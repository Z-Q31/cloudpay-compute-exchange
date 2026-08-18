(() => {
  'use strict';
  const requested = new URLSearchParams(location.search).get('next') || '/';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  document.querySelector('#acceptPrivacy').addEventListener('click', () => {
    localStorage.setItem('kai-privacy-consent-v1', 'accepted');
    location.replace(next);
  });
  document.querySelector('#declinePrivacy').addEventListener('click', () => {
    document.querySelector('#privacyConsentCard').innerHTML = '<h1>已停止进入</h1><p>未同意隐私政策时不会进入账户和交易功能。你可以关闭 App，或重新打开后再次选择。</p>';
  });
})();
