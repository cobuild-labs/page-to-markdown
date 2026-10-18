/* Service worker: context menus, keyboard shortcuts, first-run welcome page.
 * The long multi-page workflow lives in runner.html (a normal tab), which
 * avoids MV3 service-worker lifetime limits.
 */
/* global chrome, importScripts, PTM_CONFIG, ptmGetSettings, ptmFilename, ptmFrontMatter, ptmCountExport, pageToMarkdownExtract */
importScripts('config.js', 'common.js', 'extract.js');

var AI_PATTERNS = [
  'https://claude.ai/*', 'https://*.claude.ai/*',
  'https://chatgpt.com/*', 'https://chat.openai.com/*',
  'https://gemini.google.com/*', 'https://grok.com/*', 'https://x.com/i/grok*'
];

chrome.runtime.onInstalled.addListener(function (details) {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: 'ptm-page', title: 'Convert page to Markdown', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'ptm-selection', title: 'Convert selection to Markdown', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ptm-ai', title: 'Export this AI chat to Markdown', contexts: ['page'], documentUrlPatterns: AI_PATTERNS });
  });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

function flash(tabId, ok) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#16a34a' : '#dc2626', tabId: tabId });
    chrome.action.setBadgeText({ text: ok ? '✓' : '!', tabId: tabId });
    setTimeout(function () { chrome.action.setBadgeText({ text: '', tabId: tabId }); }, 3500);
  } catch (e) { /* ignore */ }
}

function exec(details) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript(details, function (results) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(results && results[0] ? results[0].result : undefined);
    });
  });
}

function downloadText(filename, text, saveAs) {
  var url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(text);
  return new Promise(function (resolve) {
    chrome.downloads.download({ url: url, filename: filename, saveAs: !!saveAs }, function () { resolve(); });
  });
}

async function convertTab(tab, selectionOnly) {
  var s = await ptmGetSettings();
  var result = await exec({ target: { tabId: tab.id }, func: pageToMarkdownExtract, args: [{ selectionOnly: !!selectionOnly, usePresets: s.usePresets, clean: s.cleanMode }] });
  if (!result || !result.markdown) throw new Error('Nothing to convert');
  var title = (result.title || result.url) + (result.layout === 'selection' ? ' (selection)' : '');
  var text = (s.frontMatter ? ptmFrontMatter({ title: title, url: result.url, type: result.layout === 'selection' ? 'selection' : 'page' }) : '') +
    (s.sourceHeader ? '# ' + title + '\n\nSource: ' + result.url + '\n\n---\n\n' : '') + result.markdown + '\n';
  await downloadText(ptmFilename(s.filenameTemplate, { title: title, site: new URL(result.url).hostname }), text, s.saveAs);
  await ptmCountExport();
}

async function aiExportTab(tab) {
  var s = await ptmGetSettings();
  await exec({ target: { tabId: tab.id }, files: ['aiexport.js'] });
  var res = await exec({
    target: { tabId: tab.id },
    func: function (o) { return window.__ptmAiExport(o); },
    args: [{ mode: s.aiMode, includeSources: s.aiSources, maxToolChars: s.aiTrim, frontMatter: s.frontMatter, filenameTemplate: s.filenameTemplate, download: true }]
  });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Export failed');
  await ptmCountExport();
}

function isAiUrl(url) {
  return /^https:\/\/(([\w-]+\.)?claude\.ai|chatgpt\.com|chat\.openai\.com|gemini\.google\.com|grok\.com)\//.test(url || '') ||
    /^https:\/\/x\.com\/i\/grok/.test(url || '');
}

function run(tab, job) {
  if (!tab || !tab.id) return;
  job().then(function () { flash(tab.id, true); }).catch(function (e) {
    console.warn('Page to Markdown:', e && e.message);
    flash(tab.id, false);
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'ptm-page') run(tab, function () { return convertTab(tab, false); });
  else if (info.menuItemId === 'ptm-selection') run(tab, function () { return convertTab(tab, true); });
  else if (info.menuItemId === 'ptm-ai') run(tab, function () { return aiExportTab(tab); });
});

chrome.commands.onCommand.addListener(function (command, tab) {
  function withTab(fn) {
    if (tab && tab.id) return fn(tab);
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { if (tabs[0]) fn(tabs[0]); });
  }
  withTab(function (t) {
    if (command === 'convert-page') run(t, function () { return convertTab(t, false); });
    else if (command === 'export-ai-chat') {
      run(t, function () { return isAiUrl(t.url) ? aiExportTab(t) : convertTab(t, false); });
    }
  });
});
