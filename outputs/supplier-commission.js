(() => {
  'use strict';

  const main = document.querySelector('main');
  const navButton = document.querySelector('.nav-item[data-view="supplierCommission"]');
  if (!main || !navButton || document.querySelector('#supplierCommissionView')) return;

  const view = document.createElement('section');
  view.className = 'view supplier-commission';
  view.id = 'supplierCommissionView';
  view.innerHTML = `
    <div class="page-title supplier-commission-title">
      <div><span class="eyebrow">SUPPLIER CARD-HOUR REBATE</span><h1>供应商返佣</h1><p>返佣规则向所有 CloudPay 账户开放。已认证供应商可关联自己已成交的真实算力订单，提交后按成交卡时返还，不走现金推广佣金。</p></div>
      <span class="supplier-commission-policy">¥50,000 以上 · 平台审核</span>
    </div>

    <section class="supplier-commission-gate" id="supplierCommissionGate">
      <span class="supplier-commission-gate-mark">入口</span>
      <div><small>供应商入口</small><b id="supplierCommissionIdentity">正在读取 CloudPay 账户</b><p id="supplierCommissionHint">规则可直接查看，供应商登录后进入申报。</p></div>
      <button class="primary" type="button" id="supplierEntranceButton">进入供应商返佣</button>
    </section>

    <section class="rebate-rules" aria-labelledby="rebateRulesTitle">
      <div class="supplier-commission-section-head"><div><span class="eyebrow">TIERED RULES</span><h2 id="rebateRulesTitle">按单笔成交金额匹配返佣比例</h2><p>系统读取订单实际金额与成交卡时，金额不能手填；比例按以下档位确定，不做累进拆分。</p></div></div>
      <div class="rebate-tier-grid" id="rebateTierGrid"></div>
    </section>

    <section class="rebate-flow" aria-label="返佣流程">
      <article><i>1</i><div><b>所有账号查看规则</b><span>返佣比例、金额区间和审核规则完全公开</span></div></article>
      <article><i>2</i><div><b>完成供应商认证</b><span>从供应商工作台提交企业主体认证</span></div></article>
      <article><i>3</i><div><b>提交真实交易内容</b><span>关联本人已验收订单，由系统校验金额和卡时</span></div></article>
      <article><i>4</i><div><b>返佣或平台审核</b><span>5 万元及以下直接返卡时，以上进入审核</span></div></article>
    </section>

    <section class="supplier-rebate-portal" id="supplierRebatePortal" hidden>
      <div class="supplier-commission-section-head"><div><span class="eyebrow">SUPPLIER SUBMISSION</span><h2>提交供应商返佣</h2><p>先选择金额区间，再从本人已验收的订单中选择交易。每笔订单只能申报一次。</p></div><button class="secondary supplier-portal-close" type="button" id="supplierPortalClose">收起入口</button></div>
      <div class="rebate-portal-lock" id="rebatePortalLock" hidden>
        <span>认证</span><div><b>供应商认证通过后开放材料提交</b><p>所有账号都能查看本页完整返佣内容；只有已认证供应商可以关联真实订单并提交交易材料。</p></div><button class="primary" type="button" id="rebateGoCertification">前往供应商认证</button>
      </div>
      <div class="rebate-band-grid" id="rebateBandGrid" role="group" aria-label="选择订单金额区间">
        <button type="button" class="rebate-band" data-rebate-band="up_to_50000"><small>自动返佣通道</small><b>5 万元及以下</b><span>提交交易内容后，返佣卡时直接进入供应商算力库</span></button>
        <button type="button" class="rebate-band requires-review" data-rebate-band="over_50000"><small>平台审核通道</small><b>5 万元以上</b><span>统一按 0.2% 计算，提交后等待平台审核</span></button>
      </div>
      <form class="rebate-submission-form" id="rebateSubmissionForm" hidden>
        <div class="rebate-form-heading"><div><small id="rebateFormChannel">返佣通道</small><b id="rebateFormTitle">选择成交订单</b></div><span id="rebateEligibleCount">0 笔可申报</span></div>
        <label>本人已验收的成交订单<select id="rebateOrderSelect" required></select></label>
        <div class="rebate-order-preview" id="rebateOrderPreview"></div>
        <label>交易内容与交付说明<textarea id="rebateTransactionSummary" minlength="10" maxlength="1000" rows="5" required placeholder="请填写本次算力交易内容、资源交付和结算说明（至少 10 个字）"></textarea><small>平台只接受真实成交订单，争议或退款中的订单不能申报。</small></label>
        <button class="primary rebate-submit-button" type="submit" id="rebateSubmitButton">提交并直接返佣</button>
      </form>
    </section>

    <section class="supplier-account-data" id="supplierAccountData" hidden>
      <div class="supplier-commission-kpis">
        <article><small>成交卡时</small><strong id="rebateSourceHours">0</strong><span>已提交返佣计算</span></article>
        <article><small>已返还卡时</small><strong id="rebateIssuedHours">0</strong><span>已进入供应商算力库</span></article>
        <article><small>待审核卡时</small><strong id="rebatePendingHours">0</strong><span>单笔超过 5 万元</span></article>
        <article><small>返佣订单</small><strong id="rebateOrderCount">0</strong><span>一笔订单一条记录</span></article>
      </div>
      <section id="supplierRebateLedger">
        <div class="supplier-commission-section-head"><div><span class="eyebrow">SUPPLIER LEDGER</span><h2>我的返佣卡时账本</h2><p>订单金额决定比例，最终返还数量 = 成交卡时 × 对应比例。</p></div></div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>返佣明细</h3><span id="supplierRebateTotal">0 笔</span></div><div class="supplier-commission-table" id="supplierRebateTable"></div></div>
      </section>
    </section>

    <section id="adminRebateReview" hidden>
      <div class="supplier-commission-section-head"><div><span class="eyebrow">PLATFORM REVIEW</span><h2>大额返佣审核</h2><p>单笔成交金额超过 5 万元统一按 0.2% 计算，审核通过后向供应商算力库发放卡时。</p></div></div>
      <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>待处理记录</h3><span id="adminRebateTotal">0 笔</span></div><div class="supplier-commission-table" id="adminRebateTable"></div></div>
    </section>

    <section class="rebate-ineligible" id="rebateIneligible" hidden>
      <b>当前账户还不能进入供应商返佣</b><p>公开规则仍可正常查看。完成供应商认证后，可关联本人已验收订单提交返佣。</p>
      <button class="secondary" type="button" id="goSupplierWorkbench">前往供应商工作台</button>
    </section>`;
  main.append(view);

  const $ = selector => view.querySelector(selector);
  const safeText = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const money = cents => `¥${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const hours = value => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  const publicPolicy = { review_threshold_cents: 5000000, tiers: [
    { minimum_cents: 100, maximum_cents: 100000, rate_bps: 100 },
    { minimum_cents: 100001, maximum_cents: 1000000, rate_bps: 80 },
    { minimum_cents: 1000001, maximum_cents: 3000000, rate_bps: 50 },
    { minimum_cents: 3000001, maximum_cents: 5000000, rate_bps: 30 },
    { minimum_cents: 5000001, maximum_cents: null, rate_bps: 20, review_required: true }
  ] };
  const statusLabels = {
    issued: '已返还卡时', pending_review: '待平台审核', paused: '争议/退款冻结',
    rejected: '审核未通过', reversed: '已冲正', clawback_required: '待追回'
  };
  let csrf = '';
  let identity = null;
  let overview = { policy: publicPolicy, eligible_orders: [], rebates: [], summary: {} };
  let adminOverview = null;
  let selectedBand = '';
  let portalOpen = false;
  let submitting = false;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const method = options.method || 'GET';
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET' && csrf) headers.set('X-KAI-CSRF', csrf);
    const response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `服务请求失败（${response.status}）`);
    return payload;
  }

  function rangeLabel(tier) {
    if (tier.maximum_cents === null) return `超过 ${money((overview.policy || publicPolicy).review_threshold_cents)}`;
    if (tier.minimum_cents <= 100) return `¥1 – ${money(tier.maximum_cents)}`;
    return `超过 ${money(tier.minimum_cents - 1)} – ${money(tier.maximum_cents)}`;
  }

  function renderPolicy() {
    const policy = overview.policy || publicPolicy;
    $('#rebateTierGrid').innerHTML = policy.tiers.map((tier, index) => `
      <article class="rebate-tier ${tier.review_required ? 'requires-review' : ''}">
        <small>档位 ${index + 1}${tier.review_required ? ' · 需审核' : ''}</small>
        <b>${safeText(rangeLabel(tier))}</b>
        <strong>${(Number(tier.rate_bps) / 100).toFixed(1)}%</strong>
        <span>成交卡时 × ${(Number(tier.rate_bps) / 100).toFixed(1)}%</span>
      </article>`).join('');
  }

  function renderSupplierRows(rows) {
    $('#supplierRebateTotal').textContent = `${rows.length} 笔`;
    $('#supplierRebateTable').innerHTML = rows.length ? rows.map(row => `
      <article class="supplier-commission-row rebate-ledger-row">
        <div><small>${safeText(row.order_no)}</small><b>${safeText(row.product_code || row.gpu)} · ${safeText(row.region)}</b></div>
        <div><small>成交金额</small><b>${money(row.amount_cents)}</b></div>
        <div><small>成交卡时</small><b>${hours(row.source_card_hours)}</b></div>
        <div><small>比例</small><b>${Number(row.rebate_rate_percent).toFixed(1)}%</b></div>
        <div><small>返还卡时</small><strong>${hours(row.rebate_card_hours)}</strong></div>
        <span class="commission-state" data-state="${safeText(row.status)}">${safeText(statusLabels[row.status] || row.status)}</span>
      </article>`).join('') : '<div class="supplier-commission-empty">暂无返佣记录。请从上方供应商入口选择已验收订单进行申报。</div>';
  }

  function renderAdminRows(rows) {
    $('#adminRebateTotal').textContent = `${rows.length} 笔待处理`;
    $('#adminRebateTable').innerHTML = rows.length ? rows.map(row => `
      <article class="admin-rebate-card">
        <div class="admin-rebate-facts"><div><small>${safeText(row.order_no)}</small><b>${safeText(row.supplier_name)}</b><span>${safeText(row.supplier_account)}</span></div><dl><div><dt>成交金额</dt><dd>${money(row.amount_cents)}</dd></div><div><dt>成交卡时</dt><dd>${hours(row.source_card_hours)}</dd></div><div><dt>统一比例</dt><dd>${Number(row.rebate_rate_percent).toFixed(1)}%</dd></div><div><dt>拟返还</dt><dd>${hours(row.rebate_card_hours)} 卡时</dd></div></dl><span class="commission-state" data-state="${safeText(row.status)}">${safeText(statusLabels[row.status] || row.status)}</span></div>
        <p class="admin-rebate-summary"><b>供应商提交内容：</b>${safeText(row.transaction_summary || '未填写')}</p>
        ${row.status === 'pending_review' ? `<div class="admin-rebate-action"><input data-review-reason="${safeText(row.id)}" placeholder="填写审核依据（至少 4 个字）"><button class="secondary" type="button" data-rebate-review="reject" data-id="${safeText(row.id)}">拒绝</button><button class="primary" type="button" data-rebate-review="approve" data-id="${safeText(row.id)}">审核通过并发卡时</button></div>` : '<p class="admin-rebate-blocked">该记录因争议、退款或追偿被冻结，不能直接发放。</p>'}
      </article>`).join('') : '<div class="supplier-commission-empty">当前没有超过 5 万元的待审核返佣。</div>';
    $('#adminRebateTable').querySelectorAll('[data-rebate-review]').forEach(button => {
      button.addEventListener('click', () => reviewRebate(button.dataset.id, button.dataset.rebateReview));
    });
  }

  function matchingOrders() {
    return (overview.eligible_orders || []).filter(order => order.submission_band === selectedBand);
  }

  function renderOrderPreview() {
    const order = matchingOrders().find(item => item.id === $('#rebateOrderSelect').value);
    $('#rebateOrderPreview').innerHTML = order ? `
      <div><small>系统读取金额</small><b>${money(order.amount_cents)}</b></div>
      <div><small>成交卡时</small><b>${hours(order.card_hours)} ${safeText(order.unit)}</b></div>
      <div><small>资源</small><b>${safeText(order.product_code || order.gpu)} · ${safeText(order.region)}</b></div>` : '<p>当前区间没有可申报订单。</p>';
    $('#rebateSubmitButton').disabled = !order || submitting;
  }

  function renderSubmissionForm() {
    const form = $('#rebateSubmissionForm');
    view.querySelectorAll('[data-rebate-band]').forEach(button => {
      button.classList.toggle('active', button.dataset.rebateBand === selectedBand);
      button.disabled = !overview.eligible;
    });
    if (!overview.eligible || !selectedBand) {
      form.hidden = true;
      return;
    }
    const orders = matchingOrders();
    const isLarge = selectedBand === 'over_50000';
    $('#rebateFormChannel').textContent = isLarge ? '平台审核通道' : '自动返佣通道';
    $('#rebateFormTitle').textContent = isLarge ? '选择 5 万元以上成交订单' : '选择 5 万元及以下成交订单';
    $('#rebateEligibleCount').textContent = `${orders.length} 笔可申报`;
    $('#rebateSubmitButton').textContent = isLarge ? '提交平台审核' : '提交并直接返佣';
    $('#rebateOrderSelect').innerHTML = orders.length
      ? orders.map(order => `<option value="${safeText(order.id)}">${safeText(order.order_no)} · ${money(order.amount_cents)} · ${hours(order.card_hours)} 卡时</option>`).join('')
      : '<option value="">当前区间暂无可申报订单</option>';
    form.hidden = false;
    renderOrderPreview();
  }

  function render() {
    renderPolicy();
    const eligible = Boolean(overview.eligible);
    const summary = overview.summary || {};
    $('#supplierAccountData').hidden = !eligible;
    $('#adminRebateReview').hidden = identity?.role !== 'admin';
    $('#supplierRebatePortal').hidden = !(identity && identity.role !== 'admin' && portalOpen);
    $('#rebatePortalLock').hidden = eligible;
    $('#rebateBandGrid').classList.toggle('locked', !eligible);
    $('#rebateIneligible').hidden = true;
    renderSubmissionForm();
    if (eligible) {
      $('#rebateSourceHours').textContent = hours(summary.source_card_hours);
      $('#rebateIssuedHours').textContent = hours(summary.issued_card_hours);
      $('#rebatePendingHours').textContent = hours(summary.pending_review_card_hours);
      $('#rebateOrderCount').textContent = String(summary.order_count || 0);
      renderSupplierRows(overview.rebates || []);
    }
    if (identity?.role === 'admin') renderAdminRows(adminOverview?.supplier_rebates || []);
  }

  async function sync() {
    const gate = $('#supplierCommissionGate');
    try {
      const me = await api('/api/auth/me');
      if (!me.authenticated) {
        identity = null;
        csrf = '';
        overview = { policy: publicPolicy, eligible_orders: [], rebates: [], summary: {} };
        adminOverview = null;
        portalOpen = false;
        selectedBand = '';
        $('#supplierCommissionIdentity').textContent = '尚未登录';
        $('#supplierCommissionHint').textContent = '规则向所有账户公开；供应商登录后进入申报。';
        $('#supplierEntranceButton').textContent = '登录后进入供应商返佣';
        gate.dataset.state = 'guest';
        render();
        return;
      }
      identity = me.user;
      csrf = me.csrf_token || '';
      overview = await api('/api/supplier-rebate/overview');
      adminOverview = identity.role === 'admin' ? await api('/api/admin/overview') : null;
      const roleLabel = identity.role === 'supplier' ? '供应商账户' : identity.role === 'admin' ? '平台管理账户' : '普通账户';
      $('#supplierCommissionIdentity').textContent = `${identity.name} · ${roleLabel}`;
      $('#supplierCommissionHint').textContent = overview.eligible
        ? `有 ${(overview.eligible_orders || []).length} 笔已验收订单可申报返佣。`
        : identity.role === 'admin' ? '可在本页审核 5 万元以上的供应商返佣。' : '规则可查看，完成供应商认证后可进入申报。';
      $('#supplierEntranceButton').textContent = overview.eligible ? '进入返佣材料提交' : identity.role === 'admin' ? '查看平台审核' : '查看返佣与认证入口';
      gate.dataset.state = 'ready';
      render();
    } catch (error) {
      $('#supplierCommissionIdentity').textContent = '返佣数据读取失败';
      $('#supplierCommissionHint').textContent = error.message;
      gate.dataset.state = 'error';
    }
  }

  async function submitRebate(event) {
    event.preventDefault();
    const orderId = $('#rebateOrderSelect').value;
    const transactionSummary = $('#rebateTransactionSummary').value.trim();
    if (!orderId) {
      if (typeof window.toast === 'function') window.toast('当前区间没有可申报订单');
      return;
    }
    if (transactionSummary.length < 10) {
      if (typeof window.toast === 'function') window.toast('请填写至少 10 个字的交易内容');
      $('#rebateTransactionSummary').focus();
      return;
    }
    submitting = true;
    renderOrderPreview();
    try {
      const result = await api('/api/supplier-rebate/submissions', {
        method: 'POST', body: { order_id: orderId, submission_band: selectedBand, transaction_summary: transactionSummary }
      });
      const message = result.rebate?.status === 'issued' ? '返佣卡时已进入供应商算力库' : '已提交平台审核';
      if (typeof window.toast === 'function') window.toast(message);
      $('#rebateTransactionSummary').value = '';
      await sync();
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message);
    } finally {
      submitting = false;
      renderOrderPreview();
    }
  }

  async function reviewRebate(id, decision) {
    const input = $(`[data-review-reason="${CSS.escape(id)}"]`);
    const reason = input?.value.trim() || '';
    if (reason.length < 4) {
      if (typeof window.toast === 'function') window.toast('请填写至少 4 个字的审核依据');
      input?.focus();
      return;
    }
    try {
      await api(`/api/admin/supplier-rebates/${encodeURIComponent(id)}/review`, { method: 'POST', body: { decision, reason } });
      if (typeof window.toast === 'function') window.toast(decision === 'approve' ? '审核通过，返佣卡时已入账' : '返佣审核已拒绝');
      await sync();
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message);
    }
  }

  $('#supplierEntranceButton').addEventListener('click', () => {
    if (!identity) {
      document.querySelector('.account')?.click();
      return;
    }
    if (identity.role === 'admin') {
      $('#adminRebateReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    portalOpen = true;
    render();
    $('#supplierRebatePortal').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#supplierPortalClose').addEventListener('click', () => {
    portalOpen = false;
    render();
  });
  view.querySelectorAll('[data-rebate-band]').forEach(button => {
    button.addEventListener('click', () => {
      selectedBand = button.dataset.rebateBand;
      renderSubmissionForm();
      $('#rebateSubmissionForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  $('#rebateOrderSelect').addEventListener('change', renderOrderPreview);
  $('#rebateSubmissionForm').addEventListener('submit', submitRebate);
  $('#rebateGoCertification').addEventListener('click', () => {
    document.querySelector('.nav-item[data-view="supplier"]')?.click();
    setTimeout(() => document.querySelector('#supplierCertificationEntry')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  });
  $('#goSupplierWorkbench').addEventListener('click', () => document.querySelector('.nav-item[data-view="supplier"]')?.click());
  navButton.addEventListener('click', sync);
  window.addEventListener('kai:auth-changed', sync);
  if (new URL(location.href).searchParams.get('view') === 'supplierCommission') {
    setTimeout(() => navButton.click(), 0);
  } else {
    sync();
  }
})();
