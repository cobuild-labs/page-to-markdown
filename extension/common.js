/**
 * common.js - helpers shared by the popup, runner, options and welcome
 * pages, and by the background service worker (via importScripts).
 * Nothing in here talks to the network.
 */
/* global chrome, PTM_CONFIG */

var PTM_DEFAULTS = {
  // AI chat export
  aiMode: 'full',            // 'full' | 'chat'
  aiSources: true,
  aiTrim: 0,                 // 0 = keep tool outputs in full
  aiRaw: false,              // also save an .mhtml copy of the page
  // Output
  frontMatter: false,        // YAML block at the top (Obsidian, Notion, static sites)
  sourceHeader: true,        // "# Title / Source: url" header on page exports
  saveAs: false,             // ask where to save each file
  filenameTemplate: '{title}',
  // Pages
  usePresets: true,          // split forum threads into posts
  cleanMode: true,           // leave out ads, menus, sidebars, cookie banners
  copyInstead: false,        // copy to the clipboard instead of downloading
  // Your support page, if config.js has none (e.g. https://buymeacoffee.com/yourname)
  supportUrl: ''
};

// The support link: config.js wins, otherwise the one saved in Settings.
function ptmSupportUrl(settings) {
  return (typeof PTM_CONFIG !== 'undefined' && PTM_CONFIG.supportUrl) || (settings && settings.supportUrl) || '';
}

// The coffee choices: config.js tiers, else one "any amount" choice for a
// single support link. Empty when nothing is set up.
function ptmSupportTiers(settings) {
  var c = typeof PTM_CONFIG !== 'undefined' ? PTM_CONFIG : {};
  var tiers = (c.supportTiers || []).filter(function (t) { return t && /^https:\/\//.test(t.url || ''); });
  if (tiers.length) return tiers;
  var url = ptmSupportUrl(settings);
  return /^https:\/\//.test(url) ? [{ price: '', name: c.supportLabel || 'Buy me a coffee', note: '', icon: 'cup', url: url }] : [];
}

function ptmGetSettings() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.sync.get(PTM_DEFAULTS, function (v) {
        resolve(Object.assign({}, PTM_DEFAULTS, v || {}));
      });
    } catch (e) { resolve(Object.assign({}, PTM_DEFAULTS)); }
  });
}

function ptmSetSettings(patch) {
  return new Promise(function (resolve) {
    try { chrome.storage.sync.set(patch, function () { resolve(); }); } catch (e) { resolve(); }
  });
}

function ptmLocalGet(keys) {
  return new Promise(function (resolve) {
    try { chrome.storage.local.get(keys, function (v) { resolve(v || {}); }); } catch (e) { resolve({}); }
  });
}

function ptmLocalSet(obj) {
  return new Promise(function (resolve) {
    try { chrome.storage.local.set(obj, function () { resolve(); }); } catch (e) { resolve(); }
  });
}

// Counts successful exports (used only to decide when to show the
// "Enjoying it?" card). Stored locally on this device, never sent anywhere.
function ptmCountExport() {
  return ptmLocalGet({ exportCount: 0 }).then(function (v) {
    return ptmLocalSet({ exportCount: (v.exportCount || 0) + 1 });
  });
}

function ptmDateStamp(d) {
  d = d || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function ptmCleanName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Template tokens: {title} {site} {date} {mode}
function ptmFilename(template, info) {
  var t = (template || '{title}').replace(/\{(\w+)\}/g, function (m, k) {
    if (k === 'title') return info.title || 'page';
    if (k === 'site') return info.site || '';
    if (k === 'date') return ptmDateStamp();
    if (k === 'mode') return info.mode || '';
    return m;
  });
  t = ptmCleanName(t).replace(/^[\s.\-]+|[\s.\-]+$/g, '').slice(0, 120);
  return (t || 'page') + '.md';
}

function ptmYaml(v) {
  return '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

function ptmFrontMatter(info) {
  var lines = ['---',
    'title: ' + ptmYaml(info.title),
    'source: ' + ptmYaml(info.url),
    info.site ? 'site: ' + ptmYaml(info.site) : '',
    'exported: ' + ptmYaml(new Date().toISOString()),
    info.type ? 'type: ' + ptmYaml(info.type) : '',
    'tags: [web-clip]',
    '---', ''];
  return lines.filter(function (l) { return l !== ''; }).join('\n') + '\n\n';
}

function ptmHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// Opens the coffee picker in its own tab (from pages other than the popup).
function ptmOpenSupport() {
  try { chrome.tabs.create({ url: chrome.runtime.getURL('support.html') }); } catch (e) { window.open('support.html', '_blank'); }
}

function ptmOpen(url) {
  if (!url) return;
  try { chrome.tabs.create({ url: url }); } catch (e) { window.open(url, '_blank', 'noopener'); }
}
