(() => {
  'use strict';

  const checkout = document.querySelector('#checkout');
  if (!checkout || typeof openCheckout !== 'function') return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const formatNumber = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const modes = {
    exclusive: { label: 'H100 80GB 独占', memory: 80, factor: 1 },
    slice_20gb: { label: 'H100 20GB 切片', memory: 20, factor: .25 }
  };

  function localDateTime(date) {
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setStep(name) {
    $$('.dialog-step', checkout).forEach(step => step.classList.toggle('active', step.dataset.step === name));
  }

  function ensurePurchaseConfigurator() {
    if ($('#h100ConfigureStep')) return;
    const configure = document.createElement('div');
    configure.className = 'dialog-step h100-config-step';
    configure.dataset.step = 'h100-configure';
    configure.id = 'h100ConfigureStep';
    configure.innerHTML = `
      <span class="eyebrow">H100 CLOUD INSTANCE</span>
      <h2>配置 H100 云服务</h2>
      <p class="h100-step-intro">购买的是指定时间内的计算服务使用权，不是物理 GPU 所有权。配置确认后再预留容量并支付。</p>
      <div class="h100-config-layout">
        <form class="h100-config-form" id="h100ConfigForm">
          <fieldset><legend>GPU 使用模式</legend><div class="h100-mode-grid"><label><input type="radio" name="h100Mode" value="exclusive" checked><span><b>80GB 独占</b><small>完整 H100 实例，适合训练与生产</small></span></label><label><input type="radio" name="h100Mode" value="slice_20gb"><span><b>20GB 切片</b><small>按 0.25 GPU 时计费，适合测试与推理</small></span></label></div></fieldset>
          <div class="h100-field-grid">
            <label>CPU<select id="h100Cpu"><option value="16">16 核</option><option value="32" selected>32 核</option><option value="64">64 核</option></select></label>
            <label>内存<select id="h100Memory"><option value="64">64GB</option><option value="128" selected>128GB</option><option value="256">256GB</option></select></label>
            <label>高速存储<select id="h100Storage"><option value="ssd_500">500GB SSD</option><option value="nvme_1tb" selected>1TB NVMe</option><option value="nvme_2tb">2TB NVMe</option></select></label>
            <label>运行环境<select id="h100Environment"><option value="ubuntu_cuda">Ubuntu + CUDA</option><option value="pytorch" selected>Ubuntu + CUDA + PyTorch</option><option value="tensorflow">Ubuntu + CUDA + TensorFlow</option></select></label>
            <label>计划开始时间<input id="h100StartAt" type="datetime-local" required></label>
            <label>服务时长<div class="input-unit"><input id="h100ServiceHours" type="number" min="1" max="8760" step="1" value="720" required><span>小时</span></div></label>
          </div>
        </form>
        <aside class="h100-config-summary" aria-live="polite">
          <span class="eyebrow">ORDER SNAPSHOT</span><h3>配置与费用快照</h3>
          <dl id="h100ConfigSummary"></dl>
          <div class="h100-estimate"><small>预计订单执行价</small><strong id="h100EstimatedTotal">¥ 0</strong><span id="h100BillingBasis">—</span></div>
          <ul><li>支付前原子预留容量</li><li>支付状态仅接受服务端签名回调</li><li>交付后按验收清单确认实例</li></ul>
        </aside>
      </div>
      <label class="h100-confirm"><input id="h100ConfigConsent" type="checkbox"><span>我已确认 GPU 模式、配套资源、服务时段与计费容量；交付凭据将通过一次性或短时安全方式领取。</span></label>
      <button class="primary wide" id="confirmH100Config" type="button">确认配置并进入支付</button>`;
    checkout.querySelector('[data-step="pay"]').before(configure);
    const payStep = checkout.querySelector('[data-step="pay"]');
    payStep.insertAdjacentHTML('afterbegin', '<button class="h100-back" id="backToH100Config" type="button">← 返回修改 H100 配置</button>');
    $('#backToH100Config').hidden = true;
    $('#backToH100Config').addEventListener('click', () => setStep('h100-configure'));
    $('#confirmH100Config').addEventListener('click', confirmConfiguration);
    $('#h100ConfigForm').addEventListener('input', updateConfiguration);
    $('#h100ConfigForm').addEventListener('change', updateConfiguration);
  }

  function currentConfiguration() {
    const mode = $('input[name="h100Mode"]:checked')?.value || 'exclusive';
    const serviceHours = Number($('#h100ServiceHours').value);
    const profile = modes[mode];
    return {
      service_mode: mode,
      service_mode_label: profile.label,
      gpu_memory_gb: profile.memory,
      billing_factor: profile.factor,
      service_hours: serviceHours,
      billable_gpu_hours: Number((serviceHours * profile.factor).toFixed(6)),
      cpu_cores: Number($('#h100Cpu').value),
      memory_gb: Number($('#h100Memory').value),
      storage: $('#h100Storage').value,
      storage_label: $('#h100Storage option:checked').textContent,
      environment: $('#h100Environment').value,
      environment_label: $('#h100Environment option:checked').textContent,
      operating_system: 'Ubuntu',
      start_at: $('#h100StartAt').value
    };
  }

  function updateConfiguration() {
    const config = currentConfiguration();
    const available = Number(checkout.dataset.availableQuantity || 0);
    const maxHours = Math.max(1, Math.min(8760, Math.floor(available / config.billing_factor)));
    $('#h100ServiceHours').max = String(maxHours);
    if (config.service_hours > maxHours) {
      $('#h100ServiceHours').value = String(maxHours);
      return updateConfiguration();
    }
    const unitPrice = Number(checkout.dataset.unitPrice || 0);
    const total = config.billable_gpu_hours * unitPrice;
    checkout.dataset.hours = String(config.billable_gpu_hours);
    checkout.dataset.h100Configured = 'false';
    $('#h100ConfigSummary').innerHTML = `
      <div><dt>实例</dt><dd>${escapeHtml(config.service_mode_label)}</dd></div>
      <div><dt>配套计算</dt><dd>${config.cpu_cores} 核 / ${config.memory_gb}GB</dd></div>
      <div><dt>存储</dt><dd>${escapeHtml(config.storage_label)}</dd></div>
      <div><dt>环境</dt><dd>${escapeHtml(config.environment_label)}</dd></div>
      <div><dt>开始</dt><dd>${escapeHtml(config.start_at.replace('T', ' '))}</dd></div>
      <div><dt>服务时长</dt><dd>${formatNumber(config.service_hours)} 小时</dd></div>`;
    $('#h100EstimatedTotal').textContent = `¥ ${formatNumber(total)}`;
    $('#h100BillingBasis').textContent = `${formatNumber(config.billable_gpu_hours)} GPU 时 × ¥ ${unitPrice.toFixed(2)}`;
    $('#orderName').textContent = `${checkout.dataset.listingProduct} · ${config.service_mode_label} · ${formatNumber(config.service_hours)} 服务小时 · ${checkout.dataset.listingRegion}`;
    $('#orderTotal').textContent = `¥ ${formatNumber(total)}`;
  }

  function confirmConfiguration() {
    const config = currentConfiguration();
    if (!config.start_at || !(config.service_hours >= 1)) return toast('请完整填写 H100 服务时段');
    if (!$('#h100ConfigConsent').checked) return toast('请确认配置、计费容量和交付凭据规则');
    checkout.dataset.h100Configured = 'true';
    $('#backToH100Config').hidden = false;
    setStep('pay');
  }

  function prepareH100Configuration() {
    ensurePurchaseConfigurator();
    const available = Number(checkout.dataset.availableQuantity || 720);
    const initialHours = Math.max(1, Math.min(720, Math.floor(available)));
    $('input[name="h100Mode"][value="exclusive"]').checked = true;
    $('#h100Cpu').value = '32';
    $('#h100Memory').value = '128';
    $('#h100Storage').value = 'nvme_1tb';
    $('#h100Environment').value = 'pytorch';
    $('#h100ServiceHours').value = String(initialHours);
    $('#h100StartAt').value = localDateTime(new Date(Date.now() + 30 * 60 * 1000));
    $('#h100ConfigConsent').checked = false;
    checkout.dataset.h100Configured = 'false';
    $('#backToH100Config').hidden = false;
    updateConfiguration();
    setStep('h100-configure');
  }

  const priorOpenCheckout = openCheckout;
  openCheckout = function h100OpenCheckout(gpuCode = 'H100', quantity = 720, total, listingId) {
    priorOpenCheckout(gpuCode, quantity, total, listingId);
    if (!checkout.open) return;
    ensurePurchaseConfigurator();
    if (checkout.dataset.gpu === 'H100') prepareH100Configuration();
    else {
      $('#backToH100Config').hidden = true;
      setStep('pay');
    }
  };

  window.kaiValidateCheckout = (dialog, listing) => {
    if (listing.gpu === 'H100' && dialog.dataset.h100Configured !== 'true') {
      setStep('h100-configure');
      throw new Error('请先确认 H100 服务配置');
    }
  };

  window.kaiBuildOrderSnapshot = (dialog, listing) => ({
    source: 'web_h100_configurator', gpu: listing.gpu, listing_version: listing.version,
    ...(listing.gpu === 'H100' ? { h100_configuration: currentConfiguration() } : {})
  });

  function ensureDeliveryDialog() {
    if ($('#h100DeliveryDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="h100DeliveryDialog" class="h100-delivery-dialog">
        <button class="dialog-close" id="closeH100Delivery" aria-label="关闭">×</button>
        <div class="h100-delivery-content" id="h100DeliveryContent"></div>
      </dialog>`);
    $('#closeH100Delivery').addEventListener('click', () => $('#h100DeliveryDialog').close());
  }

  function timelineLevel(status) {
    return ({ pending_payment: 1, paid: 2, supplier_confirmed: 3, delivered: 4, accepted: 6 }[status] ?? 0);
  }

  window.kaiOpenH100Delivery = (order, actions = {}) => {
    ensureDeliveryDialog();
    const dialog = $('#h100DeliveryDialog');
    const config = order.service_configuration || {};
    const delivery = order.delivery || {};
    const canAccept = order.status === 'delivered';
    const steps = ['配置确认', '容量预留', '支付验签', '资源调度', '实例交付', '验收入库'];
    const level = timelineLevel(order.status);
    $('#h100DeliveryContent').innerHTML = `
      <span class="eyebrow">H100 DELIVERY CONTROL</span><h2>H100 购买与交付进度</h2>
      <p>${escapeHtml(order.order_no)} · 所有状态均来自服务端订单、支付、交付和计量记录。</p>
      <ol class="h100-delivery-timeline">${steps.map((label, index) => `<li class="${index < level ? 'done' : index === level ? 'current' : ''}"><i>${index < level ? '✓' : String(index + 1).padStart(2, '0')}</i><span><b>${label}</b><small>${['配置已固化到订单快照','容量事务预留并防止超卖','仅服务端签名回调可改变支付状态','供应商确认并创建隔离实例','下发脱敏端点与一次性交付编号','核对配置、GPU 和双源计量'][index]}</small></span></li>`).join('')}</ol>
      <div class="h100-delivery-grid">
        <section><span class="eyebrow">ORDER CONFIGURATION</span><h3>订单配置</h3><dl>
          <div><dt>GPU</dt><dd>${escapeHtml(config.service_mode_label || 'H100')}</dd></div>
          <div><dt>服务时长</dt><dd>${formatNumber(config.service_hours || order.quantity)} 小时</dd></div>
          <div><dt>CPU / 内存</dt><dd>${config.cpu_cores || '—'} 核 / ${config.memory_gb || '—'}GB</dd></div>
          <div><dt>存储</dt><dd>${escapeHtml(config.storage_label || '—')}</dd></div>
          <div><dt>环境</dt><dd>${escapeHtml(config.environment_label || '—')}</dd></div>
          <div><dt>区域</dt><dd>${escapeHtml(order.region)}</dd></div>
        </dl></section>
        <section><span class="eyebrow">SECURE DELIVERY PACKAGE</span><h3>安全交付包</h3>
          <div class="h100-endpoint"><small>脱敏服务端点</small><b>${escapeHtml(delivery.endpoint_summary || (canAccept ? '供应商尚未返回端点摘要' : '实例交付完成后显示'))}</b></div>
          <div class="h100-endpoint"><small>交付凭证编号</small><b>${escapeHtml(delivery.credential_reference || order.delivery_ref || '待生成')}</b></div>
          <p>平台不在网页、聊天或订单明文中展示 SSH 私钥。真实接入由一次性领取链接、短时凭据或采购方公钥加密完成。</p>
          <code>ssh ubuntu@&lt;交付端点&gt;<br>nvidia-smi</code>
        </section>
      </div>
      <section class="h100-acceptance"><span class="eyebrow">ACCEPTANCE CHECKLIST</span><h3>采购方验收清单</h3>
        <div class="h100-check-grid">
          <label><input type="checkbox" ${canAccept ? '' : 'disabled'}><span>实例可连接，网络与权限符合交付说明</span></label>
          <label><input type="checkbox" ${canAccept ? '' : 'disabled'}><span><code>nvidia-smi</code> 显示 H100 与约定显存</span></label>
          <label><input type="checkbox" ${canAccept ? '' : 'disabled'}><span>CPU、内存、存储和运行环境与订单快照一致</span></label>
          <label><input type="checkbox" ${canAccept ? '' : 'disabled'}><span>标准测试任务可运行，未发现显存或环境错误</span></label>
          <label><input type="checkbox" ${canAccept ? '' : 'disabled'}><span>已了解验收后进入计量、资产入库和结算流程</span></label>
        </div>
        <div class="h100-accept-actions"><p id="h100AcceptanceState" aria-live="polite">${canAccept ? '完成全部检查后才能确认验收。' : order.status === 'accepted' ? '该订单已经完成验收并存入算力库。' : '实例尚未交付，当前只能查看进度。'}</p><button class="primary" id="acceptH100Delivery" type="button" ${canAccept ? 'disabled' : 'disabled'}>${order.status === 'accepted' ? '已完成验收' : '确认验收并存入算力库'}</button></div>
      </section>`;
    const checks = $$('.h100-check-grid input', dialog);
    const accept = $('#acceptH100Delivery');
    checks.forEach(input => input.addEventListener('change', () => { accept.disabled = !canAccept || !checks.every(item => item.checked); }));
    accept.addEventListener('click', async () => {
      accept.disabled = true; accept.textContent = '服务端验收中…';
      try {
        await actions.accept?.();
        $('#h100AcceptanceState').textContent = '验收成功，算力资产已经入库。';
        accept.textContent = '已完成验收';
        setTimeout(() => dialog.close(), 700);
      } catch (error) {
        $('#h100AcceptanceState').textContent = error.message;
        accept.textContent = '确认验收并存入算力库';
        accept.disabled = false;
      }
    });
    dialog.showModal();
  };

  function ensureH100ProductHub() {
    if ($('#h100ProductHub')) return;
    const chart = $('#marketChartPanel');
    if (!chart) return;
    chart.insertAdjacentHTML('beforebegin', `
      <section class="h100-product-hub" id="h100ProductHub" aria-labelledby="h100ProductTitle">
        <header class="h100-product-head">
          <div><span class="eyebrow">H100 STANDARD PRODUCT</span><h2 id="h100ProductTitle">H100 GPU 云服务购买</h2><p>先选择标准配置，再按真实验真库存进入付款；没有库存时可登记采购需求，平台不会用演示容量代替真实供给。</p></div>
          <span class="h100-stock-state" id="h100StockState" data-state="loading">正在核对库存</span>
        </header>
        <div class="h100-product-layout">
          <div class="h100-product-specification">
            <div class="h100-product-identity"><span>GPU</span><strong>NVIDIA H100 SXM 80GB</strong><small>购买指定时段内的云服务使用权，不转移物理 GPU 所有权。</small></div>
            <div class="h100-standard-modes">
              <article><i>80GB</i><div><b>整卡独占</b><span>完整 H100 实例，按 1 GPU 时计费</span></div></article>
              <article><i>20GB</i><div><b>切片服务</b><span>适合推理与测试，按 0.25 GPU 时折算</span></div></article>
            </div>
            <dl class="h100-standard-data">
              <div><dt>CPU</dt><dd>16 / 32 / 64 核</dd></div><div><dt>内存</dt><dd>64 / 128 / 256GB</dd></div>
              <div><dt>存储</dt><dd>500GB SSD / 1TB / 2TB NVMe</dd></div><div><dt>环境</dt><dd>Ubuntu · CUDA · PyTorch · TensorFlow</dd></div>
            </dl>
            <ol class="h100-product-flow" aria-label="H100 购买交付流程"><li><b>01</b><span>配置</span></li><li><b>02</b><span>预留</span></li><li><b>03</b><span>支付</span></li><li><b>04</b><span>调度</span></li><li><b>05</b><span>交付</span></li><li><b>06</b><span>验收</span></li></ol>
          </div>
          <aside class="h100-availability" aria-live="polite">
            <span class="eyebrow">LIVE AVAILABILITY</span><h3>真实库存与执行价</h3>
            <div class="h100-live-metrics"><div><small>可售容量</small><strong id="h100LiveCapacity">—</strong></div><div><small>可售地区</small><strong id="h100LiveRegions">—</strong></div><div><small>最低执行价</small><strong id="h100LivePrice">—</strong></div></div>
            <div class="h100-live-list" id="h100LiveList"><p>正在读取服务端挂牌…</p></div>
            <button class="primary wide" id="h100PrimaryAction" type="button" disabled>正在核对库存</button>
            <p class="h100-availability-note">只有“已验真、在有效期内且可售余额大于零”的挂牌才能进入支付。</p>
          </aside>
        </div>
      </section>`);
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="h100-demand-dialog" id="h100DemandDialog">
        <button class="dialog-close" id="closeH100Demand" type="button" aria-label="关闭">×</button>
        <div class="h100-demand-content"><span class="eyebrow">H100 PURCHASE REQUEST</span><h2>登记 H100 采购需求</h2><p>当前没有可直接付款的真实库存。提交后仅生成采购需求，不预留容量、不创建支付单。</p>
          <form id="h100DemandForm">
            <fieldset><legend>GPU 使用模式</legend><div class="h100-mode-grid"><label><input type="radio" name="h100DemandMode" value="exclusive" checked><span><b>80GB 独占</b><small>1 服务小时 = 1 GPU 时</small></span></label><label><input type="radio" name="h100DemandMode" value="slice_20gb"><span><b>20GB 切片</b><small>1 服务小时 = 0.25 GPU 时</small></span></label></div></fieldset>
            <div class="h100-field-grid">
              <label>期望地区<select id="h100DemandRegion"><option>不限地区</option><option>北京</option><option>上海</option><option>深圳</option><option>成都</option><option>中国香港</option></select></label>
              <label>计划开始时间<input id="h100DemandStart" type="datetime-local" required></label>
              <label>服务时长<div class="input-unit"><input id="h100DemandHours" type="number" min="1" max="8760" step="1" value="720" required><span>小时</span></div></label>
              <label>CPU<select id="h100DemandCpu"><option value="16">16 核</option><option value="32" selected>32 核</option><option value="64">64 核</option></select></label>
              <label>内存<select id="h100DemandMemory"><option value="64">64GB</option><option value="128" selected>128GB</option><option value="256">256GB</option></select></label>
              <label>高速存储<select id="h100DemandStorage"><option value="ssd_500">500GB SSD</option><option value="nvme_1tb" selected>1TB NVMe</option><option value="nvme_2tb">2TB NVMe</option></select></label>
              <label>运行环境<select id="h100DemandEnvironment"><option value="ubuntu_cuda">Ubuntu + CUDA</option><option value="pytorch" selected>Ubuntu + CUDA + PyTorch</option><option value="tensorflow">Ubuntu + CUDA + TensorFlow</option></select></label>
            </div>
            <div class="h100-demand-summary" id="h100DemandSummary" aria-live="polite"></div>
            <p class="h100-demand-state" id="h100DemandState" role="status"></p>
            <button class="primary wide" id="submitH100Demand" type="submit">登录后提交采购需求</button>
          </form>
        </div>
      </dialog>`);
    $('#closeH100Demand').addEventListener('click', () => $('#h100DemandDialog').close());
    $('#h100DemandForm').addEventListener('input', updateDemandSummary);
    $('#h100DemandForm').addEventListener('change', updateDemandSummary);
    $('#h100DemandForm').addEventListener('submit', submitH100Demand);
    $('#h100PrimaryAction').addEventListener('click', handleH100PrimaryAction);
    $('#h100LiveList').addEventListener('click', event => {
      const button = event.target.closest('[data-h100-listing]');
      if (button) openCheckout('H100', 720, undefined, button.dataset.h100Listing);
    });
  }

  let h100MarketListings = [];
  let h100MarketUser = null;

  function updateDemandSummary() {
    const mode = $('input[name="h100DemandMode"]:checked')?.value || 'exclusive';
    const hours = Number($('#h100DemandHours')?.value || 0);
    const gpuHours = hours * modes[mode].factor;
    if ($('#h100DemandSummary')) $('#h100DemandSummary').innerHTML = `<span>需求折算</span><b>${formatNumber(hours)} 服务小时 = ${formatNumber(gpuHours)} GPU 时</b><small>这是容量口径，不是报价；执行价需匹配真实供应商挂牌后才能确认。</small>`;
  }

  function openH100Demand() {
    const dialog = $('#h100DemandDialog');
    $('#h100DemandStart').value = localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    $('#h100DemandState').textContent = '';
    $('#submitH100Demand').textContent = h100MarketUser ? '提交采购需求' : '登录后提交采购需求';
    dialog.dataset.idempotency = `h100-demand-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    updateDemandSummary();
    dialog.showModal();
  }

  function handleH100PrimaryAction() {
    if (h100MarketListings.length) openCheckout('H100', 720, undefined, h100MarketListings[0].id);
    else openH100Demand();
  }

  async function submitH100Demand(event) {
    event.preventDefault();
    const button = $('#submitH100Demand');
    const state = $('#h100DemandState');
    const meResponse = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const me = await meResponse.json();
    if (!me.authenticated) {
      $('#h100DemandDialog').close();
      if (typeof openAuth === 'function') openAuth('login');
      toast('请先登录企业采购账户，再提交 H100 采购需求');
      return;
    }
    button.disabled = true; button.textContent = '正在提交…'; state.textContent = '';
    const mode = $('input[name="h100DemandMode"]:checked')?.value || 'exclusive';
    try {
      const response = await fetch('/api/purchase-requests', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token, 'Idempotency-Key': $('#h100DemandDialog').dataset.idempotency },
        body: JSON.stringify({
          product_code: 'NVIDIA H100 SXM 80GB', region: $('#h100DemandRegion').value,
          service_mode: mode, service_hours: Number($('#h100DemandHours').value),
          cpu_cores: Number($('#h100DemandCpu').value), memory_gb: Number($('#h100DemandMemory').value),
          storage: $('#h100DemandStorage').value, environment: $('#h100DemandEnvironment').value,
          start_at: $('#h100DemandStart').value
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `提交失败（${response.status}）`);
      state.innerHTML = `采购需求 <b>${escapeHtml(payload.request.id)}</b> 已登记。真实库存匹配并形成供应商执行价前，不会创建支付单。`;
      button.textContent = '采购需求已提交';
      toast('H100 采购需求已登记');
    } catch (error) {
      state.textContent = error.message;
      button.disabled = false; button.textContent = '重新提交采购需求';
    }
  }

  window.kaiRenderH100Product = (catalog = [], user = null) => {
    ensureH100ProductHub();
    h100MarketUser = user;
    h100MarketListings = catalog.filter(item => item.gpu === 'H100' && Number(item.available_quantity) > 0);
    const capacity = h100MarketListings.reduce((sum, item) => sum + Number(item.available_quantity || 0), 0);
    const regions = [...new Set(h100MarketListings.map(item => item.region))];
    const minimum = h100MarketListings.length ? Math.min(...h100MarketListings.map(item => Number(item.unit_price_cny))) : null;
    $('#h100LiveCapacity').textContent = h100MarketListings.length ? `${formatNumber(capacity)} GPU 时` : '0 GPU 时';
    $('#h100LiveRegions').textContent = h100MarketListings.length ? `${regions.length} 个` : '0 个';
    $('#h100LivePrice').textContent = minimum === null ? '暂无执行价' : `¥ ${minimum.toFixed(2)} / GPU 时`;
    const stockState = $('#h100StockState');
    stockState.dataset.state = h100MarketListings.length ? 'available' : 'empty';
    stockState.textContent = h100MarketListings.length ? '真实库存可购买' : '暂无已验真可售库存';
    $('#h100LiveList').innerHTML = h100MarketListings.length ? h100MarketListings.slice(0, 4).map(item => `
      <article><div><b>${escapeHtml(item.region)} · ${escapeHtml(item.provider)}</b><span>可售 ${formatNumber(item.available_quantity)} GPU 时 · 版本 ${item.version}</span></div><strong>¥ ${Number(item.unit_price_cny).toFixed(2)}</strong><button type="button" data-h100-listing="${escapeHtml(item.id)}">配置购买</button></article>`).join('')
      : '<div class="h100-no-stock"><b>当前没有可直接付款的 H100</b><p>真实供应商完成资源存入、验真和挂牌审核后，库存与执行价会自动显示在这里。</p></div>';
    const primary = $('#h100PrimaryAction');
    primary.disabled = false;
    primary.textContent = h100MarketListings.length ? '配置并购买 H100' : '登记 H100 采购需求';
    if ($('#submitH100Demand')) $('#submitH100Demand').textContent = user ? '提交采购需求' : '登录后提交采购需求';
  };

  ensureH100ProductHub();
  Promise.all([
    fetch('/api/catalog', { credentials: 'same-origin' }).then(response => response.json()),
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(response => response.json())
  ]).then(([catalog, me]) => window.kaiRenderH100Product(catalog.listings || [], me.authenticated ? me.user : null)).catch(() => window.kaiRenderH100Product([], null));

  ensurePurchaseConfigurator();
})();
