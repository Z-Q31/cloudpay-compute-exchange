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
      <div><span class="eyebrow">SUPPLIER REFERRAL LEDGER</span><h1>供应商返佣</h1><p>供应商邀请推广伙伴，推荐关系由伙伴本人确认；合格订单验收后自动计入返佣，并与结算、争议和退款保持同一账务状态。</p></div>
      <span class="supplier-commission-policy" id="supplierCommissionPolicy">30 天归因 · T+7 解锁 · 单笔封顶 ¥500</span>
    </div>

    <section class="supplier-commission-gate" id="supplierCommissionGate">
      <span class="supplier-commission-gate-mark">％</span>
      <div><small>账户状态</small><b id="supplierCommissionIdentity">正在读取 CloudPay 账户</b><p id="supplierCommissionHint">登录后可查看邀请、推广链接和返佣账本。</p></div>
      <button class="secondary" type="button" id="supplierCommissionLogin">登录账户</button>
    </section>

    <div id="supplierCommissionContent" hidden>
      <section class="supplier-commission-kpis" aria-label="返佣总览">
        <article><small>冻结中</small><strong id="commissionHolding">¥ 0.00</strong><span>订单验收后进入保护期</span></article>
        <article><small>可结算</small><strong id="commissionAvailable">¥ 0.00</strong><span>无争议、退款后解锁</span></article>
        <article><small>累计已付</small><strong id="commissionPaid">¥ 0.00</strong><span>持牌机构返佣流水</span></article>
        <article><small>合作关系</small><strong id="commissionPartnerCount">0</strong><span>已接受的供应商与伙伴</span></article>
      </section>

      <section class="supplier-program" id="supplierProgram" hidden>
        <div class="supplier-commission-section-head"><div><span class="eyebrow">PROGRAM CONTROL</span><h2>我的供应商返佣计划</h2><p>比例只影响之后发出的邀请；已接受合作关系沿用确认时的比例。</p></div></div>
        <div class="supplier-program-grid">
          <form class="supplier-program-card" id="supplierProgramForm">
            <label>新邀请返佣比例<div class="supplier-rate-input"><input id="supplierCommissionRate" type="number" min="1" max="20" step="0.1" required><span>%</span></div></label>
            <label>计划状态<select id="supplierCommissionStatus"><option value="active">开放邀请与归因</option><option value="paused">暂停新归因</option></select></label>
            <button class="primary" type="submit">保存计划</button><p role="status" id="supplierProgramStatus"></p>
          </form>
          <form class="supplier-program-card" id="supplierInvitationForm">
            <label>邀请推广伙伴<input id="supplierPartnerAccount" autocomplete="off" placeholder="输入已注册手机号或邮箱" required></label>
            <p>邀请不会扣除对方余额。伙伴接受后才生成可用推广码。</p>
            <button class="primary" type="submit">发送返佣邀请</button><p role="status" id="supplierInvitationStatus"></p>
          </form>
        </div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>推广伙伴</h3><span id="supplierPartnerTotal">0 位</span></div><div class="supplier-commission-table" id="supplierPartnerTable"></div></div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>供应商支出账本</h3><span>验收、冻结、解锁、支付、冲正全程留痕</span></div><div class="supplier-commission-table" id="supplierExpenseTable"></div></div>
      </section>

      <section class="partner-program" id="partnerProgram">
        <div class="supplier-commission-section-head"><div><span class="eyebrow">PARTNER CENTER</span><h2>我的推广合作</h2><p>只有你本人接受后合作才生效；推广链接仅记录供应商、伙伴和 30 天有效期，不包含账户或支付信息。</p></div></div>
        <div class="supplier-invitation-list" id="supplierInvitationList"></div>
        <div class="supplier-link-list" id="supplierPartnershipList"></div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>我的返佣明细</h3><span>订单完成验收后生成</span></div><div class="supplier-commission-table" id="partnerCommissionTable"></div></div>
      </section>

      <section class="admin-commission-program" id="adminCommissionProgram" hidden>
        <div class="supplier-commission-section-head"><div><span class="eyebrow">PLATFORM SETTLEMENT</span><h2>平台返佣账本</h2><p>仅可支付已解锁且关联供应商结算单可支付的返佣；退款追偿记录不会被支付操作覆盖。</p></div></div>
        <div class="supplier-commission-table-wrap"><div class="supplier-commission-table-head"><h3>待处理返佣</h3><span id="adminCommissionTotal">0 笔</span></div><div class="supplier-commission-table" id="adminCommissionTable"></div></div>
      </section>
    </div>`;
  main.append(view);

  const $ = selector => view.querySelector(selector);
  const safeText = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const money = cents => `¥ ${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const statusLabels = {
    pending_confirmation: '待伙伴确认', active: '合作中', rejected: '已拒绝',
    holding: '冻结中', available: '可结算', paid: '已支付', paused: '争议/退款暂停',
    reversed: '已冲正', clawback_required: '待追回'
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

  function referralUrl(code) {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('supplier_ref', code);
    return url.toString();
  }

  async function copyText(value, message) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = value; document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
    }
    if (typeof window.toast === 'function') window.toast(message);
  }

  function renderPartners(rows) {
    $('#supplierPartnerTotal').textContent = `${rows.filter(row => row.status === 'active').length} 位合作中`;
    $('#supplierPartnerTable').innerHTML = rows.length ? rows.map(row => `
      <article class="supplier-commission-row">
        <div><small>${safeText(row.partner_account)}</small><b>${safeText(row.partner_name)}</b></div>
        <span>${(Number(row.commission_rate_bps) / 100).toFixed(2)}%</span>
        <span class="commission-state" data-state="${safeText(row.status)}">${safeText(statusLabels[row.status] || row.status)}</span>
        <time>${safeText((row.accepted_at || row.invited_at || '').replace('T', ' ').slice(0, 16))}</time>
      </article>`).join('') : '<div class="supplier-commission-empty">还没有推广伙伴。输入已注册账户发出第一份邀请。</div>';
  }

  function renderLedger(target, rows, counterpart) {
    target.innerHTML = rows.length ? rows.map(row => `
      <article class="supplier-commission-row ledger">
        <div><small>${safeText(row.order_no || row.order_id)}</small><b>${safeText(row[counterpart] || 'CloudPay 账户')}</b></div>
        <span>${(Number(row.commission_rate_bps) / 100).toFixed(2)}%</span>
        <strong>${money(row.amount_cents)}</strong>
        <span class="commission-state" data-state="${safeText(row.status)}">${safeText(statusLabels[row.status] || row.status)}</span>
        <time>${safeText((row.created_at || '').replace('T', ' ').slice(0, 16))}</time>
      </article>`).join('') : '<div class="supplier-commission-empty">暂无返佣明细。合格订单完成验收后会自动生成账本记录。</div>';
  }

  function renderInvitations(rows) {
    $('#supplierInvitationList').innerHTML = rows.length ? rows.map(row => `
      <article class="supplier-invitation-card"><div><small>返佣合作邀请</small><h3>${safeText(row.supplier_name)}</h3><p>订单实付金额 × ${(Number(row.commission_rate_bps) / 100).toFixed(2)}%，单笔最高 ${money(overview.policy.maximum_commission_cents)}。</p></div><div><button class="secondary" data-invitation-action="reject" data-id="${safeText(row.id)}">拒绝</button><button class="primary" data-invitation-action="accept" data-id="${safeText(row.id)}">接受邀请</button></div></article>`).join('') : '';
    $('#supplierInvitationList').querySelectorAll('[data-invitation-action]').forEach(button => {
      button.addEventListener('click', () => resolveInvitation(button.dataset.id, button.dataset.invitationAction));
    });
  }

  function renderPartnerships(rows) {
    $('#supplierPartnershipList').innerHTML = rows.length ? rows.map(row => {
      const link = referralUrl(row.referral_code);
      return `<article class="supplier-link-card"><div><small>${safeText(row.supplier_name)}</small><b>${safeText(row.referral_code)}</b><span>${(Number(row.commission_rate_bps) / 100).toFixed(2)}% · 30 天归因</span></div><div class="supplier-link-control"><input readonly value="${safeText(link)}"><button data-copy-referral="${safeText(link)}">复制推广链接</button></div></article>`;
    }).join('') : '<div class="supplier-commission-empty">暂无已接受的推广合作。</div>';
    $('#supplierPartnershipList').querySelectorAll('[data-copy-referral]').forEach(button => {
      button.addEventListener('click', () => copyText(button.dataset.copyReferral, '推广链接已复制'));
    });
  }

  function renderAdminCommissions(rows) {
    $('#adminCommissionTotal').textContent = `${rows.length} 笔待处理`;
    $('#adminCommissionTable').innerHTML = rows.length ? rows.map(row => `
      <article class="supplier-commission-row admin-ledger">
        <div><small>${safeText(row.order_no || row.order_id)}</small><b>${safeText(row.supplier_name)} → ${safeText(row.partner_name)}</b></div>
        <strong>${money(row.amount_cents)}</strong>
        <span class="commission-state" data-state="${safeText(row.status)}">${safeText(statusLabels[row.status] || row.status)}</span>
        ${row.status === 'available' ? `<div class="supplier-admin-payout"><input aria-label="返佣支付流水" data-payout-ref="${safeText(row.id)}" placeholder="输入持牌机构流水号"><button type="button" data-admin-pay="${safeText(row.id)}">登记支付</button></div>` : '<span class="supplier-admin-wait">等待解锁或人工处理</span>'}
      </article>`).join('') : '<div class="supplier-commission-empty">当前没有待处理返佣。</div>';
    $('#adminCommissionTable').querySelectorAll('[data-admin-pay]').forEach(button => {
      button.addEventListener('click', () => payAdminCommission(button.dataset.adminPay));
    });
  }

  function render() {
    const supplier = overview.supplier;
    const partner = overview.partner;
    const supplierSummary = supplier.summary;
    const partnerSummary = partner.summary;
    const adminRows = adminOverview?.supplier_commissions || [];
    const adminSummary = {
      holding_cents: adminRows.filter(row => ['holding', 'paused'].includes(row.status)).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
      available_cents: adminRows.filter(row => row.status === 'available').reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
      paid_cents: 0
    };
    const summary = identity.role === 'admin' ? adminSummary : supplier.enabled ? supplierSummary : partnerSummary;
    $('#commissionHolding').textContent = money(summary.holding_cents);
    $('#commissionAvailable').textContent = money(summary.available_cents);
    $('#commissionPaid').textContent = money(summary.paid_cents);
    $('#commissionPartnerCount').textContent = identity.role === 'admin' ? String(adminRows.length) : String(
      (supplier.partners || []).filter(row => row.status === 'active').length + (partner.partnerships || []).length
    );
    $('#supplierCommissionPolicy').textContent = `${overview.policy.attribution_window_days} 天归因 · T+${overview.policy.hold_days} 解锁 · 单笔封顶 ${money(overview.policy.maximum_commission_cents)}`;
    $('#supplierProgram').hidden = !supplier.enabled;
    if (supplier.enabled) {
      $('#supplierCommissionRate').value = (Number(supplier.program.commission_rate_bps) / 100).toFixed(2);
      $('#supplierCommissionStatus').value = supplier.program.status;
      renderPartners(supplier.partners || []);
      renderLedger($('#supplierExpenseTable'), supplier.commissions || [], 'partner_name');
    }
    $('#partnerProgram').hidden = identity.role === 'admin';
    $('#adminCommissionProgram').hidden = identity.role !== 'admin';
    if (identity.role === 'admin') {
      renderAdminCommissions(adminRows);
    } else {
      renderInvitations(partner.invitations || []);
      renderPartnerships(partner.partnerships || []);
      renderLedger($('#partnerCommissionTable'), partner.commissions || [], 'supplier_name');
    }
  }

  async function sync() {
    const gate = $('#supplierCommissionGate');
    const content = $('#supplierCommissionContent');
    try {
      const me = await api('/api/auth/me');
      if (!me.authenticated) {
        identity = null; csrf = ''; content.hidden = true;
        $('#supplierCommissionIdentity').textContent = '尚未登录';
        $('#supplierCommissionHint').textContent = '登录后可管理供应商计划或接受返佣邀请。';
        gate.dataset.state = 'guest';
        return;
      }
      identity = me.user; csrf = me.csrf_token || '';
      await claimPendingReferral();
      overview = await api('/api/supplier-referral/overview');
      adminOverview = identity.role === 'admin' ? await api('/api/admin/overview') : null;
      $('#supplierCommissionIdentity').textContent = `${identity.name} · ${identity.role === 'supplier' ? '供应商账户' : identity.role === 'admin' ? '平台管理账户' : '推广伙伴账户'}`;
      $('#supplierCommissionHint').textContent = overview.supplier.enabled ? '供应商返佣计划已接入订单与结算账本。' : '可接受供应商邀请并分享专属推广链接。';
      gate.dataset.state = 'ready'; content.hidden = false; render();
    } catch (error) {
      content.hidden = true;
      $('#supplierCommissionIdentity').textContent = '返佣数据读取失败';
      $('#supplierCommissionHint').textContent = error.message;
      gate.dataset.state = 'error';
    }
  }

  async function claimPendingReferral() {
    const urlCode = new URL(location.href).searchParams.get('supplier_ref');
    if (urlCode) localStorage.setItem('kai-supplier-referral-pending', urlCode);
    const pending = localStorage.getItem('kai-supplier-referral-pending');
    if (!pending || !csrf) return;
    try {
      await api('/api/supplier-referral/claim', { method: 'POST', body: { referral_code: pending } });
      localStorage.removeItem('kai-supplier-referral-pending');
      const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('supplier_ref');
      history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    } catch (error) {
      if (!/登录|状态/.test(error.message)) localStorage.removeItem('kai-supplier-referral-pending');
    }
  }

  async function resolveInvitation(id, action) {
    try {
      await api(`/api/supplier-referral/invitations/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });
      if (typeof window.toast === 'function') window.toast(action === 'accept' ? '返佣合作已接受' : '返佣邀请已拒绝');
      await sync();
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message);
    }
  }

  async function payAdminCommission(id) {
    const input = $(`[data-payout-ref="${CSS.escape(id)}"]`);
    const payoutRef = input?.value.trim() || '';
    if (payoutRef.length < 6) {
      if (typeof window.toast === 'function') window.toast('请输入有效的持牌机构支付流水号');
      input?.focus();
      return;
    }
    try {
      await api(`/api/admin/supplier-commissions/${encodeURIComponent(id)}/mark-paid`, { method: 'POST', body: { payout_ref: payoutRef } });
      if (typeof window.toast === 'function') window.toast('返佣支付流水已登记');
      await sync();
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message);
    }
  }

  $('#supplierProgramForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('#supplierProgramStatus'); status.textContent = '正在保存…';
    try {
      await api('/api/supplier-referral/program', { method: 'POST', body: {
        commission_rate_percent: Number($('#supplierCommissionRate').value), status: $('#supplierCommissionStatus').value
      }});
      status.textContent = '计划已保存；新比例将用于之后发出的邀请。'; await sync();
    } catch (error) { status.textContent = error.message; }
  });

  $('#supplierInvitationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('#supplierInvitationStatus'); status.textContent = '正在发送邀请…';
    try {
      await api('/api/supplier-referral/invitations', { method: 'POST', body: { partner_account: $('#supplierPartnerAccount').value.trim() } });
      $('#supplierPartnerAccount').value = ''; status.textContent = '邀请已发送，等待伙伴本人确认。'; await sync();
    } catch (error) { status.textContent = error.message; }
  });

  $('#supplierCommissionLogin').addEventListener('click', () => document.querySelector('.account')?.click());
  navButton.addEventListener('click', () => sync());
  const initialCode = new URL(location.href).searchParams.get('supplier_ref');
  if (initialCode) {
    try { localStorage.setItem('kai-supplier-referral-pending', initialCode); } catch (_) { /* unavailable storage */ }
  }
  sync();
})();
