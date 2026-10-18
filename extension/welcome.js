/* global chrome, PTM_CONFIG, ptmOpen, ptmGetSettings, ptmSupportTiers, ptmOpenSupport */
var c = PTM_CONFIG || {};
function $(id) { return document.getElementById(id); }

ptmGetSettings().then(function (s) {
  var has = ptmSupportTiers(s).length > 0;
  if (!has && !c.repoUrl) return;
  $('support').classList.remove('hidden');
  if (has) {
    $('supportLabel').textContent = c.supportLabel || 'Buy me a coffee';
    $('supportBtn').addEventListener('click', ptmOpenSupport);
  } else {
    $('supportBtn').classList.add('hidden');
  }
});
if (c.repoUrl) {
  $('starBtn').classList.remove('hidden');
  $('starBtn').addEventListener('click', function () { ptmOpen(c.repoUrl); });
}

$('shortcutsLink').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
$('settingsBtn').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
$('closeBtn').addEventListener('click', function () { window.close(); });
