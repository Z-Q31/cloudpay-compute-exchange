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

  function randomBase64Url(bytes = 32) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    let binary = '';
    data.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function startIdentityLogin(returnTo = '/') {
    if (!native || !plugins.Browser?.open) return false;
    const safeReturnTo = String(returnTo || '/').startsWith('/') && !String(returnTo).startsWith('//')
      ? String(returnTo)
      : '/';
    const appNonce = randomBase64Url();
    localStorage.setItem(identityNonceKey, appNonce);
    const preparation = await fetch('/api/auth/kai/mobile/prepare', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_nonce: appNonce, return_to: safeReturnTo })
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

  async function completeIdentityLogin(rawUrl) {
    if (!native || !rawUrl) return false;
    let url;
    try { url = new URL(rawUrl); } catch (_) { return false; }
    if (url.protocol !== 'cloudpay:' || url.hostname !== 'auth' || url.pathname !== '/callback') return false;
    try { await plugins.Browser?.close?.(); } catch (_) { /* browser may already be closed */ }
    const providerError = url.searchParams.get('error');
    if (providerError) {
      localStorage.removeItem(identityNonceKey);
      const errorUrl = new URL(location.href);
      errorUrl.searchParams.set('kai_auth', 'error');
      errorUrl.searchParams.set('reason', providerError);
      location.replace(errorUrl.href);
      return true;
    }
    const ticket = url.searchParams.get('ticket') || '';
    const appNonce = localStorage.getItem(identityNonceKey) || '';
    try {
      const response = await fetch('/api/auth/kai/mobile/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, app_nonce: appNonce })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message || 'App 统一登录未完成');
      }
      localStorage.removeItem(identityNonceKey);
      const returnTo = String(payload.return_to || '/');
      const destination = new URL(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', location.origin);
      destination.searchParams.set('kai_auth', 'success');
      location.replace(destination.href);
    } catch (error) {
      localStorage.removeItem(identityNonceKey);
      window.dispatchEvent(new CustomEvent('kai:mobile-auth-error', { detail: { message: error.message } }));
    }
    return true;
  }

  function dispatchDeepLink(rawUrl) {
    if (!rawUrl) return;
    completeIdentityLogin(rawUrl).catch(() => {});
    try {
      const url = new URL(rawUrl, location.origin);
      window.dispatchEvent(new CustomEvent('kai:deep-link', { detail: { url: url.href, hash: url.hash, path: url.pathname } }));
    } catch (_) {}
  }

  window.KAINative = { native, share, openExternal, appInfo, startIdentityLogin, completeIdentityLogin };
  document.documentElement.dataset.runtime = native ? 'native' : 'web';

  if (!native && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
  }
  if (native && plugins.App?.addListener) {
    plugins.App.addListener('appUrlOpen', event => dispatchDeepLink(event?.url));
    plugins.App.getLaunchUrl?.().then(result => dispatchDeepLink(result?.url)).catch(() => {});
  }
})();
