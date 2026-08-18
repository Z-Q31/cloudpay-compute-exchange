(function () {
  'use strict';
  var stored = localStorage.getItem('kai-color-preference');
  var preference = ['system', 'light', 'dark'].includes(stored) ? stored : 'system';
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var effective = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.colorPreference = preference;
  document.documentElement.dataset.colorMode = effective;
})();
