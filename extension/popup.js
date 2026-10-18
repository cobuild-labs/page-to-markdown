/* global chrome, PTM_CONFIG, ptmGetSettings, ptmSetSettings, ptmLocalGet, ptmLocalSet, ptmCountExport,
   ptmFilename, ptmFrontMatter, ptmOpen, ptmHost, ptmSupportUrl, ptmSupportTiers, ptmMountSupport, pageToMarkdownExtract,
   ptmCaptionsFrameScan, ptmCaptionsYouTube, ptmYouTubeFetchTrack, ptmYouTubeTranscript, ptmCaptionsFetchText,
   ptmCaptionsPageInfo, ptmParseCaptions, ptmCaptionsToText, ptmLanguageName */

var statusEl = document.getElementById('status');
var currentTab = null;
var settings = null;

function $(id) { return document.getElementById(id); }

function setStatus(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.className = kind || '';
  if (kind !== 'ok') $('thanks').classList.add('hidden');
}

function showThanks() { $('thanks').classList.remove('hidden'); }

function getTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { resolve(tabs[0] || null); });
  });
}

function exec(details) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript(details, function (results) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(results && results[0] ? results[0].result : undefined);
    });
  });
}

// Like exec, but returns every frame's result: [{ frameId, result }].
function execAll(details) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript(details, function (results) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(results || []);
    });
  });
}

function friendlyError(err) {
  var m = (err && err.message) || String(err);
  if (/Cannot access|chrome:\/\/|chrome-extension|webstore|edge:\/\//i.test(m)) return 'Chrome does not let extensions read this kind of page (browser settings, the Web Store, other extensions).';
  if (/Receiving end|No tab/i.test(m)) return 'The page is not ready yet. Reload it and try again.';
  return m;
}

function downloadMarkdown(filename, text, saveAs) {
  var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  chrome.downloads.download({ url: url, filename: filename, saveAs: !!saveAs }, function () {
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise(function (resolve, reject) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy') ? resolve() : reject(new Error('Copy failed')); } catch (e) { reject(e); }
    ta.remove();
  });
}

function sizeLabel(n) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

function refreshLabels() {
  var copy = $('copyInstead').checked;
  $('convertSub').textContent = copy ? 'Copies the current tab as Markdown' : 'Saves a .md file of the current tab';
  $('aiExport').firstChild.nodeValue = copy ? 'Copy this chat' : 'Export this chat';
  $('aiExportSub').textContent = copy ? 'Copies the Markdown to your clipboard' : 'Saves a .md file to Downloads';
  $('captionsSub').textContent = copy ? 'Copies a video\'s captions as plain text, no timestamps' : 'Saves a video\'s captions as plain text, no timestamps';
}

/* ------------------------------ page export ------------------------------ */

function buildPageText(result, title) {
  return (settings.frontMatter ? ptmFrontMatter({ title: title, url: result.url, type: result.layout === 'selection' ? 'selection' : 'page' }) : '') +
    (settings.sourceHeader ? '# ' + title + '\n\nSource: ' + result.url + '\n\n---\n\n' : '') +
    result.markdown + '\n';
}

function convertPage(opts) {
  opts = opts || {};
  var copy = $('copyInstead').checked;
  setStatus(copy ? 'Copying...' : 'Converting...');
  return exec({
    target: { tabId: currentTab.id },
    func: pageToMarkdownExtract,
    args: [{ selectionOnly: !!opts.selection, usePresets: settings.usePresets, clean: $('cleanMode').checked }]
  })
    .then(function (result) {
      if (!result || !result.markdown) throw new Error('Nothing readable was found on this page.');
      var title = (result.title || result.url) + (result.layout === 'selection' ? ' (selection)' : '');
      var text = buildPageText(result, title);
      var note = result.layout && result.layout !== 'page' && result.layout !== 'selection'
        ? ' (' + result.items.length + ' posts)' : '';
      if (copy) {
        return copyText(text).then(function () {
          setStatus('Copied ' + sizeLabel(text.length) + ' of Markdown' + note + '.', 'ok');
        });
      }
      var name = ptmFilename(settings.filenameTemplate, { title: title, site: ptmHost(result.url) });
      downloadMarkdown(name, text, settings.saveAs);
      setStatus('Saved "' + name + '"' + note + '.', 'ok');
    })
    .then(function () { showThanks(); return ptmCountExport(); })
    .catch(function (err) { setStatus(friendlyError(err), 'error'); });
}

$('convertCurrent').addEventListener('click', function () { convertPage({}); });
$('convertSelection').addEventListener('click', function () { convertPage({ selection: true }); });

/* ---------------------------- captions to markdown ---------------------------- */

var capFound = null;   // { candidates, info, ytTitle }

function capIsEnglish(c) { return /^en\b/i.test(c.lang || '') || /english/i.test(c.label || ''); }
function capIsAuto(c) { return !!c.auto || c.kind === 'asr' || /auto[- ]?generated|automatic/i.test(c.label || ''); }
function capName(c) {
  var name = (c.label || '').replace(/\s*\(auto[- ]?generated\)\s*/i, '').trim() || ptmLanguageName(c.lang) || 'Captions';
  return name + (capIsAuto(c) ? ' (auto-generated)' : '');
}

function scanCaptions() {
  var tabId = currentTab.id;
  return Promise.all([
    execAll({ target: { tabId: tabId, allFrames: true }, func: ptmCaptionsFrameScan }),
    execAll({ target: { tabId: tabId, allFrames: true }, world: 'MAIN', func: ptmCaptionsYouTube }).catch(function () { return []; }),
    exec({ target: { tabId: tabId }, func: ptmCaptionsPageInfo }).catch(function () { return null; })
  ]).then(function (all) {
    var candidates = [], seen = new Set(), ytTitle = '';
    all[0].concat(all[1]).forEach(function (fr) {
      var r = fr.result;
      if (!r || !r.tracks) return;
      if (r.youtube && r.title) ytTitle = ytTitle || r.title;
      r.tracks.forEach(function (t) {
        var c = Object.assign({ frameId: fr.frameId, frameUrl: r.frameUrl, youtube: !!r.youtube }, t);
        if (!c.cues.length && c.raw) c.cues = ptmParseCaptions(c.raw);
        if (!c.cues.length && !c.url) return;
        var k = c.cues.length ? (c.lang + '|' + c.cues.slice(0, 5).map(function (q) { return q.text; }).join(' ')) : c.url;
        if (seen.has(k) || (c.url && seen.has(c.url))) return;
        seen.add(k); if (c.url) seen.add(c.url);
        candidates.push(c);
      });
    });
    // English first, made by a person before auto-generated.
    candidates.sort(function (a, b) {
      function score(c) { return (capIsEnglish(c) ? 4 : 0) + (capIsAuto(c) ? 0 : 2) + (c.cues.length ? 1 : 0); }
      return score(b) - score(a);
    });
    return { candidates: candidates, info: all[2] || { url: currentTab.url, title: currentTab.title }, ytTitle: ytTitle };
  });
}

function loadCues(c) {
  var tabId = currentTab.id;
  if (c.cues.length) return Promise.resolve({ cues: c.cues });
  if (c.youtube) {
    return exec({ target: { tabId: tabId, frameIds: [c.frameId] }, world: 'MAIN', func: ptmYouTubeFetchTrack, args: [c.url] })
      .then(function (text) {
        var cues = ptmParseCaptions(text);
        if (cues.length) return { cues: cues };
        // YouTube sometimes refuses direct downloads; read its transcript panel instead.
        return exec({ target: { tabId: tabId, frameIds: [c.frameId] }, func: ptmYouTubeTranscript }).then(function (r) {
          return { cues: (r && r.cues) || [], panel: true, panelLabel: r && r.label };
        });
      });
  }
  return exec({ target: { tabId: tabId, frameIds: [c.frameId] }, func: ptmCaptionsFetchText, args: [c.url] })
    .then(function (text) {
      var cues = ptmParseCaptions(text);
      if (cues.length) return { cues: cues };
      return fetch(c.url).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; })
        .then(function (t2) { return { cues: ptmParseCaptions(t2) }; });
    });
}

function captionTitle(found, c) {
  var i = found.info || {};
  if (c.youtube && found.ytTitle) return found.ytTitle;
  var h1 = i.h1 || '', active = i.active || '';
  if (h1 && active && h1.toLowerCase().indexOf(active.toLowerCase()) < 0 && active.toLowerCase().indexOf(h1.toLowerCase()) < 0) return h1 + ' - ' + active;
  return h1 || active || i.title || 'Captions';
}

function saveCaptions(c) {
  var copy = $('copyInstead').checked;
  setStatus('Reading the captions...');
  $('captions').disabled = true;
  return loadCues(c)
    .then(function (r) {
      var body = r.cues.length ? ptmCaptionsToText(r.cues) : '';
      if (!body) throw new Error('These captions came back empty. Start the video for a second, then try again.');
      var title = captionTitle(capFound, c);
      var lang = r.panel && r.panelLabel && /\w/.test(r.panelLabel) ? r.panelLabel : capName(c);
      var url = (capFound.info && capFound.info.url) || currentTab.url;
      var text = (settings.frontMatter ? ptmFrontMatter({ title: title, url: url, type: 'captions' }) : '') +
        '# ' + title + '\n\nSource: ' + url + '  \nCaptions: ' + lang + '\n\n---\n\n' + body + '\n';
      var words = (body.match(/\S+/g) || []).length.toLocaleString() + ' words';
      if (copy) return copyText(text).then(function () { setStatus('Copied the captions (' + words + ').', 'ok'); });
      var name = ptmFilename(settings.filenameTemplate, { title: title, site: ptmHost(url) });
      downloadMarkdown(name, text, settings.saveAs);
      setStatus('Saved "' + name + '" (' + words + ').', 'ok');
    })
    .then(function () { $('capPick').classList.add('hidden'); showThanks(); return ptmCountExport(); })
    .catch(function (err) { setStatus(friendlyError(err), 'error'); })
    .then(function () { $('captions').disabled = false; });
}

function showCaptionPicker(found) {
  var box = $('capPick'), at = 0;
  function draw() {
    var acts = '<div class="cap-acts"><button type="button" class="cancel">Cancel</button><button type="button" class="go">' +
      ($('copyInstead').checked ? 'Copy' : 'Save') + '</button></div>';
    if (found.candidates.length > 5) {
      // Many languages (YouTube often has 20+): a dropdown, best match first.
      box.innerHTML = '<h3>' + found.candidates.length + ' caption tracks found</h3><select class="cap-select">' +
        found.candidates.map(function (c, i) { return '<option value="' + i + '">' + capName(c).replace(/[<&]/g, '') + '</option>'; }).join('') +
        '</select>' + acts;
      var sel = box.querySelector('select');
      sel.onchange = function () { at = +sel.value; };
      box.querySelector('.cancel').onclick = function () { box.classList.add('hidden'); setStatus(''); };
      box.querySelector('.go').onclick = function () { saveCaptions(found.candidates[at]); };
      return;
    }
    box.innerHTML = '<h3>' + found.candidates.length + ' caption tracks found</h3>' + found.candidates.map(function (c, i) {
      var where = c.frameUrl && currentTab.url && ptmHost(c.frameUrl) !== ptmHost(currentTab.url) ? ptmHost(c.frameUrl) : '';
      return '<button type="button" role="radio" aria-checked="' + (i === at) + '" class="cap-opt' + (i === at ? ' on' : '') + '" data-i="' + i + '">' +
        capName(c).replace(/[<&]/g, '') + (where ? '<small>' + where + '</small>' : '') + '</button>';
    }).join('') + acts;
    box.querySelectorAll('.cap-opt').forEach(function (b) { b.onclick = function () { at = +b.getAttribute('data-i'); draw(); }; });
    box.querySelector('.cancel').onclick = function () { box.classList.add('hidden'); setStatus(''); };
    box.querySelector('.go').onclick = function () { saveCaptions(found.candidates[at]); };
  }
  draw();
  box.classList.remove('hidden');
}

$('captions').addEventListener('click', function () {
  setStatus('Looking for captions in every frame of this page...');
  $('captions').disabled = true;
  $('capPick').classList.add('hidden');
  scanCaptions()
    .then(function (found) {
      capFound = found;
      $('captions').disabled = false;
      if (!found.candidates.length) {
        setStatus('No captions found on this page. If the video has a CC button, turn captions on, play a few seconds and try again. ' +
          'Videos that only draw captions on screen will be covered by a "record while playing" mode in a later version.', 'error');
        return;
      }
      if (found.candidates.length === 1) return saveCaptions(found.candidates[0]);
      setStatus('');
      showCaptionPicker(found);
    })
    .catch(function (err) { $('captions').disabled = false; setStatus(friendlyError(err), 'error'); });
});

$('openRunner').addEventListener('click', function () {
  var url = chrome.runtime.getURL('runner.html') +
    '?tabId=' + encodeURIComponent(currentTab.id) + '&url=' + encodeURIComponent(currentTab.url || '');
  chrome.tabs.create({ url: url });
  window.close();
});

['cleanMode', 'copyInstead'].forEach(function (id) {
  $(id).addEventListener('change', function () {
    var patch = {}; patch[id] = $(id).checked;
    ptmSetSettings(patch);
    refreshLabels();
  });
});

/* ---------------------------- AI chat export ----------------------------- */

var AI_SITES = [
  { re: /^https:\/\/([\w-]+\.)?claude\.ai\//, name: 'Claude' },
  { re: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//, name: 'ChatGPT' },
  { re: /^https:\/\/gemini\.google\.com\//, name: 'Gemini' },
  { re: /^https:\/\/(grok\.com\/|x\.com\/i\/grok)/, name: 'Grok' }
];

function aiOptionsFromUi() {
  return {
    mode: document.querySelector('input[name=aiMode]:checked').value,
    includeSources: $('aiSources').checked,
    maxToolChars: parseInt($('aiTrim').value, 10) || 0
  };
}

function saveRawPage() {
  return new Promise(function (resolve) {
    if (!chrome.pageCapture) { resolve(false); return; }
    chrome.pageCapture.saveAsMHTML({ tabId: currentTab.id }, function (blob) {
      if (chrome.runtime.lastError || !blob) { resolve(false); return; }
      var url = URL.createObjectURL(blob);
      var name = ptmFilename('{title} (raw page)', { title: currentTab.title || 'chat' }).replace(/\.md$/, '.mhtml');
      chrome.downloads.download({ url: url, filename: name }, function () {
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        resolve(true);
      });
    });
  });
}

$('aiExport').addEventListener('click', function () {
  var copy = $('copyInstead').checked;
  var opts = aiOptionsFromUi();
  var wantRaw = $('aiRaw').checked;
  var pageSaves = !copy && !settings.saveAs;   // the page saves the file itself, so it finishes even if this popup closes
  opts.download = pageSaves;
  opts.frontMatter = settings.frontMatter;
  opts.filenameTemplate = settings.filenameTemplate;

  $('aiExport').disabled = true;
  setStatus('Working... collapsed sections are being opened, this can take a few seconds.');
  ptmSetSettings({ aiMode: opts.mode, aiSources: opts.includeSources, aiTrim: opts.maxToolChars, aiRaw: wantRaw });

  exec({ target: { tabId: currentTab.id }, files: ['aiexport.js'] })
    .then(function () {
      return exec({ target: { tabId: currentTab.id }, func: function (o) { return window.__ptmAiExport(o); }, args: [opts] });
    })
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Export failed.');
      var s = res.stats || {};
      var bits = [];
      if (s.messages) bits.push(s.messages + ' messages');
      if (s.toolCalls) bits.push(s.toolCalls + ' tool calls');
      if (s.thinking) bits.push(s.thinking + ' thinking blocks');
      if (s.sources) bits.push(s.sources + ' sources');
      var detail = (bits.length ? '\n' + bits.join(', ') : '') + (res.warning ? '\nUsed the on-screen view (' + res.warning + ').' : '');
      if (copy) {
        return copyText(res.markdown).then(function () { setStatus('Copied ' + sizeLabel(res.markdown.length) + ' to the clipboard.' + detail, 'ok'); });
      }
      if (!pageSaves) downloadMarkdown(res.filename, res.markdown, true);
      setStatus('Saved "' + res.filename + '"' + detail, 'ok');
    })
    .then(function () { showThanks(); return ptmCountExport(); })
    .then(function () { return wantRaw && !copy ? saveRawPage() : null; })
    .then(function (raw) { if (raw === true) statusEl.textContent += '\nRaw page saved too.'; })
    .catch(function (err) { setStatus('Could not export: ' + friendlyError(err), 'error'); })
    .then(function () { $('aiExport').disabled = false; });
});

/* ------------------------- support + "enjoying it?" ------------------------ */

// The coffee picker replaces the popup's content until it is closed.
function openSupport() {
  if (!ptmSupportTiers(settings).length) { chrome.tabs.create({ url: chrome.runtime.getURL('options.html#support') }); return; }
  var sheet = $('supportSheet');
  ptmMountSupport(sheet, settings, { onClose: closeSupport });
  document.querySelector('header').classList.add('hidden');
  document.querySelector('main').classList.add('hidden');
  document.querySelector('footer').classList.add('hidden');
  sheet.classList.remove('hidden');
  var on = sheet.querySelector('.sp-tier.on'); if (on) on.focus();
}
function closeSupport() {
  $('supportSheet').classList.add('hidden');
  document.querySelector('header').classList.remove('hidden');
  document.querySelector('main').classList.remove('hidden');
  document.querySelector('footer').classList.remove('hidden');
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !$('supportSheet').classList.contains('hidden')) { e.preventDefault(); closeSupport(); }
});

function setupSupport() {
  var c = PTM_CONFIG || {};
  var label = '☕ ' + (c.supportLabel || 'Buy me a coffee');
  ['support', 'thanksSupport', 'promptSupport'].forEach(function (id) {
    $(id).textContent = label;
    $(id).addEventListener('click', openSupport);
  });
  if (c.repoUrl) {
    $('report').classList.remove('hidden');
    $('report').addEventListener('click', function () { ptmOpen(c.repoUrl.replace(/\/$/, '') + '/issues/new/choose'); });
  } else {
    $('promptStar').classList.add('hidden');
  }

  ptmLocalGet({ exportCount: 0, promptState: {} }).then(function (v) {
    var st = v.promptState || {};
    var count = v.exportCount || 0;
    var dueAt = st.snoozeUntil || c.promptAfterExports || 5;
    if (st.never || st.supported || count < dueAt) return;
    $('promptText').textContent = count + ' exports so far. Enjoying Page to Markdown?';
    $('prompt').classList.remove('hidden');
    function close(patch) {
      $('prompt').classList.add('hidden');
      ptmLocalSet({ promptState: Object.assign({}, st, patch) });
    }
    $('promptSupport').addEventListener('click', function () { close({ supported: true }); });
    $('promptStar').onclick = function () { close({ supported: true }); ptmOpen(c.repoUrl); };
    $('promptLater').onclick = function () { close({ snoozeUntil: count + (c.promptSnoozeExports || 25) }); };
    $('promptNever').onclick = function () { close({ never: true }); };
  });
}

/* --------------------------------- init ---------------------------------- */

function openOptions() { chrome.runtime.openOptionsPage(); }
$('openOptions').addEventListener('click', openOptions);
$('footerOptions').addEventListener('click', openOptions);
$('version').textContent = 'v' + chrome.runtime.getManifest().version;

Promise.all([getTab(), ptmGetSettings()]).then(function (r) {
  currentTab = r[0];
  settings = r[1];
  $('cleanMode').checked = settings.cleanMode !== false;
  $('copyInstead').checked = !!settings.copyInstead;
  refreshLabels();
  setupSupport();
  if (!currentTab) { setStatus('No active tab.', 'error'); return; }

  var site = AI_SITES.filter(function (s) { return s.re.test(currentTab.url || ''); })[0];
  if (site) {
    $('aiSection').classList.remove('hidden');
    $('aiSite').textContent = '(' + site.name + ')';
    var radio = document.querySelector('input[name=aiMode][value="' + settings.aiMode + '"]') || document.querySelector('input[name=aiMode]');
    radio.checked = true;
    $('aiSources').checked = settings.aiSources;
    $('aiRaw').checked = settings.aiRaw;
    $('aiTrim').value = String(settings.aiTrim || 0);
  } else {
    $('convertCurrent').classList.add('primary');
  }

  exec({ target: { tabId: currentTab.id }, func: function () { return String(window.getSelection ? window.getSelection() : '').trim().length; } })
    .then(function (n) {
      if (n > 0) {
        $('convertSelection').classList.remove('hidden');
        $('selectionInfo').textContent = n.toLocaleString() + ' characters selected';
      }
    })
    .catch(function () { /* restricted page */ });
});
