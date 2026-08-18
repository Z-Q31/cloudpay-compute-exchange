(() => {
  'use strict';

  const nav = document.querySelector('.nav');
  const main = document.querySelector('main');
  if (!nav || !main) return;

  const gpuBenchmarks = {
    GB200: ['NVIDIA GB200 NVL', 38.60], B200: ['NVIDIA B200', 32.80],
    H200: ['NVIDIA H200 141GB', 18.80], H100: ['NVIDIA H100 80GB', 14.90],
    H800: ['NVIDIA H800 80GB', 12.60], A100: ['NVIDIA A100 80GB', 9.82],
    A800: ['NVIDIA A800 80GB', 8.90], L40S: ['NVIDIA L40S 48GB', 6.20],
    L20: ['NVIDIA L20 48GB', 4.20], RTX5090: ['NVIDIA RTX 5090', 4.50],
    RTX4090: ['NVIDIA RTX 4090', 3.10], MI325X: ['AMD MI325X', 15.60],
    MI300X: ['AMD MI300X', 11.70], '910C': ['华为昇腾 910C', 12.40],
    '910B': ['华为昇腾 910B', 8.70], MLU590: ['寒武纪 MLU590', 6.80],
    BR104: ['壁仞 BR104', 7.50]
  };
  const rackBenchmarks = {
    rack10: ['10kW 基础风冷机柜', 13920], rack20: ['20kW 标准风冷机柜', 28000],
    rack30: ['30kW 混合制冷 AI 机柜', 44290], rack40: ['40kW 液冷 AI 机柜', 65100],
    rack60: ['60kW 液冷超算机柜', 103550], rack80: ['80kW 高密液冷机柜', 154560],
    rack120: ['120kW 超节点液冷柜', 252880]
  };
  const regionBenchmarks = {
    beijing: ['北京', 1.18], shanghai: ['上海', 1.16], shenzhen: ['深圳', 1.14],
    chengdu: ['成都', .92], guizhou: ['贵州', .82], neimeng: ['内蒙古', .78],
    ningxia: ['宁夏', .80], hongkong: ['中国香港', 1.32], singapore: ['新加坡', 1.48]
  };

  const assessmentNav = document.createElement('button');
  assessmentNav.className = 'nav-item';
  assessmentNav.type = 'button';
  assessmentNav.dataset.view = 'assessment';
  assessmentNav.innerHTML = '<span>◎</span>供应商评估';
  nav.append(assessmentNav);

  const gpuOptions = Object.entries(gpuBenchmarks).map(([key, value]) => `<option value="${key}">${value[0]} · ¥${value[1].toFixed(2)}/GPU 时</option>`).join('');
  const rackOptions = Object.entries(rackBenchmarks).map(([key, value]) => `<option value="${key}">${value[0]} · ¥${value[1].toLocaleString('zh-CN')}/柜月</option>`).join('');
  const regionOptionsHtml = Object.entries(regionBenchmarks).map(([key, value]) => `<option value="${key}">${value[0]} · ×${value[1].toFixed(2)}</option>`).join('');
  const tokenOptions = [...document.querySelectorAll('#modelSelect option')].map(option => `<option value="${option.value}">${option.textContent}</option>`).join('');

  const assessmentView = document.createElement('section');
  assessmentView.className = 'view';
  assessmentView.id = 'assessmentView';
  assessmentView.innerHTML = `
    <div class="page-title">
      <div><span class="eyebrow">SUPPLIER ASSESSMENT</span><h1>供应商算力评估</h1><p>供应商携带 GPU、Token 容量时、百万 Token 实际用量或柜月入驻时，按独立产品口径换算为可核验人民币价值。</p></div>
      <span class="model-count">人民币 <b>统一锚定</b></span>
    </div>
    <section class="enterprise-gate" aria-labelledby="enterpriseGateTitle">
      <div class="enterprise-head"><div><span class="eyebrow">ENTERPRISE ONBOARDING</span><h2 id="enterpriseGateTitle">企业供应商准入认证</h2><p>首阶段仅开放企业供应商。平台先完成主体与授权核验，再开放资源存入、报价和取出权限。</p></div><span class="enterprise-only">ONLY ENTERPRISE · 企业限定</span></div>
      <div class="enterprise-layout">
        <div>
          <div class="enterprise-form-grid">
            <label>企业全称<input id="enterpriseName" autocomplete="organization" placeholder="营业执照登记名称"></label>
            <label>统一社会信用代码<input id="enterpriseCode" autocomplete="off" placeholder="18位统一社会信用代码"></label>
            <label>授权经办人<input id="enterpriseAgent" autocomplete="name" placeholder="姓名，仅用于企业认证"></label>
            <label>授权文件<select id="enterpriseAuthorization"><option value="pending">待提交或待核验</option><option value="verified">授权关系已核验</option><option value="missing">材料缺失</option></select></label>
            <label>对公结算账户<select id="enterpriseBank"><option value="pending">待核验</option><option value="verified">账户名称与企业一致</option><option value="changed">账户发生变化，立即复核</option></select></label>
            <label>开票资料<select id="enterpriseInvoice"><option value="pending">待核验</option><option value="verified">开票资料已核验</option><option value="missing">资料缺失</option></select></label>
            <label>相关许可<select id="enterpriseLicense"><option value="pending">按适用规则待核验</option><option value="verified">适用许可已核验</option><option value="changed">许可发生变化，立即复核</option></select></label>
            <label>资源归属证明<select id="enterpriseOwnership"><option value="pending">待核验</option><option value="verified">权属、托管或云账号证明已核验</option><option value="changed">资源证明发生变化，立即复核</option></select></label>
          </div>
          <div class="enterprise-actions"><button class="primary" id="submitEnterprise" type="button">提交企业认证</button><span class="enterprise-error" id="enterpriseError" role="status"></span></div>
        </div>
        <aside class="enterprise-status-card">
          <div class="enterprise-status-top"><small>当前供应商状态</small><strong id="supplierStatusText">待提交</strong></div>
          <div class="supplier-status-flow" aria-label="供应商状态流程"><span data-supplier-state="pending">待提交</span><span data-supplier-state="reviewing">审核中</span><span data-supplier-state="certified">已认证</span><span data-supplier-state="restricted">受限</span><span data-supplier-state="paused">已暂停</span><span data-supplier-state="exited">已退出</span></div>
          <div class="review-grid"><div><small>最近复核</small><b id="lastReviewDate">—</b></div><div><small>下次最迟复核</small><b id="nextReviewDate">认证后计算</b></div></div>
          <p class="review-trigger" id="reviewTrigger">认证信息至少每六个月复核；资源证明、许可或结算账户变化时即时复核。</p>
          <label class="status-demo">演示状态（正式版由审核后台控制）<select id="supplierStatusControl"><option value="pending">待提交</option><option value="reviewing">审核中</option><option value="certified">已认证</option><option value="restricted">受限</option><option value="paused">已暂停</option><option value="exited">已退出</option></select></label>
        </aside>
      </div>
      <section class="access-mode-section">
        <span class="eyebrow">CONNECTION MODES</span><h3>三种资源接入模式</h3>
        <div class="access-mode-grid" role="group" aria-label="接入模式">
          <button class="access-mode-card active" type="button" data-access-mode="manual"><b>人工材料 + 远程测试</b><span>首笔交易、小供应商</span><dl><dt>能力</dt><dd>人工核对资源证明并运行测试任务</dd><dt>限制</dt><dd class="limit">库存由运营确认，不能声称实时</dd></dl></button>
          <button class="access-mode-card" type="button" data-access-mode="connector"><b>KAI 轻量连接器</b><span>自有 GPU、服务器、NAS</span><dl><dt>能力</dt><dd>上报规格、可用状态、任务和签名心跳</dd><dt>限制</dt><dd class="limit">支持持续验真、自动锁定与释放</dd></dl></button>
          <button class="access-mode-card" type="button" data-access-mode="cloud"><b>云厂商只读 API / 子账号</b><span>云资源和模型配额</span><dl><dt>能力</dt><dd>读取规格、配额、账单和运行状态</dd><dt>限制</dt><dd class="limit">权限最小化，不接收主账号密码</dd></dl></button>
        </div>
      </section>
      <section class="connector-trust-panel" id="connectorTrustPanel">
        <div class="connector-trust-head"><div><span class="eyebrow">ZERO-TRUST CONNECTOR</span><h3>连接器默认不可信</h3><p>每次上报都必须重新验证身份、短期凭证、签名、防重放与最小权限；不能因为曾经接入就持续信任。</p></div><b id="connectorTrustState" data-state="pending">等待签名上报</b></div>
        <div class="connector-check-grid">
          <label>设备身份<select data-connector-check><option value="pending">待验证</option><option value="passed">身份匹配</option><option value="failed">身份异常</option></select></label>
          <label>短期证书<select data-connector-check><option value="pending">待验证</option><option value="passed">证书有效</option><option value="failed">证书过期</option></select></label>
          <label>上报签名<select data-connector-check><option value="pending">待验签</option><option value="passed">签名有效</option><option value="failed">签名无效</option></select></label>
          <label>防重放时间窗<select data-connector-check><option value="pending">待检查</option><option value="passed">时间窗有效</option><option value="failed">疑似重放</option></select></label>
          <label>最小权限<select data-connector-check><option value="pending">待检查</option><option value="passed">权限最小化</option><option value="failed">权限过大</option></select></label>
          <label>格式 / 时间 / 权属<select data-connector-check><option value="pending">待检查</option><option value="passed">全部一致</option><option value="failed">数据异常</option></select></label>
          <label>异常漂移<select data-connector-check><option value="pending">待检查</option><option value="passed">无异常漂移</option><option value="failed">发现异常漂移</option></select></label>
        </div>
        <div class="connector-trust-actions"><p id="connectorTrustMessage">连接器失联不会删除资源或历史证据，但会停止新订单，并触发复验或人工处置。</p><button class="primary" id="verifyConnectorReport" type="button">演示有效签名上报</button><button class="secondary" id="simulateConnectorOffline" type="button">模拟失联</button></div>
      </section>
      <div class="visibility-boundary">
        <article><b>采购方可见</b><p>供应商等级、脱敏区域、产品规格、可售时间、SLA 和平台标准化价格。</p></article>
        <article><b>受保护字段</b><p>设备 UUID 原值、机房详细地址、资源证明、供应商底价、内部风控备注和原始报价不向其他供应商或无关采购方公开。</p></article>
      </div>
    </section>
    <div class="assessment-layout">
      <form class="assessment-form" id="assessmentForm" novalidate>
        <span class="eyebrow">ASSET INTAKE</span><h2>录入待评估资产</h2>
        <div class="assess-grid">
          <label>供应商名称<input id="assessSupplier" autocomplete="organization" placeholder="企业或资源池名称"></label>
          <label>主体类型<select id="assessSupplierType"><option value="cloud">认证云厂商</option><option value="datacenter">数据中心 / IDC</option><option value="enterprise">企业自有资源</option><option value="broker">资源运营商</option></select></label>
        </div>
        <div class="assess-kind" role="group" aria-label="资产类型">
          <button type="button" class="active" data-assess-kind="gpu">GPU<span>按 GPU 时评估</span></button>
          <button type="button" data-assess-kind="tokencap">Token 容量时<span>评估时段内吞吐 / 限额保障</span></button>
          <button type="button" data-assess-kind="tokenusage">百万 Token 用量<span>评估已经实际调用的用量</span></button>
          <button type="button" data-assess-kind="rack">柜月<span>按机柜月评估</span></button>
        </div>
        <div class="token-product-boundary" id="assessmentTokenBoundary" hidden>
          <article><b>Token 容量时</b><span>购买指定时间段内被保证的模型吞吐或限额，按容量时验收。</span></article>
          <article><b>百万 Token 实际用量</b><span>购买已经实际调用的输入、缓存、输出或组合用量，按调用量结算。</span></article>
          <p>两类产品仅能在同一具体模型、同一服务档位下建立换算，不进入同一条价格。</p>
        </div>
        <div class="assess-grid">
          <label class="assess-field" data-kind-field="gpu">GPU 型号<select id="assessGpu">${gpuOptions}</select></label>
          <label class="assess-field" data-kind-field="gpu">可交付卡数<input id="assessGpuCount" type="number" min="1" step="1" value="64"></label>
          <label class="assess-field" data-kind-field="gpu">每卡可用时长<input id="assessGpuHours" type="number" min="1" step="1" value="720"></label>
          <label class="assess-field" data-kind-field="token" hidden>具体模型<select id="assessToken">${tokenOptions}</select></label>
          <label class="assess-field" data-kind-field="token" hidden>服务商<select id="assessTokenProvider"><option value="kai">KAI 模型网关</option><option value="aliyun">阿里云百炼</option><option value="tencent">腾讯云</option><option value="huawei">华为云</option><option value="volc">火山方舟</option></select></label>
          <label class="assess-field" data-kind-field="token" hidden>服务档位<select id="assessTokenTier"><option value="standard">标准服务档位</option><option value="premium">高保障服务档位</option><option value="dedicated">专属服务档位</option></select></label>
          <label class="assess-field" data-kind-field="token" hidden>上下文档位<select id="assessTokenContext"><option value="ctx8">8K 上下文</option><option value="ctx32" selected>32K 上下文</option><option value="ctx128">128K 上下文</option><option value="ctx1m">1M 上下文</option></select></label>
          <label class="assess-field" data-kind-field="token" hidden>价格类型<select id="assessTokenPriceType"></select></label>
          <label class="assess-field" data-kind-field="token" hidden><span id="assessTokenQtyLabel">数量</span><input id="assessTokenQty" type="number" min="0.01" step="0.01" value="100"><small id="assessTokenQtyUnit">单位：百万 Token 实际用量</small></label>
          <label class="assess-field" data-kind-field="token" hidden>报价有效期<input id="assessTokenValidity" type="date"></label>
          <label class="assess-field" data-kind-field="rack" hidden>柜月类型<select id="assessRack">${rackOptions}</select></label>
          <label class="assess-field" data-kind-field="rack" hidden>机柜数量<input id="assessRackQty" type="number" min="1" step="1" value="8"></label>
          <label class="assess-field" data-kind-field="rack" hidden>可交付月数<input id="assessRackMonths" type="number" min="1" step="1" value="12"></label>
          <label class="assess-region-field">资源地区<select id="assessRegion">${regionOptionsHtml}</select></label>
          <label class="assess-time-field">可交付开始时间<input id="assessStart" type="datetime-local"></label>
          <label>资产质量<select id="assessQuality"><option value="1.03">A级 · 新设备 / 完整权属 / 优秀能效</option><option value="1" selected>B级 · 状态正常 / 权属清晰</option><option value=".94">C级 · 使用年限较长 / 有限授权</option><option value=".86">D级 · 待整改或材料不足</option></select></label>
          <label>性能与交付<select id="assessPerformance"><option value="1.04">集群互联 / 专线 / 30分钟交付</option><option value="1" selected>标准网络 / T+1 交付</option><option value=".93">公网接入 / 人工交付</option></select></label>
          <label>权属与核验<select id="assessVerification"><option value=".92">供应商自报 · 待核验</option><option value=".98" selected>材料已审 · 待实测</option><option value="1.02">材料与现场均已核验</option></select></label>
        </div>
        <section class="standard-price-editor">
          <div class="standard-price-editor-head"><div><span class="eyebrow">STANDARD UNIT COST</span><h3>标准化有效单价</h3></div><p>以下均按当前批次总额录入，系统除以可交付标准单位，避免最低消费和必选服务造成低价错觉。</p></div>
          <div class="standard-cost-grid">
            <label>资源价 ¥<input id="costResource" type="number" min="0" step="0.01" value="0"></label>
            <label>税费调整 ¥<input id="costTax" type="number" min="0" step="0.01" value="0"></label>
            <label>电费 ¥<input id="costPower" type="number" min="0" step="0.01" value="0"></label>
            <label>网络与流量 ¥<input id="costNetwork" type="number" min="0" step="0.01" value="0"></label>
            <label>必选存储 ¥<input id="costStorage" type="number" min="0" step="0.01" value="0"></label>
            <label>开通及最低消费摊销 ¥<input id="costActivation" type="number" min="0" step="0.01" value="0"></label>
            <label>可量化 SLA 风险 ¥<input id="costSla" type="number" min="0" step="0.01" value="0"></label>
            <label>可交付标准单位<input id="costUnits" type="number" min="0.01" step="0.01" value="1"></label>
          </div>
          <div class="standard-price-output"><div><small>标准化总成本</small><b id="standardTotalCost">¥ 0</b></div><div><small>标准化有效单价</small><b id="standardEffectiveUnit">¥ 0 / GPU 时</b></div></div>
          <div class="supplier-ask-grid"><label class="supplier-private">供应商底价（私密）<input id="supplierFloor" type="number" min="0" step="0.01" placeholder="仅撮合与风控可见"></label><label>供应商目标价<input id="supplierTarget" type="number" min="0" step="0.01" placeholder="每标准单位"></label><label>要价有效期<input id="supplierAskExpiry" type="datetime-local"></label></div>
        </section>
        <div class="assessment-disclosure"><b>评估口径</b><span>系统初评不等于最终入驻额度。正式结果需要资产权属、发票或合同、序列号、性能测试、可用时段和交付能力共同验证。</span></div>
        <button class="primary wide" type="submit">生成入驻评估 <span>→</span></button>
      </form>
      <aside class="assessment-result" aria-live="polite">
        <div class="result-top"><span>系统初评结果</span><small id="assessmentId">ASSESS · KAI-0000</small></div>
        <div class="assessment-scoreline"><span>资产可信评分</span><b id="assessmentScore">—</b></div>
        <div class="assessment-scorebar"><i id="assessmentScoreBar"></i></div>
        <div class="assessment-value"><small>验收后可兑人民币</small><strong>¥ <span id="assessmentAccepted">0</span></strong><span id="assessmentUnit">¥0 / GPU 时</span></div>
        <div class="assessment-range"><div><small>资产公允值</small><b id="assessmentFair">¥ 0</b></div><div><small>建议评估区间</small><b id="assessmentRange">¥ 0 – 0</b></div></div>
        <div class="assessment-factors" id="assessmentFactors"></div>
        <button class="primary wide" id="submitAssessment" type="button">提交入驻审核</button>
        <p class="assessment-result-note">当前为参考估值，不形成收购、兑付或保底承诺。</p>
      </aside>
    </div>
    <section class="gpu-deposit-gate" id="gpuDepositGate" aria-labelledby="gpuGateTitle">
      <div class="gpu-gate-head"><div><span class="eyebrow">GPU DEPOSIT VERIFICATION</span><h2 id="gpuGateTitle">GPU 存入六项验真门</h2><p>六项全部通过后才能生成存入批次并计入已验真容量。</p></div><div class="gpu-gate-progress"><b id="gpuGateCount">0 / 6</b><small id="gpuGateStatus">等待验真</small></div></div>
      <div class="gpu-check-grid">
        <label class="gpu-check"><b>资源归属、托管或云账号证明</b><select data-gpu-check><option value="pending">待检查</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>
        <label class="gpu-check"><b>型号、UUID 摘要、显存、驱动与拓扑采集</b><select data-gpu-check><option value="pending">待采集</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>
        <label class="gpu-check"><b>标准基准任务与显存错误检查</b><select data-gpu-check><option value="pending">待测试</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>
        <label class="gpu-check"><b>网络、存储、温度等交付条件</b><select data-gpu-check><option value="pending">待检查</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>
        <label class="gpu-check"><b>连续签名心跳观察</b><select data-gpu-check><option value="pending">观察中</option><option value="passed">通过</option><option value="failed">中断</option></select></label>
        <label class="gpu-check"><b>重复存入、跨平台承诺与异常占用</b><select data-gpu-check><option value="pending">待排查</option><option value="passed">未发现异常</option><option value="failed">发现异常</option></select></label>
      </div>
      <div class="gpu-gate-foot"><p>UUID 仅采集不可逆摘要用于去重，原值不进入公开页面。</p><button class="capacity-sync" id="runGpuVerification" type="button">演示执行全部验真</button></div>
    </section>
    <section class="capacity-ledger" aria-labelledby="capacityTitle">
      <div>
        <div class="capacity-ledger-head"><div><span class="eyebrow">SELLABLE CAPACITY</span><h2 id="capacityTitle">供应商可售容量</h2><p>只允许已经验真并完成存入的容量进入报价和交易。</p></div><button class="capacity-sync" id="syncCapacity" type="button">同步评估数量</button></div>
        <div class="capacity-formula"><b>可售容量</b> = 已验真存入 − 报价预留 − 订单锁定 − 交付中 − 已消耗 − 风控冻结</div>
        <div class="capacity-inputs">
          <label>已验真存入<div class="capacity-input-wrap"><input id="capacityVerified" type="number" min="0" step="0.01" value="0" readonly><span class="capacity-unit">GPU 时</span></div></label>
          <label>报价预留<div class="capacity-input-wrap"><input id="capacityQuoted" type="number" min="0" step="0.01" value="0"><span class="capacity-unit">GPU 时</span></div></label>
          <label>订单锁定<div class="capacity-input-wrap"><input id="capacityLocked" type="number" min="0" step="0.01" value="0"><span class="capacity-unit">GPU 时</span></div></label>
          <label>交付中<div class="capacity-input-wrap"><input id="capacityDelivering" type="number" min="0" step="0.01" value="0"><span class="capacity-unit">GPU 时</span></div></label>
          <label>已消耗<div class="capacity-input-wrap"><input id="capacityConsumed" type="number" min="0" step="0.01" value="0"><span class="capacity-unit">GPU 时</span></div></label>
          <label>风控冻结<div class="capacity-input-wrap"><input id="capacityFrozen" type="number" min="0" step="0.01" value="0"><span class="capacity-unit">GPU 时</span></div></label>
        </div>
      </div>
      <aside class="capacity-result" aria-live="polite">
        <small>当前可售容量</small>
        <strong id="sellableCapacity">46,080 <span id="sellableUnit">GPU 时</span></strong>
        <div class="capacity-result-state"><span>可售率</span><b id="sellableRatio">100.0%</b></div>
        <div class="capacity-meter"><i id="sellableMeter"></i></div>
        <p class="capacity-warning" id="capacityWarning" role="status"></p>
        <div class="capacity-value"><span>对应可兑人民币</span><b id="sellableRmb">¥ 0</b></div>
      </aside>
    </section>
    <section class="withdrawal-panel" aria-labelledby="withdrawalTitle">
      <div>
        <header><span class="eyebrow">CAPACITY WITHDRAWAL</span><h2 id="withdrawalTitle">供应商容量取出</h2><p>取出申请先经过权限、余额、任务、数据、合同与风控检查，再确定执行方式。</p></header>
        <div class="withdrawal-grid">
          <label>申请取出数量<div class="withdrawal-quantity"><input id="withdrawQty" type="number" min="0.01" step="0.01" value="720"><span id="withdrawUnit">GPU 时</span></div></label>
          <label>批次操作权限<select id="withdrawPermission"><option value="yes">申请人具有操作权</option><option value="no">无权限或待授权</option></select></label>
          <label>退款或争议<select id="withdrawDispute"><option value="clear">不存在退款或争议</option><option value="pending">存在待处理事项</option></select></label>
          <label>GPU / 模型任务<select id="withdrawTasks"><option value="clear">任务已经排空</option><option value="pending">仍有任务运行</option></select></label>
          <label>NAS 数据状态<select id="withdrawNas"><option value="clear">迁移与删除已经确认</option><option value="pending">尚未完成确认</option></select></label>
          <label>通知期与合同<select id="withdrawNotice"><option value="clear">已满足通知期和合同</option><option value="pending">需要等待约定日期</option></select></label>
          <label>风控或司法冻结<select id="withdrawRisk"><option value="clear">不存在额外冻结</option><option value="frozen">存在冻结或司法限制</option></select></label>
        </div>
        <p class="withdrawal-history">取出只调整未来可售余额；历史容量批次、报价、订单、计量和结算记录永久保留，不随取出删除。</p>
      </div>
      <aside class="withdrawal-result" aria-live="polite">
        <small>系统建议结果</small>
        <div class="withdrawal-outcome" id="withdrawOutcome" data-state="immediate"><i></i><strong>立即取出</strong></div>
        <div class="withdrawal-checks">
          <div><span>本次可执行数量</span><b id="withdrawApproved">720 GPU 时</b></div>
          <div><span>当前可售余额</span><b id="withdrawAvailable">46,080 GPU 时</b></div>
          <div><span>执行后未来可售</span><b id="withdrawFuture">45,360 GPU 时</b></div>
        </div>
        <p class="withdrawal-blockers" id="withdrawBlockers">所有检查通过，可立即进入取出交割。</p>
        <button class="primary wide" id="submitWithdrawal" type="button">提交取出申请</button>
      </aside>
    </section>
    <section class="assessment-process">
      <span class="eyebrow">ONBOARDING GATES</span><h2>供应商入驻验收流程</h2>
      <div class="assessment-steps"><article class="done"><b>系统初评</b><small>统一人民币基准、地区、时段与流动性折扣。</small></article><article><b>材料核验</b><small>主体资质、权属合同、发票、序列号和可用额度。</small></article><article><b>性能实测</b><small>GPU 基准测试、TOKEN 调用验证或机柜能效与网络测试。</small></article><article><b>额度入驻</b><small>签署交割规则后生成可置换人民币额度。</small></article></div>
    </section>`;
  main.append(assessmentView);

  let assessKind = 'gpu';
  let capacityLinked = true;
  let supplierStatus = 'pending';
  let accessMode = 'manual';
  let transactionMode = 'fixed';
  let latestSwapPricing = null;
  let bilateralStage = 'verify';
  let tradeSequenceTimer = null;
  let capacityLedgerVersion = 17;
  let connectorState = 'pending';
  let connectorFrozenAmount = 0;
  const processedEventKeys = new Set();
  const agentLedgerEntries = [];
  let roadmapSelectedPhase = 0;
  let roadmapUnlockedPhase = 0;
  const roadmapCompletedPhases = new Set();
  const roadmapGateState = Array.from({ length: 5 }, () => new Set());
  const roadmapPhases = [
    {
      phase: 0, title: '制度和底座', label: 'FOUNDATION',
      items: ['明确运营主体、销售主体、合同、支付和发票责任', '发布标准产品、计价、验真、存取、交易和争议规则', '建立企业身份、权限、审计和规则版本', '完成容量账本与订单预留设计'],
      exits: ['法务签署首笔交易方案', '财务签署首笔交易方案', '支付合作方签署首笔交易方案', '研发签署首笔交易方案'],
      evidence: '主体责任矩阵、合同与发票流程、规则版本、容量账本设计、四方签署记录'
    },
    {
      phase: 1, title: '首笔真实 GPU 交易', label: 'FIRST LIVE GPU TRADE',
      items: ['1 家企业供应商与 1 家企业采购方', '1 个 GPU 标准产品、1 个地区和固定可售时间窗', '按卡时计费，人工验真与人工交付', '系统完成容量预留、支付回调、计量记录、验收和结算'],
      exits: ['完成真实付款', '完成容量锁定', '完成资源交付', '完成采购方验收', '完成退款演练', '完成双方对账', '未发生容量超卖', '未发生账本差异'],
      evidence: '支付机构回调、Reservation 与 Lock 记录、交付包、验收单、退款演练和对账单'
    },
    {
      phase: 2, title: 'GPU 连接器与供应商工作台', label: 'CONNECTOR & SUPPLIER DESK',
      items: ['企业在线入驻与连接器配对', '资源心跳、设备身份和自动复验', '容量存入、部分取出和异常冻结', '批量上架、报价、多订单并发预留与自动停止超卖'],
      exits: ['多家供应商能够稳定签名上报', '资源断连能够停止新交易', '现有订单具备应急交付流程'],
      evidence: '多供应商稳定性记录、断连演练、冻结事件、并发预留压测和应急交付预案'
    },
    {
      phase: 3, title: '模型小时与 Token', label: 'MODEL HOURS & TOKEN',
      items: ['建立模型注册表与服务价格档位', '输入、缓存、输出 Token 分项计量', 'Token 容量时与百万 Token 实际用量分开定价', '模型实例小时、吞吐容量和网关双源计量', '发布固定模型篮子成本指数'],
      exits: ['同一模型的不同服务档位可清晰区分', 'Token 容量时与实际用量不混价', '模型篮子指数不替代分项成交价', '双源计量能够完成对账'],
      evidence: '模型注册表、价格档位、分项计量账单、双源差异记录、指数规则版本与对账结果'
    },
    {
      phase: 4, title: 'NAS、柜月与跨区域调度', label: 'NAS, RACK & REGIONAL SCHEDULING',
      items: ['NAS 性能档位、迁移与删除验收', '柜月、kW 月、电费、网络和长周期合同', '跨地区资源发现与调度', '企业 API、数据订阅和批量采购'],
      exits: ['长周期容量与短时资源共享同一账本规则', 'NAS、柜月和短时资源分别执行各自验真条件', '不同产品分别执行各自交付条件', '不同产品分别执行各自取出条件'],
      evidence: '统一账本映射、分产品验真记录、长周期合同、迁移删除证明和跨区域调度记录'
    }
  ];
  const $ = selector => document.querySelector(selector);
  const formatMoney = value => Math.round(value).toLocaleString('zh-CN');
  const supplierStatusLabels = { pending: '待提交', reviewing: '审核中', certified: '已认证', restricted: '受限', paused: '已暂停', exited: '已退出' };

  function gpuGatePassed() {
    const checks = [...document.querySelectorAll('[data-gpu-check]')];
    return checks.length === 6 && checks.every(check => check.value === 'passed');
  }

  function updateGpuGate() {
    const checks = [...document.querySelectorAll('[data-gpu-check]')];
    const passed = checks.filter(check => check.value === 'passed').length;
    const failed = checks.some(check => check.value === 'failed');
    $('#gpuGateCount').textContent = `${passed} / 6`;
    $('#gpuGateStatus').textContent = failed ? '存在不通过项' : passed === 6 ? '验真通过' : '等待验真';
    if (assessKind === 'gpu' && passed < 6) $('#capacityVerified').value = '0';
    return passed === 6;
  }

  function setSupplierStatus(status, reason = '') {
    supplierStatus = status;
    $('#supplierStatusText').textContent = supplierStatusLabels[status];
    $('#supplierStatusControl').value = status;
    document.querySelectorAll('[data-supplier-state]').forEach(item => item.classList.toggle('active', item.dataset.supplierState === status));
    if (status === 'certified') {
      const reviewed = new Date();
      const next = new Date(reviewed);
      next.setMonth(next.getMonth() + 6);
      $('#lastReviewDate').textContent = reviewed.toLocaleDateString('zh-CN');
      $('#nextReviewDate').textContent = next.toLocaleDateString('zh-CN');
    } else {
      $('#lastReviewDate').textContent = '—';
      $('#nextReviewDate').textContent = status === 'reviewing' ? '审核通过后计算' : '认证后计算';
    }
    $('#reviewTrigger').textContent = reason || '认证信息至少每六个月复核；资源证明、许可或结算账户变化时即时复核。';
    if (status !== 'certified') $('#capacityVerified').value = '0';
    calculateAssessment();
  }

  function setAccessMode(mode) {
    accessMode = mode;
    document.querySelectorAll('[data-access-mode]').forEach(card => card.classList.toggle('active', card.dataset.accessMode === mode));
    $('#syncCapacity').textContent = mode === 'manual' ? '运营确认并同步' : '同步评估数量';
    $('#connectorTrustPanel').classList.toggle('mode-active', mode === 'connector');
    calculateAssessment();
  }

  function setConnectorState(state, message) {
    connectorState = state;
    const status = $('#connectorTrustState');
    status.dataset.state = state;
    status.textContent = { pending: '等待签名上报', online: '验签通过 · 心跳正常', offline: '连接器失联 · 停止新订单', quarantined: '上报异常 · 人工复核' }[state];
    $('#connectorTrustMessage').textContent = message;
    if (['offline', 'quarantined'].includes(state) && connectorFrozenAmount === 0) {
      const verified = Math.max(0, Number($('#capacityVerified').value) || 0);
      const quoted = Math.max(0, Number($('#capacityQuoted').value) || 0);
      const locked = Math.max(0, Number($('#capacityLocked').value) || 0);
      const delivering = Math.max(0, Number($('#capacityDelivering').value) || 0);
      const consumed = Math.max(0, Number($('#capacityConsumed').value) || 0);
      const existingFrozen = Math.max(0, Number($('#capacityFrozen').value) || 0);
      connectorFrozenAmount = Math.max(0, verified - quoted - locked - delivering - consumed - existingFrozen);
      $('#capacityFrozen').value = Number((existingFrozen + connectorFrozenAmount).toFixed(3));
    }
    if (state === 'online' && connectorFrozenAmount > 0) {
      const frozen = Math.max(0, Number($('#capacityFrozen').value) || 0);
      $('#capacityFrozen').value = Number(Math.max(0, frozen - connectorFrozenAmount).toFixed(3));
      connectorFrozenAmount = 0;
    }
    calculateAssessment();
  }

  function calculateStandardPrice(data = assessmentInput()) {
    const ids = ['costResource', 'costTax', 'costPower', 'costNetwork', 'costStorage', 'costActivation', 'costSla'];
    const total = ids.reduce((sum, id) => sum + Math.max(0, Number($(`#${id}`).value) || 0), 0);
    const units = Math.max(.01, Number($('#costUnits').value) || .01);
    const effective = total / units;
    $('#standardTotalCost').textContent = `¥ ${formatMoney(total)}`;
    $('#standardEffectiveUnit').textContent = `¥ ${effective.toFixed(2)} / ${data.unit}`;
    return { total, units, effective };
  }

  function syncStandardPrice() {
    const data = assessmentInput();
    $('#costResource').value = Number((data.benchmark * data.quantity).toFixed(2));
    $('#costUnits').value = Number(data.quantity.toFixed(3));
    calculateStandardPrice(data);
  }

  function tariffForHour(hour) {
    if (hour < 6) return ['深谷 00–06', .74];
    if (hour < 8) return ['早平 06–08', .88];
    if (hour < 11) return ['日峰 08–11', 1.12];
    if (hour < 14) return ['午峰 11–14', 1.18];
    if (hour < 18) return ['日峰 14–18', 1.15];
    if (hour < 22) return ['晚高峰 18–22', 1.25];
    return ['夜平 22–24', .90];
  }

  function tokenBenchmark(index) {
    try {
      const model = models[Number(index)] || models[0];
      const provider = tokenServiceProviders[$('#assessTokenProvider').value] || tokenServiceProviders.kai;
      const tier = tokenServiceTiers[$('#assessTokenTier').value] || tokenServiceTiers.standard;
      const context = tokenContextFactor[$('#assessTokenContext').value] || tokenContextFactor.ctx32;
      const type = assessKind === 'tokencap'
        ? tokenCapacityTypes[$('#assessTokenPriceType').value] || tokenCapacityTypes.stable
        : tokenUsagePriceTypes[$('#assessTokenPriceType').value] || tokenUsagePriceTypes.mixed;
      const developerFactor = vendorTokenFactor[model[1]] || .72;
      const usageBase = 22 * model[2] * developerFactor * provider.factor * tier.factor * context.factor;
      const price = assessKind === 'tokencap' ? usageBase * type.limit * type.factor : usageBase * type.factor;
      return {
        name: model[0], price,
        unit: assessKind === 'tokencap' ? 'Token 容量时' : '百万 Token 实际用量',
        liquidity: assessKind === 'tokencap' ? .92 : .96,
        provider: provider.name, tier: tier.name, context: context.name, priceType: type.name,
        validity: $('#assessTokenValidity').value || '未设置'
      };
    } catch (_) { /* Fall through to an indicative benchmark. */ }
    const option = $('#assessToken').selectedOptions[0];
    return { name: option?.textContent || '具体模型', price: 18, unit: assessKind === 'tokencap' ? 'Token 容量时' : '百万 Token 实际用量', liquidity: .96, provider: '具体服务商', tier: '具体服务档位', context: '具体上下文', priceType: '具体价格类型', validity: '未设置' };
  }

  function assessmentInput() {
    const region = regionBenchmarks[$('#assessRegion').value];
    const start = new Date($('#assessStart').value || Date.now());
    const tariff = tariffForHour(start.getHours());
    const quality = Number($('#assessQuality').value);
    const performance = Number($('#assessPerformance').value);
    const verification = Number($('#assessVerification').value);
    let name, benchmark, quantity, unit, geo = region[1], time = tariff[1], liquidity, tokenMeta = null;

    if (assessKind === 'gpu') {
      const record = gpuBenchmarks[$('#assessGpu').value];
      name = record[0]; benchmark = record[1];
      quantity = Math.max(1, Number($('#assessGpuCount').value) || 1) * Math.max(1, Number($('#assessGpuHours').value) || 1);
      unit = 'GPU 时'; liquidity = .94;
    } else if (['tokencap', 'tokenusage'].includes(assessKind)) {
      const record = tokenBenchmark($('#assessToken').value);
      name = record.name; benchmark = record.price;
      quantity = Math.max(.01, Number($('#assessTokenQty').value) || .01);
      unit = record.unit; liquidity = record.liquidity || .96;
      time = assessKind === 'tokencap' ? tariff[1] : 1;
      tokenMeta = record;
    } else {
      const record = rackBenchmarks[$('#assessRack').value];
      name = record[0]; benchmark = record[1];
      quantity = Math.max(1, Number($('#assessRackQty').value) || 1) * Math.max(1, Number($('#assessRackMonths').value) || 1);
      unit = '柜月'; liquidity = .90; time = 1;
    }
    return { region, tariff, quality, performance, verification, name, benchmark, quantity, unit, geo, time, liquidity, tokenMeta };
  }

  function capacityState(assessmentQuantity) {
    const value = id => Math.max(0, Number($(`#${id}`).value) || 0);
    const verified = value('capacityVerified');
    const deductions = value('capacityQuoted') + value('capacityLocked') + value('capacityDelivering') + value('capacityConsumed') + value('capacityFrozen');
    const raw = verified - deductions;
    const sellable = Math.max(0, raw);
    return { verified, deductions, raw, sellable, assessedSellable: Math.min(assessmentQuantity, sellable) };
  }

  function syncCapacity(resetDeductions = false, notify = false) {
    const data = assessmentInput();
    const supplierBlocked = supplierStatus !== 'certified';
    const gpuBlocked = assessKind === 'gpu' && !gpuGatePassed();
    $('#capacityVerified').value = supplierBlocked || gpuBlocked ? '0' : Number(data.quantity.toFixed(3));
    if (resetDeductions) ['capacityQuoted', 'capacityLocked', 'capacityDelivering', 'capacityConsumed', 'capacityFrozen'].forEach(id => { $(`#${id}`).value = '0'; });
    capacityLinked = true;
    if (notify && (supplierBlocked || gpuBlocked) && typeof toast === 'function') {
      toast(supplierBlocked ? '企业供应商尚未认证，不能计入已验真存入' : 'GPU 六项验真未全部通过，不能计入已验真存入');
    }
  }

  function calculateAssessment() {
    const data = assessmentInput();
    const standardized = calculateStandardPrice(data);
    if (assessKind === 'gpu') updateGpuGate();
    const unitFair = data.benchmark * data.geo * data.time * data.quality * data.performance * data.verification;
    const capacity = capacityState(data.quantity);
    const fair = data.quantity * unitFair;
    const accepted = capacity.assessedSellable * unitFair * data.liquidity;
    const score = Math.max(62, Math.min(98, Math.round(78 + (data.verification - .92) * 90 + (data.quality - .86) * 38 + (data.performance - .93) * 28)));
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : 'C';
    const kindLabel = { gpu: 'GPU', tokencap: 'Token 容量时', tokenusage: '百万 Token 实际用量', rack: '柜月' }[assessKind];
    const geoLabel = `${data.region[0]} ×${data.geo.toFixed(2)}`;
    const timeLabel = ['gpu', 'tokencap'].includes(assessKind) ? `${data.tariff[0]} ×${data.time.toFixed(2)}` : `${kindLabel} 按实际用量 / 交付周期计量`;

    $('#assessmentAccepted').textContent = formatMoney(accepted);
    $('#assessmentFair').textContent = `¥ ${formatMoney(fair)}`;
    $('#assessmentRange').textContent = `¥ ${formatMoney(accepted * .97)} – ${formatMoney(accepted * 1.03)}`;
    $('#assessmentUnit').textContent = `${data.name} · ¥${data.benchmark.toFixed(2)} / ${data.unit}`;
    $('#assessmentScore').textContent = `${score} / 100 · ${grade}级`;
    $('#assessmentScoreBar').style.width = `${score}%`;
    $('#assessmentId').textContent = `ASSESS · KAI-${String(Date.now()).slice(-4)}`;
    $('#assessmentFactors').innerHTML = `
      <div><span>${data.name} 人民币基准</span><b>¥ ${data.benchmark.toFixed(2)} / ${data.unit}</b></div>
      ${data.tokenMeta ? `<div><span>Token 订单身份</span><b>${data.name} + ${data.tokenMeta.provider} + ${data.tokenMeta.tier} + ${data.tokenMeta.context} + ${data.tokenMeta.priceType} + ${data.region[0]} + ${data.tokenMeta.validity}</b></div>` : ''}
      <div><span>供应商标准化有效单价</span><b>¥ ${standardized.effective.toFixed(2)} / ${data.unit}</b></div>
      <div><span>评估数量</span><b>${data.quantity.toLocaleString('zh-CN')} ${data.unit}</b></div>
      <div><span>当前可售容量</span><b>${capacity.assessedSellable.toLocaleString('zh-CN')} ${data.unit}</b></div>
      <div><span>地区系数</span><b>${geoLabel}</b></div>
      <div><span>日夜时段</span><b>${timeLabel}</b></div>
      <div><span>质量 × 性能</span><b>× ${(data.quality * data.performance).toFixed(3)}</b></div>
      <div><span>权属核验</span><b>× ${data.verification.toFixed(2)}</b></div>
      <div><span>验收流动性</span><b>× ${data.liquidity.toFixed(2)}</b></div>`;

    document.querySelectorAll('.capacity-unit').forEach(unit => { unit.textContent = data.unit; });
    $('#sellableUnit').textContent = data.unit;
    $('#sellableCapacity').firstChild.textContent = `${capacity.sellable.toLocaleString('zh-CN', { maximumFractionDigits: 3 })} `;
    const ratio = capacity.verified > 0 ? capacity.sellable / capacity.verified : 0;
    $('#sellableRatio').textContent = `${(ratio * 100).toFixed(1)}%`;
    $('#sellableMeter').style.width = `${Math.min(100, ratio * 100)}%`;
    $('#sellableRmb').textContent = `¥ ${formatMoney(capacity.sellable * unitFair * data.liquidity)}`;
    $('#capacityWarning').textContent = supplierStatus !== 'certified'
      ? '企业主体尚未认证，已验真存入与可售容量保持为 0。'
      : assessKind === 'gpu' && !gpuGatePassed()
        ? 'GPU 六项验真尚未全部通过，当前不可生成存入批次或报价。'
        : accessMode === 'connector' && connectorState !== 'online'
          ? '连接器尚未通过本次验签或已失联：已验真批次和历史证据保留，但停止新订单并触发复验。'
        : capacity.raw < 0
          ? `容量异常：扣减项比已验真存入多 ${Math.abs(capacity.raw).toLocaleString('zh-CN')} ${data.unit}，可售容量已归零。`
          : capacity.verified === 0 ? '尚无已验真存入容量，当前不可报价。' : '';
    calculateWithdrawal(data, capacity);
    return { accepted, score };
  }

  function calculateWithdrawal(data = assessmentInput(), capacity = capacityState(data.quantity)) {
    const request = Math.max(.01, Number($('#withdrawQty').value) || .01);
    const permission = $('#withdrawPermission').value === 'yes';
    const dispute = $('#withdrawDispute').value === 'pending';
    const tasks = $('#withdrawTasks').value === 'pending';
    const nas = $('#withdrawNas').value === 'pending';
    const notice = $('#withdrawNotice').value === 'pending';
    const extraRisk = $('#withdrawRisk').value === 'frozen';
    const quoted = Math.max(0, Number($('#capacityQuoted').value) || 0);
    const locked = Math.max(0, Number($('#capacityLocked').value) || 0);
    const delivering = Math.max(0, Number($('#capacityDelivering').value) || 0);
    const frozen = Math.max(0, Number($('#capacityFrozen').value) || 0);
    const commitments = quoted + locked + delivering > 0;
    const blockers = [];
    if (supplierStatus !== 'certified') blockers.push('供应商状态不是已认证');
    if (assessKind === 'gpu' && !gpuGatePassed()) blockers.push('GPU 存入六项验真尚未完成');
    if (!permission) blockers.push('申请人缺少容量批次操作权');
    if (commitments) blockers.push('存在报价预留、订单锁定或交付任务');
    if (dispute) blockers.push('存在退款或争议');
    if (tasks) blockers.push('GPU / 模型任务尚未排空');
    if (nas) blockers.push('NAS 数据迁移与删除尚未确认');
    if (notice) blockers.push('尚未满足通知期或合同约定');
    if (extraRisk || frozen > 0) blockers.push('存在风控或司法冻结');

    let state = 'immediate';
    let label = '立即取出';
    let approved = Math.min(request, capacity.sellable);
    if (blockers.length || capacity.sellable <= 0) {
      state = 'scheduled'; label = '排期取出';
      if (capacity.sellable <= 0) blockers.push('当前没有可售余额');
    } else if (request > capacity.sellable) {
      state = 'partial'; label = '部分取出'; approved = capacity.sellable;
      blockers.push(`申请数量超过可售余额，先执行可用的 ${approved.toLocaleString('zh-CN')} ${data.unit}`);
    }
    const future = Math.max(0, capacity.sellable - approved);
    const outcome = $('#withdrawOutcome');
    outcome.dataset.state = state;
    outcome.querySelector('strong').textContent = label;
    $('#withdrawUnit').textContent = data.unit;
    $('#withdrawApproved').textContent = `${approved.toLocaleString('zh-CN', { maximumFractionDigits: 3 })} ${data.unit}`;
    $('#withdrawAvailable').textContent = `${capacity.sellable.toLocaleString('zh-CN', { maximumFractionDigits: 3 })} ${data.unit}`;
    $('#withdrawFuture').textContent = `${future.toLocaleString('zh-CN', { maximumFractionDigits: 3 })} ${data.unit}`;
    $('#withdrawBlockers').textContent = blockers.length ? blockers.join('；') : '所有检查通过，可立即进入取出交割。';
    return { state, label, approved, future };
  }

  function setAssessmentKind(kind) {
    assessKind = kind;
    const tokenKind = ['tokencap', 'tokenusage'].includes(kind);
    document.querySelectorAll('[data-assess-kind]').forEach(button => button.classList.toggle('active', button.dataset.assessKind === kind));
    document.querySelectorAll('[data-kind-field]').forEach(field => { field.hidden = field.dataset.kindField !== kind && !(tokenKind && field.dataset.kindField === 'token'); });
    $('.assess-region-field').hidden = false;
    $('.assess-time-field').hidden = !['gpu', 'tokencap'].includes(kind);
    $('#assessmentTokenBoundary').hidden = !tokenKind;
    if (tokenKind) {
      const priceTypes = kind === 'tokencap' ? tokenCapacityTypes : tokenUsagePriceTypes;
      $('#assessTokenPriceType').innerHTML = Object.entries(priceTypes).map(([key, value]) => `<option value="${key}">${value.name}</option>`).join('');
      $('#assessTokenQtyLabel').textContent = kind === 'tokencap' ? '容量时数量' : '实际调用量';
      $('#assessTokenQtyUnit').textContent = kind === 'tokencap' ? '单位：Token 容量时' : '单位：百万 Token 实际用量';
    }
    $('#gpuDepositGate').hidden = kind !== 'gpu';
    syncStandardPrice();
    syncCapacity(true, false);
    $('#withdrawQty').value = kind === 'gpu' ? '720' : tokenKind ? '10' : '1';
    calculateAssessment();
  }

  function showAssessment() {
    document.querySelectorAll('.view,.nav-item').forEach(element => element.classList.remove('active'));
    assessmentView.classList.add('active');
    assessmentNav.classList.add('active');
    assessmentNav.setAttribute('aria-current', 'page');
    document.querySelectorAll('.nav-item:not([data-view="assessment"])').forEach(item => item.removeAttribute('aria-current'));
    const crumb = $('#crumb');
    if (crumb) crumb.textContent = '供应商评估';
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    calculateAssessment();
  }

  function renderRoadmapRail() {
    $('#roadmapPhaseRail').innerHTML = roadmapPhases.map(phase => {
      const completed = roadmapCompletedPhases.has(phase.phase);
      const unlocked = phase.phase <= roadmapUnlockedPhase;
      const current = phase.phase === roadmapUnlockedPhase && !completed;
      const state = completed ? '已通过' : current ? '当前阶段' : unlocked ? '可进入' : '待解锁';
      return `<button type="button" data-roadmap-phase="${phase.phase}" class="${roadmapSelectedPhase === phase.phase ? 'active' : ''} ${completed ? 'completed' : ''} ${!unlocked ? 'locked' : ''}"><i>0${phase.phase}</i><span><small>${phase.label}</small><b>${phase.title}</b><em>${state}</em></span></button>`;
    }).join('');
    document.querySelectorAll('[data-roadmap-phase]').forEach(button => button.addEventListener('click', () => {
      roadmapSelectedPhase = Number(button.dataset.roadmapPhase);
      renderRoadmapRail();
      renderRoadmapDetail();
    }));
  }

  function renderRoadmapDetail() {
    const phase = roadmapPhases[roadmapSelectedPhase];
    const checked = roadmapGateState[phase.phase];
    const completed = roadmapCompletedPhases.has(phase.phase);
    const unlocked = phase.phase <= roadmapUnlockedPhase;
    const allPassed = checked.size === phase.exits.length;
    const nextLabel = phase.phase < roadmapPhases.length - 1 ? `阶段 ${phase.phase + 1}` : '路线图完成状态';
    $('#roadmapPhaseDetail').innerHTML = `
      <div class="roadmap-detail-head"><div><span class="eyebrow">PHASE 0${phase.phase} · ${phase.label}</span><h2>${phase.title}</h2></div><div class="roadmap-gate-count"><b>${checked.size} / ${phase.exits.length}</b><small>退出条件证据</small></div></div>
      <div class="roadmap-detail-grid"><section><h3>本阶段实施范围</h3><ol class="roadmap-scope-list">${phase.items.map((item, index) => `<li><i>${String(index + 1).padStart(2, '0')}</i><span>${item}</span></li>`).join('')}</ol></section>
      <section class="roadmap-exit-gate"><div class="roadmap-exit-head"><div><span class="eyebrow">EXIT GATE</span><h3>进入${nextLabel}前必须满足</h3></div><b data-state="${completed ? 'passed' : allPassed ? 'ready' : 'pending'}">${completed ? '阶段已通过' : allPassed ? '条件齐备 · 待确认' : unlocked ? '尚不能进入下一阶段' : '前序阶段尚未通过'}</b></div>
      <div class="roadmap-exit-checks">${phase.exits.map((item, index) => `<label><input type="checkbox" data-roadmap-check="${index}" ${checked.has(index) ? 'checked' : ''} ${!unlocked || completed ? 'disabled' : ''}><span><i>${checked.has(index) ? '✓' : '○'}</i>${item}</span></label>`).join('')}</div>
      <div class="roadmap-evidence"><small>建议留存的退出证据</small><b>${phase.evidence}</b></div>
      <button class="primary wide" id="confirmRoadmapGate" type="button" ${!unlocked || !allPassed || completed ? 'disabled' : ''}>${completed ? '该阶段已确认通过' : phase.phase < 4 ? `确认退出阶段 ${phase.phase}，解锁阶段 ${phase.phase + 1}` : '确认阶段 4 完成'}</button></section></div>`;
    document.querySelectorAll('[data-roadmap-check]').forEach(input => input.addEventListener('change', () => {
      const index = Number(input.dataset.roadmapCheck);
      if (input.checked) checked.add(index); else checked.delete(index);
      renderRoadmapRail();
      renderRoadmapDetail();
    }));
    const confirm = $('#confirmRoadmapGate');
    if (confirm) confirm.addEventListener('click', () => {
      if (roadmapGateState[phase.phase].size !== phase.exits.length || phase.phase > roadmapUnlockedPhase) return;
      roadmapCompletedPhases.add(phase.phase);
      if (phase.phase < roadmapPhases.length - 1) {
        roadmapUnlockedPhase = Math.max(roadmapUnlockedPhase, phase.phase + 1);
        roadmapSelectedPhase = phase.phase + 1;
        if (typeof toast === 'function') toast(`阶段 ${phase.phase} 退出条件已确认，阶段 ${phase.phase + 1} 已解锁`);
      } else if (typeof toast === 'function') toast('阶段 4 退出条件已确认，路线图闭环完成');
      renderRoadmapRail();
      renderRoadmapDetail();
    });
  }

  function showRoadmap() {
    document.querySelectorAll('.view,.nav-item').forEach(element => element.classList.remove('active'));
    roadmapView.classList.add('active');
    roadmapNav.classList.add('active');
    roadmapNav.setAttribute('aria-current', 'page');
    document.querySelectorAll('.nav-item:not([data-view="roadmap"])').forEach(item => item.removeAttribute('aria-current'));
    const crumb = $('#crumb');
    if (crumb) crumb.textContent = '实施路线图';
    renderRoadmapRail();
    renderRoadmapDetail();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  assessmentNav.addEventListener('click', showAssessment);
  document.querySelectorAll('[data-assess-kind]').forEach(button => button.addEventListener('click', () => setAssessmentKind(button.dataset.assessKind)));
  $('#assessmentForm').addEventListener('input', calculateAssessment);
  $('#assessmentForm').addEventListener('change', calculateAssessment);
  $('#assessmentForm').addEventListener('submit', event => {
    event.preventDefault();
    calculateAssessment();
    if (typeof toast === 'function') toast('入驻初评已生成，请继续提交材料核验');
  });
  $('#submitAssessment').addEventListener('click', async () => {
    const supplier = $('#assessSupplier').value.trim();
    if (!supplier) {
      $('#assessSupplier').focus();
      if (typeof toast === 'function') toast('请先填写供应商名称');
      return;
    }
    if (supplierStatus !== 'certified') {
      if (typeof toast === 'function') toast('仅已认证企业供应商可以提交资源入驻审核');
      return;
    }
    if (assessKind === 'gpu' && !gpuGatePassed()) {
      if (typeof toast === 'function') toast('请先完成 GPU 存入六项验真');
      return;
    }
    if (accessMode === 'connector' && connectorState !== 'online') {
      if (typeof toast === 'function') toast('连接器未通过本次签名上报，不能接受新订单');
      return;
    }
    const button = $('#submitAssessment');
    button.disabled = true;
    button.textContent = '正在写入容量账本…';
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).then(response => response.json());
      if (!me.authenticated) throw new Error('请先登录已认证的企业供应商账户');
      let quantity;
      let product;
      let unit;
      if (assessKind === 'gpu') {
        quantity = Number($('#assessGpuCount').value) * Number($('#assessGpuHours').value);
        product = $('#assessGpu').selectedOptions[0]?.textContent || $('#assessGpu').value;
        unit = 'GPU 时';
      } else if (assessKind === 'rack') {
        quantity = Number($('#assessRackQty').value) * Number($('#assessRackMonths').value);
        product = $('#assessRack').selectedOptions[0]?.textContent || $('#assessRack').value;
        unit = '柜月';
      } else {
        quantity = Number($('#assessTokenQty').value);
        product = [
          $('#assessToken').selectedOptions[0]?.textContent,
          $('#assessTokenProvider').selectedOptions[0]?.textContent,
          $('#assessTokenTier').selectedOptions[0]?.textContent,
          $('#assessTokenContext').selectedOptions[0]?.textContent,
          $('#assessTokenPriceType').selectedOptions[0]?.textContent
        ].filter(Boolean).join(' · ');
        unit = assessKind === 'tokencap' ? 'Token 容量时' : '百万 Token';
      }
      const region = $('#assessRegion').selectedOptions[0]?.textContent || $('#assessRegion').value;
      const evidence = assessKind === 'gpu'
        ? `六项 GPU 验真已在供应商侧完成；接入模式：${accessMode}；权属状态：${$('#assessVerification').selectedOptions[0]?.textContent || ''}；UUID 仅提交不可逆摘要。`
        : `${{ tokencap: 'Token 吞吐与限额保障', tokenusage: '模型实际调用用量', rack: '机柜功率、制冷、网络与可用期' }[assessKind]}已提交材料与远程核验；接入模式：${accessMode}；权属状态：${$('#assessVerification').selectedOptions[0]?.textContent || ''}。`;
      const response = await fetch('/api/assets/intake', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': me.csrf_token },
        body: JSON.stringify({ kind: assessKind, product_code: product, region, quantity, unit, evidence_summary: evidence })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || '资源存入提交失败');
      if (typeof toast === 'function') toast(`${supplier} 的资源存入单 ${payload.intake.id} 已进入平台验真队列`);
      button.dataset.lastIntake = payload.intake.id;
    } catch (error) {
      if (typeof toast === 'function') toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = '提交入驻审核';
    }
  });

  const quantityControls = ['assessGpuCount', 'assessGpuHours', 'assessTokenQty', 'assessRackQty', 'assessRackMonths'];
  quantityControls.forEach(id => $(`#${id}`).addEventListener('input', () => {
    syncStandardPrice();
    if (capacityLinked) syncCapacity(false, false);
    calculateAssessment();
  }));
  ['assessGpu', 'assessToken', 'assessTokenProvider', 'assessTokenTier', 'assessTokenContext', 'assessTokenPriceType', 'assessTokenValidity', 'assessRack'].forEach(id => $(`#${id}`).addEventListener('change', () => {
    syncStandardPrice();
    if (capacityLinked) syncCapacity(false, false);
    calculateAssessment();
  }));
  ['capacityVerified', 'capacityQuoted', 'capacityLocked', 'capacityDelivering', 'capacityConsumed', 'capacityFrozen'].forEach(id => {
    $(`#${id}`).addEventListener('input', () => { capacityLinked = false; calculateAssessment(); });
  });
  $('#syncCapacity').addEventListener('click', () => { syncCapacity(false, true); calculateAssessment(); });
  ['withdrawQty', 'withdrawPermission', 'withdrawDispute', 'withdrawTasks', 'withdrawNas', 'withdrawNotice', 'withdrawRisk'].forEach(id => {
    $(`#${id}`).addEventListener('input', calculateAssessment);
    $(`#${id}`).addEventListener('change', calculateAssessment);
  });
  $('#submitWithdrawal').addEventListener('click', () => {
    const result = calculateWithdrawal();
    if (typeof toast === 'function') toast(`${result.label}申请已进入演示审批队列，历史记录保持不变`);
  });

  $('#enterpriseName').addEventListener('input', () => { $('#assessSupplier').value = $('#enterpriseName').value; });
  $('#submitEnterprise').addEventListener('click', () => {
    const fields = {
      enterpriseName: '企业名称', enterpriseCode: '统一社会信用代码', enterpriseAgent: '授权经办人'
    };
    const missing = Object.entries(fields).find(([id]) => !$(`#${id}`).value.trim());
    if (missing) {
      $('#enterpriseError').textContent = `请填写${missing[1]}`;
      $(`#${missing[0]}`).focus();
      return;
    }
    if (!/^[0-9A-Z]{18}$/.test($('#enterpriseCode').value.trim().toUpperCase())) {
      $('#enterpriseError').textContent = '统一社会信用代码应为 18 位数字或大写字母';
      $('#enterpriseCode').focus();
      return;
    }
    const verificationIds = ['enterpriseAuthorization', 'enterpriseBank', 'enterpriseInvoice', 'enterpriseLicense', 'enterpriseOwnership'];
    const unverified = verificationIds.find(id => $(`#${id}`).value !== 'verified');
    if (unverified) {
      $('#enterpriseError').textContent = '主体、对公账户、开票、许可与资源归属资料需全部核验';
      $(`#${unverified}`).focus();
      return;
    }
    $('#enterpriseError').textContent = '';
    $('#assessSupplier').value = $('#enterpriseName').value.trim();
    setSupplierStatus('reviewing', '企业材料已提交，正在核验主体、授权经办人、对公账户、开票资料、许可与资源归属。');
    if (typeof toast === 'function') toast('企业认证材料已提交，供应商状态更新为审核中');
  });
  $('#supplierStatusControl').addEventListener('change', event => {
    setSupplierStatus(event.target.value, event.target.value === 'certified' ? '企业主体与资料复核通过；认证信息将在六个月内再次复核。' : '状态已由演示审核后台更新。');
    if (event.target.value === 'certified' && capacityLinked) syncCapacity(false, false);
    calculateAssessment();
  });
  ['enterpriseBank', 'enterpriseLicense', 'enterpriseOwnership'].forEach(id => $(`#${id}`).addEventListener('change', event => {
    if (event.target.value !== 'changed') return;
    setSupplierStatus('reviewing', '资源证明、许可或结算账户发生变化，已触发即时复核。');
    if (typeof toast === 'function') toast('关键信息发生变化，已触发即时复核');
  }));
  document.querySelectorAll('[data-access-mode]').forEach(card => card.addEventListener('click', () => setAccessMode(card.dataset.accessMode)));
  document.querySelectorAll('[data-connector-check]').forEach(check => check.addEventListener('change', () => {
    if (accessMode !== 'connector') return;
    const checks = [...document.querySelectorAll('[data-connector-check]')];
    if (checks.some(item => item.value === 'failed')) setConnectorState('quarantined', '上报格式、时间、资源归属或异常漂移检查未通过；停止新订单并进入人工复核。');
  }));
  $('#verifyConnectorReport').addEventListener('click', () => {
    setAccessMode('connector');
    document.querySelectorAll('[data-connector-check]').forEach(check => { check.value = 'passed'; });
    setConnectorState('online', `${globalEventId('connector')} · 设备身份、短期证书、签名、防重放时间窗、最小权限与异常漂移全部通过 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    if (typeof toast === 'function') toast('连接器本次签名上报已通过');
  });
  $('#simulateConnectorOffline').addEventListener('click', () => {
    setAccessMode('connector');
    setConnectorState('offline', `${globalEventId('connector')} · 连接器失联：资源批次和历史证据未删除；新订单已停止，可售余额进入风控冻结并触发复验或人工处置。`);
    if (typeof toast === 'function') toast('连接器失联，已停止新订单并触发复验');
  });
  document.querySelectorAll('[data-gpu-check]').forEach(check => check.addEventListener('change', () => {
    const passed = updateGpuGate();
    if (passed && supplierStatus === 'certified' && capacityLinked) syncCapacity(false, false);
    calculateAssessment();
  }));
  $('#runGpuVerification').addEventListener('click', () => {
    document.querySelectorAll('[data-gpu-check]').forEach(check => { check.value = 'passed'; });
    updateGpuGate();
    if (supplierStatus === 'certified' && capacityLinked) syncCapacity(false, false);
    calculateAssessment();
    if (typeof toast === 'function') toast('六项 GPU 验真已通过，可生成已验真存入批次');
  });

  const now = new Date();
  const pad = number => String(number).padStart(2, '0');
  $('#assessStart').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const askExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  $('#supplierAskExpiry').value = `${askExpiry.getFullYear()}-${pad(askExpiry.getMonth() + 1)}-${pad(askExpiry.getDate())}T${pad(askExpiry.getHours())}:${pad(askExpiry.getMinutes())}`;
  const tokenValidity = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  $('#assessTokenValidity').value = `${tokenValidity.getFullYear()}-${pad(tokenValidity.getMonth() + 1)}-${pad(tokenValidity.getDate())}`;
  setAccessMode('manual');
  setSupplierStatus('pending');
  setAssessmentKind('gpu');

  // RMB-anchored swap clearing: both sides are priced in RMB before conversion.
  function getSwapKind(side) {
    try { if (typeof swapKinds !== 'undefined') return swapKinds[side]; } catch (_) { /* DOM fallback. */ }
    return document.querySelector(`.asset-kind[data-side="${side}"] button.active`)?.dataset.kind || 'gpu';
  }

  function getSwapAsset(kind, id, side = 'from') {
    try { if (typeof assetPrice === 'function') return assetPrice(kind, id, side); } catch (_) { /* Local fallback. */ }
    if (kind === 'gpu') {
      const item = gpuBenchmarks[id] || gpuBenchmarks.H100;
      return { name: item[0], price: item[1], unit: 'GPU 时', liquidity: .94, detail: '按人民币 / GPU 时计价' };
    }
    if (kind === 'rack') {
      const item = rackBenchmarks[id] || rackBenchmarks.rack20;
      return { name: item[0], price: item[1], unit: '柜月', liquidity: .90, detail: '按人民币 / 柜月计价' };
    }
    return kind === 'tokencap'
      ? { name: '具体模型容量保障', price: 35, unit: 'Token 容量时', liquidity: .92, detail: '按具体模型吞吐 / 限额保障计价' }
      : { name: '具体模型实际用量', price: 18, unit: '百万 Token 实际用量', liquidity: .96, detail: '按具体模型输入 / 缓存 / 输出用量计价' };
  }

  function priceGovernanceMarkup(id, title) {
    return `<section class="price-governance" id="${id}">
      <span class="eyebrow">THREE-LAYER PRICE GOVERNANCE</span><h3>${title} · 三层价格口径</h3>
      <div class="price-layer-grid">
        <article><small>01 MARKET REFERENCE</small><b data-layer-market>等待市场基准</b><span>同一标准产品、地区、可售时段与计量口径的报价和成交统计。</span></article>
        <article><small>02 SUPPLIER ASK · PRIVATE</small><b>底价私密 · 目标价与有效期参与撮合</b><span>供应商底价不公开，仅授权撮合与风控可见；采购方只看到标准化报价。</span></article>
        <article><small>03 ORDER EXECUTION</small><b>确认后生成订单执行价</b><span>固定价、询价或协商确认后的最终成交价格，随订单留痕且不可被参考价覆盖。</span></article>
      </div>
      <div class="price-standard-formula">标准化总成本 = 资源价 + 税费调整 + 电费 + 网络与流量 + 必选存储 + 开通及最低消费摊销 + 可量化 SLA 风险调整<br>标准化有效单价 = 标准化总成本 ÷ 可交付标准单位</div>
    </section>`;
  }

  function ensureQuotePriceGovernance() {
    if ($('#quotePriceGovernance')) {
      ensureTokenPricingBoundary();
      ensureTransactionMechanism();
      return;
    }
    const quoteLayout = document.querySelector('#quoteView .quote-layout');
    if (quoteLayout) {
      quoteLayout.insertAdjacentHTML('afterend', priceGovernanceMarkup('quotePriceGovernance', '算力购入'));
      ensureTokenPricingBoundary();
      ensureTransactionMechanism();
    }
  }

  function ensureSwapPriceGovernance() {
    if ($('#swapPriceGovernance')) {
      ensureBilateralSwapPanel();
      return;
    }
    const rmbPanel = $('#swapRmbStandard');
    if (rmbPanel) {
      rmbPanel.insertAdjacentHTML('afterend', priceGovernanceMarkup('swapPriceGovernance', '算力置换'));
      ensureBilateralSwapPanel();
    }
  }

  function syncPriceGovernance() {
    const quoteMarket = $('#unitPrice')?.textContent || '等待市场基准';
    const swapMarket = $('#swapRmbTarget')?.textContent || '等待目标资产基准';
    const quoteValue = $('#quotePriceGovernance [data-layer-market]');
    const swapValue = $('#swapPriceGovernance [data-layer-market]');
    if (quoteValue) quoteValue.textContent = `${quoteMarket} · 市场参考价`;
    if (swapValue) swapValue.textContent = `${swapMarket} · 目标资产市场参考价`;
  }

  function syncTokenOrderIdentity(resetPriceTypes = false) {
    if (!$('#tokenOrderKind')) return;
    const kind = $('#tokenOrderKind').value;
    const priceSelect = $('#tokenOrderPriceType');
    const priceTypes = kind === 'tokencap' ? tokenCapacityTypes : tokenUsagePriceTypes;
    const previous = priceSelect.value;
    if (resetPriceTypes || !priceSelect.options.length) {
      priceSelect.innerHTML = Object.entries(priceTypes).map(([key, value]) => `<option value="${key}">${value.name}</option>`).join('');
      if ([...priceSelect.options].some(option => option.value === previous)) priceSelect.value = previous;
    }
    const model = models[Number($('#tokenOrderModel').value)] || models[0];
    const provider = tokenServiceProviders[$('#tokenOrderProvider').value];
    const tier = tokenServiceTiers[$('#tokenOrderTier').value];
    const context = tokenContextFactor[$('#tokenOrderContext').value];
    const type = priceTypes[priceSelect.value] || Object.values(priceTypes)[0];
    const region = regionBenchmarks[$('#tokenOrderRegion').value] || regionBenchmarks.chengdu;
    const developerFactor = vendorTokenFactor[model[1]] || .72;
    const usageBase = 22 * model[2] * developerFactor * provider.factor * tier.factor * context.factor * region[1];
    const price = kind === 'tokencap' ? usageBase * type.limit * type.factor : usageBase * type.factor;
    const unit = kind === 'tokencap' ? 'Token 容量时' : '百万 Token 实际用量';
    $('#tokenOrderIdentity').textContent = `${model[0]} + ${provider.name} + ${tier.name} + ${context.name} + ${type.name} + ${region[0]} + ${$('#tokenOrderValidity').value || '未设置有效期'}`;
    $('#tokenOrderReference').textContent = `¥ ${price.toFixed(2)} / ${unit}`;
    $('#tokenOrderUnitNote').textContent = kind === 'tokencap'
      ? '这是指定时段吞吐 / 限额保障价格，不代表已经消耗的 Token。'
      : '这是具体模型的实际调用用量价格，输入、缓存和输出分别计量。';
  }

  function ensureTokenPricingBoundary() {
    if ($('#tokenPricingBoundary')) return;
    const governance = $('#quotePriceGovernance');
    if (!governance) return;
    governance.insertAdjacentHTML('afterend', `<section class="token-pricing-boundary" id="tokenPricingBoundary">
      <div class="token-pricing-head"><div><span class="eyebrow">TOKEN PRODUCT BOUNDARY</span><h2>Token 容量保障与实际用量分开定价</h2><p>两类产品可以在同一具体模型和同一服务档位下换算，但不能合并成一条 Token 价格。</p></div><span>禁止混价</span></div>
      <div class="token-product-compare"><article><b>Token 容量时</b><strong>吞吐 / 限额保障</strong><span>购买某个有效时段内被保证的模型服务能力，适合稳定并发和吞吐业务。</span></article><article><b>百万 Token 实际用量</b><strong>已发生的调用量</strong><span>按具体模型的输入、缓存和输出实际计量，适合按调用量结算。</span></article><article class="token-index-card"><b>模型 Token 综合行情</b><strong><i id="tokenBasketIndex">100.00</i> 成本指数</strong><span>固定模型篮子、固定权重、基期 = 100，只表示相对变化，不是统一成交价。</span></article></div>
      <div class="token-basket-note"><b>固定模型篮子示例</b><span>GPT-5 mini、Claude Sonnet 4、Gemini 2.5 Flash、DeepSeek-V3.1、Qwen3-32B、Kimi K2、GLM-4.5-Air、Doubao-Seed-1.6。篮子变更必须更新规则版本，不能回填历史指数。</span></div>
      <div class="token-order-builder">
        <label>产品类型<select id="tokenOrderKind"><option value="tokencap">Token 容量时</option><option value="tokenusage">百万 Token 实际用量</option></select></label>
        <label>具体模型<select id="tokenOrderModel">${tokenOptions}</select></label>
        <label>服务商<select id="tokenOrderProvider"><option value="kai">KAI 模型网关</option><option value="aliyun">阿里云百炼</option><option value="tencent">腾讯云</option><option value="huawei">华为云</option><option value="volc">火山方舟</option></select></label>
        <label>服务档位<select id="tokenOrderTier"><option value="standard">标准服务档位</option><option value="premium">高保障服务档位</option><option value="dedicated">专属服务档位</option></select></label>
        <label>上下文档位<select id="tokenOrderContext"><option value="ctx8">8K 上下文</option><option value="ctx32" selected>32K 上下文</option><option value="ctx128">128K 上下文</option><option value="ctx1m">1M 上下文</option></select></label>
        <label>价格类型<select id="tokenOrderPriceType"></select></label>
        <label>服务区域<select id="tokenOrderRegion">${regionOptionsHtml}</select></label>
        <label>有效期<input id="tokenOrderValidity" type="date"></label>
      </div>
      <div class="token-order-output"><div><small>Token 订单唯一产品身份</small><b id="tokenOrderIdentity">—</b></div><div><small>该具体产品参考单价</small><b id="tokenOrderReference">—</b><span id="tokenOrderUnitNote"></span></div></div>
    </section>`);
    const valid = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const padValue = value => String(value).padStart(2, '0');
    $('#tokenOrderValidity').value = `${valid.getFullYear()}-${padValue(valid.getMonth() + 1)}-${padValue(valid.getDate())}`;
    ['tokenOrderModel', 'tokenOrderProvider', 'tokenOrderTier', 'tokenOrderContext', 'tokenOrderPriceType', 'tokenOrderRegion', 'tokenOrderValidity'].forEach(id => $(`#${id}`).addEventListener('change', () => syncTokenOrderIdentity(false)));
    $('#tokenOrderKind').addEventListener('change', () => syncTokenOrderIdentity(true));
    syncTokenOrderIdentity(true);
  }

  function transactionDetailMarkup(mode) {
    if (mode === 'rfq') return `<div class="transaction-form-grid">
      <label>脱敏需求类型<select id="rfqResource"><option>大额 GPU 集群</option><option>柜月</option><option>复杂 NAS</option><option>定制模型服务</option></select></label>
      <label>需求规模<input id="rfqScale" type="number" min="1" value="128"></label>
      <label>期望区域<select id="rfqRegion"><option>华东（脱敏）</option><option>华北（脱敏）</option><option>华南（脱敏）</option><option>不限区域</option></select></label>
      <label>报价截止<input id="rfqDeadline" type="datetime-local"></label>
      <button class="primary" id="transactionAction" type="button">发布脱敏 RFQ</button>
    </div><div class="transaction-result" id="transactionResult">需求发布后，供应商提交的原始报价相互隔离；KAI 统一规格、时间、地区与 SLA 口径后再向需求方展示。</div>`;
    if (mode === 'reserve') return `<div class="transaction-form-grid">
      <label>预留开始<input id="reserveStart" type="datetime-local"></label>
      <label>预留结束<input id="reserveEnd" type="datetime-local"></label>
      <label>可变数量<input id="reserveQuantity" type="number" min="1" value="720"></label>
      <label>取消规则<select id="reserveCancel"><option>提前 72 小时可取消</option><option>提前 7 天可取消</option><option>不可取消</option></select></label>
      <button class="primary" id="transactionAction" type="button">生成预留合同摘要</button>
    </div><div class="transaction-result" id="transactionResult">预留费、取消规则、可变数量和交付前复验写入合同。首阶段仅做服务预订，不可自由转让，不构成远期或期货合约。</div>`;
    return `<div class="fixed-purchase-flow">
      <div><small>库存条件</small><b>标准规格 · 新鲜库存 · 自动交付</b></div>
      <div><small>买方确认</small><b id="fixedPurchaseSummary">读取当前报价中</b></div>
      <div><small>容量操作</small><b>原子预留 → 待支付订单</b></div>
      <button class="primary" id="transactionAction" type="button">原子预留并生成待支付订单</button>
    </div><div class="transaction-result" id="transactionResult">确认数量和时间后，系统先在容量账本完成原子预留；只有 Reservation 成功才生成待支付订单。</div>`;
  }

  function setTransactionMode(mode) {
    transactionMode = mode;
    document.querySelectorAll('[data-transaction-mode]').forEach(button => button.classList.toggle('active', button.dataset.transactionMode === mode));
    const detail = $('#transactionModeDetail');
    if (!detail) return;
    detail.innerHTML = transactionDetailMarkup(mode);
    const now = new Date();
    const pad2 = number => String(number).padStart(2, '0');
    const localValue = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (mode === 'fixed') {
      const model = $('#modelSelect')?.selectedOptions[0]?.textContent || '当前算力产品';
      $('#fixedPurchaseSummary').textContent = `${model} · ${$('#hoursInput')?.value || 0} GPU 时 · ${$('#startDate')?.value || '当前时段'}`;
    }
    if (mode === 'rfq') $('#rfqDeadline').value = localValue(new Date(now.getTime() + 48 * 60 * 60 * 1000));
    if (mode === 'reserve') {
      $('#reserveStart').value = localValue(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
      $('#reserveEnd').value = localValue(new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000));
    }
    $('#transactionAction').addEventListener('click', executeTransactionMode);
  }

  function executeTransactionMode() {
    const result = $('#transactionResult');
    if (transactionMode === 'fixed') {
      const orderId = `KAI-PAY-${String(Date.now()).slice(-8)}`;
      const eventId = globalEventId('order');
      result.dataset.state = 'success';
      result.innerHTML = `<b>Reservation 成功 · ${orderId}</b><span>${eventId} · 容量账本已原子预留，订单状态：待支付。支付成功并验签后才会正式锁定容量。</span>`;
      if (typeof toast === 'function') toast('容量原子预留成功，已生成待支付订单');
      return;
    }
    if (transactionMode === 'rfq') {
      const scale = Math.max(1, Number($('#rfqScale').value) || 1);
      const eventId = globalEventId('order');
      result.dataset.state = 'success';
      result.innerHTML = `<b>RFQ 已发布 · ${$('#rfqResource').value} × ${scale}</b><span>${eventId} · ${$('#rfqRegion').value} · 截止 ${new Date($('#rfqDeadline').value).toLocaleString('zh-CN')}。原始报价仅 KAI 授权撮合可见，供应商之间完全隔离；采购方只接收标准化方案。</span>`;
      if (typeof toast === 'function') toast('脱敏 RFQ 已进入供应商匹配队列');
      return;
    }
    const start = new Date($('#reserveStart').value);
    const end = new Date($('#reserveEnd').value);
    if (!(end > start)) {
      result.dataset.state = 'error';
      result.textContent = '预留结束时间必须晚于开始时间。';
      return;
    }
    result.dataset.state = 'success';
    result.innerHTML = `<b>服务预订摘要已生成</b><span>${globalEventId('order')} · ${$('#reserveQuantity').value} 标准单位 · ${start.toLocaleString('zh-CN')} 至 ${end.toLocaleString('zh-CN')} · ${$('#reserveCancel').value} · 交付前复验。不可自由转让。</span>`;
    if (typeof toast === 'function') toast('预留规则已写入演示合同摘要');
  }

  function tradeSequenceMarkup() {
    const steps = [
      ['企业采购方', '固定价购买 / 确认询价方案'], ['容量账本', '原子预留容量，返回 Reservation'],
      ['企业供应商', '确认资源可交付'], ['支付机构', '创建支付单并完成付款'],
      ['KAI Cloud', '接收签名异步通知'], ['KAI Cloud', '验签、核对金额、幂等记账'],
      ['容量账本', '支付后正式锁定容量'], ['企业供应商', '接收并执行开通任务'],
      ['企业供应商', '返回服务端点 / 交付凭据'], ['企业采购方', '接收交付包、时段与验收规则'],
      ['KAI Cloud', '计量、SLA 监控与验收'], ['支付机构', '按合同结算 / 分账'],
      ['采购方与供应商', '生成合同、计量、对账单与结算单']
    ];
    return steps.map((step, index) => `<li data-trade-step="${index}"><i>${String(index + 1).padStart(2, '0')}</i><div><small>${step[0]}</small><b>${step[1]}</b></div></li>`).join('');
  }

  function resetTradeSequence() {
    if (tradeSequenceTimer) clearInterval(tradeSequenceTimer);
    tradeSequenceTimer = null;
    document.querySelectorAll('[data-trade-step]').forEach(step => step.classList.remove('active', 'done'));
    if ($('#tradeSequenceStatus')) $('#tradeSequenceStatus').textContent = '等待发起交易';
  }

  function runTradeSequence() {
    resetTradeSequence();
    const steps = [...document.querySelectorAll('[data-trade-step]')];
    let index = 0;
    $('#tradeSequenceStatus').textContent = '交易链路执行中';
    const advance = () => {
      steps.forEach((step, stepIndex) => {
        step.classList.toggle('active', stepIndex === index);
        step.classList.toggle('done', stepIndex < index);
      });
      if (index >= steps.length) {
        steps.forEach(step => { step.classList.remove('active'); step.classList.add('done'); });
        clearInterval(tradeSequenceTimer);
        tradeSequenceTimer = null;
        $('#tradeSequenceStatus').textContent = '完成 · 合同、计量与结算记录已归档';
        if (typeof toast === 'function') toast('演示交易链路已完成');
      }
      index += 1;
    };
    advance();
    tradeSequenceTimer = setInterval(advance, matchMedia('(prefers-reduced-motion: reduce)').matches ? 90 : 360);
  }

  const acceptanceRules = {
    gpu: ['GPU', '可用卡数、运行时长、显存与错误、作业结果或环境可用性', '8 卡 · 80GB 显存 · 作业通过', '0 个显存错误'],
    tokencap: ['Token 容量时', '具体模型、保障时段、承诺吞吐 / 限额、并发与服务档位', '保障 1 容量时 · 并发 32 · 吞吐达标', '限额未降级 · SLA 达标'],
    tokenusage: ['百万 Token 实际用量', '具体模型、输入 / 缓存 / 输出实际用量、错误率和延迟', '输入 58% · 缓存 17% · 输出 25%', '错误率 0.08% · P95 820ms'],
    model: ['模型小时', '实例在线时长、并发、吞吐与模型版本', '在线 1.00 小时 · 并发 32', '146 token/s · v2026.08'],
    nas: ['NAS', '可用容量、性能、快照、数据迁移与删除确认', '可用 100TB · 读取 11GB/s', '快照、迁移与删除证据完整'],
    rack: ['柜月', '机位、功率、网络、开通时间与服务可用性', '42U · 12kW · 双路网络', '按时开通 · 可用性 99.95%']
  };

  function meteringPanelMarkup() {
    return `<section class="metering-panel" id="meteringPanel">
      <div class="metering-head"><div><span class="eyebrow">DUAL-SOURCE METERING</span><h3>双源计量与产品验收</h3><p>供应商侧连接器与 KAI 侧网关 / 探针分别签名采集；结算使用比对结果，不单信任任一侧前端数据。</p></div><b id="settlementStatus" data-state="pending">待计量比对</b></div>
      <div class="metering-controls">
        <label>产品类型<select id="meterProduct"><option value="gpu">GPU</option><option value="tokencap">Token 容量时</option><option value="tokenusage">百万 Token 实际用量</option><option value="model">模型小时</option><option value="nas">NAS</option><option value="rack">柜月</option></select></label>
        <label>供应商连接器用量<input id="supplierMeter" type="number" min="0" step="0.01" value="720"></label>
        <label>KAI 网关 / 探针用量<input id="kaiMeter" type="number" min="0" step="0.01" value="718"></label>
        <label>差异阈值（%）<input id="meterThreshold" type="number" min="0.01" step="0.01" value="2"></label>
        <button class="primary" id="compareMetering" type="button">比对并生成记录</button>
      </div>
      <div class="acceptance-rule"><small>固化验收规则</small><b id="acceptanceProduct">GPU</b><span id="acceptanceRule">—</span></div>
      <div class="metering-evidence">
        <div><small>资源 / 订单</small><b id="meterResourceOrder">—</b></div><div><small>开始 / 结束时间</small><b id="meterTimeRange">—</b></div>
        <div><small>双源使用量 / 差异</small><b id="meterUsageDiff">—</b></div><div><small>性能</small><b id="meterPerformance">—</b></div>
        <div><small>错误</small><b id="meterErrors">—</b></div><div><small>采集方</small><b>供应商连接器 + KAI 网关 / 探针</b></div>
        <div><small>签名</small><b id="meterSignature">等待双源签名</b></div><div><small>原始证据摘要</small><b id="meterEvidenceDigest">—</b></div>
      </div>
      <p class="metering-decision" id="meteringDecision">计量差异超过阈值时，系统立即暂停自动结算并进入人工复核。</p>
    </section>`;
  }

  function updateAcceptanceRule() {
    const rule = acceptanceRules[$('#meterProduct')?.value || 'gpu'];
    if (!rule || !$('#acceptanceProduct')) return;
    $('#acceptanceProduct').textContent = rule[0];
    $('#acceptanceRule').textContent = rule[1];
  }

  function evidenceDigest(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return `KAI-EVD-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  function compareMeteringSources() {
    const supplier = Math.max(0, Number($('#supplierMeter').value) || 0);
    const kai = Math.max(0, Number($('#kaiMeter').value) || 0);
    const threshold = Math.max(.01, Number($('#meterThreshold').value) || .01);
    const difference = Math.abs(supplier - kai) / Math.max(supplier, kai, .01) * 100;
    const rule = acceptanceRules[$('#meterProduct').value];
    const passed = difference <= threshold;
    const started = new Date(Date.now() - 60 * 60 * 1000);
    const ended = new Date();
    const orderId = $('#quoteId')?.textContent?.replace('QUOTE', 'ORDER') || `ORDER-${String(Date.now()).slice(-6)}`;
    const meteringEventId = globalEventId('metering');
    const resource = `${rule[0]} · ${$('#gpuSelect')?.selectedOptions[0]?.textContent || '标准产品'}`;
    const raw = `${resource}|${orderId}|${started.toISOString()}|${ended.toISOString()}|${supplier}|${kai}|${rule[2]}|${rule[3]}`;
    $('#meterResourceOrder').textContent = `${resource} · ${orderId} · ${meteringEventId}`;
    $('#meterTimeRange').textContent = `${started.toLocaleString('zh-CN', { hour12: false })} → ${ended.toLocaleString('zh-CN', { hour12: false })}`;
    $('#meterUsageDiff').textContent = `${supplier} / ${kai} · ${difference.toFixed(2)}%`;
    $('#meterPerformance').textContent = rule[2];
    $('#meterErrors').textContent = rule[3];
    $('#meterSignature').textContent = '双源签名已采集 · 证书链待后端归档';
    $('#meterEvidenceDigest').textContent = evidenceDigest(raw);
    const settlement = $('#settlementStatus');
    settlement.dataset.state = passed ? 'passed' : 'review';
    settlement.textContent = passed ? '计量一致 · 可进入验收' : '暂停自动结算 · 人工复核';
    $('#meteringDecision').textContent = passed
      ? `双源差异 ${difference.toFixed(2)}%，未超过 ${threshold.toFixed(2)}% 阈值；仍需完成 ${rule[0]} 固化验收规则后才能结算。`
      : `双源差异 ${difference.toFixed(2)}%，已超过 ${threshold.toFixed(2)}% 阈值。自动结算已暂停，原始证据与双源签名进入人工复核。`;
    if (typeof toast === 'function') toast(passed ? '双源计量一致，等待产品验收' : '计量差异超阈值，已暂停自动结算');
  }

  function globalEventId(kind) {
    return `EVT-${kind.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  function consistencyPanelMarkup() {
    return `<section class="consistency-panel" id="consistencyPanel">
      <div class="consistency-head"><div><span class="eyebrow">CONSISTENCY & GOVERNANCE</span><h3>一致性、安全与市场治理</h3><p>前端只展示公开投影和演示状态；真实写入、密钥、证据与敏感操作全部由受控后端完成。</p></div><b>RULESET · 2026.08</b></div>
      <div class="consistency-grid">
        <article><b>全局事件</b><span>订单、支付、计量、连接器与佣金事件均有全局 event_id；所有写接口接受幂等键。</span></article>
        <article><b>容量并发</b><span>容量预留使用数据库事务与乐观版本控制，避免并发超卖。</span></article>
        <article><b>跨服务可靠性</b><span>事务事件盒写入业务事务，由可重试消费者处理，失败不会静默丢失。</span></article>
        <article><b>追加式账本</b><span>支付、退款和佣金只追加分录，不覆盖余额或改写已结算记录。</span></article>
        <article><b>人工审计</b><span>记录操作人、理由、前后状态、审批证据与双人复核结果。</span></article>
        <article><b>投影隔离</b><span>原始证据与公开投影分离，供应商底价、设备标识与机房细址不会进入公开页。</span></article>
      </div>
      <div class="event-lab">
        <label>事件类型<select id="eventEntity"><option value="order">订单</option><option value="payment">支付</option><option value="refund">退款</option><option value="metering">计量</option><option value="connector">连接器</option><option value="commission">佣金</option></select></label>
        <label>幂等键<input id="eventIdempotency" value="IDEM-KAI-DEMO-001"></label>
        <label>操作理由<input id="eventReason" value="演示受控写入"></label>
        <button class="primary" id="appendConsistencyEvent" type="button">追加演示事件</button>
      </div>
      <div class="event-lab-result"><div><small>容量账本版本</small><b id="capacityVersion">v17</b></div><div><small>事务事件盒</small><b id="outboxState">等待事件</b></div><div><small>幂等结果</small><b id="idempotencyState">尚未写入</b></div></div>
      <ol class="event-log" id="eventLog"><li><span>审计日志不会被前端改写；这里仅演示 event_id、幂等与追加行为。</span></li></ol>
      <div class="security-governance-grid">
        <article><span class="eyebrow">CREDENTIAL PROTECTION</span><h4>凭据保护</h4><ul><li>不在浏览器或聊天中收集云主账号密码、SSH 私钥、root 密码</li><li>云接入仅使用只读或最小化子账号</li><li>交付使用一次性领取链接、短时凭据或采购方公钥加密</li><li>支付密钥、连接器签发密钥与加密主密钥分离管理</li><li>敏感操作执行双人复核或强认证</li></ul></article>
        <article><span class="eyebrow">DATA MINIMIZATION</span><h4>数据最小化</h4><p>仅处理主体核验、资源验真、交易、交付和法定义务所必需的数据。企业公开资料、经办人信息、机房地址、设备标识、客户模型与存储数据使用不同访问等级和保留期限。</p><a href="https://www.npc.gov.cn/WZWSREL25wYy9jMi9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noopener noreferrer">查看《个人信息保护法》官方页面 ↗</a></article>
        <article class="market-governance"><span class="eyebrow">MARKET GOVERNANCE</span><h4>公开市场规则</h4><div class="governance-tags"><span>供应商进入与退出</span><span>资源验真与复验</span><span>报价、指数与成交统计</span><span>容量锁定、取出与超卖</span><span>取消、退款、SLA 与争议</span><span>代理归因与佣金</span><span>异常交易与虚假供给</span><span>规则版本与过渡期</span></div><button class="text-btn" id="toggleRuleHistory" type="button">查看规则历史版本</button><div class="rule-history" id="ruleHistory" hidden><b>2026.08 · 当前版本</b><span>企业供应商、三层价格、双源计量、单层代理与追加账本。</span><b>2026.07 · 历史版本</b><span>基础市场报价与算力置换原型。历史条款只读保留。</span></div></article>
      </div>
      <p class="governance-fairness">公开规则应公平、公正；收费、取消、争议和赔付条款显著提示，并为每次变更保留可查询版本、征求意见记录与过渡期。</p>
    </section>`;
  }

  function appendConsistencyEvent() {
    const key = $('#eventIdempotency').value.trim();
    if (!key) { $('#idempotencyState').textContent = '拒绝：缺少幂等键'; return; }
    if (processedEventKeys.has(key)) {
      $('#idempotencyState').textContent = '重复请求已识别 · 未再次写入';
      $('#outboxState').textContent = '无新增事件';
      return;
    }
    processedEventKeys.add(key);
    const kind = $('#eventEntity').value;
    const eventId = globalEventId(kind);
    const before = capacityLedgerVersion;
    capacityLedgerVersion += 1;
    $('#capacityVersion').textContent = `v${before} → v${capacityLedgerVersion}`;
    $('#outboxState').textContent = '业务事务已提交 · 消费者处理成功';
    $('#idempotencyState').textContent = `${key} · 首次写入`;
    const row = document.createElement('li');
    const eventLabel = document.createElement('i');
    const detail = document.createElement('div');
    const title = document.createElement('b');
    const audit = document.createElement('span');
    eventLabel.textContent = eventId;
    title.textContent = `${kind.toUpperCase()} · 追加事件`;
    audit.textContent = `版本 v${before} → v${capacityLedgerVersion} · 理由：${$('#eventReason').value || '未填写'} · 操作人：DEMO-OPERATOR`;
    detail.append(title, audit);
    row.append(eventLabel, detail);
    $('#eventLog').prepend(row);
    $('#eventIdempotency').value = `IDEM-KAI-${String(Date.now()).slice(-8)}`;
    if (typeof toast === 'function') toast('事件已通过幂等检查并追加到事务事件盒');
  }

  function renderAgentLedger() {
    const body = $('#agentLedgerBody');
    if (!body) return;
    body.innerHTML = agentLedgerEntries.length ? agentLedgerEntries.map(entry => `<tr><td>${entry.eventId}</td><td>${entry.order}</td><td>${entry.type}</td><td class="${entry.amount < 0 ? 'negative' : ''}">${entry.amount === 0 ? '¥ 0' : `${entry.amount > 0 ? '+' : '-'}¥ ${formatMoney(Math.abs(entry.amount))}`}</td><td>${entry.state}</td></tr>`).join('') : '<tr><td colspan="5">暂无佣金分录；支付成功不会自动计提佣金。</td></tr>';
  }

  function recordAgentCommission() {
    const eligible = ['agentSubject', 'agentAgreement', 'agentPayoutTax'].every(id => $(`#${id}`).value === 'passed');
    const attributed = $('#agentAttribution').value === 'before';
    const amount = Math.max(0, Number($('#agentOrderAmount').value) || 0);
    const rate = Math.max(0, Number($('#agentRate').value) || 0) / 100;
    const orderState = $('#agentOrderState').value;
    const commission = amount * rate;
    const order = `KAI-ORDER-${String(Date.now()).slice(-6)}`;
    const eventId = globalEventId('commission');
    let type = 'NO_ACCRUAL';
    let entryAmount = 0;
    let state = '不计提';
    if (!eligible) state = '代理主体 / 协议 / 收款税务资料未通过';
    else if (!attributed) state = '归因晚于订单创建，无佣金资格';
    else if (orderState === 'paid') state = '仅支付成功，等待订单验收与结算';
    else if (orderState === 'accepted') { type = 'ACCRUAL'; entryAmount = commission; state = '订单验收后计提'; }
    else if (orderState === 'settled') { type = 'SETTLEMENT'; entryAmount = commission; state = '结算分录已追加'; }
    else if (['refunded', 'chargeback', 'fraud'].includes(orderState)) { type = 'REVERSAL'; entryAmount = -commission; state = '退款 / 拒付 / 欺诈自动冲正'; }
    agentLedgerEntries.unshift({ eventId, order, type, amount: entryAmount, state });
    $('#agentSnapshotId').textContent = `${order} · AGENT-RULE-V1.0`;
    $('#agentSnapshotRule').textContent = `KAI-KC-2608 · ${(rate * 100).toFixed(2)}% · 订单创建前归因：${attributed ? '是' : '否'}`;
    $('#agentSnapshotCommission').textContent = entryAmount === 0 ? '¥ 0 · 尚未计提' : `${entryAmount > 0 ? '+' : '-'}¥ ${formatMoney(Math.abs(entryAmount))}`;
    $('#agentSnapshotState').textContent = state;
    renderAgentLedger();
    if (typeof toast === 'function') toast(state);
  }

  function ensureAgentGovernance() {
    if ($('#agentGovernance') || !$('#recommendView')) return;
    const stats = document.querySelector('#recommendView .recommend-stats');
    if (!stats) return;
    stats.insertAdjacentHTML('afterend', `<section class="agent-governance" id="agentGovernance">
      <div class="agent-head"><div><span class="eyebrow">ENTERPRISE AGENT GOVERNANCE</span><h2>企业代理 · 单层直接归因</h2><p>代理只获得自己直接推荐企业在有效归因期内创建并完成的订单佣金，不参与被推荐企业再次发展的下级订单分成。</p></div><span>无入门费 · 不按人数计酬</span></div>
      <div class="single-tier-diagram"><div><small>企业代理 A</small><b>直接推荐</b></div><i>→</i><div><small>被推荐企业 B</small><b>B 的合格订单可计佣</b></div><i>→</i><div class="no-commission"><small>B 再推荐企业 C</small><b>A 不参与 C 的订单分成</b></div></div>
      <div class="agent-rule-grid"><article><b>资格前置</b><span>代理主体、协议、收款账户和税务资料全部审核通过。</span></article><article><b>归因快照</b><span>订单创建前完成归因，固化代理、规则版本、比例和有效期。</span></article><article><b>验收后计提</b><span>支付成功不等于佣金可结算；订单验收并进入结算后才计提。</span></article><article><b>只追加不改值</b><span>退款、拒付、赔付和欺诈产生冲正；已结算佣金只用反向分录更正。</span></article></div>
      <div class="agent-calculator">
        <label>代理主体<select id="agentSubject"><option value="passed">主体审核通过</option><option value="pending">待审核</option></select></label>
        <label>代理协议<select id="agentAgreement"><option value="passed">协议有效</option><option value="pending">未签署</option></select></label>
        <label>收款与税务<select id="agentPayoutTax"><option value="passed">资料审核通过</option><option value="pending">待补充</option></select></label>
        <label>归因时点<select id="agentAttribution"><option value="before">订单创建前完成</option><option value="after">订单创建后才归因</option></select></label>
        <label>订单金额（¥）<input id="agentOrderAmount" type="number" min="0" value="100000"></label>
        <label>快照佣金比例（%）<input id="agentRate" type="number" min="0" max="100" step="0.01" value="3"></label>
        <label>订单状态<select id="agentOrderState"><option value="created">订单已创建</option><option value="paid">支付成功</option><option value="accepted">已验收、进入结算</option><option value="settled">佣金已结算</option><option value="refunded">已退款</option><option value="chargeback">拒付</option><option value="fraud">欺诈订单</option></select></label>
        <button class="primary" id="recordAgentCommission" type="button">固化归因快照并试算</button>
      </div>
      <div class="agent-snapshot"><div><small>订单 / 规则版本</small><b id="agentSnapshotId">—</b></div><div><small>代理 / 比例 / 归因</small><b id="agentSnapshotRule">—</b></div><div><small>本次追加分录</small><b id="agentSnapshotCommission">—</b></div><div><small>状态</small><b id="agentSnapshotState">等待试算</b></div></div>
      <div class="agent-ledger-wrap"><table><thead><tr><th>event_id</th><th>订单</th><th>分录类型</th><th>金额</th><th>原因 / 状态</th></tr></thead><tbody id="agentLedgerBody"></tbody></table></div>
      <p class="agent-boundary">平台不收取以获得代理资格为目的的入门费，不按发展人数计酬，不建立多层级分成；佣金分录与原订单、验收、退款和支付事件可追溯关联。</p>
    </section>`);
    $('#recordAgentCommission').addEventListener('click', recordAgentCommission);
    renderAgentLedger();
  }

  function ensureTransactionMechanism() {
    if ($('#transactionMechanism')) return;
    const governance = $('#quotePriceGovernance');
    if (!governance) return;
    const transactionAnchor = $('#tokenPricingBoundary') || governance;
    transactionAnchor.insertAdjacentHTML('afterend', `<section class="transaction-mechanism" id="transactionMechanism">
      <div class="transaction-head"><div><span class="eyebrow">TRANSACTION MECHANISM</span><h2>三种交易机制</h2><p>按资源标准化程度、规模与未来交付窗口选择交易方式。</p></div><span class="transaction-scope">企业采购 · 服务交易</span></div>
      <div class="transaction-mode-tabs">
        <button type="button" data-transaction-mode="fixed"><b>固定价购买</b><span>标准规格 · 原子预留</span></button>
        <button type="button" data-transaction-mode="rfq"><b>RFQ 询价</b><span>大额、复杂或定制需求</span></button>
        <button type="button" data-transaction-mode="reserve"><b>预留容量</b><span>未来时间窗口服务预订</span></button>
      </div>
      <div class="transaction-mode-detail" id="transactionModeDetail"></div>
      <section class="trade-lifecycle"><div class="trade-lifecycle-head"><div><span class="eyebrow">END-TO-END TRADE</span><h3>一笔交易的完整链路</h3></div><b id="tradeSequenceStatus">等待发起交易</b></div>
        <ol class="trade-sequence">${tradeSequenceMarkup()}</ol>
        <div class="trade-sequence-actions"><button class="primary" id="runTradeSequence" type="button">演示完整链路</button><button class="secondary" id="resetTradeSequence" type="button">重置</button><small>支付异步通知必须验签、核对金额并执行幂等记账；支付成功后才正式锁定容量。</small></div>
      </section>
      ${meteringPanelMarkup()}
      ${consistencyPanelMarkup()}
    </section>`);
    document.querySelectorAll('[data-transaction-mode]').forEach(button => button.addEventListener('click', () => setTransactionMode(button.dataset.transactionMode)));
    $('#runTradeSequence').addEventListener('click', runTradeSequence);
    $('#resetTradeSequence').addEventListener('click', resetTradeSequence);
    $('#meterProduct').addEventListener('change', updateAcceptanceRule);
    $('#compareMetering').addEventListener('click', compareMeteringSources);
    $('#appendConsistencyEvent').addEventListener('click', appendConsistencyEvent);
    $('#toggleRuleHistory').addEventListener('click', () => {
      const history = $('#ruleHistory');
      history.hidden = !history.hidden;
      $('#toggleRuleHistory').textContent = history.hidden ? '查看规则历史版本' : '收起规则历史版本';
    });
    updateAcceptanceRule();
    setTransactionMode('fixed');
  }

  function installServerPaymentGuard() {
    const checkout = $('#checkout');
    const submitPayment = $('#demoPay');
    const paymentStep = checkout?.querySelector('[data-step="pay"]');
    const statusStep = checkout?.querySelector('[data-step="success"]');
    if (!checkout || !submitPayment || !paymentStep || !statusStep) return;
    submitPayment.textContent = '提交支付 · 等待服务端签名通知';
    statusStep.innerHTML = `<div class="success-mark payment-pending-mark">⌁</div>
      <span class="eyebrow">SERVER-SIDE PAYMENT VERIFICATION</span><h2>支付已提交，等待服务端确认</h2>
      <p>前端支付完成页不改变订单最终状态，也不会直接存入算力。平台只接受银行或持牌支付机构的服务端签名异步通知。</p>
      <div class="payment-server-state"><small>订单当前状态</small><b id="paymentServerState">支付确认中 · 容量仍为预留</b><span id="paymentEventId">等待支付机构流水号</span></div>
      <div class="payment-verification-list">
        <div><i>01</i><span><b>订单与流水</b><small>平台订单号、支付机构流水号</small></span></div>
        <div><i>02</i><span><b>交易要素</b><small>商户、金额、币种、收款状态</small></span></div>
        <div><i>03</i><span><b>通知真实性</b><small>服务端通知签名与证书有效性</small></span></div>
        <div><i>04</i><span><b>幂等记账</b><small>幂等键、事件是否已经处理</small></span></div>
        <div><i>05</i><span><b>逆向状态</b><small>退款、撤销与拒付状态</small></span></div>
      </div>
      <div class="payment-hard-rule">全部核对通过后，后端才可把容量从“预留”推进为“正式锁定”，再下发开通任务。前端没有修改最终订单状态的权限。</div>
      <button class="primary wide" id="returnToOrder" type="button">返回订单</button>`;
    submitPayment.onclick = () => {
      const provider = checkout.querySelector('.pay.active b')?.textContent || '持牌支付机构';
      paymentStep.classList.remove('active');
      statusStep.classList.add('active');
      $('#paymentServerState').textContent = '支付确认中 · 容量仍为预留';
      $('#paymentEventId').textContent = `${provider} · 等待服务端签名通知与机构流水号`;
      checkout.dataset.orderFinalState = 'payment_pending';
      if (typeof toast === 'function') toast('支付已提交，最终状态等待服务端签名通知');
    };
    $('#returnToOrder').addEventListener('click', () => {
      statusStep.classList.remove('active');
      paymentStep.classList.add('active');
      checkout.close();
    });
  }

  function setBilateralStage(stage, message = '') {
    bilateralStage = stage;
    const order = ['verify', 'snapshot', 'locked', 'payment', 'delivery'];
    document.querySelectorAll('[data-bilateral-stage]').forEach(item => {
      const itemStage = item.dataset.bilateralStage;
      item.classList.toggle('active', itemStage === stage);
      item.classList.toggle('done', stage !== 'rollback' && order.indexOf(itemStage) < order.indexOf(stage));
    });
    if ($('#bilateralStatus') && message) $('#bilateralStatus').textContent = message;
  }

  function syncBilateralPreview(pricing = latestSwapPricing) {
    if (!pricing || !$('#bilateralTargetQty')) return;
    const targetInput = $('#bilateralTargetQty');
    if (targetInput.dataset.touched !== 'true') targetInput.value = pricing.receive < 10 ? pricing.receive.toFixed(3) : pricing.receive.toFixed(2);
    $('#bilateralTargetUnit').textContent = pricing.to.unit;
  }

  function buildBilateralSnapshot() {
    if ($('#bilateralFromVerified').value !== 'yes' || $('#bilateralToVerified').value !== 'yes') {
      setBilateralStage('verify', '两边容量都必须验真并进入容量账本，当前不能生成快照。');
      return;
    }
    const pricing = latestSwapPricing;
    if (!pricing) return;
    const targetQty = Math.max(.01, Number($('#bilateralTargetQty').value) || .01);
    const targetValue = targetQty * pricing.targetUnitRmb;
    const difference = targetValue - pricing.comparableRmb;
    const topup = Math.abs(difference) < .01 ? '无需补差' : difference > 0 ? `甲方补 ¥ ${formatMoney(difference)}` : `乙方补 ¥ ${formatMoney(-difference)}`;
    $('#bilateralFromOriginal').textContent = `${pricing.quantity.toLocaleString('zh-CN')} ${pricing.from.unit}`;
    $('#bilateralToOriginal').textContent = `${targetQty.toLocaleString('zh-CN')} ${pricing.to.unit}`;
    $('#bilateralPriceSource').textContent = `${pricing.from.name} ¥${pricing.fromUnitRmb.toFixed(2)} ↔ ${pricing.to.name} ¥${pricing.targetUnitRmb.toFixed(2)}`;
    $('#bilateralSnapshotTime').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
    $('#bilateralFromValue').textContent = `¥ ${formatMoney(pricing.comparableRmb)}`;
    $('#bilateralToValue').textContent = `¥ ${formatMoney(targetValue)}`;
    $('#bilateralTopup').textContent = topup;
    setBilateralStage('snapshot', '价值快照已生成，等待双方复核并确认。');
  }

  function ensureBilateralSwapPanel() {
    if ($('#bilateralSwapPanel')) return;
    const governance = $('#swapPriceGovernance');
    if (!governance) return;
    governance.insertAdjacentHTML('afterend', `<section class="bilateral-swap-panel" id="bilateralSwapPanel">
      <div class="bilateral-head"><div><span class="eyebrow">BILATERAL COMPUTE SWAP</span><h2>双边置换 · 我可提供 / 我需要</h2><p>标准算容价值只负责比较两边资源和计算补差，最终仍交付订单约定的具体 GPU、Token 容量时、百万 Token 实际用量、NAS、模型实例或机柜服务。</p></div><span>人民币同点快照</span></div>
      <div class="bilateral-verification">
        <label>我可提供的容量<select id="bilateralFromVerified"><option value="yes">已验真并进入账本</option><option value="no">尚未验真</option></select></label>
        <label>我需要的容量<select id="bilateralToVerified"><option value="yes">已验真并进入账本</option><option value="no">尚未验真</option></select></label>
        <label>对手方实际提供数量<div class="input-unit"><input id="bilateralTargetQty" type="number" min="0.01" step="0.01"><span id="bilateralTargetUnit">标准单位</span></div></label>
        <button class="primary" id="buildSwapSnapshot" type="button">生成价值快照</button>
      </div>
      <div class="bilateral-snapshot">
        <div><small>甲方原始单位 / 数量</small><b id="bilateralFromOriginal">—</b></div><div><small>乙方原始单位 / 数量</small><b id="bilateralToOriginal">—</b></div>
        <div><small>标准价格来源</small><b id="bilateralPriceSource">—</b></div><div><small>同一时点</small><b id="bilateralSnapshotTime">—</b></div>
        <div><small>甲方标准算容价值</small><b id="bilateralFromValue">—</b></div><div><small>乙方标准算容价值</small><b id="bilateralToValue">—</b></div>
        <div class="bilateral-topup"><small>建议补差</small><b id="bilateralTopup">待生成</b></div>
      </div>
      <div class="bilateral-stage-flow"><span data-bilateral-stage="verify">容量验真</span><span data-bilateral-stage="snapshot">双方复核</span><span data-bilateral-stage="locked">原子锁定</span><span data-bilateral-stage="payment">持牌渠道补差</span><span data-bilateral-stage="delivery">实际服务交付</span><span data-bilateral-stage="rollback">整体回滚 / 争议</span></div>
      <div class="bilateral-actions"><p id="bilateralStatus">两边容量验真后可生成同一时点价值快照。</p><button class="secondary" id="lockBilateralSwap" type="button">双方确认并原子锁定</button><button class="secondary" id="payBilateralTopup" type="button">记录持牌渠道补差</button><button class="text-btn" id="rollbackBilateralSwap" type="button">模拟失败并回滚</button></div>
      <div class="bilateral-delivery-note"><b>交付与留痕</b><span>置换不产生可自由转让的标准化证券。双方仍收到具体服务，并保留订单、合同、容量账本、计量、税务、支付与结算记录。</span></div>
    </section>`);
    $('#bilateralTargetQty').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
    $('#buildSwapSnapshot').addEventListener('click', buildBilateralSnapshot);
    $('#lockBilateralSwap').addEventListener('click', () => {
      if (bilateralStage !== 'snapshot') { $('#bilateralStatus').textContent = '请先生成并复核价值快照。'; return; }
      setBilateralStage('locked', '双方已确认，两边容量已在同一事务中原子锁定。');
      if (typeof toast === 'function') toast('双边容量已原子锁定');
    });
    $('#payBilateralTopup').addEventListener('click', () => {
      if (bilateralStage !== 'locked') { $('#bilateralStatus').textContent = '补差前必须先完成双边原子锁定。'; return; }
      setBilateralStage('payment', '补差已通过银行 / 持牌支付机构记录，等待实际服务交付。');
      if (typeof toast === 'function') toast('演示补差记录已完成');
    });
    $('#rollbackBilateralSwap').addEventListener('click', () => {
      setBilateralStage('rollback', '任一侧锁定、支付或交付失败：整体回滚并释放容量；异常订单进入争议处理。');
      if (typeof toast === 'function') toast('置换已整体回滚，容量已释放');
    });
    setBilateralStage('verify');
    syncBilateralPreview();
  }

  function ensureRmbPanel() {
    if ($('#swapRmbStandard')) {
      ensureSwapPriceGovernance();
      return;
    }
    const pricingMethod = document.querySelector('#swapView .pricing-method');
    if (!pricingMethod) return;
    const panel = document.createElement('section');
    panel.className = 'rmb-standard-panel';
    panel.id = 'swapRmbStandard';
    panel.innerHTML = `
      <div class="rmb-standard-head"><div><span class="eyebrow">RMB CLEARING STANDARD</span><h2>人民币统一置换标准</h2><p>GPU、Token 容量时、百万 Token 实际用量与柜月不直接互报比例。系统先按具体产品身份计算人民币价值，再按目标具体产品的标准价换算。</p></div><span class="rmb-lock">参考基准 · 15 MIN</span></div>
      <div class="rmb-flow"><div><small>01 付出公允值</small><b id="swapRmbFair">¥ 0</b></div><div><small>02 验收可兑人民币</small><b id="swapRmbAccepted">¥ 0</b></div><div><small>03 目标人民币单价</small><b id="swapRmbTarget">¥ 0</b></div><div><small>04 预计获得</small><b id="swapRmbResult">—</b></div></div>
      <div class="rmb-equation">目标数量 = 付出数量 × 付出人民币单价 × 地区/时段 × 验收系数 × 交割系数 ÷ 目标人民币单价</div>
      <div class="rmb-example"><span>人民币参考：¥100,000 按当前目标标准价可换</span><b id="swapRmbExample">—</b></div>`;
    pricingMethod.insertAdjacentElement('afterend', panel);
    ensureSwapPriceGovernance();
  }

  function calculateRmbSwap() {
    if (!$('#swapFromProduct') || !$('#swapToProduct')) return;
    ensureRmbPanel();
    const fromKind = getSwapKind('from');
    const toKind = getSwapKind('to');
    const quantity = Math.max(.01, Number($('#swapQuantity').value) || .01);
    const from = getSwapAsset(fromKind, $('#swapFromProduct').value, 'from');
    const to = getSwapAsset(toKind, $('#swapToProduct').value, 'to');
    const fromRegion = regionBenchmarks[$('#swapFromRegion')?.value] || regionBenchmarks.chengdu;
    const toRegion = regionBenchmarks[$('#swapToRegion')?.value] || regionBenchmarks.shanghai;
    const hour = new Date($('#swapTime')?.value || Date.now()).getHours();
    const tariff = tariffForHour(hour);
    const fromGeo = fromRegion[1];
    const toGeo = toRegion[1];
    const fromTime = ['gpu', 'tokencap'].includes(fromKind) ? tariff[1] : 1;
    const toTime = ['gpu', 'tokencap'].includes(toKind) ? tariff[1] : 1;
    const tokenKinds = ['tokencap', 'tokenusage'];
    const crossTokenUnit = tokenKinds.includes(fromKind) && tokenKinds.includes(toKind) && fromKind !== toKind;
    const sameTokenService = $('#swapFromProduct').value === $('#swapToProduct').value
      && $('#tokenProviderFrom').value === $('#tokenProviderTo').value
      && $('#tokenServiceTierFrom').value === $('#tokenServiceTierTo').value
      && $('#tokenContextFrom').value === $('#tokenContextTo').value
      && $('#swapFromRegion').value === $('#swapToRegion').value
      && $('#tokenValidityFrom').value && $('#tokenValidityTo').value;
    if (crossTokenUnit && !sameTokenService) {
      const sourceValue = quantity * from.price * fromGeo * fromTime;
      latestSwapPricing = null;
      $('#swapFromUnit').textContent = from.unit;
      $('#fromValue').textContent = `¥ ${formatMoney(sourceValue)}`;
      $('#swapReceive').textContent = '不可直接换算';
      $('#swapRate').textContent = 'Token 产品口径不一致';
      $('#swapFromDetail').textContent = `${from.detail} · ${fromRegion[0]}`;
      $('#swapToDetail').textContent = `${to.detail} · ${toRegion[0]}`;
      $('#swapFactors').innerHTML = `<div><span>跨 Token 单位换算条件</span><b>必须同模型、同服务商、同服务档位、同上下文与同区域</b></div><div><span>当前结果</span><b>拒绝混价 · 请先对齐产品身份</b></div>`;
      $('#swapRmbFair').textContent = `¥ ${formatMoney(sourceValue)}`;
      $('#swapRmbAccepted').textContent = '等待口径对齐';
      $('#swapRmbTarget').textContent = '非统一 Token 价格';
      $('#swapRmbResult').textContent = '不可换算';
      $('#swapRmbExample').textContent = '模型 Token 综合行情仅为成本指数，不能代替具体产品价格';
      if ($('#bilateralStatus')) $('#bilateralStatus').textContent = 'Token 容量时与实际用量的产品身份不一致，不能生成双边价值快照。';
      syncPriceGovernance();
      return;
    }
    const deliveryValue = { standard: 1, instant: .985, reserved: 1.005 }[$('#swapDelivery').value] || 1;
    const serviceFee = fromKind === toKind ? .012 : .025;
    const fairRmb = quantity * from.price * fromGeo * fromTime;
    const acceptedRmb = fairRmb * from.liquidity;
    const clearingRmb = acceptedRmb * (1 - serviceFee) * deliveryValue;
    const targetUnitRmb = to.price * toGeo * toTime;
    const receive = clearingRmb / targetUnitRmb;
    const receiveText = `${receive < 10 ? receive.toFixed(3) : formatMoney(receive)} ${to.unit}`;
    latestSwapPricing = {
      fromKind, toKind, quantity, from, to, fromUnitRmb: from.price * fromGeo * fromTime,
      targetUnitRmb, fairRmb, acceptedRmb, comparableRmb: clearingRmb, receive, tariff
    };

    $('#swapFromUnit').textContent = from.unit;
    $('#fromValue').textContent = `¥ ${formatMoney(acceptedRmb)}`;
    $('#swapReceive').textContent = receiveText;
    $('#swapRate').textContent = `¥${(from.price * fromGeo * fromTime).toFixed(2)} / ${from.unit} → ¥${targetUnitRmb.toFixed(2)} / ${to.unit}`;
    $('#swapFromDetail').textContent = `${from.detail} · ${fromRegion[0]}${['gpu', 'tokencap'].includes(fromKind) ? ` · ${tariff[0]}` : ''}`;
    $('#swapToDetail').textContent = `${to.detail} · ${toRegion[0]}${['gpu', 'tokencap'].includes(toKind) ? ` · ${tariff[0]}` : ''}`;
    $('#swapFactors').innerHTML = `
      <div><span>付出资产人民币基准</span><b>¥ ${from.price.toFixed(2)} / ${from.unit}</b></div>
      <div><span>来源地区 / 分时</span><b>× ${(fromGeo * fromTime).toFixed(3)}</b></div>
      <div><span>资产验收系数</span><b>× ${from.liquidity.toFixed(2)}</b></div>
      <div><span>${fromKind === toKind ? '同类' : '跨品类'}置换服务费</span><b>-${(serviceFee * 100).toFixed(1)}%</b></div>
      <div><span>交割方式</span><b>× ${deliveryValue.toFixed(3)}</b></div>
      <div><span>目标资产人民币标准</span><b>¥ ${targetUnitRmb.toFixed(2)} / ${to.unit}</b></div>`;

    ensureRmbPanel();
    $('#swapRmbFair').textContent = `¥ ${formatMoney(fairRmb)}`;
    $('#swapRmbAccepted').textContent = `¥ ${formatMoney(clearingRmb)}`;
    $('#swapRmbTarget').textContent = `¥ ${targetUnitRmb.toFixed(2)} / ${to.unit}`;
    $('#swapRmbResult').textContent = receiveText;
    $('#swapRmbExample').textContent = `${(100000 / targetUnitRmb).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} ${to.unit}（未扣交割费）`;
    syncPriceGovernance();
    syncBilateralPreview(latestSwapPricing);
  }

  try { calculateSwap = calculateRmbSwap; } catch (_) { /* Existing handlers are rebound below. */ }
  ['swapFromProduct', 'swapToProduct', 'swapQuantity', 'swapDelivery', 'swapFromRegion', 'swapToRegion', 'swapTime', 'tokenProviderFrom', 'tokenProviderTo', 'tokenServiceTierFrom', 'tokenServiceTierTo', 'tokenContextFrom', 'tokenContextTo', 'tokenPriceTypeFrom', 'tokenPriceTypeTo', 'tokenValidityFrom', 'tokenValidityTo'].forEach(id => {
    const control = $(`#${id}`);
    if (!control) return;
    control.onchange = () => {
      if (['swapFromProduct', 'swapToProduct'].includes(id) && $('#bilateralTargetQty')) $('#bilateralTargetQty').dataset.touched = 'false';
      calculateRmbSwap();
    };
    if (id === 'swapQuantity') control.oninput = calculateRmbSwap;
  });
  ensureQuotePriceGovernance();
  ensureAgentGovernance();
  installServerPaymentGuard();
  const quoteForm = $('#quoteForm');
  if (quoteForm) {
    quoteForm.addEventListener('input', () => requestAnimationFrame(syncPriceGovernance));
    quoteForm.addEventListener('change', () => requestAnimationFrame(syncPriceGovernance));
  }
  calculateRmbSwap();
  requestAnimationFrame(syncPriceGovernance);
})();
