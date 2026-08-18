(() => {
  'use strict';

  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  // Generation 5 — global command center.
  const commandItems = [
    ['market', '算力市场', '浏览实时 GPU 供给与价格', '市'],
    ['vault', '我的算力库', '查看已购入并存入的资产', '库'],
    ['swap', '算力置换', 'GPU、TOKEN、柜月互相置换', '换'],
    ['quote', '智能报价', '按模型、厂商、地区和时段计价', '价'],
    ['sell', '出售算力', '评估并发布闲置算力', '售'],
    ['recommend', '推荐分享', '生成平台核心内容分享链接', '荐'],
    ['assessment', '供应商评估', '评估 GPU、TOKEN 与柜月人民币价值', '审']
  ];

  const commandTrigger = document.createElement('button');
  commandTrigger.className = 'command-trigger';
  commandTrigger.type = 'button';
  commandTrigger.setAttribute('aria-label', '打开快速导航');
  commandTrigger.innerHTML = '<span>快速导航</span><kbd>⌘ K</kbd>';
  topActions.prepend(commandTrigger);

  const commandDialog = document.createElement('dialog');
  commandDialog.className = 'command-dialog';
  commandDialog.setAttribute('aria-label', '快速导航');
  commandDialog.innerHTML = `
    <div class="command-search-wrap"><span>⌕</span><input type="search" placeholder="输入功能名称，例如：报价" aria-label="搜索功能"></div>
    <div class="command-list" role="listbox" aria-label="功能列表"></div>
    <div class="command-foot"><span>↑↓ 选择</span><span>Enter 前往</span><span>Esc 关闭</span></div>`;
  document.body.append(commandDialog);

  const commandInput = commandDialog.querySelector('input');
  const commandList = commandDialog.querySelector('.command-list');
  let selectedIndex = 0;

  function visibleOptions() {
    return [...commandList.querySelectorAll('.command-option:not([hidden])')];
  }

  function selectOption(index) {
    const options = visibleOptions();
    if (!options.length) return;
    selectedIndex = (index + options.length) % options.length;
    options.forEach((option, itemIndex) => {
      const active = itemIndex === selectedIndex;
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-selected', String(active));
    });
    options[selectedIndex].scrollIntoView({ block: 'nearest' });
  }

  function renderCommands(query = '') {
    const normalized = query.trim().toLowerCase();
    const matches = commandItems.filter(item => `${item[1]} ${item[2]} ${item[0]}`.toLowerCase().includes(normalized));
    commandList.innerHTML = matches.length ? matches.map((item, index) => `
      <button class="command-option${index === 0 ? ' is-selected' : ''}" type="button" role="option" aria-selected="${index === 0}" data-command-view="${item[0]}">
        <i>${item[3]}</i><span><b>${item[1]}</b><small>${item[2]}</small></span><span>↵</span>
      </button>`).join('') : '<div class="command-empty">没有匹配的功能</div>';
    selectedIndex = 0;
  }

  function openCommands() {
    renderCommands();
    commandDialog.showModal();
    requestAnimationFrame(() => commandInput.focus());
  }

  function runCommand(view) {
    commandDialog.close();
    if (view === 'assessment') document.querySelector('[data-view="assessment"]')?.click();
    else if (typeof jump === 'function') jump(view);
    else document.querySelector(`[data-view="${view}"]`)?.click();
  }

  renderCommands();
  commandTrigger.addEventListener('click', openCommands);
  commandInput.addEventListener('input', event => renderCommands(event.target.value));
  commandList.addEventListener('mousemove', event => {
    const option = event.target.closest('.command-option');
    if (!option) return;
    selectOption(visibleOptions().indexOf(option));
  });
  commandList.addEventListener('click', event => {
    const option = event.target.closest('.command-option');
    if (option) runCommand(option.dataset.commandView);
  });
  commandDialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectOption(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
    }
    if (event.key === 'Enter' && document.activeElement === commandInput) {
      const option = visibleOptions()[selectedIndex];
      if (option) runCommand(option.dataset.commandView);
    }
  });
  commandDialog.addEventListener('click', event => {
    if (event.target === commandDialog) commandDialog.close();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      commandDialog.open ? commandDialog.close() : openCommands();
    }
  });
})();

(() => {
  'use strict';

  // Generation 9 — persistent mobile quote action dock.
  const total = document.querySelector('#totalPrice');
  const gpuSelect = document.querySelector('#gpuSelect');
  const buyButton = document.querySelector('#buyQuote');
  const shareButton = document.querySelector('#shareQuote');
  const quoteView = document.querySelector('#quoteView');
  if (!total || !gpuSelect || !buyButton || !shareButton || !quoteView) return;

  const dock = document.createElement('div');
  dock.className = 'mobile-trade-bar';
  dock.setAttribute('aria-label', '移动端报价操作');
  dock.innerHTML = `
    <div class="mobile-trade-value"><small>当前成交参考价</small><strong>¥ <span></span></strong></div>
    <button class="mobile-trade-share" type="button">分享</button>
    <button class="mobile-trade-buy" type="button">立即购入</button>`;
  document.body.append(dock);

  function syncDock() {
    dock.querySelector('.mobile-trade-value span').textContent = total.textContent.trim();
    dock.querySelector('.mobile-trade-buy').setAttribute('aria-label', `按 ${gpuSelect.selectedOptions[0]?.textContent || '当前'} 报价购入`);
  }

  function syncActiveView() {
    document.body.classList.toggle('quote-active', quoteView.classList.contains('active'));
  }

  dock.querySelector('.mobile-trade-share').addEventListener('click', () => shareButton.click());
  dock.querySelector('.mobile-trade-buy').addEventListener('click', () => buyButton.click());
  new MutationObserver(syncDock).observe(total, { childList: true, characterData: true, subtree: true });
  new MutationObserver(syncActiveView).observe(quoteView, { attributes: true, attributeFilter: ['class'] });
  gpuSelect.addEventListener('change', syncDock);
  syncDock();
  syncActiveView();
})();

(() => {
  'use strict';

  // Generation 8 — a complete, inspectable pricing formula.
  const factors = document.querySelector('#quoteFactors');
  const buyButton = document.querySelector('#buyQuote');
  if (!factors || !buyButton) return;

  const details = document.createElement('details');
  details.className = 'formula-details';
  details.innerHTML = `
    <summary>查看完整计价公式</summary>
    <div class="formula-body">
      <div class="formula-equation" aria-label="完整报价公式">
        <span>GPU 基准</span><i>×</i><span>地区</span><i>×</i><span>模型负载</span><i>×</i><span>精细分时</span><i>×</i><span>任务 / SLA</span><i>×</i><span>厂商履约</span><i>×</i><span>期限折扣</span>
      </div>
      <div class="formula-live" aria-live="polite"></div>
      <p class="formula-note">报价为可解释参考值。实际成交还需通过资源验收、库存锁定与支付确认。</p>
    </div>`;
  buyButton.insertAdjacentElement('beforebegin', details);
  const liveFormula = details.querySelector('.formula-live');

  function syncFormula() {
    const rows = [...factors.children].map(row => {
      const label = row.querySelector('span')?.textContent.trim();
      const value = row.querySelector('b')?.textContent.trim();
      return label && value ? `${label} ${value}` : '';
    }).filter(Boolean);
    liveFormula.textContent = rows.join('  ×  ');
  }

  new MutationObserver(syncFormula).observe(factors, { childList: true, characterData: true, subtree: true });
  syncFormula();
})();

(() => {
  'use strict';

  // Generation 7 — information density switch, remembered on this device.
  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;
  const densityButton = document.createElement('button');
  densityButton.type = 'button';
  densityButton.className = 'density-toggle';
  densityButton.setAttribute('aria-label', '切换信息密度');

  function loadCompactPreference() {
    try { return localStorage.getItem('kai-density') === 'compact'; }
    catch (_) { return false; }
  }

  function applyDensity(compact) {
    document.body.classList.toggle('compact-density', compact);
    densityButton.setAttribute('aria-pressed', String(compact));
    densityButton.innerHTML = compact ? '<i>▦</i><span>紧凑</span>' : '<i>▤</i><span>舒适</span>';
    densityButton.title = compact ? '切换为舒适布局' : '切换为紧凑布局';
    try { localStorage.setItem('kai-density', compact ? 'compact' : 'comfortable'); }
    catch (_) { /* Storage can be unavailable in private contexts. */ }
  }

  topActions.prepend(densityButton);
  applyDensity(loadCompactPreference());
  densityButton.addEventListener('click', () => applyDensity(!document.body.classList.contains('compact-density')));
})();

(() => {
  'use strict';

  // Generation 6 — comparable GPU alternatives inside intelligent quote.
  const quoteLayout = document.querySelector('#quoteView .quote-layout');
  const gpuSelect = document.querySelector('#gpuSelect');
  const unitPrice = document.querySelector('#unitPrice');
  const quoteForm = document.querySelector('#quoteForm');
  if (!quoteLayout || !gpuSelect || !unitPrice || !quoteForm) return;

  const rateIndex = {
    GB200: 38.6, B200: 32.8, H200: 18.8, H100: 14.9, H800: 12.6,
    A100: 9.82, A800: 8.9, L40S: 6.2, L20: 4.2, RTX5090: 4.5,
    RTX4090: 3.1, MI325X: 15.6, MI300X: 11.7, '910C': 12.4,
    '910B': 8.7, MLU590: 6.8, BR104: 7.5
  };
  const labels = {
    GB200: 'NVIDIA GB200 NVL72', B200: 'NVIDIA B200', H200: 'NVIDIA H200 141GB',
    H100: 'NVIDIA H100 80GB', H800: 'NVIDIA H800 80GB', A100: 'NVIDIA A100 80GB',
    A800: 'NVIDIA A800 80GB', L40S: 'NVIDIA L40S', L20: 'NVIDIA L20',
    RTX5090: 'NVIDIA RTX 5090', RTX4090: 'NVIDIA RTX 4090',
    MI325X: 'AMD MI325X', MI300X: 'AMD MI300X', '910C': '华为昇腾 910C',
    '910B': '华为昇腾 910B', MLU590: '寒武纪 MLU590', BR104: '壁仞 BR104'
  };
  const candidates = ['B200', 'H200', 'H100', 'MI325X', 'MI300X', '910C', '910B', 'L40S'];

  const rail = document.createElement('section');
  rail.className = 'compare-rail';
  rail.setAttribute('aria-label', 'GPU 替代方案');
  rail.innerHTML = `
    <div class="compare-head"><div><span class="eyebrow">ALTERNATIVE ROUTES</span><h3>同条件 GPU 替代方案</h3></div><span>相对估算 · 点击即可切换并重新计价</span></div>
    <div class="compare-grid"></div>`;
  quoteLayout.insertAdjacentElement('afterend', rail);
  const grid = rail.querySelector('.compare-grid');

  function getCurrentUnit() {
    const match = unitPrice.textContent.match(/[\d,.]+/);
    return match ? Number(match[0].replace(/,/g, '')) : 0;
  }

  function ensureGpuOption(key) {
    if ([...gpuSelect.options].some(option => option.value === key)) return;
    gpuSelect.add(new Option(labels[key] || key, key));
  }

  function renderAlternatives() {
    const current = gpuSelect.value;
    const currentRate = rateIndex[current] || 10;
    const currentUnit = getCurrentUnit();
    const alternatives = candidates.filter(key => key !== current).sort((a, b) => {
      return Math.abs(rateIndex[a] - currentRate) - Math.abs(rateIndex[b] - currentRate);
    }).slice(0, 3);

    grid.innerHTML = alternatives.map(key => {
      const estimate = currentUnit * (rateIndex[key] / currentRate);
      const change = ((estimate / Math.max(currentUnit, .01) - 1) * 100);
      return `<button class="compare-option" type="button" data-gpu-alternative="${key}">
        <b>${labels[key]}</b><strong>¥ ${estimate.toFixed(2)}</strong>
        <small>预估每 GPU 小时</small><em>${change >= 0 ? '+' : ''}${change.toFixed(1)}%</em>
      </button>`;
    }).join('');
  }

  rail.addEventListener('click', event => {
    const option = event.target.closest('[data-gpu-alternative]');
    if (!option) return;
    ensureGpuOption(option.dataset.gpuAlternative);
    gpuSelect.value = option.dataset.gpuAlternative;
    gpuSelect.dispatchEvent(new Event('change', { bubbles: true }));
    quoteLayout.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  quoteForm.addEventListener('input', () => requestAnimationFrame(renderAlternatives));
  quoteForm.addEventListener('change', () => requestAnimationFrame(renderAlternatives));
  new MutationObserver(renderAlternatives).observe(unitPrice, { childList: true, characterData: true, subtree: true });
  renderAlternatives();
})();
