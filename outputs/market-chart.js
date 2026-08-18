(() => {
  'use strict';

  const panel = document.querySelector('#marketChartPanel');
  if (!panel) return;

  const state = {
    kind: 'gpu', interval: '15m', product: '', region: 'chengdu', chartMode: 'candle',
    payload: null, renderedCandles: [], watchlist: [], loading: false, pendingReload: false, watchlistToken: 0,
    showMa: true, showVolume: true, zoom: 0,
  };
  const productSelect = document.querySelector('#marketProduct');
  const productSearch = document.querySelector('#marketProductSearch');
  const regionSelect = document.querySelector('#marketRegion');
  const watchlist = document.querySelector('#marketWatchlist');
  const chart = document.querySelector('#marketCandleChart');
  const tooltip = document.querySelector('#marketChartTooltip');
  const loading = document.querySelector('#marketChartLoading');
  const source = document.querySelector('#marketChartSource');
  const intervalHelp = document.querySelector('#marketIntervalHelp');
  const intervalLabels = { '5m': '5分钟', '15m': '15分钟', '1h': '1小时', '4h': '4小时', '1d': '1天', '1w': '1周', '1mo': '1个月' };
  const kindLabels = { gpu: 'GPU', token: 'Token', rack: '柜月', server: '服务器' };

  const price = value => {
    const digits = Math.abs(value) >= 1000 ? 0 : 2;
    return `¥ ${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  };
  const percent = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const direction = value => Math.abs(value) < .01 ? 'flat' : value > 0 ? 'up' : 'down';
  const chartPrice = value => Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  });
  const compactNumber = value => value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
      : Number(value).toFixed(value >= 100 ? 0 : 1);
  const timeLabel = (stamp, interval) => new Intl.DateTimeFormat('zh-CN', interval === '1mo'
    ? { year: 'numeric', month: '2-digit' }
    : ['1d', '1w'].includes(interval)
      ? { month: '2-digit', day: '2-digit' }
      : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
  ).format(new Date(stamp * 1000));
  const fullTimeLabel = stamp => new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(stamp * 1000)).replaceAll('/', '-');

  function movingAverage(rows, period, key = 'close') {
    let total = 0;
    return rows.map((row, index) => {
      total += Number(row[key] || 0);
      if (index >= period) total -= Number(rows[index - period][key] || 0);
      return index >= period - 1 ? total / period : null;
    });
  }

  function updateIntervalHelp() {
    if (!intervalHelp) return;
    const label = intervalLabels[state.interval] || state.interval;
    const duration = state.interval === '1mo' ? '连续 30 天' : `连续 ${label}`;
    const mark = state.chartMode === 'line' ? '每个均价点' : '每根蜡烛';
    const metric = state.chartMode === 'line' ? '区间收盘参考价' : '开盘价、最高价、最低价和收盘价';
    intervalHelp.innerHTML = `<b>怎么看：</b>“${label}”表示图中${mark}汇总${duration}内的${metric}；切换周期只改变报价聚合粒度，不是评分，也不是购买时长。`;
    document.querySelector('#marketChartPeriodLabel').textContent = `${label} K · 人民币`;
  }

  function setSelectOptions(select, rows, selected) {
    select.replaceChildren(...rows.map(row => {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = row.name;
      option.selected = row.id === selected;
      return option;
    }));
  }

  function populateOptions(options) {
    const products = options.products[state.kind] || [];
    if (!products.some(item => item.id === state.product)) state.product = products[0]?.id || '';
    setSelectOptions(productSelect, products, state.product);
    setSelectOptions(regionSelect, options.regions || [], state.region);
  }

  function candleSummary(payload) {
    const candles = payload.candles;
    const first = candles[0];
    const last = candles[candles.length - 1];
    const change = first?.open ? (last.close / first.open - 1) * 100 : 0;
    return {
      first, last, change,
      high: Math.max(...candles.map(item => item.high)),
      low: Math.min(...candles.map(item => item.low)),
      volume: candles.reduce((sum, item) => sum + item.volume, 0),
    };
  }

  function updateSummary(payload) {
    const summary = candleSummary(payload);
    const changeNode = document.querySelector('#marketChange');
    const selectedChange = summary.last.open ? (summary.last.close / summary.last.open - 1) * 100 : 0;
    const selectedRange = summary.last.open ? (summary.last.high - summary.last.low) / summary.last.open * 100 : 0;
    const ma7 = movingAverage(payload.candles, 7).at(-1);
    const ma25 = movingAverage(payload.candles, 25).at(-1);
    const ma99 = movingAverage(payload.candles, 99).at(-1);
    document.querySelector('#marketDetailName').textContent = payload.product.name;
    document.querySelector('#marketDetailMeta').textContent = `${kindLabels[payload.kind]} · ${payload.region.name} · ${intervalLabels[payload.interval] || payload.interval}`;
    document.querySelector('#marketLastPrice').textContent = price(summary.last.close);
    document.querySelector('#marketDetailUnit').textContent = payload.product.unit;
    changeNode.textContent = percent(summary.change);
    changeNode.dataset.direction = direction(summary.change);
    document.querySelector('#marketOpenPrice').textContent = price(summary.first.open);
    document.querySelector('#marketHigh').textContent = price(summary.high);
    document.querySelector('#marketLow').textContent = price(summary.low);
    document.querySelector('#marketVolume').textContent = Math.round(summary.volume).toLocaleString('zh-CN');
    document.querySelector('#marketLayerReference').textContent = price(summary.last.close);
    document.querySelector('#marketLayerSupplier').textContent = `${price(summary.low)} – ${price(summary.high)}`;
    document.querySelector('#marketChartNotice').textContent = payload.notice;
    document.querySelector('#marketChartTimestamp').textContent = fullTimeLabel(summary.last.time);
    document.querySelector('#marketChartOpen').textContent = chartPrice(summary.last.open);
    document.querySelector('#marketChartHigh').textContent = chartPrice(summary.last.high);
    document.querySelector('#marketChartLow').textContent = chartPrice(summary.last.low);
    document.querySelector('#marketChartClose').textContent = chartPrice(summary.last.close);
    document.querySelector('#marketChartChange').textContent = percent(selectedChange);
    document.querySelector('#marketChartRange').textContent = `${selectedRange.toFixed(2)}%`;
    document.querySelectorAll('#marketChartOpen,#marketChartHigh,#marketChartLow,#marketChartClose,#marketChartChange,#marketChartRange').forEach(node => {
      node.dataset.direction = direction(selectedChange);
    });
    document.querySelector('#marketMa7').textContent = ma7 == null ? '—' : chartPrice(ma7);
    document.querySelector('#marketMa25').textContent = ma25 == null ? '—' : chartPrice(ma25);
    document.querySelector('#marketMa99').textContent = ma99 == null ? '—' : chartPrice(ma99);
    document.querySelector('#marketUpdatedAt').textContent = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(payload.updated_at));
    const sourceLabels = {
      verified_listing: '已验真挂牌 · 参考盘',
      vast_official_api: 'Vast.ai 官方 API · 参考盘',
      authorized_feed: '授权行情源 · 参考盘',
      platform_reference: '平台参考盘 · 非成交',
    };
    source.textContent = sourceLabels[payload.source] || '行情参考盘 · 非成交';
    source.dataset.source = payload.source;
  }

  function chartRange(candles) {
    const lows = candles.map(item => item.low);
    const highs = candles.map(item => item.high);
    let min = Math.min(...lows), max = Math.max(...highs);
    const padding = Math.max((max - min) * .08, max * .001);
    min -= padding;
    max += padding;
    return { min, max };
  }

  function chartGrid({ width, left, right, top, bottom, min, max }) {
    const parts = [];
    for (let index = 0; index <= 5; index += 1) {
      const value = max - (max - min) * index / 5;
      const rowY = top + (bottom - top) * index / 5;
      parts.push(`<line class="market-grid-line" x1="${left}" y1="${rowY}" x2="${width - right}" y2="${rowY}"/>`);
      parts.push(`<text class="market-axis-label" x="${width - 8}" y="${rowY + 4}" text-anchor="end">${chartPrice(value)}</text>`);
    }
    for (let index = 0; index <= 4; index += 1) {
      const columnX = left + (width - right - left) * index / 4;
      parts.push(`<line class="market-grid-line market-grid-vertical" x1="${columnX}" y1="${top}" x2="${columnX}" y2="${bottom}"/>`);
    }
    return parts;
  }

  function seriesPath(values, x, y) {
    let started = false;
    return values.map((value, index) => {
      if (value == null) return '';
      const command = started ? 'L' : 'M';
      started = true;
      return `${command} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    }).filter(Boolean).join(' ');
  }

  function visibleCandles(payload) {
    const target = Math.max(24, 60 - state.zoom * 12);
    return payload.candles.slice(-Math.min(payload.candles.length, target));
  }

  function renderLineChart(payload) {
    const candles = visibleCandles(payload);
    state.renderedCandles = candles;
    const width = 960, left = 0, right = 74, top = 18, bottom = 400;
    const plotWidth = width - left - right;
    const { min, max } = chartRange(candles);
    const y = value => top + (max - value) / (max - min || 1) * (bottom - top);
    const step = plotWidth / Math.max(1, candles.length - 1);
    const points = candles.map((candle, index) => ({ x: left + step * index, y: y(candle.close), candle }));
    const rising = candles.at(-1).close >= candles[0].open;
    const colorClass = rising ? 'rise' : 'fall';
    const parts = [
      '<defs>',
      '<linearGradient id="marketAreaRise" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0ecb81" stop-opacity=".20"/><stop offset="1" stop-color="#0ecb81" stop-opacity="0"/></linearGradient>',
      '<linearGradient id="marketAreaFall" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f6465d" stop-opacity=".20"/><stop offset="1" stop-color="#f6465d" stop-opacity="0"/></linearGradient>',
      '</defs>',
      ...chartGrid({ width, left, right, top, bottom, min, max }),
      `<text class="market-chart-watermark" x="${(width - right) / 2}" y="225" text-anchor="middle">CLOUDPAY</text>`,
    ];
    const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L ${points.at(-1).x.toFixed(2)} ${bottom} L ${points[0].x.toFixed(2)} ${bottom} Z`;
    parts.push(`<path class="market-line-area ${colorClass}" d="${areaPath}"/>`);
    parts.push(`<path class="market-line ${colorClass}" d="${linePath}"/>`);
    const markerEvery = Math.max(1, Math.floor(candles.length / 18));
    points.forEach((point, index) => {
      if (index % markerEvery === 0 || index === points.length - 1) {
        parts.push(`<circle class="market-line-point ${colorClass}" cx="${point.x}" cy="${point.y}" r="3.4"/>`);
      }
      if (index % Math.max(1, Math.floor(candles.length / 5)) === 0 || index === candles.length - 1) {
        parts.push(`<text class="market-time-label" x="${point.x}" y="432" text-anchor="middle">${timeLabel(point.candle.time, payload.interval)}</text>`);
      }
    });
    const latest = points.at(-1);
    parts.push(`<line class="market-latest-line ${colorClass}" x1="${left}" y1="${latest.y}" x2="${width - right}" y2="${latest.y}"/>`);
    parts.push(`<rect class="market-latest-label ${colorClass}" x="${width - right + 2}" y="${latest.y - 11}" width="72" height="22" rx="2"/>`);
    parts.push(`<text class="market-latest-label-text" x="${width - right + 38}" y="${latest.y + 4}" text-anchor="middle">${chartPrice(latest.candle.close)}</text>`);
    chart.innerHTML = parts.join('');
    chart.setAttribute('aria-label', `${payload.region.name} ${payload.product.name} ${payload.interval} 均价趋势，共 ${candles.length} 个聚合点`);
  }

  function renderCandleChart(payload) {
    const candles = visibleCandles(payload);
    state.renderedCandles = candles;
    const width = 960, left = 0, right = 74, top = 12, priceBottom = 300, volumeLegendY = 322, volumeTop = 338, volumeBottom = 405, timeY = 432;
    const plotWidth = width - left - right;
    const { min, max } = chartRange(candles);
    const y = value => top + (max - value) / (max - min || 1) * (priceBottom - top);
    const step = plotWidth / candles.length;
    const bodyWidth = Math.max(2, Math.min(9, step * .58));
    const maxVolume = Math.max(...candles.map(item => item.volume));
    const volumeY = value => volumeBottom - value / (maxVolume || 1) * (volumeBottom - volumeTop);
    const offset = payload.candles.length - candles.length;
    const ma7 = movingAverage(payload.candles, 7).slice(offset);
    const ma25 = movingAverage(payload.candles, 25).slice(offset);
    const ma99 = movingAverage(payload.candles, 99).slice(offset);
    const volumeMa5 = movingAverage(payload.candles, 5, 'volume').slice(offset);
    const volumeMa10 = movingAverage(payload.candles, 10, 'volume').slice(offset);
    const x = index => left + step * index + step / 2;
    const parts = chartGrid({ width, left, right, top, bottom: priceBottom, min, max });
    parts.push(`<text class="market-chart-watermark" x="${(width - right) / 2}" y="176" text-anchor="middle">CLOUDPAY</text>`);
    candles.forEach((candle, index) => {
      const centerX = x(index);
      const colorClass = candle.close >= candle.open ? 'rise' : 'fall';
      const openY = y(candle.open), closeY = y(candle.close);
      const bodyY = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.6, Math.abs(openY - closeY));
      const volumeHeight = Math.max(1, candle.volume / maxVolume * (volumeBottom - volumeTop));
      parts.push(`<line class="market-wick ${colorClass}" x1="${centerX}" y1="${y(candle.high)}" x2="${centerX}" y2="${y(candle.low)}"/>`);
      parts.push(`<rect class="market-candle ${colorClass}" x="${centerX - bodyWidth / 2}" y="${bodyY}" width="${bodyWidth}" height="${bodyHeight}"/>`);
      if (state.showVolume) parts.push(`<rect class="market-volume ${colorClass}" x="${centerX - bodyWidth / 2}" y="${volumeBottom - volumeHeight}" width="${bodyWidth}" height="${volumeHeight}"/>`);
      if (index % Math.max(1, Math.floor(candles.length / 5)) === 0 || index === candles.length - 1) {
        parts.push(`<text class="market-time-label" x="${centerX}" y="${timeY}" text-anchor="middle">${timeLabel(candle.time, payload.interval)}</text>`);
      }
    });
    if (state.showMa) {
      [[ma7, 'ma7'], [ma25, 'ma25'], [ma99, 'ma99']].forEach(([values, name]) => {
        const path = seriesPath(values, x, y);
        if (path) parts.push(`<path class="market-ma-line ${name}" d="${path}"/>`);
      });
    }
    const highestIndex = candles.reduce((best, candle, index) => candle.high > candles[best].high ? index : best, 0);
    const lowestIndex = candles.reduce((best, candle, index) => candle.low < candles[best].low ? index : best, 0);
    parts.push(`<text class="market-extreme-label" x="${x(highestIndex)}" y="${Math.max(12, y(candles[highestIndex].high) - 7)}" text-anchor="middle">${chartPrice(candles[highestIndex].high)}</text>`);
    parts.push(`<text class="market-extreme-label" x="${x(lowestIndex)}" y="${Math.min(priceBottom - 2, y(candles[lowestIndex].low) + 14)}" text-anchor="middle">${chartPrice(candles[lowestIndex].low)}</text>`);
    if (state.showVolume) {
      parts.push(`<line class="market-divider" x1="${left}" y1="312" x2="${width}" y2="312"/>`);
      const lastIndex = candles.length - 1;
      parts.push(`<text class="market-volume-label" x="14" y="${volumeLegendY}">VOL ${compactNumber(candles[lastIndex].volume)}</text>`);
      if (volumeMa5[lastIndex] != null) parts.push(`<text class="market-volume-label volume-ma5" x="108" y="${volumeLegendY}">MA(5) ${compactNumber(volumeMa5[lastIndex])}</text>`);
      if (volumeMa10[lastIndex] != null) parts.push(`<text class="market-volume-label volume-ma10" x="226" y="${volumeLegendY}">MA(10) ${compactNumber(volumeMa10[lastIndex])}</text>`);
      const volumePath5 = seriesPath(volumeMa5, x, volumeY);
      const volumePath10 = seriesPath(volumeMa10, x, volumeY);
      if (volumePath5) parts.push(`<path class="market-volume-ma volume-ma5" d="${volumePath5}"/>`);
      if (volumePath10) parts.push(`<path class="market-volume-ma volume-ma10" d="${volumePath10}"/>`);
      [1, .5].forEach(ratio => parts.push(`<text class="market-axis-label" x="${width - 8}" y="${volumeY(maxVolume * ratio) + 4}" text-anchor="end">${compactNumber(maxVolume * ratio)}</text>`));
    }
    const latest = candles.at(-1);
    const latestY = y(latest.close);
    const latestClass = latest.close >= latest.open ? 'rise' : 'fall';
    parts.push(`<line class="market-latest-line ${latestClass}" x1="${left}" y1="${latestY}" x2="${width - right}" y2="${latestY}"/>`);
    parts.push(`<rect class="market-latest-label ${latestClass}" x="${width - right + 2}" y="${latestY - 11}" width="72" height="22" rx="2"/>`);
    parts.push(`<text class="market-latest-label-text" x="${width - right + 38}" y="${latestY + 4}" text-anchor="middle">${chartPrice(latest.close)}</text>`);
    chart.innerHTML = parts.join('');
    chart.setAttribute('aria-label', `${payload.region.name} ${payload.product.name} ${payload.interval} 蜡烛 K 线，共 ${candles.length} 根`);
  }

  function renderChart(payload) {
    if (!payload.candles.length) return;
    panel.dataset.chartMode = state.chartMode;
    if (state.chartMode === 'line') renderLineChart(payload);
    else renderCandleChart(payload);
  }

  function renderWatchlist() {
    const keyword = productSearch.value.trim().toLocaleLowerCase('zh-CN');
    const rows = state.watchlist.filter(item => !keyword
      || item.product.name.toLocaleLowerCase('zh-CN').includes(keyword)
      || item.product.id.toLocaleLowerCase('zh-CN').includes(keyword));
    document.querySelector('#marketWatchlistCount').textContent = `共 ${rows.length} 个结果`;
    if (!rows.length) {
      watchlist.innerHTML = '<div class="market-watchlist-loading">没有符合条件的产品</div>';
      return;
    }
    watchlist.replaceChildren(...rows.map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `market-watch-row${item.product.id === state.product ? ' active' : ''}`;
      button.dataset.marketProduct = item.product.id;
      button.setAttribute('aria-pressed', String(item.product.id === state.product));
      const product = document.createElement('span');
      const productName = document.createElement('b');
      const productMeta = document.createElement('small');
      productName.textContent = item.product.name;
      productMeta.textContent = item.product.unit;
      product.append(productName, productMeta);
      const quote = document.createElement('span');
      const latest = document.createElement('strong');
      const change = document.createElement('em');
      latest.textContent = price(item.latest);
      change.textContent = percent(item.change);
      change.dataset.direction = direction(item.change);
      quote.append(latest, change);
      button.append(product, quote);
      return button;
    }));
  }

  function updateOverview() {
    const changes = state.watchlist.map(item => item.change);
    document.querySelector('#marketOverviewTotal').textContent = changes.length.toLocaleString('zh-CN');
    document.querySelector('#marketOverviewUp').textContent = changes.filter(value => direction(value) === 'up').length.toLocaleString('zh-CN');
    document.querySelector('#marketOverviewDown').textContent = changes.filter(value => direction(value) === 'down').length.toLocaleString('zh-CN');
    document.querySelector('#marketOverviewFlat').textContent = changes.filter(value => direction(value) === 'flat').length.toLocaleString('zh-CN');
  }

  async function loadWatchlist(payload) {
    const token = ++state.watchlistToken;
    const products = payload.options.products[state.kind] || [];
    watchlist.innerHTML = '<div class="market-watchlist-loading">正在聚合当前分类报价…</div>';
    const snapshots = await Promise.all(products.map(async product => {
      if (product.id === payload.product.id) return payload;
      const query = new URLSearchParams({
        kind: state.kind, product: product.id, region: state.region, interval: state.interval, limit: '48',
      });
      try {
        const response = await fetch(`/api/market/candles?${query}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return null;
        return response.json();
      } catch (_error) {
        return null;
      }
    }));
    if (token !== state.watchlistToken) return;
    state.watchlist = snapshots.filter(Boolean).map(item => {
      const summary = candleSummary(item);
      return { product: item.product, latest: summary.last.close, change: summary.change };
    });
    updateOverview();
    renderWatchlist();
  }

  function showTooltip(event) {
    const payload = state.payload;
    const candles = state.renderedCandles;
    if (!payload?.candles?.length || !candles.length) return;
    const bounds = chart.getBoundingClientRect();
    const normalizedX = (event.clientX - bounds.left) / bounds.width * 960;
    const index = Math.max(0, Math.min(candles.length - 1,
      Math.floor(normalizedX / 886 * candles.length)));
    const candle = candles[index];
    tooltip.textContent = `${timeLabel(candle.time, payload.interval)}  开 ${price(candle.open)}  高 ${price(candle.high)}  低 ${price(candle.low)}  收 ${price(candle.close)}`;
    tooltip.hidden = false;
    const panelBounds = panel.getBoundingClientRect();
    tooltip.style.left = `${Math.min(panelBounds.width - tooltip.offsetWidth - 18, Math.max(18, event.clientX - panelBounds.left + 12))}px`;
    tooltip.style.top = `${Math.max(150, event.clientY - panelBounds.top - 42)}px`;
    chart.querySelectorAll('.market-crosshair').forEach(node => node.remove());
    const namespace = 'http://www.w3.org/2000/svg';
    const vertical = document.createElementNS(namespace, 'line');
    const horizontal = document.createElementNS(namespace, 'line');
    const { min, max } = chartRange(candles);
    const top = state.chartMode === 'candle' ? 12 : 18;
    const bottom = state.chartMode === 'candle' ? 405 : 400;
    const closeY = top + (max - candle.close) / (max - min || 1) * ((state.chartMode === 'candle' ? 300 : 400) - top);
    const candleX = (index + .5) / candles.length * 886;
    vertical.setAttribute('class', 'market-crosshair');
    vertical.setAttribute('x1', String(candleX));
    vertical.setAttribute('x2', String(candleX));
    vertical.setAttribute('y1', String(top));
    vertical.setAttribute('y2', String(bottom));
    horizontal.setAttribute('class', 'market-crosshair');
    horizontal.setAttribute('x1', '0');
    horizontal.setAttribute('x2', '886');
    horizontal.setAttribute('y1', String(closeY));
    horizontal.setAttribute('y2', String(closeY));
    chart.append(vertical, horizontal);
  }

  async function loadChart() {
    if (state.loading) {
      state.pendingReload = true;
      return;
    }
    state.loading = true;
    const initialLoad = !state.payload;
    loading.hidden = !initialLoad;
    if (initialLoad) loading.textContent = '正在读取报价流…';
    else source.textContent = '更新报价中…';
    try {
      const query = new URLSearchParams({ kind: state.kind, region: state.region, interval: state.interval, limit: '120' });
      if (state.product) query.set('product', state.product);
      const response = await fetch(`/api/market/candles?${query}`, { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || '行情读取失败');
      state.payload = payload;
      panel.dataset.kind = payload.kind;
      populateOptions(payload.options);
      if (payload.product.id !== state.product) {
        state.product = payload.product.id;
        productSelect.value = state.product;
      }
      updateSummary(payload);
      renderChart(payload);
      loading.hidden = true;
      void loadWatchlist(payload);
    } catch (error) {
      loading.hidden = !initialLoad;
      if (initialLoad) loading.textContent = `${error.message}，请稍后刷新`;
      source.textContent = '报价流暂不可用';
    } finally {
      state.loading = false;
      if (state.pendingReload) {
        state.pendingReload = false;
        void loadChart();
      }
    }
  }

  document.querySelectorAll('[data-market-kind]').forEach(button => button.addEventListener('click', () => {
    state.kind = button.dataset.marketKind;
    state.product = '';
    state.watchlist = [];
    productSearch.value = '';
    document.querySelectorAll('[data-market-kind]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    void loadChart();
  }));
  document.querySelectorAll('[data-market-interval]').forEach(button => button.addEventListener('click', () => {
    state.interval = button.dataset.marketInterval;
    document.querySelectorAll('[data-market-interval]').forEach(item => item.classList.toggle('active', item === button));
    state.chartMode = 'candle';
    document.querySelectorAll('[data-market-chart-mode]').forEach(item => item.classList.toggle('active', item.dataset.marketChartMode === 'candle'));
    updateIntervalHelp();
    void loadChart();
  }));
  document.querySelectorAll('[data-market-chart-mode]').forEach(button => button.addEventListener('click', () => {
    state.chartMode = button.dataset.marketChartMode;
    document.querySelectorAll('[data-market-chart-mode]').forEach(item => item.classList.toggle('active', item === button));
    updateIntervalHelp();
    if (state.payload) renderChart(state.payload);
  }));
  document.querySelectorAll('[data-market-zoom]').forEach(button => button.addEventListener('click', () => {
    state.zoom = button.dataset.marketZoom === 'in' ? Math.min(3, state.zoom + 1) : Math.max(-1, state.zoom - 1);
    if (state.payload) renderChart(state.payload);
  }));
  document.querySelectorAll('[data-market-indicator]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.marketIndicator === 'ma') state.showMa = !state.showMa;
    if (button.dataset.marketIndicator === 'volume') state.showVolume = !state.showVolume;
    button.classList.toggle('active', button.dataset.marketIndicator === 'ma' ? state.showMa : state.showVolume);
    if (state.payload) renderChart(state.payload);
  }));
  productSelect.addEventListener('change', () => { state.product = productSelect.value; void loadChart(); });
  productSearch.addEventListener('input', renderWatchlist);
  regionSelect.addEventListener('change', () => { state.region = regionSelect.value; void loadChart(); });
  watchlist.addEventListener('click', event => {
    const button = event.target.closest('[data-market-product]');
    if (!button || button.dataset.marketProduct === state.product) return;
    state.product = button.dataset.marketProduct;
    productSelect.value = state.product;
    void loadChart();
  });
  document.querySelector('#refreshMarketChart').addEventListener('click', () => loadChart());
  document.querySelector('#showMarketChart').addEventListener('click', () => panel.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'
  }));
  chart.addEventListener('pointermove', showTooltip);
  chart.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
    chart.querySelectorAll('.market-crosshair').forEach(node => node.remove());
  });
  window.setInterval(() => { if (!document.hidden) void loadChart(); }, 15000);
  updateIntervalHelp();
  void loadChart();
})();
