(function () {
  'use strict';

  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var modeSelect = document.querySelector('#colorMode');

  function applyMode(preference) {
    var safePreference = ['system', 'light', 'dark'].includes(preference) ? preference : 'system';
    var effective = safePreference === 'system' ? (media.matches ? 'dark' : 'light') : safePreference;
    root.dataset.colorPreference = safePreference;
    root.dataset.colorMode = effective;
    root.style.colorScheme = effective;
    localStorage.setItem('kai-color-preference', safePreference);
    if (modeSelect) modeSelect.value = safePreference;
  }

  if (modeSelect) {
    modeSelect.value = root.dataset.colorPreference || 'system';
    modeSelect.addEventListener('change', function () { applyMode(modeSelect.value); });
  }
  media.addEventListener('change', function () {
    if ((root.dataset.colorPreference || 'system') === 'system') applyMode('system');
  });

  var nav = document.querySelector('.nav');
  if (!nav || document.querySelector('.nav-more-toggle')) return;

  var moreToggle = document.createElement('button');
  moreToggle.type = 'button';
  moreToggle.className = 'nav-item nav-more-toggle';
  moreToggle.setAttribute('aria-expanded', 'false');
  moreToggle.setAttribute('aria-controls', 'mobileMoreMenu');
  moreToggle.textContent = '更多';

  var moreMenu = document.createElement('div');
  moreMenu.className = 'mobile-more-menu';
  moreMenu.id = 'mobileMoreMenu';
  moreMenu.hidden = true;
  moreMenu.setAttribute('aria-label', '更多页面');

  function closeMore() {
    moreMenu.hidden = true;
    moreToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-more-open');
  }

  function rebuildMore() {
    var secondaryViews = ['swap', 'sell', 'supplier', 'recommend', 'assessment'];
    moreMenu.replaceChildren();
    secondaryViews.forEach(function (view) {
      var original = nav.querySelector('[data-view="' + view + '"]');
      if (!original) return;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'mobile-more-item';
      item.dataset.targetView = view;
      item.textContent = original.textContent.trim().replace(/^[⇄↗◎◉▦]+\s*/, '');
      item.addEventListener('click', function () {
        original.click();
        closeMore();
      });
      moreMenu.appendChild(item);
    });
  }

  moreToggle.addEventListener('click', function () {
    var opening = moreMenu.hidden;
    moreMenu.hidden = !opening;
    moreToggle.setAttribute('aria-expanded', String(opening));
    document.body.classList.toggle('mobile-more-open', opening);
    if (opening) moreMenu.querySelector('button')?.focus();
  });

  nav.appendChild(moreToggle);
  document.body.appendChild(moreMenu);
  rebuildMore();

  var navObserver = new MutationObserver(function () {
    rebuildMore();
    var active = nav.querySelector('.nav-item.active')?.dataset.view;
    moreToggle.classList.toggle('active', ['swap', 'sell', 'supplier', 'recommend', 'assessment'].includes(active));
  });
  navObserver.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  document.addEventListener('click', function (event) {
    if (!event.target.closest('.nav-more-toggle,.mobile-more-menu')) closeMore();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !moreMenu.hidden) {
      closeMore();
      moreToggle.focus();
    }
  });
})();
