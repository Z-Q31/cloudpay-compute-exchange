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
      <div><span class="eyebrow">SUPPLIER CARD-HOUR REBATE</span><h1>供应商返佣</h1><p>供应商算力订单完成验收后，平台按实际成交卡时和订单金额档位计算返佣。返佣以 GPU 卡时入账，不走现金推广佣金。</p></div>
      <span class="supplier-commission-policy">¥50,000 以上 · 平台审核</span>
    </div>

    <section class="supplier-commission-gate" id="supplierCommissionGate">
      <span class="supplier-commission-gate-mark">卡时</span>
      <div><small>返佣账户</small><b id="supplierCommissionIdentity">正在读取 CloudPay 账户</b><p id="supplierCommissionHint">登录后查看返佣卡时和审核进度。</p></div>
      <button class="secondary" type="button" id="supplierCommissionLogin">登录账户</button>
    </section>

    <section class="rebate-rules" aria-labelledby="rebateRulesTitle">
      <div class="supplier-commission-section-head"><div><span class="eyebrow">TIERED RULES</span><h2 id="rebateRulesTitle">按单笔成交金额匹配返佣比例</h2><p>金额越大，返还卡时的绝对数量随成交卡时增加；比例按以下档位确定，不做累进拆分。</p></div></div>
      <div class="rebate-tier-grid" id="rebateTierGrid"></div>
    </section>

    <section class="rebate-flow" aria-label="返佣流程">
      <article><i>1</i><div><b>订单完成验收</b><span>仅计算供应商已成交的 GPU 卡时订单</span></div></article>
      <article><i>2</i><div><b>确认成交卡时</b><span>以订单的标准 GPU 时数量为计算基数</span></div></article>
      <article><i>3</i><div><b>匹配金额档位</b><span>5 万元及以下自动返还，超过 5 万元进入审核</span></div></article>
      <article><i>4</i><div><b>返还供应商算力库</b><span>生成独立卡时资产批次，全程留痕</span></div></article>
    </section>

    <div id="supplierCommissionContent" hidden>
      <section class="supplier-commission-kpis">
        <article><small>成交卡时</small><strong id="rebateSourceHours">0</strong><span>已纳入返佣计算</span></article>
        <article><small>已返还卡时</small><strong id="rebateIssuedHours">0</strong><span>已进入供应商算力库</span></article>
        <article><small>待审核卡时</small><strong id="rebatePendingHours">0</strong><span>单笔超过 5 万元</span></article>
        <article><small>返佣订单</small><strong id="rebateOrderCount">0</strong><span>一笔订单一条记录</span></article>
      </section>

      <section id="supplierRebateLedger" hidden>
        <div class="supplier-commission-section-head"><div><span class="eyebrow">SUPPLIER LEDGER</span><h2>我的返佣卡时账本</h2><p>订单金额只决定比例，最终返还数量 = 成交卡时 × 对应比例。</p></div></div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>返佣明细</h3><span id="supplierRebateTotal">0 笔</span></div><div class="supplier-commission-table" id="supplierRebateTable"></div></div>
      </section>

      <section id="adminRebateReview" hidden>
        <div class="supplier-commission-section-head"><div><span class="eyebrow">PLATFORM REVIEW</span><h2>大额返佣审核</h2><p>单笔成交金额超过 5 万元统一按 0.2% 计算，审核通过后才向供应商算力库发放卡时。</p></div></div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>待处理记录</h3><span id="adminRebateTotal">0 笔</span></div><div class="supplier-commission-table" id="adminRebateTable"></div></div>
      </section>

      <section class="rebate-ineligible" id="rebateIneligible" hidden>
        <b>当前账户不是已认证供应商</b><p>该板块只向已认证供应商展示自己的返佣卡时账本；平台管理账户可处理大额审核。</p>
      </section>
    </div>`;
  main.append(view);

  const $ = selector => view.querySelector(selector);
  const safeText = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const money = cents => `¥${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const hours = value => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  const statusLabels = {
    issued: '已返还卡时', pending_review: '待平台审核', paused: '争议/退款冻结',
    rejected: '审核未通过', reversed: '已冲正', clawback_required: '待追回'
  };
  let csrf = '';
  let identity = null;
  let overview = null;
  let adminOverview = null;

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
    if (tier.maximum_cents === null) return `超过 ${money(overview.policy.review_threshold_cents)}`;
    if (tier.minimum_cents <= 100) return `¥1 – ${money(tier.maximum_cents)}`;
    return `超过 ${money(tier.minimum_cents - 1)} – ${money(tier.maximum_cents)}`;
  }

  function renderPolicy() {
    $('#rebateTierGrid').innerHTML = overview.policy.tiers.map((tier, index) => `
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
      </article>`).join('') : '<div class="supplier-commission-empty">暂无返佣记录。供应商 GPU 卡时订单完成验收后会自动写入。</div>';
  }

  function renderAdminRows(rows) {
    $('#adminRebateTotal').textContent = `${rows.length} 笔待处理`;
    $('#adminRebateTable').innerHTML = rows.length ? rows.map(row => `
      <article class="admin-rebate-card">
        <div class="admin-rebate-facts"><div><small>${safeText(row.order_no)}</small><b>${safeText(row.supplier_name)}</b><span>${safeText(row.supplier_account)}</span></div><dl><div><dt>成交金额</dt><dd>${money(row.amount_cents)}</dd></div><div><dt>成交卡时</dt><dd>${hours(row.source_card_hours)}</dd></div><div><dt>统一比例</dt><dd>${Number(row.rebate_rate_percent).toFixed(1)}%</dd></div><div><dt>拟返还</dt><dd>${hours(row.rebate_card_hours)} 卡时</dd></div></dl><span class="commission-state" data-state="${safeText(row.status)}">${safeText(statusLabels[row.status] || row.status)}</span></div>
        ${row.status === 'pending_review' ? `<div class="admin-rebate-action"><input data-review-reason="${safeText(row.id)}" placeholder="填写审核依据（至少 4 个字）"><button class="secondary" type="button" data-rebate-review="reject" data-id="${safeText(row.id)}">拒绝</button><button class="primary" type="button" data-rebate-review="approve" data-id="${safeText(row.id)}">审核通过并发卡时</button></div>` : '<p class="admin-rebate-blocked">该记录因争议、退款或追偿被冻结，不能直接发放。</p>'}
      </article>`).join('') : '<div class="supplier-commission-empty">当前没有超过 5 万元的待审核返佣。</div>';
    $('#adminRebateTable').querySelectorAll('[data-rebate-review]').forEach(button => {
      button.addEventListener('click', () => reviewRebate(button.dataset.id, button.dataset.rebateReview));
    });
  }

  function render() {
    renderPolicy();
    const summary = overview.summary || {};
    const adminRows = adminOverview?.supplier_rebates || [];
    $('#rebateSourceHours').textContent = hours(identity.role === 'admin' ? adminRows.reduce((sum, row) => sum + Number(row.source_card_hours || 0), 0) : summary.source_card_hours);
    $('#rebateIssuedHours').textContent = hours(summary.issued_card_hours);
    $('#rebatePendingHours').textContent = hours(identity.role === 'admin' ? adminRows.reduce((sum, row) => sum + Number(row.rebate_card_hours || 0), 0) : summary.pending_review_card_hours);
    $('#rebateOrderCount').textContent = String(identity.role === 'admin' ? adminRows.length : summary.order_count || 0);
    $('#supplierRebateLedger').hidden = !overview.eligible;
    $('#adminRebateReview').hidden = identity.role !== 'admin';
    $('#rebateIneligible').hidden = overview.eligible || identity.role === 'admin';
    if (overview.eligible) renderSupplierRows(overview.rebates || []);
    if (identity.role === 'admin') renderAdminRows(adminRows);
  }

  async function sync() {
    const gate = $('#supplierCommissionGate');
    const content = $('#supplierCommissionContent');
    try {
      const me = await api('/api/auth/me');
      if (!me.authenticated) {
        identity = null; csrf = ''; content.hidden = true;
        $('#supplierCommissionIdentity').textContent = '尚未登录';
        $('#supplierCommissionHint').textContent = '登录后查看供应商返佣卡时账本。';
        gate.dataset.state = 'guest';
        overview = { policy: { review_threshold_cents: 5000000, tiers: [
          { minimum_cents: 100, maximum_cents: 100000, rate_bps: 100 },
          { minimum_cents: 100001, maximum_cents: 1000000, rate_bps: 80 },
          { minimum_cents: 1000001, maximum_cents: 3000000, rate_bps: 50 },
          { minimum_cents: 3000001, maximum_cents: 5000000, rate_bps: 30 },
          { minimum_cents: 5000001, maximum_cents: null, rate_bps: 20, review_required: true }
        ] } };
        renderPolicy();
        return;
      }
      identity = me.user; csrf = me.csrf_token || '';
      overview = await api('/api/supplier-rebate/overview');
      adminOverview = identity.role === 'admin' ? await api('/api/admin/overview') : null;
      $('#supplierCommissionIdentity').textContent = `${identity.name} · ${identity.role === 'supplier' ? '供应商账户' : identity.role === 'admin' ? '平台管理账户' : '普通账户'}`;
      $('#supplierCommissionHint').textContent = overview.eligible ? '成交返佣将以卡时资产批次进入你的算力库。' : identity.role === 'admin' ? '可审核单笔超过 5 万元的供应商卡时返佣。' : '返佣账本仅面向已认证供应商。';
      gate.dataset.state = 'ready'; content.hidden = false; render();
    } catch (error) {
      content.hidden = true;
      $('#supplierCommissionIdentity').textContent = '返佣数据读取失败';
      $('#supplierCommissionHint').textContent = error.message;
      gate.dataset.state = 'error';
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

  $('#supplierCommissionLogin').addEventListener('click', () => document.querySelector('.account')?.click());
  navButton.addEventListener('click', sync);
  if (new URL(location.href).searchParams.get('view') === 'supplierCommission') {
    setTimeout(() => navButton.click(), 0);
  } else {
    sync();
  }
})();
