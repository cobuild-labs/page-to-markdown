/* global chrome, PTM_CONFIG, PTM_DEFAULTS, ptmGetSettings, ptmSetSettings, ptmOpen, ptmSupportUrl, ptmSupportTiers, ptmOpenSupport */

var savedTimer = null;
function flashSaved() {
  var el = document.getElementById('saved');
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(function () { el.classList.remove('show'); }, 1100);
}

function bind(settings) {
  document.querySelectorAll('[data-key]').forEach(function (el) {
    var key = el.getAttribute('data-key');
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = String(settings[key] == null ? '' : settings[key]);
    el.addEventListener('change', function () {
      var v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.getAttribute('data-type') === 'number') v = parseInt(v, 10) || 0;
      if (key === 'filenameTemplate' && !String(v).trim()) { v = PTM_DEFAULTS.filenameTemplate; el.value = v; }
      if (key === 'supportUrl') {
        v = String(v).trim();
        if (v && !/^https?:\/\//i.test(v)) { v = 'https://' + v; el.value = v; }
      }
      var patch = {}; patch[key] = v;
      ptmSetSettings(patch).then(flashSaved);
    });
  });
}

ptmGetSettings().then(bind);

document.getElementById('version').textContent = 'Version ' + chrome.runtime.getManifest().version + '.';
document.getElementById('shortcuts').addEventListener('click', function () { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
document.getElementById('welcome').addEventListener('click', function () { chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }); });
document.getElementById('reset').addEventListener('click', function () {
  chrome.storage.sync.clear(function () { ptmGetSettings().then(function () { location.reload(); }); });
});

var c = PTM_CONFIG || {};
// The link is set in config.js for public builds; then the field is not needed.
var configTiers = (c.supportTiers || []).some(function (t) { return t && /^https:\/\//.test(t.url || ''); });
if (c.supportUrl || configTiers) document.getElementById('support').classList.add('hidden');
ptmGetSettings().then(function (s) {
  if (!ptmSupportTiers(s).length) return;
  document.getElementById('supportCard').classList.remove('hidden');
  document.getElementById('supportLabel').textContent = c.supportLabel || 'Buy me a coffee';
  document.getElementById('supportBtn').addEventListener('click', ptmOpenSupport);
});
if (location.hash === '#support') {
  setTimeout(function () {
    var f = document.querySelector('[data-key="supportUrl"]');
    if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
  }, 150);
}
if (c.repoUrl) {
  var repo = document.getElementById('repo'), issues = document.getElementById('issues');
  repo.classList.remove('hidden'); issues.classList.remove('hidden');
  repo.addEventListener('click', function () { ptmOpen(c.repoUrl); });
  issues.addEventListener('click', function () { ptmOpen(c.repoUrl.replace(/\/$/, '') + '/issues/new/choose'); });
}
