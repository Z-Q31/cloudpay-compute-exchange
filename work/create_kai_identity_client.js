const { spawn } = require('child_process');
const { chromium } = require('playwright');

const AUTH_ORIGIN = 'https://auth.kai.com';
const WEB_CALLBACK = 'https://cloudpay.kai.com/api/auth/kai/callback';
const MOBILE_CALLBACK = 'https://cloudpay.kai.com/api/auth/kai/mobile/callback';
const CALLBACKS = [WEB_CALLBACK, MOBILE_CALLBACK];
const CLOUDPAY_HOME = 'https://cloudpay.kai.com/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'tmp/kai-identity-client-browser';

async function api(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    return { ok: response.ok, status: response.status, body };
  }, { path, options });
  if (!result.ok) {
    const detail = result.body?.message || result.body?.error || result.body || `HTTP ${result.status}`;
    const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
    const error = new Error(`${path} [${result.status}]: ${message}`);
    error.status = result.status;
    error.body = result.body;
    throw error;
  }
  return result.body;
}

async function findOrCreateOrganization(page) {
  const me = await api(page, '/api/me');
  const organizations = me.organizations || me.data?.organizations || [];
  const existing = organizations.find((item) => item.slug === 'cloudpay' || item.name === 'CloudPay');
  if (existing) return existing;
  return api(page, '/api/organizations', {
    method: 'POST',
    body: { name: 'CloudPay', slug: 'cloudpay' },
  });
}

async function findOrCreateProject(page, organizationId) {
  const projects = await api(page, `/api/organizations/${organizationId}/projects`);
  const list = Array.isArray(projects) ? projects : projects.projects || projects.data || [];
  const existing = list.find((item) => item.slug === 'cloudpay' || item.name === 'CloudPay');
  if (existing) return existing;
  return api(page, `/api/organizations/${organizationId}/projects`, {
    method: 'POST',
    body: { name: 'CloudPay', slug: 'cloudpay' },
  });
}

async function createOrRotateApplication(page, organizationId, projectId) {
  const base = `/api/organizations/${organizationId}/projects/${projectId}/applications`;
  const applications = await api(page, base);
  const list = Array.isArray(applications) ? applications : applications.applications || applications.data || [];
  const existing = list.find((item) =>
    item.name === 'CloudPay Production' || (item.redirectUris || []).includes(WEB_CALLBACK));
  if (existing) {
    const detail = await api(page, `${base}/${existing.id}`);
    const current = detail.application || detail;
    await api(page, `${base}/${existing.id}`, {
      method: 'PATCH',
      body: {
        name: current.name || 'CloudPay Production',
        accessMode: current.accessMode || 'authenticated_users',
        scopes: [...new Set([...(current.scopes || []), 'openid', 'profile', 'email'])],
        redirectUris: [...new Set([...(current.redirectUris || []), ...CALLBACKS])],
        postLogoutRedirectUris: [...new Set([...(current.postLogoutRedirectUris || []), CLOUDPAY_HOME])],
        backchannelLogoutUri: current.backchannelLogoutUri || null,
      },
    });
    const credential = await api(page, `${base}/${existing.id}/rotate-secret`, { method: 'POST' });
    return {
      application: existing,
      credential: credential.credential || credential,
      rotated: true,
    };
  }
  const created = await api(page, base, {
    method: 'POST',
    body: {
      name: 'CloudPay Production',
      clientType: 'confidential',
      accessMode: 'authenticated_users',
      scopes: ['openid', 'profile', 'email'],
      redirectUris: CALLBACKS,
      postLogoutRedirectUris: [CLOUDPAY_HOME],
      backchannelLogoutUri: null,
    },
  });
  return { ...created, rotated: false };
}

function extractCredential(result) {
  const credential = result.credential || result.application?.credential || {};
  const application = result.application || result;
  const clientId = credential.clientId || credential.client_id || application.clientId || application.client_id;
  const clientSecret = credential.clientSecret || credential.client_secret;
  if (!clientId || !clientSecret) throw new Error('KAI Identity did not return a complete client credential');
  return { client_id: clientId, client_secret: clientSecret };
}

function deployCredential(credential) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['work/deploy_kai_identity_credentials.py'], {
      cwd: process.cwd(),
      env: { ...process.env, KAI_SSH_PASSWORD: process.env.KAI_SSH_PASSWORD || 'ubuntu' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) return resolve(JSON.parse(stdout));
      reject(new Error(stderr.trim() || `credential deployment failed (${code})`));
    });
    child.stdin.end(JSON.stringify(credential));
  });
}

let browserContext;

(async () => {
  browserContext = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    executablePath: EDGE,
    viewport: { width: 1280, height: 860 },
  });
  const page = browserContext.pages()[0] || await browserContext.newPage();
  await page.goto(`${AUTH_ORIGIN}/sign-in`, { waitUntil: 'domcontentloaded' });
  console.log(JSON.stringify({ status: 'waiting_for_kai_identity_login' }));

  const loginDeadline = Date.now() + 15 * 60 * 1000;
  let signedIn = false;
  while (Date.now() < loginDeadline) {
    signedIn = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/me', { credentials: 'include' });
        return response.ok;
      } catch { return false; }
    });
    if (signedIn) break;
    await page.waitForTimeout(1000);
  }
  if (!signedIn) throw new Error('KAI Identity login timed out');

  console.log(JSON.stringify({ status: 'creating_cloudpay_client' }));
  const organization = await findOrCreateOrganization(page);
  const project = await findOrCreateProject(page, organization.id);
  const application = await createOrRotateApplication(page, organization.id, project.id);
  const credential = extractCredential(application);
  const deployed = await deployCredential(credential);
  credential.client_secret = '';
  await page.goto(CLOUDPAY_HOME, { waitUntil: 'domcontentloaded' });
  console.log(JSON.stringify({
    status: 'complete',
    organization: organization.name,
    project: project.name,
    rotated: application.rotated,
    ...deployed,
  }));
  await browserContext.close();
})().catch(async (error) => {
  console.error(JSON.stringify({ status: 'failed', message: error.message }));
  if (browserContext) await browserContext.close().catch(() => {});
  process.exitCode = 1;
});
