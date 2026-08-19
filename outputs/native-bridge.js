(() => {
  'use strict';

  const capacitor = window.Capacitor;
  const native = Boolean(capacitor?.isNativePlatform?.());
  const plugins = capacitor?.Plugins || {};
  if (native && localStorage.getItem('kai-privacy-consent-v1') !== 'accepted' && location.pathname !== '/privacy-consent.html') {
    location.replace(`/privacy-consent.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
    return;
  }

  async function share(data) {
    if (native && plugins.Share?.share) {
      await plugins.Share.share({ title: data.title || 'KAI Cloud', text: data.text || '', url: data.url || location.href, dialogTitle: '分享 KAI Cloud' });
      return true;
    }
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      await navigator.share(data);
      return true;
    }
    return false;
  }

  async function openExternal(url) {
    if (!/^https:\/\//i.test(String(url || ''))) throw new Error('外部地址必须使用 HTTPS');
    if (native && plugins.Browser?.open) {
      await plugins.Browser.open({ url, presentationStyle: 'popover' });
      return;
    }
    window.location.assign(url);
  }

  async function appInfo() {
    if (native && plugins.App?.getInfo) return plugins.App.getInfo();
    return { name: 'KAI Cloud Web', version: 'web', build: 'web' };
  }

  const identityNonceKey = 'kai-mobile-identity-nonce-v1';
  const identityReturnKey = 'kai-mobile-identity-return-v1';
  let identityCompletion = null;

  function randomBase64Url(bytes = 32) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    let binary = '';
    data.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function startIdentityLogin(returnTo = '/', options = {}) {
    if (!native || !plugins.Browser?.open) return false;
    const safeReturnTo = String(returnTo || '/').startsWith('/') && !String(returnTo).startsWith('//')
      ? String(returnTo)
      : '/';
    const loginHint = String(options.loginHint || '').trim().toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{1,189}$/.test(loginHint)) {
      throw new Error('请输入有效的 KAI 账户邮箱');
    }
    const appNonce = randomBase64Url();
    localStorage.setItem(identityNonceKey, appNonce);
    localStorage.removeItem(identityReturnKey);
    const preparation = await fetch('/api/auth/kai/mobile/prepare', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_nonce: appNonce, login_hint: loginHint, return_to: safeReturnTo })
    });
    const payload = await preparation.json().catch(() => null);
    if (!preparation.ok || !payload?.ok || !payload?.start_url) {
      localStorage.removeItem(identityNonceKey);
      throw new Error(payload?.error?.message || '无法准备 App 统一登录');
    }
    const startUrl = new URL(payload.start_url, location.origin);
    if (startUrl.origin !== location.origin || startUrl.pathname !== '/api/auth/kai/mobile/start') {
      localStorage.removeItem(identityNonceKey);
      throw new Error('App 统一登录入口无效');
    }
    await plugins.Browser.open({ url: startUrl.href, presentationStyle: 'popover' });
    return true;
  }

  async function readIdentitySession() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      const payload = await response.json().catch(() => null);
      return response.ok && payload?.authenticated ? payload : null;
    } catch (_) {
      return null;
    }
  }

  function finishIdentityLogin(returnTo, session) {
    localStorage.removeItem(identityNonceKey);
    localStorage.removeItem(identityReturnKey);
    window.dispatchEvent(new CustomEvent('kai:auth-changed', { detail: { user: session?.user || null } }));
    window.dispatchEvent(new CustomEvent('kai:mobile-auth-complete', { detail: { user: session?.user || null } }));
    const destination = new URL(
      String(returnTo || '/').startsWith('/') && !String(returnTo).startsWith('//') ? String(returnTo) : '/',
      location.origin
    );
    destination.searchParams.set('kai_auth', 'success');
    location.replace(destination.href);
  }

  async function runIdentityCompletion(rawUrl) {
    if (!native || !rawUrl) return false;
    let url;
    try { url = new URL(rawUrl); } catch (_) { return false; }
    if (url.protocol !== 'cloudpay:' || url.hostname !== 'auth' || url.pathname !== '/callback') return false;
    localStorage.setItem(identityReturnKey, url.href);
    try { await plugins.Browser?.close?.(); } catch (_) { /* browser may already be closed */ }
    const providerError = url.searchParams.get('error');
    if (providerError) {
      localStorage.removeItem(identityNonceKey);
      localStorage.removeItem(identityReturnKey);
      const errorUrl = new URL(location.href);
      errorUrl.searchParams.set('kai_auth', 'error');
      errorUrl.searchParams.set('reason', providerError);
      location.replace(errorUrl.href);
      return true;
    }
    const ticket = url.searchParams.get('ticket') || '';
    const appNonce = localStorage.getItem(identityNonceKey) || '';
    try {
      const existingSession = await readIdentitySession();
      if (existingSession) {
        finishIdentityLogin(url.searchParams.get('return_to') || '/', existingSession);
        return true;
      }
      if (!ticket || !appNonce) throw new Error('App 登录回传信息不完整，请重新登录');
      const response = await fetch('/api/auth/kai/mobile/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, app_nonce: appNonce })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        const failure = new Error(payload?.error?.message || 'App 统一登录未完成');
        failure.code = payload?.error?.code || '';
        throw failure;
      }
      const verifiedSession = await readIdentitySession();
      if (!verifiedSession) throw new Error('登录凭据已返回，但 App 会话尚未建立，正在等待重试');
      finishIdentityLogin(payload.return_to || url.searchParams.get('return_to') || '/', verifiedSession);
    } catch (error) {
      if (/_(?:invalid|rejected|expired)$/.test(String(error.code || ''))) {
        localStorage.removeItem(identityNonceKey);
        localStorage.removeItem(identityReturnKey);
      }
      window.dispatchEvent(new CustomEvent('kai:mobile-auth-error', { detail: { message: error.message } }));
    }
    return true;
  }

  async function completeIdentityLogin(rawUrl) {
    if (identityCompletion) return identityCompletion;
    identityCompletion = runIdentityCompletion(rawUrl).finally(() => { identityCompletion = null; });
    return identityCompletion;
  }

  async function retryPendingIdentityLogin() {
    const pending = localStorage.getItem(identityReturnKey);
    if (pending) return completeIdentityLogin(pending);
    const launch = await plugins.App?.getLaunchUrl?.().catch(() => null);
    if (launch?.url) return completeIdentityLogin(launch.url);
    return false;
  }

  function dispatchDeepLink(rawUrl) {
    if (!rawUrl) return;
    completeIdentityLogin(rawUrl).catch(() => {});
    try {
      const url = new URL(rawUrl, location.origin);
      window.dispatchEvent(new CustomEvent('kai:deep-link', { detail: { url: url.href, hash: url.hash, path: url.pathname } }));
    } catch (_) {}
  }

  window.KAINative = { native, share, openExternal, appInfo, startIdentityLogin, completeIdentityLogin, retryPendingIdentityLogin };
  document.documentElement.dataset.runtime = native ? 'native' : 'web';

  if (!native && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
  }
  if (native && plugins.App?.addListener) {
    plugins.App.addListener('appUrlOpen', event => dispatchDeepLink(event?.url));
    plugins.App.getLaunchUrl?.().then(result => dispatchDeepLink(result?.url)).catch(() => {});
    plugins.App.addListener('appStateChange', state => {
      if (state?.isActive) retryPendingIdentityLogin().catch(() => {});
    });
    window.addEventListener('online', () => retryPendingIdentityLogin().catch(() => {}));
  }
})();
