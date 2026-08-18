const { chromium } = require('playwright');

const baseUrl = process.env.KAI_BASE_URL || 'http://18.163.148.84:8081/';
const account = process.env.KAI_ADMIN_ACCOUNT;
const password = process.env.KAI_ADMIN_PASSWORD;
if (!account || !password) throw new Error('missing temporary admin credentials');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (response.status() !== 200) throw new Error(`homepage ${response.status()}`);
  const publicState = await page.evaluate(async () => {
    const health = await fetch('/api/health').then(response => response.json());
    const readiness = await fetch('/api/config/readiness').then(response => response.json());
    const catalog = await fetch('/api/catalog').then(response => response.json());
    return { health, readiness, catalog };
  });
  if (publicState.health.payment_mode !== 'provider') throw new Error('demo payment remains enabled');
  if (publicState.readiness.platform_mode !== 'marketplace') throw new Error('marketplace mode not active');
  if (!publicState.readiness.transaction_capabilities?.dual_source_metering) throw new Error('new workflow capabilities missing');
  if ((publicState.catalog.listings || []).some(item => ['lst_h100_bj', 'lst_h200_sh', 'lst_a100_cd'].includes(item.id))) throw new Error('demo listings remain public');

  await page.evaluate(async ({ account, password }) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password }) });
    if (!response.ok) throw new Error(`admin login ${response.status}`);
  }, { account, password });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-view="operations"]');
  await page.locator('[data-view="operations"]').click();
  await page.waitForSelector('#operationsView.active');
  const operationsText = await page.locator('#operationsView').textContent();
  if (!operationsText.includes('真实收款仍被安全阻断') || !operationsText.includes('修改初始管理员密码')) throw new Error('online readiness or first-password warning missing');
  await page.screenshot({ path: 'outputs/online-marketplace-operations.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`mobile overflow ${overflow}px`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ publicMarketplace: 'PASS', demoPaymentDisabled: 'PASS', demoCatalogHidden: 'PASS', adminOperations: 'PASS', readinessBlockersVisible: 'PASS', mobileOverflow: overflow, pageErrors: errors.length }, null, 2));
  await browser.close();
})().catch(error => { console.error(error.stack || error); process.exit(1); });
