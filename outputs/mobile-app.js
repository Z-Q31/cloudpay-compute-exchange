(function () {
  'use strict';

  var mobile = window.matchMedia('(max-width: 760px)');
  var scheduled = false;
  var groups = [
    ['#quoteView > #quotePriceGovernance', '定价依据与三层价格'],
    ['#quoteView > #tokenPricingBoundary', 'Token 产品口径与订单配置'],
    ['#quoteView > #transactionMechanism', '交易机制、计量与一致性'],
    ['#quoteView > .compare-rail', '供应商与产品对比'],
    ['#quoteView > .model-panel', '100 个模型定价覆盖'],
    ['#swapView > .pricing-method', '资产计价方法'],
    ['#swapView > #swapRmbStandard', '人民币标准价换算'],
    ['#swapView > #swapPriceGovernance', '置换价格治理'],
    ['#swapView > #bilateralSwapPanel', '双边置换与交割'],
    ['#assessmentView .enterprise-gate > .access-mode-section', '接入方式与权限范围'],
    ['#assessmentView .enterprise-gate > #connectorTrustPanel', '连接器信任边界'],
    ['#assessmentForm > .standard-price-editor', '标准化成本明细'],
    ['#assessmentView > #gpuDepositGate', '03 · GPU 存入条件'],
    ['#assessmentView > .capacity-ledger', '04 · 容量台账'],
    ['#assessmentView > .withdrawal-panel', '05 · 取出申请'],
    ['#assessmentView > .assessment-process', '完整验真流程说明'],
    ['#supplierView > .supplier-audit-panel', '供应商审核与合规记录'],
    ['#supplierView > .supplier-history', '历史提交与状态记录']
  ];

  function wrap(node, label) {
    if (!node || node.closest('.mobile-section-group')) return;
    var details = document.createElement('details');
    details.className = 'mobile-section-group';
    var summary = document.createElement('summary');
    summary.innerHTML = '<span>' + label + '</span><b aria-hidden="true">展开</b>';
    node.before(details);
    node.dataset.mobileSectionContent = 'true';
    details.append(summary, node);
  }

  function enhance() {
    scheduled = false;
    if (!mobile.matches) return;
    groups.forEach(function (definition) {
      document.querySelectorAll(definition[0]).forEach(function (node) { wrap(node, definition[1]); });
    });
  }

  function unwrap() {
    document.querySelectorAll('.mobile-section-group').forEach(function (details) {
      var content = details.querySelector(':scope > [data-mobile-section-content]');
      if (!content) return;
      content.removeAttribute('data-mobile-section-content');
      details.replaceWith(content);
    });
  }

  function sync() {
    if (mobile.matches) enhance();
    else unwrap();
  }

  function schedule() {
    if (scheduled || !mobile.matches) return;
    scheduled = true;
    requestAnimationFrame(enhance);
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  mobile.addEventListener('change', sync);
  sync();
})();
