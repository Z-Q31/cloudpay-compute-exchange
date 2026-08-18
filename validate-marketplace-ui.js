const { chromium } = require('playwright');

const baseUrl = process.env.KAI_BASE_URL || 'http://127.0.0.1:4176/';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const errors = [];
  const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  admin.on('pageerror', error => errors.push(`admin: ${error.message}`));
  await admin.goto(baseUrl, { waitUntil: 'networkidle' });
  await admin.evaluate(async () => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'ops-ui@kai.test', password: 'KaiOpsUiSecure#2026' }) });
    if (!response.ok) throw new Error(`admin login ${response.status}`);
  });
  await admin.reload({ waitUntil: 'networkidle' });
  await admin.waitForSelector('[data-view="operations"]');
  await admin.locator('[data-view="operations"]').click();
  await admin.waitForSelector('#operationsView.active');
  if (!((await admin.locator('.operations-readiness').textContent()).includes('真实收款仍被安全阻断'))) throw new Error('运营台未明确显示外部通道阻断状态');

  const supplierContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const supplier = await supplierContext.newPage();
  supplier.on('pageerror', error => errors.push(`supplier: ${error.message}`));
  await supplier.goto(baseUrl, { waitUntil: 'networkidle' });
  const unique = `supplier-ui-${Date.now()}@example.com`;
  const applicationId = await supplier.evaluate(async account => {
    const registration = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '前端上架验收供应商', account, password: 'SupplierUi2026' }) }).then(response => response.json());
    const application = await fetch('/api/suppliers/applications', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': registration.csrf_token }, body: JSON.stringify({ enterprise_name: '前端上架验收供应商', credit_code: '91310000MA1K888888', agent_name: '前端测试经办人' }) }).then(response => response.json());
    return application.application.id;
  }, unique);
  await admin.evaluate(async applicationId => {
    const me = await fetch('/api/auth/me').then(response => response.json());
    const response = await fetch(`/api/admin/suppliers/${applicationId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token }, body: JSON.stringify({ decision: 'certified', reason: '前端闭环测试认证通过', bank_account_verified: true, invoice_verified: true, resource_proof_verified: true, license_verified: true }) });
    if (!response.ok) throw new Error(`supplier review ${response.status}`);
  }, applicationId);
  const intakeId = await supplier.evaluate(async () => {
    const me = await fetch('/api/auth/me').then(response => response.json());
    const response = await fetch('/api/assets/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token }, body: JSON.stringify({ kind: 'gpu', product_code: 'NVIDIA H100 80GB', region: '成都', quantity: 800, unit: 'GPU 时', evidence_summary: '前端闭环六项 GPU 验真材料摘要' }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'intake failed');
    return payload.intake.id;
  });
  await admin.evaluate(async intakeId => {
    const me = await fetch('/api/auth/me').then(response => response.json());
    const response = await fetch(`/api/admin/intakes/${intakeId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token }, body: JSON.stringify({ decision: 'verified', verification_summary: '前端闭环权属、规格、性能、网络和重复承诺检查通过' }) });
    if (!response.ok) throw new Error(`intake review ${response.status}`);
  }, intakeId);

  await supplier.reload({ waitUntil: 'networkidle' });
  await supplier.locator('[data-view="supplier"]').click();
  await supplier.waitForSelector('#supplierView.active');
  await supplier.waitForFunction(() => document.querySelector('#workbenchSupplierState')?.textContent.includes('已认证'));
  await supplier.locator('[data-supplier-open-kind="gpu"]').first().click();
  await supplier.waitForSelector('[data-supplier-panel="create"].active');
  await supplier.locator('#supplierBatch').selectOption(intakeId);
  await supplier.locator('#supplierGpuQty').fill('300');
  await supplier.locator('#supplierGpuMin').fill('8');
  await supplier.locator('#supplierTargetPrice').fill('14.90');
  await supplier.locator('#supplierFloorPrice').fill('13.50');
  await supplier.locator('#submitSupplierListing').click();
  await supplier.waitForFunction(() => document.querySelector('#supplierListingTable')?.textContent.includes('平台审核中'));
  if (!((await supplier.locator('#supplierListingTable').textContent()).includes('H100 80GB'))) throw new Error('服务端挂牌未同步回供应商工作台');

  await admin.locator('[data-operation-refresh]').click();
  await admin.waitForFunction(() => document.querySelector('[data-operation-panel="resources"]')?.textContent.includes('前端上架验收供应商'));
  await admin.locator('[data-operation-tab="resources"]').click();
  await admin.waitForSelector('[data-operation-panel="resources"].active [data-action="listing-approve"]');

  await supplier.setViewportSize({ width: 390, height: 844 });
  const overflow = await supplier.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`供应商工作台移动端横向溢出 ${overflow}px`);
  await supplier.screenshot({ path: 'outputs/marketplace-supplier-mobile.png', fullPage: false });
  await admin.screenshot({ path: 'outputs/marketplace-operations-desktop.png', fullPage: false });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ adminOperations: 'PASS', supplierServerWorkbench: 'PASS', verifiedBatchBinding: 'PASS', listingSubmission: 'PASS', adminListingQueue: 'PASS', mobileOverflow: overflow, pageErrors: errors.length }, null, 2));
  await supplierContext.close();
  await browser.close();
})().catch(error => { console.error(error.stack || error); process.exit(1); });
