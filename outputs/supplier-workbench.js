(() => {
  'use strict';

  const main = document.querySelector('main');
  const navButton = document.querySelector('.nav-item[data-view="supplier"]');
  if (!main || !navButton || document.querySelector('#supplierView')) return;

  const draftKey = 'kai-supplier-listing-drafts-v1';
  const productMeta = {
    gpu: { label: 'GPU 算力', short: 'GPU', unit: 'GPU 时', marketKind: 'gpu' },
    token: { label: 'Token 大模型', short: 'Token', unit: '百万 Token', marketKind: 'token' },
    rack: { label: '柜月', short: '柜月', unit: '柜月', marketKind: 'rack' }
  };
  const regionNames = {
    chengdu: '成都', beijing: '北京', shanghai: '上海', shenzhen: '深圳',
    guizhou: '贵州', neimeng: '内蒙古', ningxia: '宁夏', hongkong: '中国香港', singapore: '新加坡'
  };

  const view = document.createElement('section');
  view.className = 'view supplier-workbench';
  view.id = 'supplierView';
  view.innerHTML = `
    <div class="page-title supplier-page-title">
      <div><span class="eyebrow">SUPPLIER OPERATIONS</span><h1>供应商工作台</h1><p>先认证和验真，再从容量账本创建 GPU、Token 或柜月上架；报价、预留、交付和结算使用同一批次口径。</p></div>
      <button class="primary" type="button" data-supplier-open-kind="gpu">+ 创建上架</button>
    </div>

    <section class="supplier-gate" aria-labelledby="supplierGateTitle">
      <div><span class="supplier-gate-dot" aria-hidden="true"></span><div><small>企业供应商状态</small><b id="workbenchSupplierState">正在读取账户状态</b><p id="workbenchSupplierHint">只有已认证企业供应商可以提交上架审核。</p></div></div>
      <button class="secondary" type="button" data-supplier-certification>进入供应商认证</button>
    </section>

    <section class="supplier-certification-entry" id="supplierCertificationEntry" data-state="pending" aria-labelledby="supplierCertificationTitle">
      <div class="supplier-certification-mark">认证</div>
      <div class="supplier-certification-copy">
        <small>SUPPLIER CERTIFICATION</small>
        <h2 id="supplierCertificationTitle">供应商认证入口</h2>
        <p id="supplierCertificationDescription">普通企业账号也可以申请。先完成企业主体认证，审核通过后再提交返佣材料、资源验真和上架申请。</p>
        <div class="supplier-certification-steps"><span><i>1</i>填写企业主体</span><span><i>2</i>平台审核认证</span><span><i>3</i>提交返佣材料</span></div>
      </div>
      <div class="supplier-certification-actions">
        <b id="supplierCertificationStatus">等待认证</b>
        <button class="primary" type="button" id="supplierCertificationAction">开始供应商认证</button>
        <button class="secondary" type="button" id="supplierRebateMaterialsAction" hidden>进入返佣材料提交</button>
      </div>
      <form class="supplier-certification-form" id="supplierCertificationForm" hidden novalidate>
        <div class="supplier-certification-form-head"><div><small>ENTERPRISE MATERIALS</small><h3>提交企业认证材料</h3><p>营业执照仅供平台认证审核，不会在市场页面公开。</p></div><span id="supplierCertificationApplicationId">新申请</span></div>
        <div class="supplier-certification-grid">
          <label>企业全称<input id="certEnterpriseName" autocomplete="organization" maxlength="120" placeholder="必须与营业执照完全一致" required></label>
          <label>统一社会信用代码<input id="certCreditCode" autocomplete="off" maxlength="18" placeholder="18 位统一社会信用代码" required></label>
          <label>法定代表人<input id="certLegalRepresentative" autocomplete="name" maxlength="60" placeholder="营业执照登记姓名" required></label>
          <label>授权经办人<input id="certAgentName" autocomplete="name" maxlength="60" placeholder="本次认证经办人姓名" required></label>
          <label>联系电话<input id="certContactPhone" autocomplete="tel" maxlength="60" placeholder="便于平台核验联系" required></label>
          <label class="supplier-license-upload">三证合一营业执照
            <input id="certLicenseFile" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required>
            <span id="certLicenseFileState">上传 PDF、JPG 或 PNG，文件不超过 5MB</span>
          </label>
        </div>
        <label class="supplier-certification-declaration"><input id="certDeclaration" type="checkbox" required><span>我确认提交的企业主体和营业执照真实、有效，并授权平台用于供应商准入核验。</span></label>
        <div class="supplier-certification-review-note" id="supplierCertificationReviewNote" hidden></div>
        <div class="supplier-certification-form-actions"><button class="primary" id="submitSupplierCertification" type="submit">提交平台认证</button><span id="supplierCertificationFormStatus" role="status"></span></div>
      </form>
    </section>

    <section class="supplier-kpis" aria-label="供应商经营概览">
      <article><small>已验真存入</small><strong id="supplierVerifiedTotal">—</strong><span>容量账本中的有效批次</span></article>
      <article><small>当前可售容量</small><strong id="supplierSellableTotal">—</strong><span>扣除预留、锁定与冻结</span></article>
      <article><small>我的上架</small><strong id="supplierListingCount">0</strong><span>本机已保存的上架草稿</span></article>
      <article><small>待交付订单</small><strong id="supplierDeliveryCount">—</strong><span>登录后从服务端同步</span></article>
    </section>

    <section class="supplier-flow" aria-label="供应商上架流程">
      <div><i>01</i><span><b>企业认证</b><small>主体、经办人和对公账户</small></span></div>
      <em>→</em><div><i>02</i><span><b>资源接入</b><small>人工测试、连接器或只读 API</small></span></div>
      <em>→</em><div><i>03</i><span><b>验真存入</b><small>生成可追溯容量批次</small></span></div>
      <em>→</em><div><i>04</i><span><b>创建上架</b><small>规格、时段、地区和报价</small></span></div>
      <em>→</em><div><i>05</i><span><b>成交交付</b><small>预留、计量、验收和结算</small></span></div>
    </section>

    <nav class="supplier-tabs" role="tablist" aria-label="供应商工作台页面">
      <button class="active" type="button" role="tab" data-supplier-tab="overview" aria-selected="true">工作台首页</button>
      <button type="button" role="tab" data-supplier-tab="resources" aria-selected="false">我的资源</button>
      <button type="button" role="tab" data-supplier-tab="create" aria-selected="false">创建上架</button>
      <button type="button" role="tab" data-supplier-tab="listings" aria-selected="false">上架管理</button>
      <button type="button" role="tab" data-supplier-tab="delivery" aria-selected="false">订单与交付</button>
    </nav>

    <div class="supplier-tab-panel active" data-supplier-panel="overview">
      <div class="supplier-section-head"><div><span class="eyebrow">RESOURCE ROUTES</span><h2>选择要经营的资源</h2><p>三类资源采用不同的产品身份、计量和交付标准，不混用一张发布表单。</p></div></div>
      <div class="supplier-resource-routes">
        <article><span class="supplier-type-mark">GPU</span><h3>GPU 算力</h3><p>按型号、卡数、显存、拓扑、地区和精细时段建立 GPU 时商品。</p><ul><li>计价：元 / GPU 时</li><li>库存：已验真 GPU 时</li><li>交付：环境、作业或集群</li></ul><button type="button" data-supplier-open-kind="gpu">创建 GPU 上架 →</button></article>
        <article><span class="supplier-type-mark">TOK</span><h3>Token 大模型</h3><p>必须绑定具体模型、服务商、上下文、价格类型、区域和有效期。</p><ul><li>实际用量：元 / 百万 Token</li><li>容量保障：元 / Token 容量时</li><li>输入、缓存和输出分项</li></ul><button type="button" data-supplier-open-kind="token">创建 Token 上架 →</button></article>
        <article><span class="supplier-type-mark">RACK</span><h3>柜月</h3><p>按机柜功率、制冷、PUE、网络、电费和最低服务期标准化。</p><ul><li>计价：元 / 柜月或 kW 月</li><li>库存：可交付机柜月</li><li>复杂需求默认 RFQ</li></ul><button type="button" data-supplier-open-kind="rack">创建柜月上架 →</button></article>
      </div>
      <section class="supplier-rule-strip">
        <div><small>可售容量公式</small><b>已验真存入 − 报价预留 − 订单锁定 − 交付中 − 已消耗 − 风控冻结</b></div>
        <p>工作台只允许从已验真批次分配上架容量。设备 UUID、机房详细地址、供应商底价和风控备注不会进入采购方公开页面。</p>
      </section>
    </div>

    <div class="supplier-tab-panel" data-supplier-panel="resources" hidden>
      <div class="supplier-section-head"><div><span class="eyebrow">VERIFIED BATCHES</span><h2>我的资源批次</h2><p>资源经过认证、接入和验真后才会出现在这里。</p></div><button class="primary" type="button" data-supplier-assessment>+ 存入并验真资源</button></div>
      <div class="supplier-empty-state" id="supplierResourceList">
        <span>▦</span><h3>暂无可上架的已验真批次</h3><p>完成企业认证后，可通过人工材料与远程测试、KAI 轻量连接器或云厂商只读 API 接入资源。</p><button class="secondary" type="button" data-supplier-assessment>进入供应商评估</button>
      </div>
      <section class="supplier-access-summary">
        <article><b>人工材料 + 远程测试</b><span>适合首笔交易和小供应商，库存由运营确认。</span></article>
        <article><b>KAI 轻量连接器</b><span>适合自有 GPU、服务器和 NAS，支持持续验真。</span></article>
        <article><b>云厂商只读 API / 子账号</b><span>读取规格、配额和运行状态，不接收主账号密码。</span></article>
      </section>
    </div>

    <div class="supplier-tab-panel" data-supplier-panel="create" hidden>
      <div class="supplier-create-layout">
        <form class="supplier-listing-form" id="supplierListingForm" novalidate>
          <div class="supplier-form-head"><div><span class="eyebrow">CREATE LISTING</span><h2>创建标准化上架</h2><p>可以先保存草稿；绑定已验真容量批次后才能提交平台审核。</p></div><span class="supplier-draft-state">未保存</span></div>

          <fieldset class="supplier-form-section"><legend><i>01</i> 选择资源类型</legend>
            <div class="supplier-kind-picker" role="group" aria-label="上架资源类型"><button class="active" type="button" data-listing-kind="gpu">GPU 算力</button><button type="button" data-listing-kind="token">Token 大模型</button><button type="button" data-listing-kind="rack">柜月</button></div>
          </fieldset>

          <fieldset class="supplier-form-section"><legend><i>02</i> 绑定容量批次</legend>
            <label>已验真容量批次<select id="supplierBatch" required><option value="">暂未绑定 · 先保存上架草稿</option></select><small>不能手工填写库存；可售数量必须由容量账本计算。</small></label>
          </fieldset>

          <fieldset class="supplier-form-section"><legend><i>03</i> 产品规格与交付</legend>
            <div class="supplier-form-grid" data-listing-fields="gpu">
              <label>GPU 型号<select id="supplierGpu"><option>H100 80GB</option><option>H200 141GB</option><option>B200 180GB</option><option>GB200 NVL72</option><option>A100 80GB</option><option>H800 80GB</option><option>MI300X 192GB</option><option>昇腾 910B</option></select></label>
              <label>交付形态<select id="supplierGpuDelivery"><option>单卡实例</option><option>8 卡服务器</option><option>多机 RDMA 集群</option><option>裸金属整机</option></select></label>
              <label>可售 GPU 时<input id="supplierGpuQty" type="number" min="1" step="1" value="720"></label>
              <label>最小购买量<input id="supplierGpuMin" type="number" min="1" step="1" value="8"><small>单位：GPU 时</small></label>
            </div>
            <div class="supplier-form-grid" data-listing-fields="token" hidden>
              <label>具体模型<select id="supplierTokenModel"><option>DeepSeek-V3</option><option>DeepSeek-R1</option><option>Qwen3-235B</option><option>GPT-5</option><option>Claude Sonnet 4</option><option>Gemini 2.5 Pro</option><option>Kimi K2</option><option>GLM-4.5</option></select></label>
              <label>服务商<select id="supplierTokenProvider"><option>KAI 模型网关</option><option>阿里云百炼</option><option>腾讯云</option><option>华为云</option><option>火山方舟</option></select></label>
              <label>上下文档位<select id="supplierTokenContext"><option>32K 上下文</option><option>128K 上下文</option><option>1M 上下文</option></select></label>
              <label>价格类型<select id="supplierTokenPriceType"><option value="usage">百万 Token 实际用量</option><option value="capacity">Token 容量时</option></select></label>
              <label>计量分项<select id="supplierTokenMeter"><option>输入 Token</option><option>缓存输入 Token</option><option>输出 Token</option><option>输入 / 缓存 / 输出分别计价</option></select></label>
              <label>吞吐保障<input id="supplierTokenTpm" type="number" min="1" value="100000"><small>TPM：每分钟可处理的 Token 数</small></label>
              <label>请求频率<input id="supplierTokenRpm" type="number" min="1" value="300"><small>RPM：每分钟允许的请求数</small></label>
              <label>可售数量<input id="supplierTokenQty" type="number" min="0.01" step="0.01" value="100"><small id="supplierTokenUnitHelp">单位：百万 Token</small></label>
            </div>
            <div class="supplier-form-grid" data-listing-fields="rack" hidden>
              <label>柜月产品<select id="supplierRack"><option>10kW 基础风冷机柜</option><option>20kW 标准风冷机柜</option><option>40kW 液冷 AI 机柜</option><option>60kW 液冷超算机柜</option><option>80kW 高密液冷机柜</option><option>120kW 超节点液冷柜</option></select></label>
              <label>制冷方式<select id="supplierCooling"><option>风冷</option><option>混合制冷</option><option>冷板液冷</option><option>浸没式液冷</option></select></label>
              <label>功率上限<input id="supplierPower" type="number" min="1" value="40"><small>单位：kW / 柜</small></label>
              <label>PUE 参考值<input id="supplierPue" type="number" min="1" max="3" step="0.01" value="1.25"></label>
              <label>可售柜月<input id="supplierRackQty" type="number" min="1" value="12"></label>
              <label>最低服务期<input id="supplierMinTerm" type="number" min="1" value="3"><small>单位：月</small></label>
            </div>
            <div class="supplier-form-grid supplier-common-grid">
              <label>服务地区<select id="supplierRegion"><option value="chengdu">成都</option><option value="beijing">北京</option><option value="shanghai">上海</option><option value="shenzhen">深圳</option><option value="guizhou">贵州</option><option value="neimeng">内蒙古</option><option value="ningxia">宁夏</option><option value="hongkong">中国香港</option><option value="singapore">新加坡</option></select></label>
              <label>SLA<select id="supplierSla"><option>99.5% 标准保障</option><option>99.9% 高可用</option><option>99.95% 关键任务</option><option>按合同协商</option></select></label>
              <label>可售开始<input id="supplierValidFrom" type="datetime-local" required></label>
              <label>可售结束<input id="supplierValidUntil" type="datetime-local" required></label>
            </div>
          </fieldset>

          <fieldset class="supplier-form-section"><legend><i>04</i> 报价与交易规则</legend>
            <div class="supplier-price-layers">
              <article><small>市场参考价</small><b id="supplierMarketReference">正在读取参考盘</b><span>同产品、地区和口径的参考报价</span></article>
              <label class="supplier-private-price"><small>供应商底价 · 私密</small><span><em>¥</em><input id="supplierFloorPrice" type="number" min="0" step="0.01" placeholder="仅平台撮合和风控可见"></span><u>不会展示给采购方或其他供应商</u></label>
              <label><small>供应商目标价</small><span><em>¥</em><input id="supplierTargetPrice" type="number" min="0.01" step="0.01" value="14.90" required></span><u id="supplierTargetUnit">每 GPU 时</u></label>
            </div>
            <div class="supplier-form-grid">
              <label>交易方式<select id="supplierTradeMode"><option value="fixed">固定价购买</option><option value="rfq">RFQ 询价</option><option value="reserved">预留未来容量</option></select></label>
              <label>报价有效期<input id="supplierQuoteExpiry" type="datetime-local" required></label>
            </div>
            <div class="supplier-price-note"><b>订单执行价</b><span>买卖双方确认后在订单快照中固化；上架页面不会把市场参考价当作最终成交价。</span></div>
          </fieldset>

          <div class="supplier-form-actions"><button class="secondary" id="saveSupplierDraft" type="button">保存草稿</button><button class="primary" id="submitSupplierListing" type="submit">提交上架审核</button></div>
          <p class="supplier-form-status" id="supplierFormStatus" role="status"></p>
        </form>

        <aside class="supplier-public-preview" aria-live="polite">
          <div class="supplier-preview-head"><span>采购方公开预览</span><b>不含敏感字段</b></div>
          <span class="supplier-preview-badge" id="supplierPreviewKind">GPU</span>
          <h3 id="supplierPreviewTitle">H100 80GB · 单卡实例</h3>
          <p id="supplierPreviewIdentity">成都 · 99.5% 标准保障</p>
          <dl><div><dt>可售数量</dt><dd id="supplierPreviewQty">720 GPU 时</dd></div><div><dt>可售时间</dt><dd id="supplierPreviewTime">等待设置</dd></div><div><dt>标准化报价</dt><dd id="supplierPreviewPrice">¥ 14.90 / GPU 时</dd></div><div><dt>交易方式</dt><dd id="supplierPreviewMode">固定价购买</dd></div></dl>
          <div class="supplier-preview-trust"><i>✓</i><span><b>容量批次待绑定</b><small>验真通过后展示等级和最近验真时间</small></span></div>
          <div class="supplier-preview-hidden"><b>不会公开</b><span>供应商底价、设备 UUID、机房详细地址、权属材料、原始报价和风控备注</span></div>
        </aside>
      </div>
    </div>

    <div class="supplier-tab-panel" data-supplier-panel="listings" hidden>
      <div class="supplier-section-head"><div><span class="eyebrow">LISTING MANAGEMENT</span><h2>上架管理</h2><p>查看草稿和待绑定批次的上架方案。正式上架后还会显示预留、锁定和可售余额。</p></div><button class="primary" type="button" data-supplier-open-kind="gpu">+ 创建上架</button></div>
      <div class="supplier-listing-table" id="supplierListingTable"></div>
    </div>

    <div class="supplier-tab-panel" data-supplier-panel="delivery" hidden>
      <div class="supplier-section-head"><div><span class="eyebrow">ORDER DELIVERY</span><h2>订单与交付</h2><p>固定价、RFQ 和预留订单统一进入容量锁定、交付、计量、验收和结算流程。</p></div></div>
      <div class="supplier-empty-state" id="supplierDeliveryList"><span>→</span><h3>暂无待交付订单</h3><p>成交后会在这里显示容量锁定状态、交付凭据领取、双源计量差异、验收期限和结算进度。</p></div>
      <div class="supplier-delivery-flow"><span>订单确认</span><i>→</i><span>容量锁定</span><i>→</i><span>开通交付</span><i>→</i><span>双源计量</span><i>→</i><span>采购方验收</span><i>→</i><span>结算</span></div>
    </div>`;
  main.append(view);

  const $ = selector => view.querySelector(selector);
  const $$ = selector => [...view.querySelectorAll(selector)];
  const safeText = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  let activeKind = 'gpu';
  let marketReference = null;
  let supplierCertified = false;
  let supplierIdentity = null;
  let editingDraftId = null;
  let supplierCsrf = '';
  let supplierData = { applications: [], intakes: [], listings: [], orders: [], settlements: [] };

  async function supplierApi(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if ((options.method || 'GET') !== 'GET' && supplierCsrf) headers.set('X-KAI-CSRF', supplierCsrf);
    const response = await fetch(path, { method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `服务请求失败（${response.status}）`);
    return payload;
  }

  function loadDrafts() {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }

  function storeDrafts(rows) {
    try { localStorage.setItem(draftKey, JSON.stringify(rows)); } catch (_) { /* storage may be unavailable */ }
  }

  function localDateTime(date) {
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function switchTab(name) {
    $$('[data-supplier-tab]').forEach(button => {
      const active = button.dataset.supplierTab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-supplier-panel]').forEach(panel => {
      const active = panel.dataset.supplierPanel === name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (name === 'listings') renderDrafts();
  }

  function setKind(kind) {
    activeKind = productMeta[kind] ? kind : 'gpu';
    $$('[data-listing-kind]').forEach(button => button.classList.toggle('active', button.dataset.listingKind === activeKind));
    $$('[data-listing-fields]').forEach(group => { group.hidden = group.dataset.listingFields !== activeKind; });
    const meta = productMeta[activeKind];
    $('#supplierTargetUnit').textContent = `每 ${meta.unit}`;
    $('#supplierPreviewKind').textContent = meta.short;
    if (activeKind === 'rack' && $('#supplierTradeMode').value === 'fixed') $('#supplierTradeMode').value = 'rfq';
    updateTokenUnit();
    renderBatchOptions();
    updatePreview();
    refreshReferencePrice();
  }

  function ledgerKind() {
    if (activeKind !== 'token') return activeKind;
    return $('#supplierTokenPriceType').value === 'capacity' ? 'tokencap' : 'tokenusage';
  }

  function renderBatchOptions() {
    const batch = $('#supplierBatch');
    if (!batch) return;
    const expectedKind = ledgerKind();
    const verified = (supplierData.intakes || []).filter(item => item.status === 'verified' && item.kind === expectedKind);
    const allocatedByIntake = (supplierData.listings || []).filter(item => ['pending_review', 'active', 'suspended'].includes(item.status)).reduce((map, item) => {
      map[item.intake_id] = (map[item.intake_id] || 0) + Number(item.verified_quantity || 0);
      return map;
    }, {});
    batch.innerHTML = '<option value="">请选择已验真容量批次</option>' + verified.map(item => {
      const remaining = Math.max(0, Number(item.quantity) - Number(allocatedByIntake[item.id] || 0));
      return `<option value="${safeText(item.id)}" data-remaining="${remaining}">${safeText(item.product_code)} · ${safeText(item.region)} · 可分配 ${remaining.toLocaleString('zh-CN')} ${safeText(item.unit)}</option>`;
    }).join('');
  }

  function updateTokenUnit() {
    if (activeKind !== 'token') return;
    const capacity = $('#supplierTokenPriceType').value === 'capacity';
    productMeta.token.unit = capacity ? 'Token 容量时' : '百万 Token';
    $('#supplierTokenUnitHelp').textContent = `单位：${productMeta.token.unit}`;
    $('#supplierTokenMeter').disabled = capacity;
    if (capacity) $('#supplierTokenMeter').value = '输入 / 缓存 / 输出分别计价';
    $('#supplierTargetUnit').textContent = `每 ${productMeta.token.unit}`;
    renderBatchOptions();
  }

  function listingIdentity() {
    if (activeKind === 'gpu') return {
      title: `${$('#supplierGpu').value} · ${$('#supplierGpuDelivery').value}`,
      quantity: `${Number($('#supplierGpuQty').value || 0).toLocaleString('zh-CN')} GPU 时`
    };
    if (activeKind === 'token') return {
      title: `${$('#supplierTokenModel').value} · ${$('#supplierTokenProvider').value}`,
      quantity: `${Number($('#supplierTokenQty').value || 0).toLocaleString('zh-CN')} ${productMeta.token.unit}`
    };
    return {
      title: `${$('#supplierRack').value} · ${$('#supplierCooling').value}`,
      quantity: `${Number($('#supplierRackQty').value || 0).toLocaleString('zh-CN')} 柜月`
    };
  }

  function updatePreview() {
    const identity = listingIdentity();
    const region = regionNames[$('#supplierRegion').value] || $('#supplierRegion').selectedOptions[0]?.textContent || '待设置地区';
    const from = $('#supplierValidFrom').value ? new Date($('#supplierValidFrom').value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const until = $('#supplierValidUntil').value ? new Date($('#supplierValidUntil').value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const price = Number($('#supplierTargetPrice').value || 0);
    $('#supplierPreviewTitle').textContent = identity.title;
    $('#supplierPreviewIdentity').textContent = `${region} · ${$('#supplierSla').value}`;
    $('#supplierPreviewQty').textContent = identity.quantity;
    $('#supplierPreviewTime').textContent = from && until ? `${from} 至 ${until}` : '等待设置';
    $('#supplierPreviewPrice').textContent = `¥ ${price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${productMeta[activeKind].unit}`;
    $('#supplierPreviewMode').textContent = $('#supplierTradeMode').selectedOptions[0].textContent;
  }

  async function refreshReferencePrice() {
    const region = $('#supplierRegion').value;
    $('#supplierMarketReference').textContent = '正在读取参考盘';
    marketReference = null;
    try {
      const query = new URLSearchParams({ kind: productMeta[activeKind].marketKind, region, interval: '15m', limit: '1' });
      const response = await fetch(`/api/market/candles?${query}`, { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.candles?.length) throw new Error('reference unavailable');
      const last = payload.candles[payload.candles.length - 1];
      marketReference = Number(last.close);
      $('#supplierMarketReference').textContent = `¥ ${marketReference.toLocaleString('zh-CN', { minimumFractionDigits: marketReference >= 1000 ? 0 : 2, maximumFractionDigits: 2 })} / ${payload.product.unit}`;
      if (!editingDraftId) $('#supplierTargetPrice').value = marketReference.toFixed(marketReference >= 1000 ? 0 : 2);
      updatePreview();
    } catch (_) {
      $('#supplierMarketReference').textContent = '参考盘暂不可用';
    }
  }

  function collectDraft(status) {
    const identity = listingIdentity();
    const details = activeKind === 'gpu' ? {
      gpu: $('#supplierGpu').value, delivery: $('#supplierGpuDelivery').value,
      quantity: $('#supplierGpuQty').value, minimum: $('#supplierGpuMin').value
    } : activeKind === 'token' ? {
      model: $('#supplierTokenModel').value, provider: $('#supplierTokenProvider').value,
      context: $('#supplierTokenContext').value, priceType: $('#supplierTokenPriceType').value,
      meter: $('#supplierTokenMeter').value, tpm: $('#supplierTokenTpm').value,
      rpm: $('#supplierTokenRpm').value, quantity: $('#supplierTokenQty').value
    } : {
      rack: $('#supplierRack').value, cooling: $('#supplierCooling').value,
      power: $('#supplierPower').value, pue: $('#supplierPue').value,
      quantity: $('#supplierRackQty').value, minimumTerm: $('#supplierMinTerm').value
    };
    return {
      id: editingDraftId || `LST-${Date.now().toString().slice(-8)}`,
      kind: activeKind,
      title: identity.title,
      quantity: identity.quantity,
      region: regionNames[$('#supplierRegion').value] || $('#supplierRegion').value,
      regionCode: $('#supplierRegion').value,
      sla: $('#supplierSla').value,
      validFrom: $('#supplierValidFrom').value,
      validUntil: $('#supplierValidUntil').value,
      price: Number($('#supplierTargetPrice').value || 0),
      floor: Number($('#supplierFloorPrice').value || 0),
      unit: productMeta[activeKind].unit,
      tradeMode: $('#supplierTradeMode').selectedOptions[0].textContent,
      quoteExpiry: $('#supplierQuoteExpiry').value,
      details,
      status,
      updatedAt: new Date().toISOString()
    };
  }

  function validateDraft() {
    const status = $('#supplierFormStatus');
    status.textContent = '';
    if (!$('#supplierValidFrom').value || !$('#supplierValidUntil').value || !$('#supplierQuoteExpiry').value) {
      status.textContent = '请完整填写可售开始、可售结束和报价有效期。';
      return false;
    }
    if (new Date($('#supplierValidUntil').value) <= new Date($('#supplierValidFrom').value)) {
      status.textContent = '可售结束时间必须晚于开始时间。';
      return false;
    }
    const target = Number($('#supplierTargetPrice').value || 0);
    const floor = Number($('#supplierFloorPrice').value || 0);
    if (target <= 0) {
      status.textContent = '供应商目标价必须大于 0。';
      return false;
    }
    if (floor > 0 && floor > target) {
      status.textContent = '供应商底价不能高于目标价。';
      return false;
    }
    return true;
  }

  function saveDraft(status = '草稿') {
    if (!validateDraft()) return false;
    const rows = loadDrafts();
    const draft = collectDraft(status);
    const index = rows.findIndex(row => row.id === draft.id);
    if (index >= 0) rows[index] = draft; else rows.unshift(draft);
    storeDrafts(rows);
    editingDraftId = draft.id;
    $('.supplier-draft-state').textContent = `${status} · 已保存`;
    $('#supplierFormStatus').textContent = status === '草稿'
      ? '草稿已保存在当前浏览器，可在“上架管理”继续完善。'
      : '方案已保存；完成企业认证并绑定已验真容量批次后才能进入平台审核。';
    renderDrafts();
    if (typeof toast === 'function') toast(status === '草稿' ? '上架草稿已保存' : '方案已保存，等待认证与验真');
    return true;
  }

  function renderDrafts() {
    const rows = loadDrafts();
    const serverRows = supplierData.listings || [];
    $('#supplierListingCount').textContent = String(rows.length + serverRows.length);
    const target = $('#supplierListingTable');
    if (!rows.length && !serverRows.length) {
      target.innerHTML = '<div class="supplier-empty-state"><span>＋</span><h3>还没有上架草稿</h3><p>从已验真容量批次创建 GPU、Token 或柜月商品，设置地区、时段和三层价格。</p><button class="secondary" type="button" data-empty-create>创建第一个上架</button></div>';
      target.querySelector('[data-empty-create]')?.addEventListener('click', () => openKind('gpu'));
      return;
    }
    const statusLabels = { pending_review: '平台审核中', active: '公开在售', suspended: '已暂停', rejected: '审核未通过' };
    const published = serverRows.map(row => `
      <div class="supplier-listing-row">
        <div><b>${safeText(row.product_code)}</b><small>${Number(row.verified_quantity).toLocaleString('zh-CN')} ${safeText(row.unit)} · ${safeText(row.trade_mode)}</small></div>
        <div><b>${safeText(row.region)}</b><small>${safeText(row.valid_from.replace('T', ' ').slice(0, 16))} 至 ${safeText(row.valid_until.replace('T', ' ').slice(0, 16))}</small></div>
        <div><b>¥ ${Number(row.unit_price_cny).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</b><small>/ ${safeText(row.unit)}</small></div>
        <span class="supplier-listing-status">${safeText(statusLabels[row.status] || row.status)}</span>
        <span>可售 ${Number(row.available_quantity).toLocaleString('zh-CN')}</span>
      </div>`).join('');
    target.innerHTML = `<div class="supplier-listing-row supplier-listing-header"><span>产品</span><span>地区 / 可售时间</span><span>目标价</span><span>状态</span><span>操作</span></div>${published}${rows.map(row => `
      <div class="supplier-listing-row">
        <div><b>${safeText(row.title)}</b><small>${safeText(row.quantity)} · ${safeText(row.tradeMode)}</small></div>
        <div><b>${safeText(row.region)}</b><small>${safeText(row.validFrom ? row.validFrom.replace('T', ' ') : '时间待补')} 至 ${safeText(row.validUntil ? row.validUntil.replace('T', ' ') : '待补')}</small></div>
        <div><b>¥ ${Number(row.price).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</b><small>/ ${safeText(row.unit)}</small></div>
        <span class="supplier-listing-status">${safeText(row.status)}</span>
        <button type="button" data-edit-draft="${safeText(row.id)}">继续完善</button>
      </div>`).join('')}`;
    target.querySelectorAll('[data-edit-draft]').forEach(button => button.addEventListener('click', () => editDraft(button.dataset.editDraft)));
  }

  function editDraft(id) {
    const draft = loadDrafts().find(row => row.id === id);
    if (!draft) return;
    editingDraftId = draft.id;
    setKind(draft.kind);
    const detail = draft.details || {};
    const assign = (selector, value) => { if (value !== undefined && $(selector)) $(selector).value = value; };
    if (draft.kind === 'gpu') {
      assign('#supplierGpu', detail.gpu); assign('#supplierGpuDelivery', detail.delivery);
      assign('#supplierGpuQty', detail.quantity); assign('#supplierGpuMin', detail.minimum);
    } else if (draft.kind === 'token') {
      assign('#supplierTokenModel', detail.model); assign('#supplierTokenProvider', detail.provider);
      assign('#supplierTokenContext', detail.context); assign('#supplierTokenPriceType', detail.priceType);
      updateTokenUnit(); assign('#supplierTokenMeter', detail.meter); assign('#supplierTokenTpm', detail.tpm);
      assign('#supplierTokenRpm', detail.rpm); assign('#supplierTokenQty', detail.quantity);
    } else {
      assign('#supplierRack', detail.rack); assign('#supplierCooling', detail.cooling);
      assign('#supplierPower', detail.power); assign('#supplierPue', detail.pue);
      assign('#supplierRackQty', detail.quantity); assign('#supplierMinTerm', detail.minimumTerm);
    }
    $('#supplierRegion').value = draft.regionCode || 'chengdu';
    $('#supplierSla').value = draft.sla;
    $('#supplierValidFrom').value = draft.validFrom;
    $('#supplierValidUntil').value = draft.validUntil;
    $('#supplierTargetPrice').value = draft.price;
    $('#supplierFloorPrice').value = draft.floor || '';
    $('#supplierQuoteExpiry').value = draft.quoteExpiry;
    [...$('#supplierTradeMode').options].forEach(option => { option.selected = option.textContent === draft.tradeMode; });
    $('.supplier-draft-state').textContent = `${draft.status} · 编辑中`;
    switchTab('create');
    updatePreview();
  }

  function openKind(kind) {
    editingDraftId = null;
    $('.supplier-draft-state').textContent = '未保存';
    $('#supplierListingForm').reset();
    setDefaultDates();
    switchTab('create');
    setKind(kind);
    $('#supplierListingForm').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function openAssessment() {
    const assessment = document.querySelector('.nav-item[data-view="assessment"]');
    if (assessment) {
      assessment.click();
      setTimeout(() => document.querySelector('.enterprise-gate')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
    else if (typeof toast === 'function') toast('供应商评估模块正在加载，请稍后重试');
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('营业执照读取失败，请重新选择文件'));
      reader.readAsDataURL(file);
    });
  }

  function openCertification() {
    if (!supplierIdentity) {
      document.querySelector('.account')?.click();
      if (typeof toast === 'function') toast('请先登录企业账户再申请供应商认证');
      return;
    }
    const form = $('#supplierCertificationForm');
    form.hidden = !form.hidden;
    if (!form.hidden) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function openRebateMaterials() {
    const rebate = document.querySelector('.nav-item[data-view="supplierCommission"]');
    if (!rebate) return;
    rebate.click();
    setTimeout(() => document.querySelector('#supplierEntranceButton')?.click(), 180);
  }

  function renderCertificationEntry(status = 'unverified') {
    const entry = $('#supplierCertificationEntry');
    const state = $('#supplierCertificationStatus');
    const action = $('#supplierCertificationAction');
    const materials = $('#supplierRebateMaterialsAction');
    const copy = $('#supplierCertificationDescription');
    const form = $('#supplierCertificationForm');
    const submit = $('#submitSupplierCertification');
    const application = (supplierData.applications || [])[0];
    const reviewNote = $('#supplierCertificationReviewNote');
    entry.dataset.state = supplierCertified ? 'certified' : status === 'reviewing' ? 'reviewing' : 'pending';
    action.hidden = false;
    action.disabled = false;
    materials.hidden = true;
    submit.hidden = supplierCertified || status === 'reviewing';
    reviewNote.hidden = !application?.review_reason;
    reviewNote.textContent = application?.review_reason ? `平台审核意见：${application.review_reason}` : '';
    if (application) {
      $('#supplierCertificationApplicationId').textContent = `申请编号 ${application.id}`;
      $('#certEnterpriseName').value = application.enterprise_name || '';
      $('#certCreditCode').value = application.credit_code || '';
      $('#certLegalRepresentative').value = application.legal_representative || '';
      $('#certAgentName').value = application.agent_name || '';
      $('#certContactPhone').value = application.contact_phone || '';
      if (application.license_uploaded) {
        const size = Number(application.license_size || 0) / 1024;
        $('#certLicenseFileState').textContent = `已提交：${application.license_file_name} · ${size.toFixed(size >= 100 ? 0 : 1)} KB`;
      }
    }
    if (!supplierIdentity) {
      state.textContent = '登录后申请';
      action.textContent = '登录并申请认证';
      copy.textContent = '所有企业账号都可以查看供应商业务内容；登录后从这里提交企业主体认证。';
      form.hidden = true;
      return;
    }
    if (supplierCertified) {
      state.textContent = '认证已通过';
      action.textContent = '查看认证信息';
      materials.hidden = false;
      copy.textContent = '企业供应商认证已通过，可以提交返佣交易材料、资源验真和上架申请。';
      return;
    }
    if (status === 'reviewing') {
      state.textContent = '平台审核中';
      action.textContent = '查看认证进度';
      copy.textContent = '认证材料已经提交。平台审核通过后，返佣材料提交入口会自动开放。';
      return;
    }
    state.textContent = status === 'restricted' || status === 'paused' ? '需要复核' : '尚未认证';
    action.textContent = status === 'restricted' || status === 'paused' ? '查看并补充认证' : '开始供应商认证';
    copy.textContent = '普通企业账号也可以申请。先完成企业主体认证，审核通过后再提交返佣材料、资源验真和上架申请。';
  }

  function setDefaultDates() {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const until = new Date(now.getTime() + 30 * 864e5);
    const expiry = new Date(now.getTime() + 7 * 864e5);
    $('#supplierValidFrom').value = localDateTime(now);
    $('#supplierValidUntil').value = localDateTime(until);
    $('#supplierQuoteExpiry').value = localDateTime(expiry);
  }

  function renderSupplierData() {
    const verified = (supplierData.intakes || []).filter(item => item.status === 'verified');
    const activeListings = (supplierData.listings || []).filter(item => item.status === 'active');
    renderBatchOptions();
    $('#supplierVerifiedTotal').textContent = `${verified.length} 个批次`;
    $('#supplierSellableTotal').textContent = `${activeListings.length} 个在售产品`;
    $('#supplierDeliveryCount').textContent = String((supplierData.orders || []).filter(item => ['paid', 'supplier_confirmed', 'delivered'].includes(item.status)).length);

    const resourceTarget = $('#supplierResourceList');
    const resourceStatuses = { pending_verification: '等待平台验真', verified: '已验真', rejected: '验真未通过', frozen: '风控冻结' };
    resourceTarget.innerHTML = (supplierData.intakes || []).length ? (supplierData.intakes || []).map(item => `
      <article class="supplier-rule-strip"><div><small>${safeText(item.id)}</small><b>${safeText(item.product_code)} · ${Number(item.quantity).toLocaleString('zh-CN')} ${safeText(item.unit)}</b></div><p>${safeText(item.region)} · ${safeText(resourceStatuses[item.status] || item.status)}${item.verification_summary ? ` · ${safeText(item.verification_summary)}` : ''}</p></article>`).join('')
      : '<span>▦</span><h3>暂无可上架的已验真批次</h3><p>先完成企业认证，再提交资源存入与远程验真。</p><button class="secondary" type="button" data-supplier-assessment>进入供应商评估</button>';

    const deliveryTarget = $('#supplierDeliveryList');
    const actionable = (supplierData.orders || []).filter(item => ['paid', 'supplier_confirmed', 'delivered'].includes(item.status));
    const orderStatuses = { paid: '已付款 · 待供应商确认', supplier_confirmed: '已确认 · 待交付', delivered: '已交付 · 待双源计量及验收' };
    deliveryTarget.innerHTML = actionable.length ? actionable.map(item => {
      const actions = item.status === 'paid'
        ? `<button class="secondary" type="button" data-supplier-order="confirm" data-id="${safeText(item.id)}">确认可交付</button>`
        : item.status === 'supplier_confirmed'
          ? `<button class="primary" type="button" data-supplier-order="deliver" data-id="${safeText(item.id)}">登记交付</button>`
          : `<button class="primary" type="button" data-supplier-order="meter" data-id="${safeText(item.id)}" data-start="${safeText(item.delivered_at || item.updated_at)}" data-quantity="${item.quantity}">上报供应商计量</button>`;
      return `<article class="supplier-rule-strip"><div><small>${safeText(item.order_no)}</small><b>${safeText(item.gpu)} · ${Number(item.quantity).toLocaleString('zh-CN')} ${safeText(item.unit)}</b></div><p>${safeText(orderStatuses[item.status] || item.status)} · ${safeText(item.region)} ${actions}</p></article>`;
    }).join('') : '<span>→</span><h3>暂无待交付订单</h3><p>成交后会显示容量锁定、交付、计量、验收和结算进度。</p>';
    deliveryTarget.querySelectorAll('[data-supplier-order]').forEach(button => button.addEventListener('click', handleSupplierOrder));
    renderDrafts();
  }

  async function handleSupplierOrder(event) {
    const button = event.currentTarget;
    const action = button.dataset.supplierOrder;
    const orderId = button.dataset.id;
    button.disabled = true;
    try {
      if (action === 'confirm') await supplierApi(`/api/supplier/orders/${encodeURIComponent(orderId)}/confirm`, { method: 'POST', body: {} });
      if (action === 'deliver') {
        const endpoint = window.prompt('请填写交付端点摘要（不要填写密码、私钥或完整凭据）', 'GPU 集群服务端点已通过一次性领取链接下发');
        if (!endpoint) return;
        const evidence = `delivery-evidence-${orderId}-${Date.now()}`;
        await supplierApi(`/api/supplier/orders/${encodeURIComponent(orderId)}/deliver`, { method: 'POST', body: { endpoint_summary: endpoint, evidence_digest: evidence, acceptance_hours: 48 } });
      }
      if (action === 'meter') {
        const evidence = `supplier-meter-${orderId}-${Date.now()}`;
        await supplierApi('/api/metering', { method: 'POST', body: { order_id: orderId, source: 'supplier', started_at: button.dataset.start, ended_at: new Date().toISOString(), quantity: Number(button.dataset.quantity), performance: { source: 'supplier_manual_connector', memory_errors: 0 }, evidence_digest: evidence, signature: `supplier-signed-${evidence}` } });
      }
      if (typeof toast === 'function') toast(action === 'meter' ? '供应商计量已上报，等待 KAI 探针比对' : '订单交付状态已更新');
      await syncSupplierAccount();
    } catch (error) {
      if (typeof toast === 'function') toast(error.message);
    } finally { button.disabled = false; }
  }

  async function submitCertification(event) {
    event.preventDefault();
    const status = $('#supplierCertificationFormStatus');
    const submit = $('#submitSupplierCertification');
    const enterpriseName = $('#certEnterpriseName').value.trim();
    const creditCode = $('#certCreditCode').value.trim().toUpperCase();
    const legalRepresentative = $('#certLegalRepresentative').value.trim();
    const agentName = $('#certAgentName').value.trim();
    const contactPhone = $('#certContactPhone').value.trim();
    const file = $('#certLicenseFile').files[0];
    status.textContent = '';
    if (!enterpriseName || !legalRepresentative || !agentName || !contactPhone) {
      status.textContent = '请完整填写企业、法定代表人、经办人和联系电话。';
      return;
    }
    if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode)) {
      status.textContent = '统一社会信用代码应为 18 位数字或大写字母。';
      $('#certCreditCode').focus();
      return;
    }
    if (!file) {
      status.textContent = '请上传三证合一营业执照。';
      $('#certLicenseFile').focus();
      return;
    }
    const supportedFile = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!supportedFile || file.size > 5 * 1024 * 1024) {
      status.textContent = '营业执照仅支持 PDF、JPG、PNG，且不能超过 5MB。';
      return;
    }
    if (!$('#certDeclaration').checked) {
      status.textContent = '请确认材料真实有效并同意平台核验。';
      return;
    }
    submit.disabled = true;
    submit.textContent = '正在安全上传…';
    try {
      const licenseContent = await readFileAsDataUrl(file);
      const result = await supplierApi('/api/suppliers/applications', { method: 'POST', body: {
        enterprise_name: enterpriseName, credit_code: creditCode,
        legal_representative: legalRepresentative, agent_name: agentName, contact_phone: contactPhone,
        declaration_accepted: true, license_file_name: file.name, license_content_base64: licenseContent
      }});
      status.textContent = `申请 ${result.application.id} 已提交，平台将查验营业执照、企业主体和经办人。`;
      if (typeof toast === 'function') toast('企业认证材料已提交，等待平台审核');
      await syncSupplierAccount();
      $('#supplierCertificationForm').hidden = false;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = '提交平台认证';
    }
  }

  async function syncSupplierAccount() {
    const state = $('#workbenchSupplierState');
    const hint = $('#workbenchSupplierHint');
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!payload.authenticated) {
        supplierIdentity = null;
        supplierCertified = false;
        supplierData = { applications: [], intakes: [], listings: [], orders: [], settlements: [] };
        state.textContent = '未登录';
        hint.textContent = '登录企业账户后可读取认证状态和容量账本。';
        $('.supplier-gate').dataset.state = 'pending';
        renderCertificationEntry();
        return;
      }
      if (supplierIdentity?.id !== payload.user.id) supplierData = { applications: [], intakes: [], listings: [], orders: [], settlements: [] };
      supplierIdentity = payload.user;
      supplierCsrf = payload.csrf_token || '';
      if (!$('#certContactPhone').value && /^1\d{10}$/.test(payload.user.account || '')) $('#certContactPhone').value = payload.user.account;
      const statusLabels = { unverified: '待供应商认证', verified: '企业账户已核验 · 待供应商认证', reviewing: '供应商认证审核中', certified: '供应商已认证', restricted: '供应商权限受限', paused: '供应商权限已暂停', exited: '已退出' };
      supplierCertified = payload.user.enterprise_status === 'certified' && payload.user.role === 'supplier';
      state.textContent = statusLabels[payload.user.enterprise_status] || payload.user.enterprise_status;
      hint.textContent = supplierCertified ? '已开放返佣材料、资源存入、上架和交付权限。' : '完成供应商认证后，才可提交返佣材料、资源验真和上架审核。';
      $('.supplier-gate').dataset.state = supplierCertified ? 'certified' : 'pending';
      renderCertificationEntry(payload.user.enterprise_status);
      if (payload.user.role === 'supplier' || payload.user.role === 'supplier_pending') {
        supplierData = await supplierApi('/api/supplier/workbench');
        renderSupplierData();
        renderCertificationEntry(payload.user.enterprise_status);
      } else {
        supplierData = { applications: [], intakes: [], listings: [], orders: [], settlements: [] };
        renderCertificationEntry(payload.user.enterprise_status);
      }
    } catch (_) {
      state.textContent = '服务端状态暂不可用';
      hint.textContent = '仍可保存上架草稿，恢复连接后再绑定容量批次。';
    }
  }

  $$('[data-supplier-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.supplierTab)));
  $$('[data-supplier-open-kind]').forEach(button => button.addEventListener('click', () => openKind(button.dataset.supplierOpenKind)));
  $$('[data-supplier-assessment]').forEach(button => button.addEventListener('click', openAssessment));
  $$('[data-supplier-certification]').forEach(button => button.addEventListener('click', openCertification));
  $('#supplierCertificationAction').addEventListener('click', openCertification);
  $('#supplierRebateMaterialsAction').addEventListener('click', openRebateMaterials);
  $('#supplierCertificationForm').addEventListener('submit', submitCertification);
  $('#certLicenseFile').addEventListener('change', event => {
    const file = event.target.files[0];
    $('#certLicenseFileState').textContent = file
      ? `${file.name} · ${(file.size / 1024).toFixed(file.size >= 102400 ? 0 : 1)} KB`
      : '上传 PDF、JPG 或 PNG，文件不超过 5MB';
  });
  $$('[data-listing-kind]').forEach(button => button.addEventListener('click', () => setKind(button.dataset.listingKind)));
  $('#supplierTokenPriceType').addEventListener('change', () => { updateTokenUnit(); updatePreview(); });
  $('#supplierRegion').addEventListener('change', () => { updatePreview(); refreshReferencePrice(); });
  $('#supplierListingForm').addEventListener('input', updatePreview);
  $('#supplierListingForm').addEventListener('change', updatePreview);
  $('#saveSupplierDraft').addEventListener('click', () => saveDraft('草稿'));
  $('#supplierListingForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!supplierCertified) {
      saveDraft('待认证与验真');
      if (typeof openAuth === 'function' && !document.querySelector('.account-menu.show')) {
        $('#supplierFormStatus').textContent += ' 当前账户尚未取得企业供应商上架权限。';
      }
      return;
    }
    if (!$('#supplierBatch').value) {
      saveDraft('待绑定验真批次');
      return;
    }
    const submit = $('#submitSupplierListing');
    submit.disabled = true;
    $('#supplierFormStatus').textContent = '正在提交服务端挂牌审核…';
    try {
      const priceSource = marketReference ? { type: 'platform_reference', observed_price_cny: marketReference, observed_at: new Date().toISOString() } : { type: 'supplier_quote' };
      const identity = listingIdentity();
      const kind = ledgerKind();
      const quantity = activeKind === 'gpu' ? Number($('#supplierGpuQty').value)
        : activeKind === 'token' ? Number($('#supplierTokenQty').value) : Number($('#supplierRackQty').value);
      const minimum = activeKind === 'gpu' ? Number($('#supplierGpuMin').value) : (activeKind === 'rack' ? 1 : 0.01);
      const assetCode = activeKind === 'gpu' ? $('#supplierGpu').value.split(' ')[0]
        : activeKind === 'token' ? $('#supplierTokenModel').value : $('#supplierRack').value;
      const productCode = activeKind === 'token'
        ? `${identity.title} · ${$('#supplierTokenContext').value} · ${$('#supplierTokenPriceType').selectedOptions[0].textContent}`
        : identity.title;
      const result = await supplierApi('/api/supplier/listings', { method: 'POST', body: {
        intake_id: $('#supplierBatch').value, kind, product_code: productCode, asset_code: assetCode,
        gpu: assetCode, region: regionNames[$('#supplierRegion').value] || $('#supplierRegion').value,
        sla: $('#supplierSla').value, trade_mode: $('#supplierTradeMode').value,
        quantity, minimum_quantity: minimum,
        target_price_cny: Number($('#supplierTargetPrice').value), floor_price_cny: $('#supplierFloorPrice').value || null,
        valid_from: $('#supplierValidFrom').value, valid_until: $('#supplierValidUntil').value, price_source: priceSource
      }});
      saveDraft(`已提交 · ${result.listing.id}`);
      $('#supplierFormStatus').textContent = `挂牌 ${result.listing.id} 已进入平台审核队列；审核通过前不会出现在采购市场。`;
      await syncSupplierAccount();
      switchTab('listings');
    } catch (error) {
      $('#supplierFormStatus').textContent = error.message;
      if (typeof toast === 'function') toast(error.message);
    } finally { submit.disabled = false; }
  });

  setDefaultDates();
  setKind('gpu');
  renderDrafts();
  navButton.addEventListener('click', syncSupplierAccount);
  window.addEventListener('kai:auth-changed', syncSupplierAccount);
  syncSupplierAccount();
})();
