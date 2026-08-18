(() => {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const requestId = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const kindLabels = { gpu: 'GPU ç®å', tokencap: 'Token å®¹éæ¶', tokenusage: 'ç¾ä¸ Token å®éç¨é', rack: 'ææ' };
  let csrf = '';
  let currentUser = null;
  let assets = [];
  let catalog = [];
  let swaps = [];

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if ((options.method || 'GET') !== 'GET' && csrf) headers.set('X-KAI-CSRF', csrf);
    const response = await fetch(path, {
      method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `æå¡è¯·æ±å¤±è´¥ï¼${response.status}ï¼`);
    if (payload.csrf_token) csrf = payload.csrf_token;
    return payload;
  }

  function notify(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  function installLegalLinks() {
    const consent = document.querySelector('#registerAgree')?.nextElementSibling;
    if (consent) consent.innerHTML = 'æå·²éè¯»å¹¶åæ <a href="/terms.html" target="_blank" rel="noopener">ãç¨æ·åè®®ã</a> å <a href="/privacy.html" target="_blank" rel="noopener">ãéç§æ¿ç­ã</a>';
  }

  async function nativeShare(data, fallback) {
    try {
      if (await window.KAINative?.share?.(data)) return;
      await fallback();
      notify('å½åç¯å¢ä¸æ¯æç³»ç»åäº«ï¼å·²å¤å¶é¾æ¥');
    } catch (error) {
      if (error?.name === 'AbortError' || /cancel/i.test(error?.message || '')) return;
      await fallback();
      notify('ç³»ç»åäº«ä¸å¯ç¨ï¼å·²å¤å¶é¾æ¥');
    }
  }

  function installNativeShare() {
    window.safeSystemShare = nativeShare;
    const recommend = document.querySelector('#systemRecommend');
    if (recommend) recommend.onclick = () => nativeShare({ title: 'KAI Cloud', text: 'ä¼ä¸ç®åæ®åãäº¤ä»ä¸å®¹éè´¦æ¬ã', url: document.querySelector('#recommendLink')?.value || location.href }, window.copyRecommend);
    const quote = document.querySelector('#nativeShare');
    if (quote) quote.onclick = () => nativeShare({ title: 'KAI ç®åæ¥ä»·', text: document.querySelector('#shareSummary')?.textContent || '', url: document.querySelector('#shareLink')?.value || location.href }, window.copyShare);
  }

  function ensureAccountCenter() {
    if (document.querySelector('#accountView')) return;
    const nav = document.querySelector('.nav');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.type = 'button';
    button.dataset.view = 'account';
    button.innerHTML = '<span>â</span>è´¦æ·ä¸åè§';
    nav?.append(button);

    const view = document.createElement('section');
    view.className = 'view app-account-view';
    view.id = 'accountView';
    view.innerHTML = `
      <div class="page-title"><div><span class="eyebrow">ACCOUNT & COMPLIANCE</span><h1>è´¦æ·ä¸åè§</h1><p>ç®¡çç»å½å®å¨ãä¼ä¸èº«ä»½ãåè®®ãéç§ä¸è´¦æ·æ³¨éï¼ææç¶æåä»æå¡ç«¯è¯»åã</p></div><span class="model-count" id="appRuntimeBadge">Web</span></div>
      <section class="app-account-grid">
        <article class="app-account-card"><small>å½åè´¦æ·</small><h2 id="closureAccountName">æªç»å½</h2><p id="closureAccountMeta">ç»å½åå¯æ¥è¯¢è®¢åãèµäº§ãç½®æ¢åæ³¨éç¶æã</p><button class="primary" id="closureLogin" type="button">ç»å½ / æ³¨å</button></article>
        <article class="app-account-card"><small>å¬å¼è§å</small><h2>åè®®ä¸éç§</h2><p>æ³¨åãæ¯ä»ãè®¡éãéæ¬¾ãæ°æ®ä¿çåä¾åºåä¿¡æ¯è¾¹çåæä¾ç¬ç«è¯´æã</p><div class="app-link-row"><a href="/terms.html" target="_blank">ç¨æ·åè®®</a><a href="/privacy.html" target="_blank">éç§æ¿ç­</a><a href="/account-deletion.html" target="_blank">æ³¨éè¯´æ</a></div></article>
      </section>
      <section class="panel app-deletion-panel"><div class="panel-head"><div><span class="eyebrow">ACCOUNT DELETION</span><h2>ç³è¯·æ³¨éè´¦æ·</h2></div><b id="deletionState">æªç³è¯·</b></div>
        <p>æ³¨éä¼åæ­¢æ°çäº¤ææéãè®¢åãæ¯ä»ãè®¡éãåç¥¨ãç»ç®åå®¡è®¡è®°å½å¨æ³å®æååä¿çæåä¸ä¼è¢«å é¤ï¼ä½è´¦æ·èº«ä»½ä¼å¨ä¹å¡å®æåå¿ååã</p>
        <div class="app-deletion-form"><label>ç¡®è®¤å½åå¯ç <input id="deletionPassword" type="password" autocomplete="current-password"></label><label>æ³¨éåå <textarea id="deletionReason" rows="3">ç¨æ·ä¸»å¨ç³è¯·åæ­¢ä½¿ç¨ KAI Cloud</textarea></label><button class="danger" id="requestDeletion" type="button">æäº¤æ³¨éç³è¯·</button><button class="secondary" id="cancelDeletion" type="button" hidden>æ¤éæ³¨éç³è¯·</button></div>
        <p class="app-form-state" id="deletionMessage" role="status"></p>
      </section>
      <section class="panel app-release-panel" id="appReleasePanel" hidden><div class="panel-head"><div><span class="eyebrow">RELEASE CONTROL</span><h2>App åå¸èªæ£</h2></div><button class="secondary" id="refreshRelease" type="button">éæ°æ£æ¥</button></div><div id="releaseChecklist"></div><div id="adminClosureQueue"></div></section>`;
    document.querySelector('main')?.append(view);
    button.addEventListener('click', showAccountCenter);
    document.querySelector('#menuProfile').onclick = showAccountCenter;
    document.querySelector('#closureLogin').addEventListener('click', () => window.openAuth?.('login'));
    document.querySelector('#requestDeletion').addEventListener('click', requestDeletion);
    document.querySelector('#cancelDeletion').addEventListener('click', cancelDeletion);
    document.querySelector('#refreshRelease').addEventListener('click', loadReleaseReadiness);
  }

  async function showAccountCenter() {
    document.querySelector('#accountMenu')?.classList.remove('show');
    window.jump?.('account');
    const crumb = document.querySelector('#crumb');
    if (crumb) crumb.textContent = 'è´¦æ·ä¸åè§';
    const info = await window.KAINative?.appInfo?.().catch(() => ({ version: 'web' }));
    document.querySelector('#appRuntimeBadge').textContent = window.KAINative?.native ? `App ${info?.version || ''}` : 'Web / PWA';
    await syncAccountCenter();
  }

  async function syncIdentity() {
    const me = await api('/api/auth/me');
    const accountButton = document.querySelector('.account');
    if (!me.authenticated) {
      currentUser = null;
      csrf = '';
      if (accountButton) {
        accountButton.setAttribute('aria-label', 'ç»å½ææ³¨å');
        accountButton.querySelector(':scope > span').textContent = 'ç»å½';
      }
      return null;
    }
    currentUser = me.user;
    csrf = me.csrf_token || csrf;
    if (accountButton) {
      accountButton.setAttribute('aria-label', `è´¦æ·ï¼${currentUser.name}`);
      accountButton.querySelector(':scope > span').textContent = String(currentUser.name || 'KAI').slice(0, 2).toUpperCase();
    }
    return currentUser;
  }

  async function syncAccountCenter() {
    try {
      await syncIdentity();
      const name = document.querySelector('#closureAccountName');
      const meta = document.querySelector('#closureAccountMeta');
      const login = document.querySelector('#closureLogin');
      if (!currentUser) {
        name.textContent = 'æªç»å½'; meta.textContent = 'ç»å½åå¯æ¥è¯¢è®¢åãèµäº§ãç½®æ¢åæ³¨éç¶æã'; login.hidden = false;
        document.querySelector('#appReleasePanel').hidden = true;
        return;
      }
      name.textContent = currentUser.name;
      meta.textContent = `${currentUser.account} Â· ${currentUser.role} Â· ä¼ä¸ç¶æ ${currentUser.enterprise_status}`;
      login.hidden = true;
      const deletion = await api('/api/account/deletion-status');
      renderDeletion(deletion.request);
      const admin = currentUser.role === 'admin';
      document.querySelector('#appReleasePanel').hidden = !admin;
      if (admin) await loadReleaseReadiness();
    } catch (error) {
      document.querySelector('#deletionMessage').textContent = error.message;
    }
  }

  function renderDeletion(request) {
    const labels = { pending_obligations: 'ç­å¾äº¤æä¹å¡å®æ', scheduled: 'å·²è¿å¥æ³¨éææ', completed: 'å·²å®æå¿åå', cancelled: 'å·²æ¤é' };
    document.querySelector('#deletionState').textContent = request ? (labels[request.status] || request.status) : 'æªç³è¯·';
    document.querySelector('#deletionMessage').textContent = request ? `${request.retention_summary || ''}${request.scheduled_for ? ` é¢è®¡å¤çï¼${request.scheduled_for.replace('T', ' ').slice(0, 19)}` : ''}` : '';
    const cancellable = ['pending_obligations', 'scheduled'].includes(request?.status);
    document.querySelector('#cancelDeletion').hidden = !cancellable;
    document.querySelector('#requestDeletion').disabled = cancellable;
  }

  async function requestDeletion() {
    if (!currentUser && !(await syncIdentity())) return window.openAuth?.('login');
    const password = document.querySelector('#deletionPassword').value;
    const reason = document.querySelector('#deletionReason').value.trim();
    if (!password) return document.querySelector('#deletionMessage').textContent = 'è¯·è¾å¥å½åå¯ç ç¡®è®¤æ¬äººæä½ã';
    const button = document.querySelector('#requestDeletion');
    button.disabled = true;
    try {
      const result = await api('/api/account/deletion-request', { method: 'POST', body: { password, reason } });
      renderDeletion(result.request);
      document.querySelector('#deletionPassword').value = '';
      notify('æ³¨éç³è¯·å·²è¿å¥æå¡ç«¯æµç¨');
    } catch (error) {
      document.querySelector('#deletionMessage').textContent = error.message;
      button.disabled = false;
    }
  }

  async function cancelDeletion() {
    try {
      await api('/api/account/deletion-cancel', { method: 'POST', body: {} });
      renderDeletion(null);
      notify('æ³¨éç³è¯·å·²æ¤é');
    } catch (error) { document.querySelector('#deletionMessage').textContent = error.message; }
  }

  async function loadReleaseReadiness() {
    try {
      const [release, overview, catalogResult] = await Promise.all([api('/api/app/release-readiness'), api('/api/admin/overview'), api('/api/catalog')]);
      catalog = catalogResult.listings || [];
      const checks = release.release.checks || {};
      document.querySelector('#releaseChecklist').innerHTML = `<div class="release-summary" data-ready="${release.release.ready}"><b>${release.release.ready ? 'åå¸å­è¯å·²é½å¤' : `ä»æ ${release.release.blockers.length} é¡¹é»æ­`}</b><span>${escapeHtml(release.release.ios_bundle_id)} Â· ${escapeHtml(release.release.android_package_id)}</span></div><div class="release-check-grid">${Object.entries(checks).map(([label, ready]) => `<div data-ready="${ready}"><i>${ready ? 'â' : '!'}</i><span>${escapeHtml(label)}</span><b>${ready ? 'å·²éç½®' : 'å¾æä¾'}</b></div>`).join('')}</div>`;
      renderAdminQueues(overview);
    } catch (error) { document.querySelector('#releaseChecklist').innerHTML = `<p class="app-form-state">${escapeHtml(error.message)}</p>`; }
  }

  function renderAdminQueues(overview) {
    const waiting = overview.swaps || [];
    const deletions = overview.account_deletions || [];
    document.querySelector('#adminClosureQueue').innerHTML = `
      <div class="admin-closure-group"><h3>ç½®æ¢æ®åéå</h3>${waiting.length ? waiting.map(item => {
        const candidates = catalog.filter(row => row.kind === item.target_kind && (row.product_code === item.target_product_code || row.gpu === item.target_product_code));
        return `<div class="admin-closure-row"><span><b>${escapeHtml(item.id)}</b><small>${escapeHtml(kindLabels[item.source_kind] || item.source_kind)} ${item.source_quantity} ${escapeHtml(item.source_unit)} â ${escapeHtml(item.target_product_code)}</small></span>${item.status === 'matching' ? `<select data-admin-swap-listing="${escapeHtml(item.id)}"><option value="">éæ©ç®æ æç</option>${candidates.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.product_code)} Â· ${escapeHtml(row.region)} Â· Â¥${row.unit_price_cny}/${escapeHtml(row.unit)}</option>`).join('')}</select><button data-admin-quote-swap="${escapeHtml(item.id)}">éå®å¹¶æ¥ä»·</button>` : `<b>${escapeHtml(item.status)}</b>`}</div>`;
      }).join('') : '<p>å½åæ²¡æå¾æ®åç½®æ¢ã</p>'}</div>
      <div class="admin-closure-group"><h3>è´¦æ·æ³¨ééå</h3>${deletions.length ? deletions.map(item => `<div class="admin-closure-row"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.id)} Â· ${escapeHtml(item.status)}</small></span><button data-admin-complete-deletion="${escapeHtml(item.id)}">å¤æ ¸å¹¶å¿åå</button></div>`).join('') : '<p>å½åæ²¡æå¾å¤çæ³¨éç³è¯·ã</p>'}</div>`;
    document.querySelectorAll('[data-admin-quote-swap]').forEach(button => button.addEventListener('click', async () => {
      const select = document.querySelector(`[data-admin-swap-listing="${CSS.escape(button.dataset.adminQuoteSwap)}"]`);
      if (!select?.value) return notify('è¯·åéæ©åå£å¾ç®æ æç');
      button.disabled = true;
      try { await api(`/api/admin/swaps/${encodeURIComponent(button.dataset.adminQuoteSwap)}/quote`, { method: 'POST', body: { target_listing_id: select.value } }); notify('ç½®æ¢ä¸¤ä¾§å®¹éå·²éå®ï¼æ¥ä»·ææ 15 åé'); await loadReleaseReadiness(); }
      catch (error) { notify(error.message); button.disabled = false; }
    }));
    document.querySelectorAll('[data-admin-complete-deletion]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api(`/api/admin/account-deletions/${encodeURIComponent(button.dataset.adminCompleteDeletion)}/complete`, { method: 'POST', body: {} }); notify('è´¦æ·èº«ä»½å·²å¿ååï¼æ³å®è®°å½ç»§ç»­ä¿ç'); await loadReleaseReadiness(); }
      catch (error) { notify(error.message); button.disabled = false; }
    }));
  }

  function ensureSwapClosure() {
    if (document.querySelector('#liveSwapPanel')) return;
    const panel = document.createElement('section');
    panel.className = 'panel live-swap-panel';
    panel.id = 'liveSwapPanel';
    panel.innerHTML = `
      <div class="panel-head"><div><span class="eyebrow">VERIFIED BILATERAL SWAP</span><h2>æäº¤çå®å®¹éç½®æ¢</h2><p>åªä½¿ç¨å·²éªæ¶èµäº§åå·²éªçç®æ æçï¼åæ¹æåä¸æ¶ç¹äººæ°å¸æ åä»·å¼æ®åã</p></div><button class="secondary" id="refreshSwaps" type="button">å·æ°ç¶æ</button></div>
      <div class="live-swap-form"><label>æå¯æä¾<select id="liveSwapSource"></select></label><label>æä¾æ°é<div class="input-unit"><input id="liveSwapQuantity" type="number" min="0.01" step="0.01" value="1"><span id="liveSwapSourceUnit">æ ååä½</span></div></label><label>æéè¦<select id="liveSwapTarget"></select></label><button class="primary" id="submitLiveSwap" type="button">æäº¤ç½®æ¢æ®å</button></div>
      <p class="app-form-state" id="liveSwapMessage">æ¥ä»·çæåéå® 15 åéï¼ç¡®è®¤ååæ¹å®¹éåå­éå®ï¼ç®æ èµæºä»éå®æäº¤ä»ãè®¡éåéªæ¶ã</p><div id="liveSwapList"></div>`;
    document.querySelector('#swapView .quote-breakdown')?.after(panel);
    document.querySelector('#refreshSwaps').addEventListener('click', loadSwapData);
    document.querySelector('#submitLiveSwap').addEventListener('click', submitSwap);
    document.querySelector('#liveSwapSource').addEventListener('change', syncSwapUnit);
    document.querySelector('#confirmSwap').onclick = () => panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function syncSwapUnit() {
    const source = assets.find(item => item.id === document.querySelector('#liveSwapSource').value);
    document.querySelector('#liveSwapSourceUnit').textContent = source?.unit || 'æ ååä½';
    const input = document.querySelector('#liveSwapQuantity');
    input.max = source ? String(source.available_quantity) : '';
  }

  async function loadSwapData() {
    try {
      if (!(await syncIdentity())) {
        assets = []; swaps = []; catalog = [];
        document.querySelector('#liveSwapList').innerHTML = '<p class="production-empty">ç»å½åå¯ä»çå®èµäº§æ¹æ¬¡åèµ·ç½®æ¢ã</p>';
        return;
      }
      const [assetResult, catalogResult, swapResult] = await Promise.all([api('/api/assets'), api('/api/catalog'), api('/api/swaps')]);
      assets = (assetResult.assets || []).filter(item => Number(item.available_quantity) > 0);
      catalog = catalogResult.listings || [];
      swaps = swapResult.swaps || [];
      document.querySelector('#liveSwapSource').innerHTML = assets.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.product_code)} Â· å¯ç¨ ${Number(item.available_quantity).toLocaleString('zh-CN')} ${escapeHtml(item.unit)}</option>`).join('');
      document.querySelector('#liveSwapTarget').innerHTML = catalog.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.product_code)} Â· ${escapeHtml(item.region)} Â· Â¥${item.unit_price_cny}/${escapeHtml(item.unit)}</option>`).join('');
      syncSwapUnit();
      renderSwaps();
    } catch (error) { document.querySelector('#liveSwapMessage').textContent = error.message; }
  }

  function renderSwaps() {
    const labels = { matching: 'æ®åä¸­', quoted: 'å¾ç¡®è®¤ Â· 15 åééå®', confirmed: 'åæ¹å·²éå® Â· äº¤ä»ä¸­', completed: 'å·²äº¤å²', cancelled: 'å·²åæ¶', quote_expired: 'æ¥ä»·å·²è¿æ' };
    document.querySelector('#liveSwapList').innerHTML = swaps.length ? swaps.map(item => `
      <article class="live-swap-row" data-swap-id="${escapeHtml(item.id)}"><div><small>${escapeHtml(item.id)}</small><b>${escapeHtml(item.source_product_code)} â ${escapeHtml(item.target_product_code)}</b><span>${Number(item.source_quantity).toLocaleString('zh-CN')} ${escapeHtml(item.source_unit)}${item.target_quantity ? ` â ${Number(item.target_quantity).toLocaleString('zh-CN')} ${escapeHtml(item.target_unit || '')}` : ''}</span></div><div><small>äººæ°å¸ä»·å¼å¿«ç§</small><b>Â¥ ${Number(item.source_reference_cny * item.source_quantity).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</b><span>${item.quote_expires_at ? `ææè³ ${escapeHtml(item.quote_expires_at.replace('T', ' ').slice(0, 19))}` : 'ç­å¾ç®æ æçæ®å'}</span></div><strong>${escapeHtml(labels[item.status] || item.status)}</strong><div class="live-swap-actions">${item.status === 'quoted' ? `<button class="primary" data-swap-accept="${escapeHtml(item.id)}">ç¡®è®¤ç½®æ¢</button>` : ''}${['matching', 'quoted'].includes(item.status) ? `<button data-swap-cancel="${escapeHtml(item.id)}">åæ¶</button>` : ''}${item.target_order_id ? `<button data-swap-order="${escapeHtml(item.target_order_id)}">æ¥çäº¤ä»è®¢å</button>` : ''}</div></article>`).join('') : '<p class="production-empty">è¿æ²¡æç½®æ¢ç³è¯·ã</p>';
    document.querySelectorAll('[data-swap-accept]').forEach(button => button.addEventListener('click', () => swapAction(button, 'accept')));
    document.querySelectorAll('[data-swap-cancel]').forEach(button => button.addEventListener('click', () => swapAction(button, 'cancel')));
    document.querySelectorAll('[data-swap-order]').forEach(button => button.addEventListener('click', () => { window.jump?.('vault'); setTimeout(() => document.querySelector(`[data-order-id]`)?.scrollIntoView({ block: 'start' }), 100); }));
  }

  async function submitSwap() {
    if (!currentUser && !(await syncIdentity())) return window.openAuth?.('login');
    const source = assets.find(item => item.id === document.querySelector('#liveSwapSource').value);
    const target = catalog.find(item => item.id === document.querySelector('#liveSwapTarget').value);
    const quantity = Number(document.querySelector('#liveSwapQuantity').value);
    if (!source || !target || !(quantity > 0) || quantity > Number(source.available_quantity)) return document.querySelector('#liveSwapMessage').textContent = 'è¯·éæ©ææçæºèµäº§ãç®æ æçåç½®æ¢æ°éã';
    const button = document.querySelector('#submitLiveSwap');
    button.disabled = true;
    try {
      const result = await api('/api/swaps', { method: 'POST', headers: { 'Idempotency-Key': requestId('swap') }, body: {
        source_allocation_id: source.id, source_quantity: quantity, target_kind: target.kind,
        target_product_code: target.product_code, target_region: target.region, target_listing_id: target.id
      }});
      document.querySelector('#liveSwapMessage').textContent = `ç½®æ¢éæ± ${result.swap.id} å·²è¿å¥æ®åï¼å¹³å°å¤æ ¸åå£å¾ä»·æ ¼åä¼éå®åæ¹å®¹éã`;
      await loadSwapData(); notify('ç½®æ¢éæ±å·²åå¥æå¡ç«¯è´¦æ¬');
    } catch (error) { document.querySelector('#liveSwapMessage').textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function swapAction(button, action) {
    button.disabled = true;
    try { await api(`/api/swaps/${encodeURIComponent(button.dataset[action === 'accept' ? 'swapAccept' : 'swapCancel'])}/${action}`, { method: 'POST', body: {} }); await loadSwapData(); notify(action === 'accept' ? 'åæ¹å®¹éå·²éå®ï¼ç®æ èµæºè¿å¥äº¤ä»' : 'ç½®æ¢å·²åæ¶ï¼å®¹éå·²éæ¾'); }
    catch (error) { notify(error.message); button.disabled = false; }
  }

  function installSellClosure() {
    const button = document.querySelector('#publishSell');
    if (!button) return;
    button.textContent = 'è¿å¥éªçå¹¶ä¸æ¶';
    button.onclick = () => {
      const supplier = document.querySelector('.nav-item[data-view="supplier"]');
      if (supplier) supplier.click();
      else document.querySelector('.nav-item[data-view="assessment"]')?.click();
      notify('åºå®å¿é¡»åå®æä¼ä¸è®¤è¯åèµæºéªçï¼åç»å®å®¹éæ¹æ¬¡ä¸æ¶');
    };
  }

  function installRouteHooks() {
    document.querySelector('.nav-item[data-view="swap"]')?.addEventListener('click', () => setTimeout(loadSwapData, 0));
    window.addEventListener('kai:auth-changed', () => { syncIdentity().catch(() => {}); if (document.querySelector('#swapView.active')) loadSwapData(); });
    const routeDeepLink = detail => {
      const rawHash = detail?.hash || location.hash;
      const route = rawHash.match(/^#(?:route=)?(account|swap|supplier|market|quote|vault)$/)?.[1];
      if (!route) return;
      if (route === 'account') showAccountCenter();
      else {
        window.jump?.(route);
        if (route === 'swap') loadSwapData();
      }
    };
    window.addEventListener('kai:deep-link', event => routeDeepLink(event.detail));
    window.addEventListener('hashchange', () => routeDeepLink());
    routeDeepLink();
  }

  installLegalLinks();
  installNativeShare();
  ensureAccountCenter();
  ensureSwapClosure();
  installSellClosure();
  installRouteHooks();
  syncIdentity().catch(() => {});
})();

