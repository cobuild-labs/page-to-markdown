/**
 * captions.js - "Captions to Markdown".
 *
 * Two halves:
 *  A. Functions injected into the page (every frame). Each one is
 *     self-contained, because chrome.scripting.executeScript sends only the
 *     function's own source.
 *       ptmCaptionsFrameScan()   HTML5 <video> text tracks and <track src>.
 *                                Covers Vimeo, Video.js, Plyr, most course sites.
 *       ptmCaptionsYouTube()     YouTube watch pages and embeds (runs in the
 *                                page's MAIN world to reach the player).
 *       ptmYouTubeFetchTrack()   Downloads one YouTube caption track.
 *       ptmYouTubeTranscript()   Fallback: reads YouTube's "Show transcript" panel.
 *       ptmCaptionsFetchText()   Downloads a caption file from inside a frame.
 *       ptmCaptionsPageInfo()    The top page's title, H1 and active lesson.
 *  B. Parsers and the cleaner, used by the popup:
 *       ptmParseCaptions(text) -> cues   (WebVTT, SRT, TTML/DFXP, YouTube json3/xml)
 *       ptmCaptionsToText(cues) -> clean paragraphs, no timestamps
 *
 * Signed caption URLs (Vimeo) expire, so nothing here is cached: every click
 * reads the page again.
 */

/* ======================= A. injected into the page ======================= */

async function ptmCaptionsFrameScan() {
  var out = { frameUrl: location.href, top: window === window.top, tracks: [] };
  var CAPTION_KINDS = /^(captions|subtitles|)$/;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function readCues(tt) {
    var list = [];
    var cues = tt.cues;
    if (!cues) return list;
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      if (c && typeof c.text === 'string') list.push({ start: c.startTime, end: c.endTime, text: c.text });
    }
    return list;
  }
  var seenTrackEls = new Set();

  var videos = Array.prototype.slice.call(document.querySelectorAll('video, audio'));
  for (var v = 0; v < videos.length; v++) {
    var video = videos[v];
    var tts = video.textTracks || [];
    var trackEls = Array.prototype.slice.call(video.querySelectorAll('track'));
    for (var i = 0; i < tts.length; i++) {
      var tt = tts[i];
      if (!CAPTION_KINDS.test(tt.kind || '')) continue;
      var el = trackEls.filter(function (t) { return t.track === tt; })[0] || null;
      if (el) seenTrackEls.add(el);
      var cues = readCues(tt);
      var original = tt.mode;
      // Cues only load while a track is not "disabled". Switch it to hidden
      // (loads without showing anything), read, then put it back.
      if (!cues.length && original === 'disabled') {
        try {
          tt.mode = 'hidden';
          for (var w = 0; w < 15 && !(tt.cues && tt.cues.length); w++) await wait(200);
          cues = readCues(tt);
        } catch (e) { /* ignore */ }
        try { tt.mode = original; } catch (e) { /* ignore */ }
      }
      out.tracks.push({
        source: 'html5', label: tt.label || '', lang: tt.language || (el && el.srclang) || '',
        kind: tt.kind || 'subtitles', cues: cues, url: el ? el.src : ''
      });
    }
  }

  // <track> elements whose cues were not loaded: fetch the file here, in the
  // frame, where the player's own cookies and origin apply.
  document.querySelectorAll('track[src]').forEach(function (el) {
    if (seenTrackEls.has(el) || !CAPTION_KINDS.test(el.kind || '')) return;
    out.tracks.push({ source: 'track', label: el.label || '', lang: el.srclang || '', kind: el.kind || 'subtitles', cues: [], url: el.src });
  });
  for (var t = 0; t < out.tracks.length; t++) {
    var tr = out.tracks[t];
    if (tr.cues.length || !tr.url) continue;
    try {
      var res = await fetch(tr.url, { credentials: 'include' });
      if (res.ok) tr.raw = await res.text();
    } catch (e) { /* the popup will try the URL itself */ }
  }
  return out;
}

// Runs in the page's MAIN world (YouTube keeps the caption list in its player).
function ptmCaptionsYouTube() {
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname)) return null;
  var player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  var resp = null;
  try { resp = player && player.getPlayerResponse ? player.getPlayerResponse() : null; } catch (e) { /* ignore */ }
  var urlId = (location.search.match(/[?&]v=([\w-]{6,})/) || location.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/) || [])[1] || '';
  if (!resp || (urlId && resp.videoDetails && resp.videoDetails.videoId !== urlId)) {
    var initial = window.ytInitialPlayerResponse;
    if (initial && (!urlId || !initial.videoDetails || initial.videoDetails.videoId === urlId)) resp = initial;
  }
  if (!resp) return { frameUrl: location.href, top: window === window.top, youtube: true, tracks: [] };
  var list = (((resp.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
  function name(n) { return !n ? '' : n.simpleText || (n.runs || []).map(function (r) { return r.text; }).join(''); }
  return {
    frameUrl: location.href, top: window === window.top, youtube: true,
    title: (resp.videoDetails || {}).title || '',
    videoId: (resp.videoDetails || {}).videoId || urlId,
    tracks: list.map(function (t) {
      return { source: 'youtube', label: name(t.name), lang: t.languageCode || '', kind: t.kind === 'asr' ? 'asr' : 'captions', auto: t.kind === 'asr', url: t.baseUrl || '', cues: [] };
    })
  };
}

// MAIN world, YouTube frame: download one track. Tries json3, then the default XML.
async function ptmYouTubeFetchTrack(url) {
  var tries = [url.replace(/([?&])fmt=[^&]*/, '$1') + '&fmt=json3', url];
  for (var i = 0; i < tries.length; i++) {
    try {
      var res = await fetch(tries[i], { credentials: 'include' });
      if (!res.ok) continue;
      var text = await res.text();
      if (text && text.trim().length > 20) return text;
    } catch (e) { /* try the next one */ }
  }
  return '';
}

// YouTube frame: open "Show transcript" if needed and read its lines.
async function ptmYouTubeTranscript() {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function segs() { return document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model'); }
  var opened = false;
  function findButton() {
    return document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      Array.prototype.slice.call(document.querySelectorAll('button, ytd-button-renderer, tp-yt-paper-item')).filter(function (b) {
        return /^\s*show transcript\s*$/i.test(b.textContent || '') || /show transcript/i.test(b.getAttribute('aria-label') || '');
      })[0] || null;
  }
  if (!segs().length) {
    var btn = findButton();
    if (!btn) {
      var expand = document.querySelector('#description-inline-expander #expand, ytd-text-inline-expander #expand, #expand');
      if (expand) { expand.click(); await wait(600); btn = findButton(); }
    }
    if (!btn) return { cues: [], error: 'no-transcript-button' };
    btn.click();
    opened = true;
    var last = -1;
    for (var i = 0; i < 40; i++) {
      await wait(250);
      var n = segs().length;
      if (n && n === last) break;
      last = n;
    }
  }
  function toSec(s) {
    var p = (s || '').trim().split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.reduce(function (a, b) { return a * 60 + b; }, 0);
  }
  var cues = Array.prototype.slice.call(segs()).map(function (s) {
    var ts = s.querySelector('.segment-timestamp, [class*="timestamp"]');
    var tx = s.querySelector('.segment-text, yt-formatted-string, [class*="segment-text"], span[role="text"]');
    var text = (tx ? tx.textContent : s.textContent || '').replace(/\s+/g, ' ').trim();
    if (ts && !tx) text = text.replace((ts.textContent || '').trim(), '').trim();
    return { start: ts ? toSec(ts.textContent) : null, end: null, text: text };
  }).filter(function (c) { return c.text; });
  // The panel only shows start times; each line runs until the next one.
  cues.forEach(function (c, i) { c.end = cues[i + 1] && cues[i + 1].start != null ? cues[i + 1].start : c.start; });
  var langEl = document.querySelector('ytd-transcript-footer-renderer #label-text, ytd-transcript-footer-renderer tp-yt-paper-button, ytd-transcript-footer-renderer button');
  var label = langEl ? (langEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  if (label.length > 60) label = '';
  if (opened) {
    var close = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"] #visibility-button button');
    if (close) close.click();
  }
  return { cues: cues, label: label };
}

// Any frame: download a caption file with that frame's cookies and origin.
async function ptmCaptionsFetchText(url) {
  try {
    var res = await fetch(url, { credentials: 'include' });
    return res.ok ? await res.text() : '';
  } catch (e) { return ''; }
}

// Top frame: what to call the file.
function ptmCaptionsPageInfo() {
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  var h1 = document.querySelector('h1');
  var info = { url: location.href, title: clean(document.title), h1: h1 ? clean(h1.innerText || h1.textContent) : '', active: '' };
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    var yt = document.querySelector('h1.ytd-watch-metadata, ytd-watch-metadata h1, #title h1');
    if (yt) info.h1 = clean(yt.textContent);
    info.title = info.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    return info;
  }
  // The lesson that is playing, in a course playlist or sidebar.
  var lists = document.querySelectorAll('[class*="playlist" i], [class*="lesson" i], [class*="curriculum" i], [class*="chapter" i], [class*="sidebar" i], [id*="playlist" i], [id*="lesson" i], aside, nav');
  for (var i = 0; i < lists.length && !info.active; i++) {
    var cur = lists[i].querySelector('[aria-current="true"], [aria-current="page"], [aria-current="step"], [aria-selected="true"], [class*="active" i], [class*="current" i], [class*="playing" i], [class*="selected" i]');
    if (!cur) continue;
    var text = clean(String(cur.innerText || cur.textContent || '').split(/\n|\s{3,}/).filter(function (l) { return l.trim(); })[0]);
    if (text && text.length > 2 && text.length < 140) info.active = text;
  }
  return info;
}

/* ===================== B. parsers and cleaner (popup) ===================== */

function ptmParseTime(s) {
  if (s == null) return null;
  s = String(s).trim();
  var m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (m) return (+m[1] || 0) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4].padEnd(3, '0')) : 0);
  m = s.match(/^([\d.]+)(h|m|s|ms)?$/);
  if (m) {
    var n = parseFloat(m[1]);
    return m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 'ms' ? n / 1000 : n;
  }
  return null;
}

// WebVTT and SRT (same shape: blocks with a "start --> end" line).
function ptmParseVtt(text) {
  var cues = [];
  text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n{2,}/).forEach(function (block) {
    var lines = block.split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) return;
    var ti = lines.findIndex(function (l) { return l.indexOf('-->') >= 0; });
    if (ti < 0) return;
    var parts = lines[ti].split('-->');
    var start = ptmParseTime(parts[0]);
    var end = ptmParseTime((parts[1] || '').trim().split(/\s+/)[0]);
    var body = lines.slice(ti + 1).join('\n').trim();
    if (body) cues.push({ start: start, end: end, text: body });
  });
  return cues;
}

// TTML / DFXP, and YouTube's older <transcript><text start dur> XML.
function ptmParseXmlCaptions(text) {
  var doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  var root = doc.documentElement;
  var tickRate = +(root.getAttribute('ttp:tickRate') || root.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'tickRate')) || 10000000;
  function t(v) {
    if (!v) return null;
    var m = String(v).match(/^(\d+)t$/);
    return m ? +m[1] / tickRate : ptmParseTime(v);
  }
  function textOf(el) {
    var s = '';
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1) s += /^(br)$/i.test(n.localName) ? '\n' : textOf(n);
    });
    return s;
  }
  var cues = [];
  var ytText = root.localName === 'transcript' ? root.getElementsByTagName('text') : [];
  if (ytText.length) {
    Array.prototype.forEach.call(ytText, function (el) {
      var st = +el.getAttribute('start') || 0;
      cues.push({ start: st, end: st + (+el.getAttribute('dur') || 0), text: textOf(el) });
    });
    return cues;
  }
  var ps = root.getElementsByTagNameNS('*', 'p');
  if (!ps.length) ps = root.getElementsByTagName('p');
  Array.prototype.forEach.call(ps, function (p) {
    var st = t(p.getAttribute('begin') || p.getAttribute('t'));
    var en = t(p.getAttribute('end'));
    if (en == null && p.getAttribute('dur')) en = (st || 0) + t(p.getAttribute('dur'));
    if (en == null && p.getAttribute('d')) en = (st || 0) + (+p.getAttribute('d') / 1000);
    if (p.getAttribute('t') && !/[:.s]/.test(p.getAttribute('t'))) st = +p.getAttribute('t') / 1000;   // YouTube srv3: t/d in ms
    cues.push({ start: st, end: en, text: textOf(p) });
  });
  return cues;
}

// YouTube json3.
function ptmParseJson3(text) {
  var data = JSON.parse(text);
  return (data.events || []).filter(function (e) { return e.segs; }).map(function (e) {
    var st = (e.tStartMs || 0) / 1000;
    return { start: st, end: st + (e.dDurationMs || 0) / 1000, text: e.segs.map(function (s) { return s.utf8 || ''; }).join('') };
  }).filter(function (c) { return c.text.trim(); });
}

function ptmParseCaptions(text) {
  if (!text) return [];
  var s = text.replace(/^﻿/, '').trim();
  try {
    if (s[0] === '{') return ptmParseJson3(s);
    if (s[0] === '<') return ptmParseXmlCaptions(s);
  } catch (e) { return []; }
  return ptmParseVtt(s);
}

function ptmDecodeEntities(s) {
  var map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
    if (e[0] === '#') { var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1); return isNaN(n) ? m : String.fromCodePoint(n); }
    var k = e.toLowerCase();
    return k in map ? map[k] : m;
  });
}

/**
 * cues -> clean flowing paragraphs. No timestamps, no cue numbers, no tags,
 * no rolling repeats (auto captions repeat each line as the next one builds).
 * New paragraph on a pause of 2s+, on a change of speaker, or after about
 * five sentences. Speaker names from <v Name> become "Name: text".
 */
function ptmCaptionsToText(cues) {
  var items = [];
  cues.slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); }).forEach(function (c) {
    var raw = String(c.text || '');
    var speaker = (raw.match(/<v(?:\.[\w.-]+)?\s+([^>]+)>/) || [])[1] || '';
    var text = ptmDecodeEntities(raw.replace(/<[^>]*>/g, ''))
      .replace(/\{\\[^}]*\}/g, '')                          // SSA style codes that leak into SRT
      .replace(/\s+/g, ' ').trim();
    var turn = /^(>>|&gt;&gt;|-\s)/.test(text);              // ">>" or "- " marks a new speaker
    text = text.replace(/^(>>\s*|-\s+)/, '');
    text = text.replace(/^\[(music|applause|laughter|laughs|inaudible|silence|no audio|noise|cheering|music playing)\]$/i, '');
    if (!text) return;
    items.push({ start: c.start, end: c.end, text: text, speaker: speaker.trim(), turn: turn });
  });

  // Rolling repeats: append only the words a cue adds to what came before.
  function words(s) { return s.split(' '); }
  function key(w) { return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''); }
  var outWords = [];   // { w, k, gapBefore, speaker, turn }
  var prevEnd = null;
  items.forEach(function (it) {
    var ws = words(it.text);
    var ks = ws.map(key);
    var tail = outWords.slice(-80).map(function (o) { return o.k; });
    var overlap = 0;
    for (var n = Math.min(ks.length, tail.length); n > 0; n--) {
      var ok = true;
      for (var j = 0; j < n; j++) if (tail[tail.length - n + j] !== ks[j]) { ok = false; break; }
      if (ok) { overlap = n; break; }
    }
    // A cue fully inside the recent text is a repeat.
    if (overlap === 0 && ks.length >= 3) {
      var tailStr = ' ' + tail.join(' ') + ' ';
      if (tailStr.indexOf(' ' + ks.join(' ') + ' ') >= 0) overlap = ks.length;
    }
    var gap = prevEnd != null && it.start != null ? it.start - prevEnd : 0;
    var first = true;
    for (var x = overlap; x < ws.length; x++) {
      outWords.push({ w: ws[x], k: ks[x], gap: first ? gap : 0, speaker: it.speaker, turn: first && it.turn });
      first = false;
    }
    if (it.end != null) prevEnd = Math.max(prevEnd || 0, it.end);
    else if (it.start != null) prevEnd = it.start;
  });

  // Paragraphs.
  var paras = [];
  var cur = [], curSpeaker = null, sentences = 0, sinceBreak = 0;
  var hasPunct = outWords.some(function (o) { return /[.!?]["')\]]?$/.test(o.w); });
  function flush() {
    if (!cur.length) return;
    var p = cur.join(' ').replace(/\s+([,.!?;:])/g, '$1');
    p = p.charAt(0).toUpperCase() + p.slice(1);
    paras.push((curSpeaker ? curSpeaker + ': ' : '') + p);
    cur = []; sentences = 0; sinceBreak = 0;
  }
  outWords.forEach(function (o) {
    var newSpeaker = o.speaker && o.speaker !== curSpeaker;
    var endOfSentence = cur.length && /[.!?]["')\]]?$/.test(cur[cur.length - 1]);
    var longPause = o.gap >= 2;
    var tooLong = hasPunct ? (sentences >= 5 && endOfSentence) : (sinceBreak >= 110 || (sinceBreak >= 60 && o.gap >= 0.8));
    if (cur.length && (newSpeaker || o.turn || tooLong || (longPause && (endOfSentence || !hasPunct || sinceBreak > 25)))) flush();
    if (o.speaker) curSpeaker = o.speaker;
    cur.push(o.w);
    sinceBreak++;
    if (/[.!?]["')\]]?$/.test(o.w)) sentences++;
  });
  flush();
  return paras.join('\n\n');
}

// Human-readable language name, e.g. "en" -> "English".
function ptmLanguageName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch (e) { return code; }
}
