const { chromium } = require('playwright');

const baseUrl = process.env.KAI_BASE_URL || 'http://18.163.148.84:8081/';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });

  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (!response.headers()['content-security-policy']) throw new Error('线上 CSP 缺失');
  await page.waitForSelector('#productionState[data-state="online"]');
  if (!((await page.locator('#productionState').textContent()).includes('支付 0/2'))) throw new Error('线上支付配置状态不正确');
  if (await page.locator('[data-live-listing]').count() < 6) throw new Error('线上服务端库存未加载');

  const demoStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/demo-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return response.status;
  });
  if (demoStatus < 400) throw new Error('公网演示登录未禁用');

  await page.locator('.account').click();
  await page.locator('[data-auth="register"]').click();
  if (!(await page.locator('#sendCode').isDisabled())) throw new Error('短信通道配置完成前发送按钮必须禁用');
  if (!(await page.locator('#registerPane [type="submit"]').isDisabled())) throw new Error('短信通道配置完成前注册按钮必须禁用');
  if (!((await page.locator('#registrationChannelState').textContent()).includes('短信通道待运营配置'))) throw new Error('短信配置边界提示缺失');
  await page.locator('#authDialog').evaluate(dialog => dialog.close());

  await page.evaluate(() => document.querySelector('#checkout').showModal());
  await page.waitForSelector('#checkout[open]');
  if (!(await page.locator('#demoPay').isDisabled())) throw new Error('商户配置完成前线上付款按钮必须禁用');
  if (!((await page.locator('#checkout .security-note').textContent()).includes('商户号'))) throw new Error('付款配置边界提示缺失');
  await page.locator('#checkout').evaluate(dialog => dialog.close());

  await page.locator('[data-view="capacity"]').click();
  await page.waitForSelector('#capacityView.active');
  if (await page.locator('[data-capacity-jump]').count() !== 6) throw new Error('容量与存取跳转入口不完整');
  if ((await page.locator('#hubMarketCapacity').textContent()).startsWith('0 ')) throw new Error('容量中心未展示市场可售容量');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'outputs/capacity-online-desktop.png', fullPage: false });
  await page.locator('[data-capacity-jump="market"]').click();
  await page.waitForSelector('#marketView.active');
  if (await page.locator('[data-view="roadmap"],#roadmapView').count()) throw new Error('实施路线图仍存在');
  await page.waitForFunction(() => document.querySelectorAll('.market-candle').length >= 60);
  for (const kind of ['token', 'rack', 'server', 'gpu']) {
    await page.locator(`[data-market-kind="${kind}"]`).click();
    await page.waitForFunction(selected => document.querySelector('#marketChartPanel')?.dataset.kind === selected && document.querySelectorAll('.market-candle').length >= 60, kind);
  }
  await page.locator('#marketChartPanel').screenshot({ path: 'outputs/market-chart-online.png' });

  await page.screenshot({ path: 'outputs/online-desktop-test.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  for (const view of ['market', 'capacity', 'vault', 'swap', 'quote', 'assessment']) {
    if (['swap', 'assessment'].includes(view)) {
      await page.locator('.nav-more-toggle').click();
      await page.locator(`.mobile-more-menu [data-target-view="${view}"]`).click();
    } else {
      await page.locator(`[data-view="${view}"]`).click();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`${view} 手机端横向溢出 ${overflow}px`);
    if (view === 'capacity') {
      await page.waitForTimeout(700);
      await page.screenshot({ path: 'outputs/capacity-online-mobile.png', fullPage: false });
    }
  }
  const tapTargets = await page.locator('.nav-item:visible').evaluateAll(items => items.map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })));
  if (tapTargets.some(target => target.height < 40)) throw new Error('手机端导航触控高度不足 40px');
  await page.screenshot({ path: 'outputs/online-mobile-test.png', fullPage: false });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    desktop1440: 'PASS', mobile390: 'PASS', serviceApi: 'PASS',
    serverCatalog: 'PASS', publicDemoDisabled: 'PASS', smsCredentialGate: 'PASS',
    capacityNavigation: 'PASS', marketKline: 'PASS', roadmapRemoved: 'PASS',
    paymentCredentialGate: 'PASS', securityHeaders: 'PASS', pageErrors: errors.length
  }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
