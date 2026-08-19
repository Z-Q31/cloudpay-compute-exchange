(() => {
  'use strict';

  const runtime = {
    csrf: '',
    user: null,
    catalog: [],
    orders: [],
    assets: [],
    withdrawals: [],
    integrations: null,
    paymentMode: 'unknown',
    connected: false
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const requestId = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (runtime.csrf && (options.method || 'GET') !== 'GET') headers.set('X-KAI-CSRF', runtime.csrf);
    const response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    let payload = {};
    try { payload = await response.json(); } catch (error) { /* handled below */ }
    if (!response.ok) {
      const failure = new Error(payload?.error?.message || `服务请求失败（${response.status}）`);
      failure.code = payload?.error?.code || 'request_failed';
      failure.status = response.status;
      throw failure;
    }
    if (payload.csrf_token) runtime.csrf = payload.csrf_token;
    return payload;
  }

  function setBusy(button, busy, busyText = '处理中…') {
    if (!button) return;
    if (busy) {
      button.dataset.previousText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.previousText || button.textContent;
      button.disabled = false;
    }
  }

  function setConnectionState(state, detail) {
    let badge = document.querySelector('#productionState');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'productionState';
      badge.className = 'production-state';
      document.querySelector('.top-actions')?.prepend(badge);
    }
    badge.dataset.state = state;
    badge.innerHTML = `<i></i><span><b>${state === 'online' ? '服务端账本在线' : '服务端未连接'}</b><small>${escapeHtml(detail)}</small></span>`;
  }

  function ensureCapacityHub() {
    if (document.querySelector('[data-view="capacity"]')) return;
    const navButton = document.createElement('button');
    navButton.className = 'nav-item';
    navButton.type = 'button';
    navButton.dataset.view = 'capacity';
    navButton.innerHTML = '<span>▥</span>容量与存取';
    const vaultButton = document.querySelector('[data-view="vault"]');
    vaultButton?.before(navButton);

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'capacityView';
    view.innerHTML = `
      <div class="page-title"><div><span class="eyebrow">容量台账</span><h1>容量与存取</h1><p>集中查看算力容量、GPU 小时和订单状态，并快速进入买入、支付、存入与取出流程。</p></div><span class="model-count">服务端账本 <b>在线</b></span></div>
      <section class="capacity-hub-stats">
        <article><small>我的可用容量</small><strong id="hubOwnedCapacity">0</strong><span>已验收并扣除取出排期</span></article>
        <article><small>我的 GPU 小时</small><strong id="hubGpuHours">0</strong><span>可分配算力小时</span></article>
        <article><small>市场可售容量</small><strong id="hubMarketCapacity">0</strong><span>服务端已验真挂牌</span></article>
        <article><small>待处理订单</small><strong id="hubPendingOrders">0</strong><span>支付 / 交付 / 验收</span></article>
      </section>
      <section class="capacity-route-grid" aria-label="容量与存取快捷入口">
        <button type="button" data-capacity-jump="market"><i>01</i><span><b>买入入口</b><small>选择已验真的 GPU、地区和可售时段</small></span><em>进入算力市场 →</em></button>
        <button type="button" data-capacity-jump="payments"><i>02</i><span><b>支付入口</b><small>查看订单执行价、支付与容量锁定状态</small></span><em>进入订单支付 →</em></button>
        <button type="button" data-capacity-jump="deposit"><i>03</i><span><b>存入入口</b><small>企业供应商认证、资源评估和验真存入</small></span><em>提交资产存入 →</em></button>
        <button type="button" data-capacity-jump="capacity"><i>04</i><span><b>算力容量</b><small>查看已购批次、余额、到期日与人民币估值</small></span><em>查看容量明细 →</em></button>
        <button type="button" data-capacity-jump="hours"><i>05</i><span><b>算力小时</b><small>查看可用 GPU 小时和当前资产汇总</small></span><em>查看 GPU 小时 →</em></button>
        <button type="button" data-capacity-jump="withdraw"><i>06</i><span><b>取出入口</b><small>按资产批次提交全部或部分取出排期</small></span><em>发起取出申请 →</em></button>
      </section>
      <section class="capacity-lifecycle"><span>买入</span><i>→</i><span>支付回调</span><i>→</i><span>容量锁定</span><i>→</i><span>交付</span><i>→</i><span>验收存入</span><i>→</i><span>使用或取出</span></section>`;
    document.querySelector('main')?.append(view);
    navButton.addEventListener('click', () => { jump('capacity'); renderCapacityHub(); });
    view.addEventListener('click', handleCapacityRoute);
  }

  function handleCapacityRoute(event) {
    const trigger = event.target.closest('[data-capacity-jump]');
    if (!trigger) return;
    const target = trigger.dataset.capacityJump;
    const route = {
      market: ['market', '#h100ProductHub'], payments: ['vault', '#liveOrdersPanel'],
      deposit: ['assessment', '#assessmentForm'], capacity: ['vault', '#assetTable'],
      hours: ['vault', '.stat-grid'], withdraw: ['vault', '#withdrawRequestPanel']
    }[target];
    if (!route) return;
    jump(route[0]);
    setTimeout(() => document.querySelector(route[1])?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }

  function renderCapacityHub() {
    if (!document.querySelector('#capacityView')) return;
    const owned = runtime.assets.filter(asset => Number(asset.available_quantity || 0) > 0).length;
    const hours = runtime.assets.filter(asset => asset.unit === 'GPU 时').reduce((sum, asset) => sum + Number(asset.available_quantity || 0), 0);
    const market = runtime.catalog.length;
    const pending = runtime.orders.filter(order => !['accepted', 'cancelled'].includes(order.status)).length;
    document.querySelector('#hubOwnedCapacity').textContent = `${owned} 个批次`;
    document.querySelector('#hubGpuHours').textContent = money(hours);
    document.querySelector('#hubMarketCapacity').textContent = `${market} 个产品`;
    document.querySelector('#hubPendingOrders').textContent = String(pending);
  }

  function applyUser(user) {
    runtime.user = user || null;
    try { localStorage.removeItem('kaiProfile'); } catch (error) { /* storage may be disabled */ }
    sessionProfile = user ? { name: user.name, type: 'enterprise', account: user.account, role: user.role } : null;
    updateAccount();
    const menu = document.querySelector('#menuAccount');
    if (menu) menu.textContent = user ? `${user.account} · ${user.enterprise_status}` : '未登录';
    const supplierControl = document.querySelector('#supplierStatusControl');
    if (supplierControl) {
      const status = user?.enterprise_status === 'unverified' ? 'pending' : (user?.enterprise_status || 'pending');
      if ([...supplierControl.options].some(option => option.value === status)) {
        supplierControl.value = status;
        supplierControl.dispatchEvent(new Event('change'));
      }
    }
    window.dispatchEvent(new CustomEvent('kai:auth-changed', { detail: { user } }));
    window.kaiRenderH100Product?.(runtime.catalog, runtime.user);
  }

  function installLiveOfferRenderer() {
    const kindLabel = kind => ({ gpu: 'GPU', tokencap: 'Token 容量', tokenusage: 'Token 用量', rack: '柜月' }[kind] || kind);
    renderOffers = function liveRenderOffers(filter = 'all', term = '') {
      const lowered = term.toLowerCase();
      const rows = offers.filter(offer => (filter === 'all' || offer.type === filter || (filter === 'token' && ['tokencap', 'tokenusage'].includes(offer.kind))) &&
        `${offer.gpu}${offer.vendor}${offer.model}${offer.region}`.toLowerCase().includes(lowered));
      document.querySelector('#offerGrid').innerHTML = rows.map(offer => `
        <article class="offer" data-live-listing="${escapeHtml(offer.id)}">
          <div class="offer-top"><span class="gpu-badge">${escapeHtml(kindLabel(offer.kind))}</span><span class="verified">✓ 服务端已验容量</span></div>
          <h3>${escapeHtml(offer.product_code)}</h3>
          <div class="offer-vendor">${escapeHtml(offer.vendor)} · ${escapeHtml(offer.region)}</div>
          <div class="offer-tags"><span>可售 ${Number(offer.available).toLocaleString('zh-CN')} ${escapeHtml(offer.unit)}</span><span>${escapeHtml(offer.sla || '标准 SLA')} · 版本 ${offer.version}</span></div>
          <div class="offer-price"><div><strong>¥ ${offer.price.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}</strong><small> / ${escapeHtml(offer.unit)}</small></div><button data-buy="${escapeHtml(offer.gpu)}" data-listing="${escapeHtml(offer.id)}" data-minimum="${offer.minimum}">购入</button></div>
        </article>`).join('') || '<p class="production-empty">没有符合筛选条件的已验真可售容量。</p>';
      bindBuy();
    };

    bindBuy = function liveBindBuy() {
      document.querySelectorAll('[data-buy]').forEach(button => {
        button.onclick = () => openCheckout(button.dataset.buy, Number(button.dataset.minimum || 1), undefined, button.dataset.listing);
      });
    };
  }

  async function refreshCatalog() {
    const result = await api('/api/catalog');
    runtime.catalog = result.listings || [];
    offers = runtime.catalog.map(listing => ({
      id: listing.id,
      gpu: listing.gpu,
      product_code: listing.product_code,
      vendor: listing.provider,
      region: listing.region,
      price: listing.unit_price_cny,
      available: listing.available_quantity,
      version: listing.version,
      kind: listing.kind,
      unit: listing.unit,
      minimum: listing.minimum_quantity,
      sla: listing.sla,
      tags: ['已验真容量', listing.region],
      type: listing.kind === 'gpu' ? 'gpu' : (listing.kind === 'rack' ? 'rack' : 'token'),
      model: listing.product_code
    }));
    renderOffers(document.querySelector('.chip.active')?.dataset.filter || 'all', document.querySelector('#marketSearch')?.value || '');
    window.kaiRenderH100Product?.(runtime.catalog, runtime.user);
    const totalCapacity = runtime.catalog.reduce((sum, listing) => sum + Number(listing.available_quantity || 0), 0);
    const regionCount = new Set(runtime.catalog.map(listing => listing.region)).size;
    const listingsNode = document.querySelector('#marketBriefListings');
    const capacityNode = document.querySelector('#marketBriefCapacity');
    const regionsNode = document.querySelector('#marketBriefRegions');
    const statusNode = document.querySelector('#marketBriefStatus');
    if (listingsNode) listingsNode.textContent = `${runtime.catalog.length} 项`;
    if (capacityNode) capacityNode.textContent = `${runtime.catalog.length} 个标准产品`;
    if (regionsNode) regionsNode.textContent = `${regionCount} 个`;
    if (statusNode) statusNode.textContent = runtime.catalog.length ? '库存已同步' : '暂无可售挂牌';
    renderCapacityHub();
  }

  function matchingListing(gpuCode, listingId) {
    return runtime.catalog.find(listing => listing.id === listingId) ||
      runtime.catalog.find(listing => listing.gpu === gpuCode && listing.available_quantity > 0);
  }

  const originalOpenCheckout = openCheckout;
  openCheckout = function liveOpenCheckout(gpuCode = 'H100', quantity = 720, ignoredTotal, listingId) {
    if (!runtime.user) {
      openAuth('login');
      toast('请先登录企业账户，再创建订单');
      return;
    }
    const listing = matchingListing(gpuCode, listingId);
    if (!listing) {
      toast('当前没有可交付的服务端库存，请更换 GPU 或地区');
      return;
    }
    const minimum = Math.max(Number(listing.minimum_quantity || 0.01), 0.01);
    const safeQuantity = Math.max(minimum, Math.min(Number(quantity) || minimum, listing.available_quantity));
    const total = listing.unit_price_cny * safeQuantity;
    originalOpenCheckout(gpuCode, safeQuantity, total);
    const checkout = document.querySelector('#checkout');
    checkout.dataset.listingId = listing.id;
    checkout.dataset.gpu = listing.gpu;
    checkout.dataset.hours = String(safeQuantity);
    checkout.dataset.unitPrice = String(listing.unit_price_cny);
    checkout.dataset.availableQuantity = String(listing.available_quantity);
    checkout.dataset.listingProduct = listing.product_code;
    checkout.dataset.listingRegion = listing.region;
    checkout.dataset.listingUnit = listing.unit;
    checkout.dataset.listingProvider = listing.provider;
    checkout.dataset.listingKind = listing.kind;
    checkout.dataset.idempotency = requestId('order');
    checkout.dataset.orderFinalState = 'not_created';
    document.querySelector('#orderName').textContent = `${listing.product_code} · ${money(safeQuantity)} ${listing.unit} · ${listing.region}`;
    document.querySelector('#orderTotal').textContent = `¥ ${money(total)}`;
    const note = checkout.querySelector('.security-note');
    if (note) note.textContent = runtime.paymentMode === 'mock'
      ? `服务端执行价 ¥${listing.unit_price_cny.toFixed(2)} / ${listing.unit}；支付状态仅以签名回调为准。`
      : `服务端执行价 ¥${listing.unit_price_cny.toFixed(2)} / ${listing.unit}；支付宝 / 微信商户号和证书配置完成后开放付款。`;
  };

  function installQuotePurchase() {
    const button = document.querySelector('#buyQuote');
    if (!button) return;
    button.onclick = () => {
      const quote = calculateQuote();
      openCheckout(quote.g, quote.h);
    };
  }

  const statusLabels = {
    pending_payment: '待支付', expired: '支付超时 · 预留已释放', paid: '已支付 · 容量锁定',
    supplier_confirmed: '供应商已确认交付', delivered: '已交付 · 双源计量与验收',
    accepted: '已验收 · 结算观察期', disputed: '争议处理中', refund_pending: '退款审核中',
    refunded: '已退款', cancelled: '已取消'
  };

  function ensureOrderPanel() {
    if (document.querySelector('#liveOrdersPanel')) return;
    const panel = document.createElement('section');
    panel.className = 'panel live-orders-panel';
    panel.id = 'liveOrdersPanel';
    panel.innerHTML = '<div class="panel-head"><div><span class="eyebrow">订单台账</span><h2>交易订单</h2></div><button class="text-btn" id="refreshLiveOrders" type="button">刷新状态</button></div><div id="liveOrderList" aria-live="polite"></div>';
    document.querySelector('#vaultView .stat-grid')?.after(panel);
    document.querySelector('#refreshLiveOrders')?.addEventListener('click', () => refreshAccountData(true));
    panel.addEventListener('click', handleOrderAction);
  }

  function ensureWithdrawalPanel() {
    if (document.querySelector('#withdrawRequestPanel')) return;
    const panel = document.createElement('section');
    panel.className = 'panel withdraw-request-panel';
    panel.id = 'withdrawRequestPanel';
    panel.innerHTML = `
      <div class="panel-head"><div><span class="eyebrow">容量取出</span><h2>算力取出入口</h2></div><span class="withdraw-history-rule">只调整未来可用余额 · 历史记录不删除</span></div>
      <div class="withdraw-request-form">
        <label>选择资产批次<select id="liveWithdrawAsset"></select></label>
        <label>取出数量<div class="input-unit"><input id="liveWithdrawQuantity" type="number" min="0.01" step="0.01" value="1"><span>GPU 时</span></div></label>
        <button class="primary" id="submitLiveWithdrawal" type="button">提交取出排期</button>
      </div>
      <p class="withdraw-request-note" id="liveWithdrawNote">系统将检查批次操作权、可取余额和已有取出排期；申请不会删除历史订单、计量和结算记录。</p>
      <div class="withdraw-request-list" id="liveWithdrawalList"></div>`;
    document.querySelector('#liveOrdersPanel')?.after(panel);
    document.querySelector('#submitLiveWithdrawal')?.addEventListener('click', submitWithdrawalRequest);
  }

  async function submitWithdrawalRequest() {
    const button = document.querySelector('#submitLiveWithdrawal');
    const allocationId = document.querySelector('#liveWithdrawAsset')?.value;
    const quantity = Number(document.querySelector('#liveWithdrawQuantity')?.value);
    if (!runtime.user) return openAuth('login');
    if (!allocationId) return toast('当前没有可取出的已验收资产');
    if (!(quantity > 0)) return toast('请输入有效的取出数量');
    setBusy(button, true, '提交服务端检查…');
    try {
      const result = await api('/api/withdrawals', {
        method: 'POST', headers: { 'Idempotency-Key': requestId('withdraw') },
        body: { allocation_id: allocationId, quantity }
      });
      document.querySelector('#liveWithdrawNote').textContent = `申请 ${result.withdrawal.id} 已排期；未来可用余额已调整，历史批次与订单保持不变。`;
      await Promise.all([refreshWithdrawals(), refreshAssets()]);
      toast('取出申请已进入排期');
    } catch (error) {
      document.querySelector('#liveWithdrawNote').textContent = error.message;
      toast(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  function renderWithdrawals() {
    ensureWithdrawalPanel();
    const select = document.querySelector('#liveWithdrawAsset');
    const button = document.querySelector('#submitLiveWithdrawal');
    if (select) {
      select.innerHTML = runtime.assets.filter(asset => Number(asset.available_quantity) > 0).map(asset => `<option value="${escapeHtml(asset.id)}" data-unit="${escapeHtml(asset.unit)}">${escapeHtml(asset.product_code || asset.gpu)} · ${escapeHtml(asset.region)} · 可取 ${Number(asset.available_quantity).toLocaleString('zh-CN')} ${escapeHtml(asset.unit)}</option>`).join('');
      select.disabled = !runtime.assets.length;
      select.onchange = () => {
        const unit = select.selectedOptions[0]?.dataset.unit || '标准单位';
        const node = document.querySelector('#liveWithdrawQuantity')?.nextElementSibling;
        if (node) node.textContent = unit;
      };
      select.onchange();
    }
    if (button) button.disabled = !runtime.assets.length || !runtime.user;
    const list = document.querySelector('#liveWithdrawalList');
    if (!list) return;
    list.innerHTML = runtime.withdrawals.length ? runtime.withdrawals.map(item => `
      <div><span><b>${escapeHtml(item.id)}</b><small>${escapeHtml(item.created_at.replace('T', ' ').slice(0, 19))}</small></span><strong>${money(item.quantity)} ${escapeHtml(item.unit)}</strong><em>${item.status === 'scheduled' ? '排期取出' : escapeHtml(item.status)}</em></div>`).join('')
      : '<div class="production-empty"><b>暂无取出申请</b><span>提交后会保留申请、资产批次和审计事件。</span></div>';
  }

  async function refreshWithdrawals() {
    if (!runtime.user) {
      runtime.withdrawals = [];
      renderWithdrawals();
      return;
    }
    const result = await api('/api/withdrawals');
    runtime.withdrawals = result.withdrawals || [];
    renderWithdrawals();
  }

  function h100OrderConfiguration(order) {
    const config = order.service_configuration;
    if (!config || order.gpu !== 'H100') return '';
    return `<div class="h100-order-config"><b>${escapeHtml(config.service_mode_label)}</b><span>${money(config.service_hours)} 服务小时 · ${config.cpu_cores} 核 CPU · ${config.memory_gb}GB 内存 · ${escapeHtml(config.storage_label)} · ${escapeHtml(config.environment_label)}</span></div>`;
  }

  function h100OrderTimeline(order) {
    if (order.gpu !== 'H100') return '';
    const levels = { pending_payment: 1, paid: 2, supplier_confirmed: 3, delivered: 4, accepted: 6 };
    const current = levels[order.status] ?? -1;
    const steps = ['配置确认', '容量预留', '支付验签', '资源调度', '实例交付', '验收入库'];
    return `<ol class="h100-order-timeline" aria-label="H100 订单交付进度">${steps.map((label, index) => `<li class="${index < current ? 'done' : index === current ? 'current' : ''}"><i>${index < current ? '✓' : String(index + 1).padStart(2, '0')}</i><span>${label}</span></li>`).join('')}</ol>`;
  }

  function renderOrders() {
    ensureOrderPanel();
    const target = document.querySelector('#liveOrderList');
    if (!target) return;
    if (!runtime.user) {
      target.innerHTML = '<div class="production-empty"><b>登录后查看真实订单</b><span>订单状态、支付流水、交付和验收都从服务端读取。</span></div>';
      return;
    }
    if (!runtime.orders.length) {
      target.innerHTML = '<div class="production-empty"><b>还没有交易订单</b><span>从算力市场购入一笔已验真 GPU 容量即可开始。</span></div>';
      return;
    }
    target.innerHTML = runtime.orders.map(order => {
      let action = '';
      const details = order.gpu === 'H100' ? '<button data-order-action="details">查看交付流程</button>' : '';
      if (order.settlement_mode === 'swap' && ['paid', 'supplier_confirmed'].includes(order.status)) action = `<button data-order-action="dispute">置换交付争议</button>${details}<span>双方容量已锁定 · 等待交付</span>`;
      else if (order.status === 'paid' && runtime.paymentMode === 'mock') action = `<button data-order-action="deliver">模拟供应商人工交付</button>${details}`;
      else if (order.status === 'paid' || order.status === 'supplier_confirmed') action = `<button data-order-action="refund">申请退款</button>${details}<span>等待供应商交付</span>`;
      else if (order.status === 'delivered') action = `<button class="primary" data-order-action="details">查看交付并验收</button><button data-order-action="dispute">交付争议</button>`;
      else if (order.status === 'accepted') action = `<button data-order-action="invoice">申请发票</button><button data-order-action="dispute">售后争议</button>${details}`;
      else if (order.status === 'pending_payment') action = `<button data-order-action="cancel">取消并释放预留</button>${details}`;
      return `<article class="live-order" data-order-id="${escapeHtml(order.id)}">
        <div class="live-order-main"><small>${escapeHtml(order.order_no)}</small><b>${escapeHtml(order.product_code || order.gpu)} · ${Number(order.quantity).toLocaleString('zh-CN')} ${escapeHtml(order.unit)}</b><span>${escapeHtml(order.provider)} · ${escapeHtml(order.region)}${order.settlement_mode === 'swap' ? ' · 双边置换' : ''}</span></div>
        <div><small>订单执行价</small><b>¥ ${money(order.amount_cny)}</b><span>¥ ${order.unit_price_cny.toFixed(2)} / ${escapeHtml(order.unit)}</span></div>
        <div><small>服务端状态</small><b class="order-state" data-state="${escapeHtml(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</b><span>${escapeHtml(order.updated_at.replace('T', ' ').slice(0, 19))}</span></div>
        <div class="live-order-action">${action}</div>
        ${h100OrderConfiguration(order)}
        ${h100OrderTimeline(order)}
      </article>`;
    }).join('');
  }

  async function handleOrderAction(event) {
    const button = event.target.closest('[data-order-action]');
    if (!button) return;
    const row = button.closest('[data-order-id]');
    const orderId = row?.dataset.orderId;
    const action = button.dataset.orderAction;
    if (!orderId) return;
    if (action === 'details') {
      const order = runtime.orders.find(item => item.id === orderId);
      if (order && typeof window.kaiOpenH100Delivery === 'function') {
        window.kaiOpenH100Delivery(order, {
          accept: async () => {
            await api(`/api/orders/${encodeURIComponent(orderId)}/accept`, { method: 'POST', body: {} });
            await Promise.all([refreshOrders(), refreshAssets(), refreshCatalog()]);
            toast('验收完成，H100 算力已由服务端存入算力库');
          }
        });
      }
      return;
    }
    setBusy(button, true);
    try {
      if (action === 'deliver') await api(`/api/orders/${encodeURIComponent(orderId)}/demo-deliver`, { method: 'POST', body: {} });
      if (action === 'accept') await api(`/api/orders/${encodeURIComponent(orderId)}/accept`, { method: 'POST', body: {} });
      if (action === 'cancel') await api(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: {} });
      if (action === 'refund') {
        const reason = window.prompt('请填写退款原因（至少 8 个字）', '供应商尚未按约定时间完成交付');
        if (!reason) return;
        await api('/api/refunds', { method: 'POST', headers: { 'Idempotency-Key': requestId('refund') }, body: { order_id: orderId, reason } });
      }
      if (action === 'dispute') {
        const reason = window.prompt('请说明交付或计量争议（至少 8 个字）', '交付结果或双源计量与合同约定不一致');
        if (!reason) return;
        await api('/api/disputes', { method: 'POST', body: { order_id: orderId, category: 'delivery_metering', reason } });
      }
      if (action === 'invoice') {
        const title = window.prompt('请输入发票抬头', runtime.user?.name || '');
        if (!title) return;
        const taxId = window.prompt('请输入纳税人识别号', '');
        if (!taxId) return;
        const email = window.prompt('请输入电子发票接收邮箱', runtime.user?.account?.includes('@') ? runtime.user.account : '');
        if (!email) return;
        await api('/api/invoices', { method: 'POST', body: { order_id: orderId, invoice_title: title, tax_id: taxId, email } });
      }
      await Promise.all([refreshOrders(), refreshAssets(), refreshCatalog()]);
      const messages = { accept: '验收完成，资产已由服务端存入算力库', deliver: '交付任务已记录，请继续验收', cancel: '预留已释放，订单已取消', refund: '退款申请已进入运营审核', dispute: '争议已登记，自动结算已暂停', invoice: '开票申请已提交' };
      toast(messages[action] || '订单状态已更新');
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshOrders() {
    if (!runtime.user) {
      runtime.orders = [];
      renderOrders();
      renderCapacityHub();
      return;
    }
    const result = await api('/api/orders');
    runtime.orders = result.orders || [];
    renderOrders();
    renderCapacityHub();
  }

  async function refreshAssets() {
    if (!runtime.user) {
      runtime.assets = [];
      assets = [];
      renderLiveAssets();
      renderWithdrawals();
      renderCapacityHub();
      return;
    }
    const result = await api('/api/assets');
    runtime.assets = result.assets || [];
    assets = runtime.assets;
    renderLiveAssets();
    if (!assets.length) document.querySelector('#assetTable').innerHTML = '<div class="production-empty"><b>暂无已验收资产</b><span>支付只锁定容量；完成供应商交付和采购方验收后才会存入这里。</span></div>';
    renderWithdrawals();
    renderCapacityHub();
  }

  function renderLiveAssets() {
    const value = runtime.assets.reduce((sum, asset) => sum + Number(asset.estimated_value_cny || 0), 0);
    const gpuHours = runtime.assets.filter(asset => asset.unit === 'GPU 时').reduce((sum, asset) => sum + Number(asset.available_quantity || 0), 0);
    const valueNode = document.querySelector('#vaultValue');
    const hoursNode = document.querySelector('#vaultHours');
    const badgeNode = document.querySelector('#vaultBadge');
    if (valueNode) valueNode.textContent = `¥ ${Math.round(value).toLocaleString('zh-CN')}`;
    if (hoursNode) hoursNode.textContent = gpuHours.toLocaleString('zh-CN');
    if (badgeNode) badgeNode.textContent = String(runtime.assets.length);
    const target = document.querySelector('#assetTable');
    if (!target) return;
    target.innerHTML = runtime.assets.map(asset => `
      <div class="asset-row" data-allocation-id="${escapeHtml(asset.id)}">
        <div class="asset-name"><span class="gpu-badge">${escapeHtml({ gpu: 'GPU', tokencap: 'TOK-C', tokenusage: 'TOK', rack: 'RACK' }[asset.kind] || 'ASSET')}</span><div><b>${escapeHtml(asset.product_code || asset.gpu)}</b><small>${escapeHtml(asset.region)} · ${asset.status === 'available' ? '可用' : escapeHtml(asset.status)}</small></div></div>
        <div><small>可用余额</small><b>${Number(asset.available_quantity).toLocaleString('zh-CN')} ${escapeHtml(asset.unit)}</b></div>
        <div><small>到期日</small><b>${escapeHtml(asset.expiry)}</b></div>
        <div><small>参考价值</small><b>¥ ${Math.round(Number(asset.estimated_value_cny || 0)).toLocaleString('zh-CN')}</b></div>
        <div class="asset-actions"><button data-live-asset-swap="${escapeHtml(asset.id)}">置换</button><button data-live-asset-sell="${escapeHtml(asset.id)}">出售</button></div>
      </div>`).join('');
  }

  async function refreshAccountData(showToast = false) {
    await Promise.all([refreshOrders(), refreshAssets(), refreshCatalog(), refreshWithdrawals()]);
    if (showToast) toast('已从服务端刷新订单、容量和资产');
  }

  function installAuth() {
    const dialog = document.querySelector('#authDialog');
    const loginPane = document.querySelector('#loginPane');
    const registerPane = document.querySelector('#registerPane');
    const nativeRuntime = Boolean(window.KAINative?.native);
    dialog?.classList.add('kai-identity-auth');
    dialog?.classList.toggle('kai-mobile-identity', nativeRuntime);
    const heading = dialog?.querySelector('.auth-wrap > h2');
    const eyebrow = dialog?.querySelector('.auth-wrap > .eyebrow');
    if (heading) heading.textContent = nativeRuntime ? '登录 CloudPay' : '使用 KAI 统一账户';
    if (eyebrow && nativeRuntime) eyebrow.textContent = 'SECURE MOBILE SIGN IN';
    dialog?.querySelector('.auth-tabs')?.setAttribute('hidden', '');
    if (registerPane) registerPane.hidden = true;

    const existingChildren = [...loginPane.children].filter(node => node.id !== 'demoLogin' && !node.classList.contains('auth-divider'));
    const identityBlock = document.createElement('div');
    identityBlock.className = `identity-auth-block${nativeRuntime ? ' identity-mobile-page' : ''}`;
    identityBlock.innerHTML = nativeRuntime ? `
      <div class="mobile-auth-brand">
        <div class="identity-auth-mark" aria-hidden="true">K</div>
        <div><b>CloudPay 账户</b><p>登录后可查看订单、资产与算力置换记录</p></div>
        <span class="mobile-auth-secure">安全连接</span>
      </div>
      <div class="mobile-auth-step"><span>1</span><div><b>输入 KAI 账户</b><p>先在 App 内确认账户，再进入受保护的身份验证步骤。</p></div></div>
      <label class="mobile-identity-field" for="kaiMobileLoginAccount">
        <span>KAI 账户邮箱</span>
        <input id="kaiMobileLoginAccount" name="kai_account" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="name@company.com" aria-describedby="kaiMobileAccountHelp">
      </label>
      <p class="mobile-auth-field-help" id="kaiMobileAccountHelp">CloudPay 只传递账户提示；密码和验证码仍由 KAI Identity 安全校验。</p>
      <p class="auth-error identity-auth-error" id="kaiIdentityError" role="alert" aria-live="polite"></p>
      <button class="primary wide identity-login" id="kaiIdentityLogin" type="button">继续安全登录 <span aria-hidden="true">→</span></button>
      <div class="mobile-auth-step mobile-auth-step-muted"><span>2</span><div><b>完成身份验证</b><p>验证完成会自动返回 App，并在 CloudPay 内建立登录会话。</p></div></div>
      <p class="production-auth-hint" id="identityChannelState" aria-live="polite">正在检查登录通道…</p>
      <div class="mobile-auth-assurance" aria-label="登录安全说明"><span>一次性回传</span><span>会话加密</span><span>可随时退出</span></div>` : `
      <div class="identity-auth-mark" aria-hidden="true">K</div>
      <div><b>KAI Identity</b><p>使用与 cloud.kai.com 相同的邮箱账户登录或注册；认证和邮箱验证均在 KAI 身份中心完成。</p></div>
      <a class="primary wide identity-login" id="kaiIdentityLogin" href="/api/auth/kai/start?return_to=/">使用 KAI Identity 登录 / 注册 <span>↗</span></a>
      <p class="production-auth-hint" id="identityChannelState">正在检查统一登录通道…</p>
      <div class="identity-auth-links"><a href="https://auth.kai.com/" target="_blank" rel="noopener">身份中心</a><a href="https://auth.kai.com/sign-up" target="_blank" rel="noopener">注册账户</a></div>`;
    const fallback = document.createElement('details');
    fallback.className = 'identity-local-fallback';
    const summary = document.createElement('summary');
    summary.textContent = '运营及后台工作人员备用登录';
    const fallbackBody = document.createElement('div');
    fallbackBody.className = 'identity-local-fields';
    fallbackBody.append(...existingChildren);
    fallback.append(summary, fallbackBody);
    loginPane.replaceChildren(identityBlock, fallback);
    const accountLabel = document.querySelector('#loginAccount')?.closest('label');
    if (accountLabel) accountLabel.firstChild.textContent = '运营账号';
    const localSubmit = loginPane.querySelector('[type="submit"]');
    if (localSubmit) localSubmit.textContent = '运营账号登录';
    document.querySelector('#demoLogin')?.remove();

    const identityLogin = document.querySelector('#kaiIdentityLogin');
    const mobileAccount = document.querySelector('#kaiMobileLoginAccount');
    mobileAccount?.addEventListener('input', event => {
      const value = String(event.currentTarget.value || '').trim().toLowerCase();
      const error = document.querySelector('#kaiIdentityError');
      if (error && /^[^@\s]{1,64}@[^@\s]{1,189}$/.test(value)) error.textContent = '';
    });
    mobileAccount?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        identityLogin?.click();
      }
    });
    identityLogin?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const ready = button.dataset.ready === 'true';
      if (window.KAINative?.native && ready) {
        event.preventDefault();
        const loginHint = String(mobileAccount?.value || '').trim().toLowerCase();
        const error = document.querySelector('#kaiIdentityError') || document.querySelector('#loginPane .auth-error');
        const status = document.querySelector('#identityChannelState');
        if (!/^[^@\s]{1,64}@[^@\s]{1,189}$/.test(loginHint)) {
          if (error) error.textContent = '请输入有效的 KAI 账户邮箱';
          mobileAccount?.focus();
          return;
        }
        if (error) error.textContent = '';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        if (status) status.textContent = '正在打开安全验证，请在完成后返回 CloudPay…';
        const opened = await window.KAINative.startIdentityLogin(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
          { loginHint }
        ).catch(failure => {
          if (error) error.textContent = failure.message || '无法准备移动登录';
          return false;
        });
        if (!opened && error && !error.textContent) {
          error.textContent = '无法打开安全验证窗口，请检查网络和系统浏览器设置。';
        }
        button.disabled = false;
        button.removeAttribute('aria-busy');
        return;
      }
      if (ready) return;
      event.preventDefault();
      const error = document.querySelector('#loginPane .auth-error');
      if (error) error.textContent = 'KAI Identity 客户端尚未完成 CloudPay 回调登记，请联系平台管理员。';
    });

    document.querySelector('#loginPane').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const error = form.querySelector('.auth-error');
      error.textContent = '';
      setBusy(button, true, '正在登录…');
      try {
        const result = await api('/api/auth/login', { method: 'POST', body: {
          account: document.querySelector('#loginAccount').value.trim(),
          password: document.querySelector('#loginPassword').value
        }});
        applyUser(result.user);
        document.querySelector('#authDialog').close();
        await refreshAccountData();
        toast('运营账户已登录，服务端会话已建立');
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        setBusy(button, false);
      }
    };

    document.querySelector('#logoutBtn').onclick = async () => {
      try { if (runtime.user) await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (error) { /* clear local state regardless */ }
      runtime.csrf = '';
      applyUser(null);
      document.querySelector('#accountMenu').classList.remove('show');
      await refreshAccountData();
      toast('已退出服务端会话');
    };
  }

  function updateIntegrationUi() {
    const identity = runtime.integrations?.identity;
    const hint = document.querySelector('#identityChannelState');
    const login = document.querySelector('#kaiIdentityLogin');
    if (!identity || !hint || !login) return;
    const ready = Boolean(identity.configured);
    login.dataset.ready = String(ready);
    login.setAttribute('aria-disabled', String(!ready));
    hint.dataset.ready = String(ready);
    hint.textContent = ready
      ? (window.KAINative?.native
        ? '登录通道已连接；完成验证后会自动返回并确认 App 登录状态。'
        : '统一登录已连接；登录成功后会回到 CloudPay 并建立独立安全会话。')
      : `统一登录待配置：${(identity.missing || []).join('、') || '客户端资料不完整'}。`;
    const fallback = document.querySelector('.identity-local-fallback');
    if (fallback && !ready) fallback.open = true;
  }

  function installPayment() {
    const payButton = document.querySelector('#demoPay');
    if (!payButton) return;
    const returnButton = document.querySelector('#returnToOrder');
    if (returnButton) {
      returnButton.textContent = '查看订单进度';
      returnButton.onclick = () => {
        document.querySelector('#checkout').close();
        jump('vault');
      };
    }
    const channelName = provider => provider === 'alipay' ? '支付宝' : '微信支付';
    const paymentState = runtime.integrations?.payment || {};
    const paymentOptions = [...document.querySelectorAll('.pay[data-pay]')];
    if (runtime.paymentMode !== 'mock') {
      paymentOptions.forEach(option => {
        const ready = Boolean(paymentState[option.dataset.pay]?.configured);
        option.disabled = !ready;
        option.dataset.ready = String(ready);
      });
      const activeReady = paymentOptions.find(option => !option.disabled);
      paymentOptions.forEach(option => option.classList.toggle('active', option === activeReady));
    }
    const selectedProvider = () => document.querySelector('.pay.active')?.dataset.pay || 'alipay';
    const readyForPayment = () => runtime.paymentMode === 'mock' || Boolean(paymentState[selectedProvider()]?.configured);
    const refreshPayAction = () => {
      payButton.textContent = runtime.paymentMode === 'mock'
        ? '联调支付并验证服务端回调'
        : (readyForPayment() ? `前往${channelName(selectedProvider())}收银台` : '支付通道待商户配置');
      payButton.disabled = !readyForPayment();
    };
    paymentOptions.forEach(option => {
      option.onclick = () => {
        if (option.disabled) return;
        paymentOptions.forEach(item => item.classList.toggle('active', item === option));
        refreshPayAction();
      };
    });
    refreshPayAction();
    const note = document.querySelector('#checkout .security-note');
    if (note && runtime.paymentMode !== 'mock') {
      const missing = [...new Set(Object.values(paymentState).flatMap(item => item?.missing || []))];
      note.textContent = readyForPayment()
        ? '付款结果以支付机构服务端签名通知为准，页面返回不会直接改变订单状态。'
        : `商户通道暂未开放：${missing.join('、') || '商户资料不完整'}。`;
    }
    payButton.onclick = async () => {
      if (!runtime.user) return openAuth('login');
      const checkout = document.querySelector('#checkout');
      const provider = document.querySelector('.pay.active')?.dataset.pay || 'alipay';
      const listing = matchingListing(checkout.dataset.gpu, checkout.dataset.listingId);
      if (!listing) return toast('订单库存快照已经失效，请重新选择算力');
      try {
        if (typeof window.kaiValidateCheckout === 'function') window.kaiValidateCheckout(checkout, listing);
      } catch (error) {
        toast(error.message);
        return;
      }
      setBusy(payButton, true, '服务端预留容量…');
      try {
        const orderResult = await api('/api/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': checkout.dataset.idempotency || requestId('order') },
          body: {
            listing_id: listing.id,
            quantity: Number(checkout.dataset.hours),
            quote_snapshot: typeof window.kaiBuildOrderSnapshot === 'function'
              ? window.kaiBuildOrderSnapshot(checkout, listing)
              : { source: 'web_quote', gpu: listing.gpu, listing_version: listing.version }
          }
        });
        checkout.dataset.orderFinalState = orderResult.order.status;
        setBusy(payButton, true, '创建支付单…');
        const mobilePayment = window.matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
        const channel = provider === 'alipay' ? (mobilePayment ? 'wap' : 'web') : (mobilePayment ? 'h5' : 'native');
        const paymentResult = await api('/api/payments/create', {
          method: 'POST', body: { order_id: orderResult.order.id, provider, channel }
        });
        if (!paymentResult.mock_allowed) {
          const checkoutUrl = paymentResult.payment?.checkout_url;
          if (!checkoutUrl) throw new Error('支付机构通道尚未返回收银台，请稍后重试');
          if (window.KAINative?.openExternal) await window.KAINative.openExternal(checkoutUrl);
          else window.location.assign(checkoutUrl);
          return;
        }
        setBusy(payButton, true, '等待签名回调…');
        const callbackResult = await api('/api/payments/mock-complete', { method: 'POST', body: { payment_id: paymentResult.payment.id } });
        checkout.dataset.orderFinalState = callbackResult.order.status;
        if (!callbackResult.callback_verified || callbackResult.order.status !== 'paid') throw new Error('服务端尚未确认支付结果');
        const serverState = document.querySelector('#paymentServerState');
        const eventState = document.querySelector('#paymentEventId');
        if (serverState) serverState.textContent = '服务端验签通过 · 容量已正式锁定';
        if (eventState) eventState.textContent = `${provider === 'alipay' ? '支付宝' : '微信支付'} · 订单 ${callbackResult.order.order_no}`;
        checkout.querySelector('[data-step="pay"]').classList.remove('active');
        checkout.querySelector('[data-step="success"]').classList.add('active');
        await Promise.all([refreshOrders(), refreshCatalog()]);
      } catch (error) {
        toast(error.message);
      } finally {
        setBusy(payButton, false);
      }
    };
  }

  function installSupplierSubmission() {
    const submit = document.querySelector('#submitEnterprise');
    if (!submit) return;
    submit.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!runtime.user) {
        openAuth('login');
        toast('请先登录企业账户再提交供应商认证');
        return;
      }
      const error = document.querySelector('#enterpriseError');
      error.textContent = '';
      setBusy(submit, true, '提交服务端审核…');
      try {
        const result = await api('/api/suppliers/applications', { method: 'POST', body: {
          enterprise_name: document.querySelector('#enterpriseName').value.trim(),
          credit_code: document.querySelector('#enterpriseCode').value.trim(),
          agent_name: document.querySelector('#enterpriseAgent').value.trim()
        }});
        document.querySelector('#supplierStatusText').textContent = '审核中';
        document.querySelector('#supplierStatusControl').value = 'reviewing';
        document.querySelectorAll('[data-supplier-state]').forEach(item => item.classList.toggle('active', item.dataset.supplierState === 'reviewing'));
        error.textContent = `申请 ${result.application.id} 已进入服务端审核队列`;
        toast('企业供应商申请已持久化，等待人工核验');
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        setBusy(submit, false);
      }
    }, true);
  }

  async function bootstrap() {
    ensureCapacityHub();
    installLiveOfferRenderer();
    ensureOrderPanel();
    ensureWithdrawalPanel();
    installAuth();
    installQuotePurchase();
    installSupplierSubmission();
    try {
      const [health, integrations] = await Promise.all([api('/api/health'), api('/api/config/readiness')]);
      runtime.connected = true;
      runtime.paymentMode = health.payment_mode;
      runtime.integrations = integrations;
      updateIntegrationUi();
      const channelCount = Object.values(integrations.payment || {}).filter(item => item.configured).length;
      setConnectionState('online', `阶段 ${health.phase} · 支付 ${channelCount}/2 · 统一登录${integrations.identity?.configured ? '已连接' : '待配置'}`);
      if (health.payment_mode !== 'mock') {
        const demo = document.querySelector('#demoLogin');
        if (demo) demo.hidden = true;
      }
      const me = await api('/api/auth/me');
      if (me.authenticated) {
        runtime.csrf = me.csrf_token;
        applyUser(me.user);
      } else {
        applyUser(null);
      }
      installPayment();
      await refreshAccountData();
      const authQuery = new URLSearchParams(window.location.search);
      if (authQuery.get('kai_auth') === 'success') toast('KAI 统一账户登录成功');
      if (authQuery.get('kai_auth') === 'error') {
        const reasons = {
          kai_identity_denied: '登录已取消或未授权',
          kai_identity_email_unverified: '请先在 KAI Identity 完成邮箱验证',
          staff_identity_link_required: '运营账号首次绑定需要管理员确认',
        };
        toast(reasons[authQuery.get('reason')] || '统一登录未完成，请重新尝试');
      }
      if (authQuery.has('kai_auth')) {
        authQuery.delete('kai_auth');
        authQuery.delete('reason');
        const cleanUrl = `${window.location.pathname}${authQuery.toString() ? `?${authQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', cleanUrl);
      }
      window.addEventListener('kai:mobile-auth-error', event => {
        toast(event.detail?.message || 'App 统一登录未完成，请重新尝试');
      });
    } catch (error) {
      runtime.connected = false;
      setConnectionState('offline', '页面处于只读降级状态');
      installPayment();
      document.querySelector('#demoPay').disabled = true;
      renderOrders();
    }
  }

  bootstrap();
})();
