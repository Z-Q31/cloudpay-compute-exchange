const { chromium } = require('playwright');

const baseUrl = process.env.KAI_BASE_URL || 'http://127.0.0.1:19084/';
const expectedReady = process.env.KAI_EXPECT_IDENTITY_READY !== 'false';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (!response || response.status() !== 200) throw new Error(`homepage ${response?.status()}`);
  await page.locator('.account').click();
  await page.locator('#authDialog[open] #kaiIdentityLogin').waitFor();

  const auth = await page.locator('#authDialog').evaluate((dialog) => ({
    text: dialog.textContent,
    registrationHidden: getComputedStyle(document.querySelector('#registerPane')).display === 'none',
    tabsHidden: getComputedStyle(document.querySelector('.auth-tabs')).display === 'none',
    loginReady: document.querySelector('#kaiIdentityLogin').dataset.ready,
    loginHref: document.querySelector('#kaiIdentityLogin').getAttribute('href'),
    fallback: document.querySelector('.identity-local-fallback summary').textContent,
  }));
  if (!auth.registrationHidden || !auth.tabsHidden) throw new Error('legacy registration remains visible');
  if (auth.text.includes('阿里云') || auth.text.includes('短信验证码')) throw new Error('legacy Aliyun/SMS copy remains visible');
  if ((auth.loginReady === 'true') !== expectedReady) throw new Error('KAI Identity readiness not reflected in UI');
  if (auth.loginHref !== '/api/auth/kai/start?return_to=/') throw new Error('KAI Identity start URL mismatch');
  if (!auth.fallback.includes('后台工作人员')) throw new Error('operations fallback missing');
  await page.locator('#authDialog').screenshot({ path: 'outputs/kai-identity-desktop.png' });

  const apiChecks = await page.evaluate(async () => {
    const readiness = await fetch('/api/config/readiness').then((item) => item.json());
    const register = await fetch('/api/auth/send-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '13800138000' }),
    });
    const callback = await fetch('/api/auth/kai/callback?code=invalid&state=invalid', { redirect: 'manual' });
    return {
      authProvider: readiness.auth_provider,
      identityConfigured: readiness.identity.configured,
      legacyRegistrationStatus: register.status,
      callbackStatus: callback.status,
    };
  });
  if (apiChecks.authProvider !== 'kai_identity' || apiChecks.identityConfigured !== expectedReady) throw new Error('identity readiness API failed');
  if (apiChecks.legacyRegistrationStatus !== 410) throw new Error('legacy registration API not disabled');
  if (apiChecks.callbackStatus !== 0 && apiChecks.callbackStatus !== 302) throw new Error('callback did not redirect safely');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.account').click();
  await page.locator('#authDialog[open] #kaiIdentityLogin').waitFor();
  const overflow = await page.locator('#authDialog').evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth);
  if (overflow > 1) throw new Error(`mobile auth overflow ${overflow}px`);
  await page.locator('#authDialog').screenshot({ path: 'outputs/kai-identity-mobile.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ desktop: 'PASS', mobile390: 'PASS', overflow, ...apiChecks, pageErrors: errors.length }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
