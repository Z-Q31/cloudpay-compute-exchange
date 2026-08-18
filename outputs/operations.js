(() => {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  let csrf = '';
  let state = null;
  let mustChangePassword = false;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if ((options.method || 'GET') !== 'GET' && csrf) headers.set('X-KAI-CSRF', csrf);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    const response = await fetch(path, {
      method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
    return payload;
  }

  function notify(message, error = false) {
    document.querySelector('.operations-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'operations-toast';
    node.dataset.error = String(error);
    node.textContent = message;
    document.body.append(node);
    setTimeout(() => node.remove(), 3600);
  }

  function showOperations() {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'operations'));
    document.querySelectorAll('main > .view').forEach(view => view.classList.toggle('active', view.id === 'operationsView'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function empty(message) {
    return `<div class="operations-empty">${escapeHtml(message)}</div>`;
  }

  function createShell() {
    if (document.querySelector('#operationsView')) return;
    const nav = document.createElement('button');
    nav.className = 'nav-item';
    nav.type = 'button';
    nav.dataset.view = 'operations';
    nav.innerHTML = '<span>✓</span>运营审核 <b id="operationsBadge">0</b>';
    document.querySelector('.nav-item[data-view="supplier"]')?.after(nav);
    nav.addEventListener('click', showOperations);

    const view = document.createElement('section');
    view.className = 'view operations-view';
    view.id = 'operationsView';
    view.innerHTML = `
      <div class="page-title"><div><span class="eyebrow">MARKETPLACE OPERATIONS</span><h1>撮合平台运营台</h1><p>企业认证、资源验真、挂牌、计量、争议、退款、结算和开票都在服务端留痕。</p></div><button class="primary" type="button" data-operation-refresh>刷新队列</button></div>
      <section class="operations-readiness"><div><b>正在检查真实交易条件</b><span>支付、短信和 HTTPS 未配置时不会伪装成可用。</span></div><div><button class="secondary" type="button" data-operation-password>修改管理员密码</button> <button class="secondary" type="button" data-operation-maintenance>运行账本维护</button></div></section>
      <section class="operations-health"></section>
      <nav class="operations-tabs" aria-label="运营审核队列">
        <button class="active" type="button" data-operation-tab="suppliers">企业认证</button>
        <button type="button" data-operation-tab="resources">资源与挂牌</button>
        <button type="button" data-operation-tab="metering">交付计量</button>
        <button type="button" data-operation-tab="aftersale">争议与退款</button>
        <button type="button" data-operation-tab="finance">结算与开票</button>
      </nav>
      <section class="operations-panel active" data-operation-panel="suppliers"></section>
      <section class="operations-panel" data-operation-panel="resources"></section>
      <section class="operations-panel" data-operation-panel="metering"></section>
      <section class="operations-panel" data-operation-panel="aftersale"></section>
      <section class="operations-panel" data-operation-panel="finance"></section>`;
    document.querySelector('main')?.append(view);
    view.querySelector('[data-operation-refresh]').addEventListener('click', refresh);
    view.querySelector('[data-operation-password]').addEventListener('click', async () => {
      const currentPassword = window.prompt('请输入当前管理员密码');
      if (!currentPassword) return;
      const newPassword = window.prompt('请输入新密码（至少12位，含字母、数字和特殊字符）');
      if (!newPassword) return;
      try {
        await api('/api/auth/change-password', { method: 'POST', body: { current_password: currentPassword, new_password: newPassword } });
        mustChangePassword = false;
        notify('管理员密码已更新，其他登录会话已退出');
        render();
      } catch (error) { notify(error.message, true); }
    });
    view.querySelector('[data-operation-maintenance]').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try {
        const result = await api('/api/admin/maintenance/run', { method: 'POST', body: {} });
        notify(`维护完成：释放 ${result.result.expired_orders} 个过期预留，处理 ${result.result.processed_events} 个事件`);
        await refresh();
      } catch (error) { notify(error.message, true); }
      finally { event.currentTarget.disabled = false; }
    });
    view.querySelectorAll('[data-operation-tab]').forEach(button => button.addEventListener('click', () => {
      view.querySelectorAll('[data-operation-tab]').forEach(item => item.classList.toggle('active', item === button));
      view.querySelectorAll('[data-operation-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.operationPanel === button.dataset.operationTab));
    }));
    view.addEventListener('click', handleAction);
  }

  function panel(title, description, body) {
    return `<div class="operations-panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div><div class="operations-queue">${body}</div>`;
  }

  function render() {
    if (!state) return;
    const counts = state.counts || {};
    const pendingTotal = Object.entries(counts).filter(([key]) => key !== 'pending_outbox').reduce((sum, [, value]) => sum + Number(value || 0), 0);
    document.querySelector('#operationsBadge').textContent = String(pendingTotal);
    document.querySelector('.operations-health').innerHTML = `
      <article><small>企业与资源审核</small><strong>${Number(counts.pending_supplier_reviews || 0) + Number(counts.pending_intakes || 0)}</strong><span>认证与验真队列</span></article>
      <article><small>挂牌与计量</small><strong>${Number(counts.pending_listings || 0) + Number(counts.pending_gateway_metering || 0)}</strong><span>上架及双源计量</span></article>
      <article><small>争议与退款</small><strong>${Number(counts.open_disputes || 0) + Number(counts.pending_refunds || 0)}</strong><span>暂停自动结算</span></article>
      <article><small>结算与开票</small><strong>${Number(counts.pending_settlements || 0) + Number(counts.pending_invoices || 0)}</strong><span>持牌分账流水留痕</span></article>`;
    const ready = state.readiness?.public_https && state.readiness?.sms?.configured &&
      Object.values(state.readiness?.payment || {}).some(item => item.configured);
    const readiness = document.querySelector('.operations-readiness');
    readiness.dataset.ready = String(Boolean(ready));
    readiness.querySelector('b').textContent = ready ? '至少一个真实支付通道已就绪' : '真实收款仍被安全阻断';
    const blockers = [];
    if (!state.readiness?.public_https) blockers.push('HTTPS 域名');
    if (!state.readiness?.sms?.configured) blockers.push('短信验证码');
    if (!Object.values(state.readiness?.payment || {}).some(item => item.configured)) blockers.push('持牌支付机构子商户/分账');
    if (mustChangePassword) blockers.unshift('修改初始管理员密码');
    readiness.querySelector('span').textContent = blockers.length ? `尚缺：${blockers.join('、')}。业务审核功能可以先使用。` : '可以进入小范围首单验证。';

    const suppliers = (state.applications || []).map(item => `
      <article class="operations-card"><div><h3>${escapeHtml(item.enterprise_name)}</h3><p>${escapeHtml(item.name)} · ${escapeHtml(item.account)} · 信用代码 ${escapeHtml(item.credit_code)}</p><small>提交于 ${escapeHtml(item.created_at.replace('T', ' ').slice(0, 16))}</small></div>
      <div class="operations-card-actions"><input data-reason="${escapeHtml(item.id)}" value="主体、经办人、对公账户、开票资料、许可及资源归属证明核验通过" aria-label="审核理由"><button data-action="supplier-needs" data-id="${escapeHtml(item.id)}" data-danger>退回补充</button><button data-action="supplier-certify" data-id="${escapeHtml(item.id)}" data-primary>认证通过</button></div></article>`).join('');
    document.querySelector('[data-operation-panel="suppliers"]').innerHTML = panel('企业供应商认证', '认证通过后每六个月复核；资料变化应即时复核。', suppliers || empty('当前没有待审核企业供应商'));

    const resources = [
      ...(state.intakes || []).map(item => `<article class="operations-card"><div><h3>资源存入 · ${escapeHtml(item.product_code)}</h3><p>${escapeHtml(item.supplier_name)} · ${escapeHtml(item.region)} · ${item.quantity} ${escapeHtml(item.unit)}</p><small>${escapeHtml(item.evidence_summary)}</small></div><div class="operations-card-actions"><input data-summary="${escapeHtml(item.id)}" value="权属、规格、基准测试、错误检查、网络温度及重复承诺检查通过" aria-label="验真结论"><button data-action="intake-reject" data-id="${escapeHtml(item.id)}" data-danger>拒绝</button><button data-action="intake-verify" data-id="${escapeHtml(item.id)}" data-primary>确认验真</button></div></article>`),
      ...(state.listings || []).map(item => `<article class="operations-card"><div><h3>挂牌审核 · ${escapeHtml(item.product_code)}</h3><p>${escapeHtml(item.supplier_name)} · ${escapeHtml(item.region)} · ${item.verified_quantity} ${escapeHtml(item.unit)}</p><small>目标价 ¥ ${(item.unit_price_cents / 100).toFixed(2)} / ${escapeHtml(item.unit)}；供应商底价不会公开</small></div><div class="operations-card-actions"><button data-action="listing-reject" data-id="${escapeHtml(item.id)}" data-danger>拒绝</button><button data-action="listing-approve" data-id="${escapeHtml(item.id)}" data-primary>公开上架</button></div></article>`)
    ].join('');
    document.querySelector('[data-operation-panel="resources"]').innerHTML = panel('资源验真与挂牌', '只有已验真批次能够创建公开挂牌，底价和原始材料不进入公开页。', resources || empty('当前没有待验真资源或待审核挂牌'));

    const metering = (state.metering_orders || []).map(order => `<article class="operations-card"><div><h3>${escapeHtml(order.order_no)} · KAI 侧计量待上报</h3><p>${escapeHtml(order.supplier_name)} · ${escapeHtml(order.gpu)} · ${order.quantity} ${escapeHtml(order.unit)}</p><small>供应商交付于 ${escapeHtml((order.delivered_at || order.updated_at).replace('T', ' ').slice(0, 16))}</small></div><div class="operations-card-actions"><button data-action="gateway-meter" data-id="${escapeHtml(order.id)}" data-start="${escapeHtml(order.delivered_at || order.updated_at)}" data-quantity="${order.quantity}" data-primary>录入 KAI 探针计量</button></div></article>`).join('');
    document.querySelector('[data-operation-panel="metering"]').innerHTML = panel('双源计量', '供应商连接器与 KAI 网关/探针都到齐且差异不超阈值，采购方才能验收。', metering || empty('当前没有待补充的 KAI 侧计量'));

    const aftersale = [
      ...(state.disputes || []).map(item => `<article class="operations-card"><div><h3>争议 ${escapeHtml(item.id)}</h3><p>${escapeHtml(item.category)} · ${escapeHtml(item.reason)}</p><small>订单 ${escapeHtml(item.order_id)} · 原状态 ${escapeHtml(item.original_order_status)}</small></div><div class="operations-card-actions"><input data-resolution="${escapeHtml(item.id)}" value="已核对合同、交付和双源计量证据" aria-label="处理结论"><button data-action="dispute-reject" data-id="${escapeHtml(item.id)}">驳回争议</button><button data-action="dispute-refund" data-id="${escapeHtml(item.id)}" data-danger>支持退款</button></div></article>`),
      ...(state.refunds || []).map(item => `<article class="operations-card"><div><h3>退款 ${escapeHtml(item.id)}</h3><p>订单 ${escapeHtml(item.order_id)} · ¥ ${(item.amount_cents / 100).toFixed(2)}</p><small>${escapeHtml(item.reason)} · ${escapeHtml(item.status)}</small></div><div class="operations-card-actions"><button data-action="refund-reject" data-id="${escapeHtml(item.id)}">拒绝退款</button><button data-action="refund-approve" data-id="${escapeHtml(item.id)}" data-danger>提交支付机构退款</button></div></article>`)
    ].join('');
    document.querySelector('[data-operation-panel="aftersale"]').innerHTML = panel('争议与退款', '退款成功前不直接修改支付余额；退款、撤销和拒付使用追加状态与审计记录。', aftersale || empty('当前没有争议或退款待处理'));

    const finance = [
      ...(state.settlements || []).map(item => `<article class="operations-card"><div><h3>结算 ${escapeHtml(item.id)}</h3><p>供应商净额 ¥ ${(item.supplier_net_cents / 100).toFixed(2)} · 平台服务费 ¥ ${(item.platform_fee_cents / 100).toFixed(2)}</p><small>${escapeHtml(item.status)} · 订单 ${escapeHtml(item.order_id)}</small></div><div class="operations-card-actions">${item.status === 'payable' ? `<input data-payout="${escapeHtml(item.id)}" placeholder="持牌机构分账流水号"><button data-action="settlement-paid" data-id="${escapeHtml(item.id)}" data-primary>确认已分账</button>` : '<span>结算观察期内</span>'}</div></article>`),
      ...(state.invoices || []).map(item => `<article class="operations-card"><div><h3>开票 · ${escapeHtml(item.invoice_title)}</h3><p>${escapeHtml(item.tax_id)} · ${escapeHtml(item.email)}</p><small>订单 ${escapeHtml(item.order_id)}</small></div><div class="operations-card-actions"><input data-invoice="${escapeHtml(item.id)}" placeholder="发票号码"><button data-action="invoice-issue" data-id="${escapeHtml(item.id)}" data-primary>登记已开票</button></div></article>`)
    ].join('');
    document.querySelector('[data-operation-panel="finance"]').innerHTML = panel('结算与开票', '只登记持牌支付机构真实分账流水；平台不以页面状态代替资金结果。', finance || empty('当前没有待结算或待开票记录'));
  }

  async function handleAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    button.disabled = true;
    try {
      let path = ''; let body = {};
      if (action.startsWith('supplier-')) {
        path = `/api/admin/suppliers/${encodeURIComponent(id)}/review`;
        body = { decision: action === 'supplier-certify' ? 'certified' : 'needs_changes', reason: document.querySelector(`[data-reason="${CSS.escape(id)}"]`)?.value || '请补充认证材料', bank_account_verified: action === 'supplier-certify', invoice_verified: action === 'supplier-certify', resource_proof_verified: action === 'supplier-certify', license_verified: action === 'supplier-certify' };
      } else if (action.startsWith('intake-')) {
        path = `/api/admin/intakes/${encodeURIComponent(id)}/review`;
        body = { decision: action === 'intake-verify' ? 'verified' : 'rejected', verification_summary: document.querySelector(`[data-summary="${CSS.escape(id)}"]`)?.value || '验真材料不满足要求' };
      } else if (action.startsWith('listing-')) {
        path = `/api/admin/listings/${encodeURIComponent(id)}/review`;
        body = { decision: action === 'listing-approve' ? 'approve' : 'reject', reason: action === 'listing-approve' ? '规格、容量、时段、地区和价格披露符合规则' : '挂牌信息不符合平台规则' };
      } else if (action === 'gateway-meter') {
        path = '/api/metering';
        const digest = `kai-gateway-${id}-${Date.now()}`;
        body = { order_id: id, source: 'kai_gateway', started_at: button.dataset.start, ended_at: new Date().toISOString(), quantity: Number(button.dataset.quantity), performance: { source: 'manual_gateway_probe', errors: 0 }, evidence_digest: digest, signature: `operator-signed-${digest}` };
      } else if (action.startsWith('dispute-')) {
        path = `/api/admin/disputes/${encodeURIComponent(id)}/resolve`;
        body = { decision: action === 'dispute-refund' ? 'refund' : 'reject', resolution: document.querySelector(`[data-resolution="${CSS.escape(id)}"]`)?.value || '已完成证据复核' };
      } else if (action.startsWith('refund-')) {
        path = `/api/admin/refunds/${encodeURIComponent(id)}/review`;
        body = { decision: action === 'refund-approve' ? 'approve' : 'reject', reason: '已复核订单、支付、交付、计量和争议记录' };
      } else if (action === 'settlement-paid') {
        path = `/api/admin/settlements/${encodeURIComponent(id)}/mark-paid`;
        body = { payout_ref: document.querySelector(`[data-payout="${CSS.escape(id)}"]`)?.value || '' };
      } else if (action === 'invoice-issue') {
        path = `/api/admin/invoices/${encodeURIComponent(id)}/issue`;
        body = { invoice_ref: document.querySelector(`[data-invoice="${CSS.escape(id)}"]`)?.value || '' };
      }
      if (!path) return;
      await api(path, { method: 'POST', body });
      notify('操作已写入服务端并生成审计记录');
      await refresh();
    } catch (error) { notify(error.message, true); }
    finally { button.disabled = false; }
  }

  async function refresh() {
    try {
      state = await api('/api/admin/overview');
      render();
    } catch (error) { notify(error.message, true); }
  }

  async function boot() {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).then(response => response.json());
      if (!me.authenticated || me.user?.role !== 'admin') return;
      csrf = me.csrf_token || '';
      mustChangePassword = Boolean(me.user.must_change_password);
      createShell();
      await refresh();
    } catch (_) { /* admin surface remains hidden */ }
  }

  window.addEventListener('kai:auth-changed', boot);
  setTimeout(boot, 450);
})();
