const { chromium } = require('playwright');
const baseUrl = process.env.KAI_BASE_URL || 'http://127.0.0.1:4174/';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (await page.locator('#productionState[data-state="online"]').count()) {
    await page.evaluate(async () => {
      const response = await fetch('/api/auth/demo-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(`demo login ${response.status}`);
    });
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.locator('[data-view="assessment"]').click();
  await page.waitForSelector('#assessmentView.active');

  const initialCapacity = await page.locator('#capacityVerified').inputValue();
  if (initialCapacity !== '0') throw new Error(`未认证时容量应为 0，实际为 ${initialCapacity}`);

  await page.locator('#enterpriseName').fill('上海开艾算力科技有限公司');
  await page.locator('#enterpriseCode').fill('91310000MA1K123456');
  await page.locator('#enterpriseLegalRepresentative').fill('张法人');
  await page.locator('#enterpriseAgent').fill('张经办');
  await page.locator('#enterpriseContactPhone').fill('13800138000');
  await page.locator('#enterpriseLicenseFile').setInputFiles({ name: 'three-in-one-license.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgpLQUktTElDRU5TRS1VSQ==', 'base64') });
  await page.locator('#enterpriseDeclaration').check();
  for (const id of ['enterpriseAuthorization', 'enterpriseBank', 'enterpriseInvoice', 'enterpriseLicense', 'enterpriseOwnership']) {
    await page.locator(`#${id}`).selectOption('verified');
  }
  await page.locator('#submitEnterprise').click();
  await page.waitForFunction(() => document.querySelector('#supplierStatusText')?.textContent.trim() === '审核中');
  if ((await page.locator('#supplierStatusText').textContent()).trim() !== '审核中') throw new Error('企业认证提交后未进入审核中');

  await page.locator('#supplierStatusControl').selectOption('certified');
  if ((await page.locator('#capacityVerified').inputValue()) !== '0') throw new Error('GPU 验真前容量不应释放');
  await page.locator('#runGpuVerification').click();
  if ((await page.locator('#gpuGateCount').textContent()).trim() !== '6 / 6') throw new Error('GPU 六项验真未全部通过');
  const verifiedCapacity = Number(await page.locator('#capacityVerified').inputValue());
  if (!(verifiedCapacity > 0)) throw new Error('认证与验真通过后未释放已验真容量');

  await page.locator('[data-access-mode="connector"]').click();
  if (!(await page.locator('[data-access-mode="connector"]').evaluate(el => el.classList.contains('active')))) throw new Error('接入模式不能切换');
  await page.locator('#verifyConnectorReport').click();
  if (!((await page.locator('#connectorTrustState').textContent()).includes('验签通过'))) throw new Error('连接器有效签名上报未通过');
  await page.locator('#simulateConnectorOffline').click();
  if (!((await page.locator('#connectorTrustState').textContent()).includes('停止新订单'))) throw new Error('连接器失联未停止新订单');
  if (Number(await page.locator('#capacityVerified').inputValue()) !== verifiedCapacity) throw new Error('连接器失联不应删除已验真资源');
  if (!(Number(await page.locator('#capacityFrozen').inputValue()) > 0)) throw new Error('连接器失联未触发风控冻结');
  await page.locator('#verifyConnectorReport').click();

  const beforeTotal = await page.locator('#standardTotalCost').textContent();
  await page.locator('#costTax').fill('100');
  const afterTotal = await page.locator('#standardTotalCost').textContent();
  if (beforeTotal === afterTotal) throw new Error('标准化总成本未随成本项变化');
  if (!(await page.locator('#standardEffectiveUnit').textContent()).includes('/ GPU 时')) throw new Error('标准化有效单价单位不正确');

  await page.locator('#enterpriseBank').selectOption('changed');
  if ((await page.locator('#supplierStatusText').textContent()).trim() !== '审核中') throw new Error('结算账户变化未触发即时复核');
  if ((await page.locator('#capacityVerified').inputValue()) !== '0') throw new Error('即时复核期间容量未冻结');

  if (await page.locator('#quotePriceGovernance').count() !== 1) throw new Error('购入三层价格面板缺失');
  if (await page.locator('#swapPriceGovernance').count() !== 1) throw new Error('置换三层价格面板缺失');
  const quoteGovernance = await page.locator('#quotePriceGovernance').textContent();
  if (!quoteGovernance.includes('市场参考价') || !quoteGovernance.includes('供应商底价不公开') || !quoteGovernance.includes('订单执行价')) throw new Error('购入三层价格口径不完整');
  if (!quoteGovernance.includes('标准化总成本') || !quoteGovernance.includes('标准化有效单价')) throw new Error('标准化价格公式缺失');

  await page.locator('[data-view="quote"]').click();
  if (await page.locator('#tokenPricingBoundary').count() !== 1) throw new Error('Token 产品边界面板缺失');
  const capReference = await page.locator('#tokenOrderReference').textContent();
  if (!capReference.includes('/ Token 容量时')) throw new Error('Token 容量时未使用独立价格单位');
  await page.locator('#tokenOrderKind').selectOption('tokenusage');
  const usageReference = await page.locator('#tokenOrderReference').textContent();
  if (!usageReference.includes('/ 百万 Token 实际用量')) throw new Error('Token 实际用量未使用独立价格单位');
  if (capReference === usageReference) throw new Error('Token 容量时与实际用量被混成同一价格');
  const tokenIdentity = await page.locator('#tokenOrderIdentity').textContent();
  if (!tokenIdentity.includes('KAI 模型网关') || !tokenIdentity.includes('32K 上下文') || !tokenIdentity.includes('Token')) throw new Error('Token 订单身份字段不完整');
  if (!((await page.locator('.token-index-card').textContent()).includes('不是统一成交价'))) throw new Error('模型 Token 综合行情未标明仅为成本指数');
  await page.locator('#tokenPricingBoundary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'outputs/token-pricing-test.png', fullPage: false });
  await page.locator('[data-transaction-mode="fixed"]').click();
  await page.locator('#transactionAction').click();
  if (!((await page.locator('#transactionResult').textContent()).includes('Reservation 成功'))) throw new Error('固定价购买未原子预留容量');
  await page.locator('#compareMetering').click();
  if (!((await page.locator('#settlementStatus').textContent()).includes('计量一致'))) throw new Error('双源计量正常差异未通过');
  await page.locator('#kaiMeter').fill('600');
  await page.locator('#compareMetering').click();
  if (!((await page.locator('#settlementStatus').textContent()).includes('暂停自动结算'))) throw new Error('计量超阈值未暂停自动结算');

  const eventRowsBefore = await page.locator('#eventLog li').count();
  await page.locator('#eventIdempotency').fill('IDEM-TEST-001');
  await page.locator('#appendConsistencyEvent').click();
  const eventRowsAfter = await page.locator('#eventLog li').count();
  await page.locator('#eventIdempotency').fill('IDEM-TEST-001');
  await page.locator('#appendConsistencyEvent').click();
  if (eventRowsAfter !== eventRowsBefore + 1 || await page.locator('#eventLog li').count() !== eventRowsAfter) throw new Error('幂等键未阻止重复写入');
  await page.screenshot({ path: 'outputs/transaction-governance-test.png', fullPage: false });

  const assetsBefore = await page.locator('#assetTable .asset-row').count();
  await page.locator('#gpuSelect').selectOption('H100');
  await page.locator('#buyQuote').click();
  await page.locator('#demoPay').click();
  await page.waitForSelector('#checkout [data-step="success"].active');
  if (await page.locator('#checkout').getAttribute('data-order-final-state') !== 'paid') throw new Error('订单必须由服务端签名回调推进为已支付');
  if (await page.locator('#assetTable .asset-row').count() !== assetsBefore) throw new Error('前端支付页错误地直接存入了资产');
  await page.locator('#returnToOrder').click();

  await page.locator('[data-view="swap"]').click();
  await page.locator('#buildSwapSnapshot').click();
  if ((await page.locator('#bilateralSnapshotTime').textContent()).trim() === '—') throw new Error('双边置换未生成同点价值快照');
  await page.screenshot({ path: 'outputs/bilateral-swap-test.png', fullPage: false });
  await page.locator('#lockBilateralSwap').click();
  if (!((await page.locator('#bilateralStatus').textContent()).includes('原子锁定'))) throw new Error('双边容量未原子锁定');
  await page.locator('#rollbackBilateralSwap').click();
  if (!((await page.locator('#bilateralStatus').textContent()).includes('整体回滚'))) throw new Error('置换失败未整体回滚');
  await page.locator('.asset-kind[data-side="from"] [data-kind="tokencap"]').click();
  await page.locator('.asset-kind[data-side="to"] [data-kind="tokenusage"]').click();
  if (!((await page.locator('#swapReceive').textContent()).includes('不可直接换算'))) throw new Error('跨 Token 单位在产品身份不一致时应拒绝换算');
  await page.locator('#swapToRegion').selectOption(await page.locator('#swapFromRegion').inputValue());
  if ((await page.locator('#swapReceive').textContent()).includes('不可直接换算')) throw new Error('同模型同服务档位下未恢复 Token 单位换算');
  await page.locator('.swap-layout').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'outputs/token-swap-test.png', fullPage: false });

  await page.locator('[data-view="recommend"]').click();
  await page.locator('#agentOrderState').selectOption('paid');
  await page.locator('#recordAgentCommission').click();
  if (!((await page.locator('#agentSnapshotState').textContent()).includes('等待订单验收'))) throw new Error('支付成功不应直接计提佣金');
  await page.locator('#agentOrderState').selectOption('accepted');
  await page.locator('#recordAgentCommission').click();
  if (!((await page.locator('#agentSnapshotCommission').textContent()).includes('+¥'))) throw new Error('订单验收后未追加佣金计提分录');
  await page.screenshot({ path: 'outputs/agent-governance-test.png', fullPage: false });

  await page.locator('[data-view="assessment"]').click();
  await page.locator('[data-assess-kind="tokencap"]').click();
  if (!((await page.locator('#standardEffectiveUnit').textContent()).includes('/ Token 容量时'))) throw new Error('供应商评估未区分 Token 容量时');
  await page.locator('[data-assess-kind="tokenusage"]').click();
  if (!((await page.locator('#standardEffectiveUnit').textContent()).includes('/ 百万 Token 实际用量'))) throw new Error('供应商评估未区分 Token 实际用量');

  await page.screenshot({ path: 'outputs/assessment-enterprise-test.png', fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.nav-more-toggle').click();
  await page.locator('.mobile-more-menu [data-target-view="assessment"]').click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`移动端横向溢出 ${overflow}px`);
  if (await page.locator('[data-view="roadmap"],#roadmapView').count()) throw new Error('实施路线图入口或页面仍然存在');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    enterpriseFlow: 'PASS', gpuVerification: 'PASS', standardPrice: 'PASS',
    priceLayers: 'PASS', transactionModes: 'PASS', bilateralSwap: 'PASS',
    serverPaymentGuard: 'PASS', dualSourceMetering: 'PASS', consistency: 'PASS',
    singleTierAgent: 'PASS', connectorTrust: 'PASS', instantReview: 'PASS',
    tokenProductSeparation: 'PASS', tokenOrderIdentity: 'PASS', tokenBasketIndex: 'PASS',
    roadmapRemoved: 'PASS', mobileOverflow: overflow, pageErrors: errors.length
  }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
