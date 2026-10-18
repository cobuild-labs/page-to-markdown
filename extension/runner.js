/* global chrome, ptmGetSettings, ptmSetSettings, ptmLocalGet, ptmLocalSet, ptmCountExport, ptmFilename, ptmFrontMatter,
   ptmHost, ptmOpen, ptmSupportUrl, ptmOpenSupport, PTM_CONFIG, PTM_DEFAULTS,
   pageToMarkdownExtract, detectPaginationOnPage, clickNextPageButton, startElementPicker, findNextLinkOnPage,
   waitForPageReady */

var qs = new URLSearchParams(location.search);
var sourceTabId = parseInt(qs.get('tabId'), 10);
var sourceUrl = qs.get('url') || '';
function $(id) { return document.getElementById(id); }
$('sourceUrl').textContent = sourceUrl || '(unknown)';

var settings = Object.assign({}, PTM_DEFAULTS);
var detection = null;
var stopped = false;
var running = false;
var pageResults = [];          // { n, title, url, markdown, error }
var seenItemKeys = new Set();  // posts already written (forums repeat post #1 on every page)
var seenBlocks = new Set();    // text already written (headers, intros, "load more" lists)
var lastHeaderUrl = '';
var sourceChars = 0;           // how much text the user's own tab shows, so we know when a copy has loaded

/* ---------------------------- promise helpers ---------------------------- */

function chromeCall(fn) {
  return new Promise(function (resolve, reject) {
    fn(function (v) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(v);
    });
  });
}
function tabsCreate(props) { return chromeCall(function (cb) { chrome.tabs.create(props, cb); }); }
function tabsUpdate(id, props) { return chromeCall(function (cb) { chrome.tabs.update(id, props, cb); }); }
function tabsGet(id) { return chromeCall(function (cb) { chrome.tabs.get(id, cb); }); }
function tabsRemove(id) { return new Promise(function (r) { chrome.tabs.remove(id, function () { void chrome.runtime.lastError; r(); }); }); }
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function execScript(tabId, func, args) {
  return chromeCall(function (cb) {
    chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args || [] }, cb);
  }).then(function (results) {
    if (!results || !results.length) throw new Error('No result returned from the page.');
    return results[0].result;
  });
}

function waitForComplete(tabId, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(v) { if (done) return; done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(v); }
    var timer = setTimeout(function () { finish(false); }, timeoutMs || 25000);
    function listener(id, info) { if (id === tabId && info.status === 'complete') finish(true); }
    chrome.tabs.onUpdated.addListener(listener);
    tabsGet(tabId).then(function (t) { if (t && t.status === 'complete') finish(true); }).catch(function () {});
  });
}

/* ----------------------------------- UI ----------------------------------- */

var fieldGroups = { auto: $('fields-auto'), manual: $('fields-manual'), next: $('fields-next'), button: $('fields-button') };
document.querySelectorAll('input[name=mode]').forEach(function (radio) {
  radio.addEventListener('change', function () {
    Object.keys(fieldGroups).forEach(function (k) { fieldGroups[k].classList.toggle('active', radio.value === k && radio.checked); });
  });
});
fieldGroups.auto.classList.add('active');

function currentMode() { var c = document.querySelector('input[name=mode]:checked'); return c ? c.value : 'auto'; }

function getOptions() {
  return {
    clean: $('cleanMode').checked,
    usePresets: $('usePresets').checked,
    contentSelector: $('contentSelector').value.trim(),
    itemSelector: $('itemSelector').value.trim(),
    itemHeadingSelector: $('itemHeadingSelector').value.trim(),
    itemDateSelector: $('itemDateSelector').value.trim(),
    excludeSelector: $('excludeSelector').value.trim()
  };
}

function log(msg, isErr) {
  var line = document.createElement('div');
  if (isErr) line.className = 'err';
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  $('log').appendChild(line);
  $('log').scrollTop = $('log').scrollHeight;
}

function setProgress(current, total, label) {
  $('progressBar').max = total || 1;
  $('progressBar').value = Math.min(current, total || 1);
  $('progressLabel').textContent = label || (current + ' / ' + total);
}

function appendPreview(text) {
  var el = $('preview');
  el.value += text;
  el.scrollTop = el.scrollHeight;
  var words = (el.value.match(/\S+/g) || []).length;
  $('stats').textContent = el.value.length.toLocaleString() + ' characters, about ' + words.toLocaleString() + ' words';
}

/* ------------------------------ page results ------------------------------ */

function normalise(s) { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }

// Drops text already written on an earlier page: site headers and intros
// that repeat on every page, and items a "Load more" list shows again.
function dropRepeats(md) {
  if (!$('skipRepeats').checked) return md;
  return md.split(/\n{2,}/).map(function (block) {
    var lines = block.split('\n');
    var isList = lines.every(function (l) { return /^\s*([-*+]|\d+\.) /.test(l) || !l.trim(); });
    if (isList) {
      var kept = lines.filter(function (l) {
        var k = normalise(l);
        if (k.length < 12) return true;
        if (seenBlocks.has(k)) return false;
        seenBlocks.add(k); return true;
      });
      return kept.join('\n');
    }
    var key = normalise(block);
    var heading = /^#{1,6} /.test(key);
    if (/^#{1,6} page \d+/.test(key) || (!heading && key.length < 25)) return block;
    if (seenBlocks.has(key)) return '';
    seenBlocks.add(key);
    return block;
  }).filter(function (b) { return b.trim(); }).join('\n\n');
}

function pageHeader(n, url) {
  var src = url && url !== lastHeaderUrl ? '\n\nSource: ' + url : '';
  lastHeaderUrl = url;
  return (n > 1 ? '\n' : '') + '## Page ' + n + src + '\n\n';
}

function handlePageResult(n, result) {
  var md = result.markdown || '';
  var note = '';
  if (result.items && result.items.length) {
    var fresh = result.items.filter(function (it) {
      if (seenItemKeys.has(it.key)) return false;
      seenItemKeys.add(it.key); return true;
    });
    var dupes = result.items.length - fresh.length;
    var bullets = fresh.length && fresh.every(function (it) { return /^- /.test(it.markdown); });
    md = fresh.map(function (it) { return it.markdown; }).join(bullets ? '\n' : '\n\n---\n\n');
    note = ', ' + fresh.length + ' item(s)' + (dupes ? ', ' + dupes + ' repeated skipped' : '');
  }
  var before = md.length;
  md = dropRepeats(md);
  if (md.length < before) note += ', repeated text skipped';
  pageResults.push({ n: n, title: result.title, url: result.url, markdown: md });
  appendPreview(pageHeader(n, result.url) + (md || '_Nothing new on this page._') + '\n');
  log('Page ' + n + ' done (' + md.length.toLocaleString() + ' characters' + note + ').');
}

function handlePageError(n, url, err) {
  pageResults.push({ n: n, url: url, error: err.message });
  appendPreview(pageHeader(n, url) + '_Could not read this page: ' + err.message + '_\n');
  log('Page ' + n + ' failed: ' + err.message, true);
}

/* ------------------------------ the three runs ----------------------------- */

// Waits for a page that has finished "loading" to also finish drawing its
// content. Sites built with React, Next.js and the like fill the list in a
// moment after the load event, and background tabs are slower still, so
// reading straight away gives only the header and footer.
async function settle(tabId, url, needButton) {
  var sameAsSource = url && sourceUrl && url.split('#')[0] === sourceUrl.split('#')[0];
  var r = await execScript(tabId, waitForPageReady, [{
    minChars: sameAsSource ? sourceChars : 0,
    needButton: !!needButton,
    maxMs: sameAsSource || needButton ? 15000 : 10000
  }]).catch(function () { return null; });
  if (r && r.waited > 2500) log('Waited ' + Math.round(r.waited / 1000) + 's for the page to finish drawing.');
  if (r && !r.ready) log('The page still looked unfinished after ' + Math.round(r.waited / 1000) + 's; reading what is there.', true);
  return r;
}

async function openTab(url, needButton) {
  var tab = await tabsCreate({ url: url, active: false });
  await waitForComplete(tab.id, 25000);
  await settle(tab.id, url, needButton);
  return tab.id;
}

async function runUrlList(urls, options) {
  for (var i = 0; i < urls.length && !stopped; i++) {
    var n = i + 1;
    setProgress(i, urls.length, 'Page ' + n + ' of ' + urls.length + '...');
    log('Loading page ' + n + ': ' + urls[i]);
    var tabId = null;
    try {
      tabId = await openTab(urls[i]);
      handlePageResult(n, await execScript(tabId, pageToMarkdownExtract, [options]));
    } catch (e) { handlePageError(n, urls[i], e); }
    if (tabId) await tabsRemove(tabId);
    setProgress(n, urls.length, 'Page ' + n + ' of ' + urls.length + ' done.');
  }
}

async function runNextLinks(startUrl, maxPages, options) {
  var visited = new Set(), url = startUrl, tabId = null, n = 0;
  try {
    while (url && !visited.has(url) && n < maxPages && !stopped) {
      visited.add(url); n++;
      setProgress(n - 1, maxPages, 'Page ' + n + '...');
      log('Loading page ' + n + ': ' + url);
      if (tabId === null) tabId = await openTab(url);
      else { await tabsUpdate(tabId, { url: url }); await delay(300); await waitForComplete(tabId, 25000); await settle(tabId, url); }
      try { handlePageResult(n, await execScript(tabId, pageToMarkdownExtract, [options])); }
      catch (e) { handlePageError(n, url, e); }
      url = await execScript(tabId, findNextLinkOnPage).catch(function () { return null; });
    }
    if (!url) log('No further "Next" link, all pages read.');
  } finally { if (tabId !== null) await tabsRemove(tabId); }
}

async function runNextButton(startUrl, maxPages, options) {
  var tabId = await openTab(startUrl, true);
  var n = 0;
  try {
    while (n < maxPages && !stopped) {
      n++;
      setProgress(n - 1, maxPages, 'Page ' + n + '...');
      try { handlePageResult(n, await execScript(tabId, pageToMarkdownExtract, [options])); }
      catch (e) { handlePageError(n, startUrl, e); }
      if (n >= maxPages || stopped) break;
      log('Clicking the page\'s "Next" button...');
      var r = await execScript(tabId, clickNextPageButton).catch(function (e) { return { clicked: false, error: e.message }; });
      if (!r || !r.clicked) {
        // The button can show up a little after the list does. Give it one more chance.
        await settle(tabId, '', true);
        r = await execScript(tabId, clickNextPageButton).catch(function (e) { return { clicked: false, error: e.message }; });
      }
      if (!r || !r.clicked) { log('No more "Next" button, all pages read.'); break; }
      if (!r.changed) { log('The "Next" button did not load anything new, stopping here.'); break; }
      if (r.appended) log('This page adds more items below (a "Load more" list). Only the new items are kept.');
      await delay(300);
    }
  } finally { await tabsRemove(tabId); }
}

/* ---------------------------- detection + start ---------------------------- */

function describeDetection(d) {
  if (!d) return 'No page links or "Next" button found. Only this page will be converted.';
  if (d.type === 'urls') return 'Found ' + d.urls.length + ' numbered pages.';
  if (d.type === 'next-link') return 'Found a "Next" link. Will follow it page by page.';
  return 'Found a "' + (d.label || 'Next') + '" button. Will click it until the last page.';
}

function detect() {
  if (!sourceTabId) return Promise.reject(new Error('No source tab.'));
  $('detectResult').textContent = 'Looking...';
  // Let the page finish drawing first, or a pager drawn by script is missed.
  return execScript(sourceTabId, waitForPageReady, [{ maxMs: 6000 }]).catch(function () { return null; }).then(function (r) {
    if (r && r.chars) sourceChars = r.chars;
    return execScript(sourceTabId, detectPaginationOnPage);
  }).then(function (d) {
    detection = d;
    $('detectResult').textContent = describeDetection(d);
    log(describeDetection(d));
    return d;
  });
}

$('detectBtn').addEventListener('click', function () {
  detect().catch(function (e) { $('detectResult').textContent = 'Could not check the page.'; log('Detection failed: ' + e.message, true); });
});

function manualUrls() {
  var pattern = $('manualPattern').value.trim();
  var start = parseInt($('manualStart').value, 10) || 1;
  var end = parseInt($('manualEnd').value, 10) || start;
  if (!pattern || pattern.indexOf('{page}') < 0 || end < start) return null;
  var urls = [];
  for (var n = start; n <= end; n++) urls.push(pattern.replace(/\{page\}/g, String(n)));
  return urls;
}

function setRunning(on) {
  running = on;
  $('startBtn').disabled = on;
  $('stopBtn').disabled = !on;
  $('saveBtn').disabled = on || !pageResults.some(function (p) { return !p.error; });
  $('copyBtn').disabled = $('saveBtn').disabled;
}

$('startBtn').addEventListener('click', async function () {
  if (running) return;
  var options = getOptions();
  var mode = currentMode();
  pageResults = []; seenItemKeys = new Set(); seenBlocks = new Set(); lastHeaderUrl = '';
  $('preview').value = ''; $('log').innerHTML = ''; $('thanks').classList.add('hidden');
  stopped = false;
  ptmSetSettings({ cleanMode: options.clean, usePresets: options.usePresets });
  setRunning(true);
  try {
    if (mode === 'manual') {
      var urls = manualUrls();
      if (!urls) throw new Error('The pattern needs {page} where the number goes, and the end page must not be before the start page.');
      await runUrlList(urls, options);
    } else if (mode === 'next') {
      await runNextLinks(sourceUrl, parseInt($('nextMax').value, 10) || 50, options);
    } else if (mode === 'button') {
      await runNextButton(sourceUrl, parseInt($('buttonMax').value, 10) || 50, options);
    } else {
      var d = detection || await detect();
      if (d && d.type === 'urls') await runUrlList(d.urls, options);
      else if (d && d.type === 'next-link') await runNextLinks(sourceUrl, 200, options);
      else if (d && d.type === 'next-button') await runNextButton(sourceUrl, 200, options);
      else { log('Converting just this page.'); await runUrlList([sourceUrl], options); }
    }
  } catch (e) {
    log(e.message, true);
  }
  var ok = pageResults.filter(function (p) { return !p.error; }).length;
  setProgress(1, 1, (stopped ? 'Stopped. ' : 'Done. ') + ok + ' of ' + pageResults.length + ' page(s) converted.');
  log(stopped ? 'Stopped.' : 'Finished.');
  setRunning(false);
  if (ok) $('thanks').classList.remove('hidden');
});

$('stopBtn').addEventListener('click', function () { stopped = true; log('Stopping after the current page...'); });

/* ------------------------------- save / copy ------------------------------- */

function buildCombined() {
  var okPages = pageResults.filter(function (p) { return !p.error; });
  var title = ((okPages[0] && okPages[0].title) || 'Pages').trim();
  var header = (settings.frontMatter ? ptmFrontMatter({ title: title, url: sourceUrl, type: 'pages', site: ptmHost(sourceUrl) }) : '') +
    '# ' + title + '\n\nSource: ' + sourceUrl + '  \nPages: ' + okPages.length + (okPages.length !== pageResults.length ? ' of ' + pageResults.length : '') + '\n\n---\n\n';
  var body = $('preview').value.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim();
  return { title: title, text: header + body + '\n', ok: okPages.length };
}

$('saveBtn').addEventListener('click', function () {
  var c = buildCombined();
  if (!c.ok) return;
  var name = ptmFilename(settings.filenameTemplate, { title: c.title, site: ptmHost(sourceUrl) });
  var url = URL.createObjectURL(new Blob([c.text], { type: 'text/markdown;charset=utf-8' }));
  chrome.downloads.download({ url: url, filename: name, saveAs: !!settings.saveAs }, function () {
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  });
  log('Saved "' + name + '".');
  ptmCountExport();
});

$('copyBtn').addEventListener('click', function () {
  var c = buildCombined();
  if (!c.ok) return;
  navigator.clipboard.writeText(c.text).then(function () {
    log('Copied ' + c.text.length.toLocaleString() + ' characters to the clipboard.');
    ptmCountExport();
  }, function (e) { log('Copy failed: ' + e.message, true); });
});

/* --------------------------------- picker --------------------------------- */

function focusSourceTab() {
  return tabsGet(sourceTabId).then(function (tab) {
    return tabsUpdate(sourceTabId, { active: true }).then(function () {
      return chromeCall(function (cb) { chrome.windows.update(tab.windowId, { focused: true }, cb); });
    });
  });
}

function focusRunner() {
  chrome.tabs.getCurrent(function (me) {
    if (!me) return;
    chrome.tabs.update(me.id, { active: true });
    chrome.windows.update(me.windowId, { focused: true });
  });
}

document.querySelectorAll('[data-pick]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var field = btn.getAttribute('data-pick');
    var mode = btn.getAttribute('data-mode') || 'single';
    var label = btn.textContent;
    if (!sourceTabId) { log('No source tab to pick from.', true); return; }
    btn.disabled = true;
    btn.textContent = 'Click on the page...';
    focusSourceTab()
      .then(function () { return execScript(sourceTabId, startElementPicker, [mode === 'append' ? 'single' : mode]); })
      .then(function (res) {
        if (!res || !res.selector) { log('Nothing picked.'); return; }
        var input = $(field);
        if (mode === 'append' && input.value.trim()) input.value = input.value.trim().replace(/,\s*$/, '') + ', ' + res.selector;
        else input.value = res.selector;
        input.dispatchEvent(new Event('change'));
        log('Picked for ' + btn.getAttribute('data-label') + ': ' + res.selector + (mode === 'repeat' ? ' (' + res.count + ' items on this page)' : ''));
      })
      .catch(function (err) { log('Could not start picking: ' + err.message, true); })
      .then(function () { btn.disabled = false; btn.textContent = label; focusRunner(); });
  });
});

/* --------------------------- settings and memory --------------------------- */

var SELECTOR_FIELDS = ['contentSelector', 'itemSelector', 'itemHeadingSelector', 'itemDateSelector', 'excludeSelector'];
var siteKey = 'selectors:' + ptmHost(sourceUrl);

ptmGetSettings().then(function (s) {
  settings = s;
  $('usePresets').checked = s.usePresets !== false;
  $('cleanMode').checked = s.cleanMode !== false;
});

ptmLocalGet({ [siteKey]: null }).then(function (v) {
  var saved = v[siteKey];
  if (!saved) return;
  var any = false;
  SELECTOR_FIELDS.forEach(function (f) { if (saved[f]) { $(f).value = saved[f]; any = true; } });
  if (any) { $('advanced').open = true; log('Loaded the selectors you used last time on ' + ptmHost(sourceUrl) + '.'); }
});

SELECTOR_FIELDS.forEach(function (f) {
  $(f).addEventListener('change', function () {
    var o = {};
    SELECTOR_FIELDS.forEach(function (k) { o[k] = $(k).value.trim(); });
    var patch = {}; patch[siteKey] = o;
    ptmLocalSet(patch);
  });
});

$('clearSelectors').addEventListener('click', function () {
  SELECTOR_FIELDS.forEach(function (f) { $(f).value = ''; });
  var patch = {}; patch[siteKey] = null;
  ptmLocalSet(patch);
  log('Cleared the selectors for ' + ptmHost(sourceUrl) + '.');
});

$('thanksSupport').addEventListener('click', function () {
  ptmOpenSupport();
});

// Check the page straight away so the user sees what will happen.
detect().catch(function () { $('detectResult').textContent = 'Click "Check again" once the page has loaded.'; });
