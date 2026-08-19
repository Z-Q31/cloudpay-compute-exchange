const { chromium } = require('playwright');

const baseUrl = process.env.KAI_BASE_URL || 'http://127.0.0.1:19086/';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('kai-privacy-consent-v1', 'accepted');
    window.__nativeBrowserOpened = '';
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Browser: {
          open: async ({ url }) => { window.__nativeBrowserOpened = url; },
          close: async () => {},
        },
        App: {
          addListener: () => ({ remove: async () => {} }),
          getLaunchUrl: async () => null,
          getInfo: async () => ({ name: 'CloudPay', version: '1.2.0', build: '3' }),
        },
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (!response || response.status() !== 200) throw new Error(`homepage ${response?.status()}`);
  await page.locator('.account').click();
  const login = page.locator('#kaiIdentityLogin');
  await login.waitFor();
  if (await login.getAttribute('data-ready') !== 'true') throw new Error('identity channel not ready');
  if (!(await page.locator('#authDialog').evaluate(node => node.classList.contains('kai-mobile-identity')))) {
    throw new Error('dedicated mobile login page missing');
  }
  await page.locator('#kaiMobileLoginAccount').fill('mobile.qa@example.com');
  await login.click();
  await page.waitForFunction(() => Boolean(window.__nativeBrowserOpened));
  const opened = await page.evaluate(() => window.__nativeBrowserOpened);
  const url = new URL(opened);
  if (url.pathname !== '/api/auth/kai/mobile/start') throw new Error('mobile start endpoint mismatch');
  if (!/^[A-Za-z0-9_-]{48,180}$/.test(url.searchParams.get('login_handle') || '')) throw new Error('mobile handle missing');
  if (url.searchParams.has('app_nonce')) throw new Error('mobile nonce leaked into browser URL');
  if (url.searchParams.has('login_hint')) throw new Error('mobile account leaked into CloudPay start URL');
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({
    ok: true,
    dedicated_mobile_page: true,
    mobile_start: url.pathname,
    nonce_bound: true,
    nonce_not_in_url: true,
    account_not_in_start_url: true,
  }));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
