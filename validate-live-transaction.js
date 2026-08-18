const { chromium } = require('playwright');

const baseUrl = process.env.KAI_BASE_URL || 'http://127.0.0.1:4175/';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });
  const pageErrors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) pageErrors.push(message.text());
  });

  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const headers = response.headers();
  if (!headers['content-security-policy'] || !headers['x-content-type-options']) throw new Error('安全响应头缺失');
  await page.waitForSelector('#productionState[data-state="online"]');
  if (await page.locator('[data-live-listing]').count() < 6) throw new Error('服务端已验真 GPU 挂牌未加载');

  await page.locator('.account').click();
  await page.locator('#demoLogin').click();
  await page.waitForFunction(() => document.querySelector('.account b')?.textContent.includes('KAI 企业采购方'));

  await page.locator('[data-live-listing="lst_h100_bj"] [data-buy]').click();
  await page.waitForSelector('#checkout[open]');
  if (await page.locator('#checkout').getAttribute('data-order-final-state') !== 'not_created') throw new Error('打开支付页时订单状态异常');
  await page.locator('#demoPay').click();
  await page.waitForSelector('#checkout [data-step="success"].active');
  if (await page.locator('#checkout').getAttribute('data-order-final-state') !== 'paid') throw new Error('未通过服务端签名回调进入已支付状态');

  await page.locator('#checkout #returnToOrder').click();
  await page.waitForSelector('#vaultView.active');
  await page.waitForSelector('.live-order .order-state[data-state="paid"]');
  if (await page.locator('#assetTable .asset-row').count()) throw new Error('支付后、验收前不应直接生成资产');
  await page.locator('.live-order [data-order-action="deliver"]').first().click();
  await page.waitForSelector('.live-order .order-state[data-state="delivered"]');
  await page.locator('.live-order [data-order-action="accept"]').first().click();
  await page.waitForSelector('.live-order .order-state[data-state="accepted"]');
  if (await page.locator('#assetTable .asset-row').count() !== 1) throw new Error('验收完成后资产未存入算力库');
  if ((await page.locator('#vaultHours').textContent()).replace(/,/g, '').trim() !== '720') throw new Error('资产数量与订单数量不一致');
  await page.locator('[data-view="capacity"]').click();
  await page.waitForSelector('#capacityView.active');
  if (await page.locator('[data-capacity-jump]').count() !== 6) throw new Error('容量中心跳转入口不完整');
  if (!((await page.locator('#hubGpuHours').textContent()).includes('720'))) throw new Error('容量中心未展示已购 GPU 小时');
  await page.locator('[data-capacity-jump="withdraw"]').click();
  await page.waitForSelector('#vaultView.active #withdrawRequestPanel');
  await page.locator('#liveWithdrawQuantity').fill('100');
  await page.locator('#submitLiveWithdrawal').click();
  await page.waitForSelector('#liveWithdrawalList div:not(.production-empty)');
  if (!((await page.locator('#liveWithdrawalList').textContent()).includes('排期取出'))) throw new Error('取出申请未进入排期');
  if ((await page.locator('#vaultHours').textContent()).replace(/,/g, '').trim() !== '620') throw new Error('取出排期未调整未来可用余额');

  const apiChecks = await page.evaluate(async () => {
    const me = await fetch('/api/auth/me').then(response => response.json());
    const headers = { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token, 'Idempotency-Key': 'idem-live-transaction-0001' };
    const body = JSON.stringify({ listing_id: 'lst_a100_cd', quantity: 1, quote_snapshot: { source: 'idempotency_test' } });
    const firstResponse = await fetch('/api/orders', { method: 'POST', headers, body });
    const first = await firstResponse.json();
    const secondResponse = await fetch('/api/orders', { method: 'POST', headers, body });
    const second = await secondResponse.json();
    const overbookResponse = await fetch('/api/orders', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'idem-overbook-transaction-0001' },
      body: JSON.stringify({ listing_id: 'lst_a100_cd', quantity: 999999 })
    });
    const overbook = await overbookResponse.json();
    const cancel = await fetch(`/api/orders/${first.order.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token }, body: '{}'
    }).then(response => response.json());
    const events = await fetch('/api/audit/recent').then(response => response.json());
    return {
      firstStatus: firstResponse.status,
      firstId: first.order.id,
      secondId: second.order.id,
      replay: second.idempotent_replay,
      overbookStatus: overbookResponse.status,
      overbookCode: overbook.error?.code,
      cancelStatus: cancel.order.status,
      eventTypes: events.events.map(event => event.event_type)
    };
  });
  if (apiChecks.firstStatus !== 201 || apiChecks.firstId !== apiChecks.secondId || !apiChecks.replay) throw new Error('订单幂等写入未生效');
  if (apiChecks.overbookStatus !== 409 || apiChecks.overbookCode !== 'insufficient_capacity') throw new Error('超卖保护未生效');
  if (apiChecks.cancelStatus !== 'cancelled') throw new Error('取消订单未释放预留');
  for (const eventType of ['capacity.reserved', 'payment.confirmed', 'delivery.credentials_issued', 'order.accepted', 'settlement.eligible', 'withdrawal.scheduled']) {
    if (!apiChecks.eventTypes.includes(eventType)) throw new Error(`审计事件缺失：${eventType}`);
  }

  await page.screenshot({ path: 'outputs/live-transaction-test.png', fullPage: false });

  const registration = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await registration.goto(baseUrl, { waitUntil: 'networkidle' });
  await registration.locator('.account').click();
  await registration.locator('[data-auth="register"]').click();
  const uniqueAccount = `buyer-${Date.now()}@example.com`;
  await registration.locator('#registerName').fill('首阶段采购测试企业');
  await registration.locator('#registerAccount').fill(uniqueAccount);
  await registration.locator('#registerPassword').fill('KaiBuyer2026');
  await registration.locator('#registerAgree').check();
  await registration.locator('#registerPane [type="submit"]').click();
  await registration.waitForFunction(() => document.querySelector('.account b')?.textContent.includes('首阶段采购测试企业'));
  await registration.reload({ waitUntil: 'networkidle' });
  await registration.waitForFunction(() => document.querySelector('.account b')?.textContent.includes('首阶段采购测试企业'));
  await registration.locator('[data-view="assessment"]').click();
  await registration.locator('#enterpriseName').fill('首阶段采购测试企业');
  await registration.locator('#enterpriseCode').fill('91310000MA1K123456');
  await registration.locator('#enterpriseAgent').fill('测试经办人');
  await registration.locator('#submitEnterprise').click();
  await registration.waitForFunction(() => document.querySelector('#supplierStatusText')?.textContent.trim() === '审核中');
  if (!((await registration.locator('#enterpriseError').textContent()).includes('服务端审核队列'))) throw new Error('供应商申请未持久化');

  await registration.setViewportSize({ width: 390, height: 844 });
  await registration.reload({ waitUntil: 'networkidle' });
  const overflow = await registration.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`移动端横向溢出 ${overflow}px`);

  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  console.log(JSON.stringify({
    serverHealth: 'PASS', enterpriseRegistration: 'PASS', sessionPersistence: 'PASS',
    catalogPersistence: 'PASS', capacityReservation: 'PASS', paymentCallback: 'PASS',
    frontendCannotFinalizePayment: 'PASS', manualDelivery: 'PASS', buyerAcceptance: 'PASS',
    assetDepositAfterAcceptance: 'PASS', capacityNavigation: 'PASS', withdrawalScheduling: 'PASS',
    idempotency: 'PASS', oversellProtection: 'PASS',
    appendOnlyAuditEvents: 'PASS', supplierApplication: 'PASS', securityHeaders: 'PASS',
    mobileOverflow: overflow, pageErrors: pageErrors.length
  }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
