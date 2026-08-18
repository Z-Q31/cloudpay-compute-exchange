(() => {
  'use strict';
  let csrf = '';
  const state = document.querySelector('#webDeletionState');
  fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => response.json())
    .then(payload => {
      if (payload.authenticated) {
        csrf = payload.csrf_token;
        state.textContent = `已登录：${payload.user.account}`;
      } else {
        state.textContent = '当前未登录。请先返回首页登录，然后重新打开本页面。';
      }
    })
    .catch(() => { state.textContent = '暂时无法读取登录状态，请稍后重试。'; });

  document.querySelector('#deletionWebForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!csrf) {
      state.textContent = '请先登录账户。';
      return;
    }
    const response = await fetch('/api/account/deletion-request', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-KAI-CSRF': csrf },
      body: JSON.stringify({
        password: document.querySelector('#webDeletionPassword').value,
        reason: document.querySelector('#webDeletionReason').value,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    state.textContent = response.ok
      ? `申请 ${payload.request.id} 已提交，状态：${payload.request.status}`
      : (payload?.error?.message || '提交失败');
  });
})();
