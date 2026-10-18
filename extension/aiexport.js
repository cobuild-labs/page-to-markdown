/**
 * aiexport.js - "AI chat export" for Claude, ChatGPT, Gemini and Grok.
 *
 * Injected into the chat tab with chrome.scripting.executeScript({files}),
 * then started with window.__ptmAiExport(options). Runs entirely inside the
 * user's own browser tab; nothing is sent anywhere. The Markdown file is
 * downloaded straight from the page, so the export finishes even if the
 * extension popup closes.
 *
 * options:
 *   mode            'chat'  - only your messages and the AI's replies
 *                   'full'  - plus thinking, every tool call (inputs such as
 *                             scripts/commands/queries) and every tool result
 *   includeSources  true/false - list links/citations the AI used
 *   maxToolChars    0 = keep tool inputs/results in full, else trim to N chars
 *   download        true = save the .md from the page (default true)
 *   fast            tests only: skip waits
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function sleep(ms, opts) { return new Promise(function (r) { setTimeout(r, opts && opts.fast ? 0 : ms); }); }

  function absUrl(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } }

  function textOf(el) { return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

  // A code fence longer than any run of backticks inside the text, so tool
  // outputs that themselves contain ``` can't break the export.
  function fence(text, lang) {
    text = String(text == null ? '' : text);
    var longest = 2;
    var m = text.match(/`+/g);
    if (m) m.forEach(function (s) { if (s.length > longest) longest = s.length; });
    var f = new Array(longest + 2).join('`');
    return f + (lang || '') + '\n' + text.replace(/\n+$/, '') + '\n' + f;
  }

  function trim(text, max) {
    text = String(text == null ? '' : text);
    if (!max || text.length <= max) return text;
    return text.slice(0, max) + '\n... [trimmed ' + (text.length - max).toLocaleString() + ' more characters]';
  }

  function quote(text) {
    return String(text).replace(/\n{3,}/g, '\n\n').split('\n').map(function (l) { return '> ' + l; }).join('\n');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function SourceList() {
    var seen = {};
    var list = [];
    return {
      add: function (url, title) {
        if (!url || !/^https?:/i.test(url)) return;
        var key = url.replace(/#.*$/, '');
        if (seen[key]) { if (title && !seen[key].title) seen[key].title = title; return; }
        seen[key] = { url: url, title: (title || '').trim() };
        list.push(seen[key]);
      },
      items: function () { return list; },
      md: function () {
        return list.map(function (s) { return '- ' + (s.title ? '[' + s.title.replace(/[\[\]]/g, '') + '](' + s.url + ')' : s.url); }).join('\n');
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * On-page progress toast
   * ------------------------------------------------------------------ */
  var toastEl = null;
  function toast(msg) {
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;' +
          'background:#111827;color:#fff;font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;' +
          'padding:10px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);';
        document.documentElement.appendChild(toastEl);
      }
      toastEl.textContent = 'AI export: ' + msg;
    } catch (e) { /* ignore */ }
  }
  function toastDone(msg) {
    toast(msg);
    setTimeout(function () { if (toastEl) { toastEl.remove(); toastEl = null; } }, 4000);
  }

  /* ------------------------------------------------------------------ *
   * HTML -> Markdown (for the on-screen sites)
   * ------------------------------------------------------------------ */
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, BUTTON: 1, IFRAME: 1, TEXTAREA: 1, INPUT: 1 };

  function isVisuallyHidden(el) {
    var cls = (el.getAttribute && el.getAttribute('class')) || '';
    if (/\b(sr-only|cdk-visually-hidden|visually-hidden|screen-reader[\w-]*)\b/.test(cls) && !/not-sr-only\b/.test(cls.replace(/print:not-sr-only/g, ''))) return true;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    try {
      var cs = window.getComputedStyle(el);
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function htmlToMd(root, exclude) {
    exclude = exclude || new Set();
    function kids(n) { var s = ''; n.childNodes.forEach(function (c) { s += node(c, n); }); return s; }
    function list(el, ordered) {
      var out = '\n', i = 1;
      Array.prototype.forEach.call(el.children, function (li) {
        if (li.tagName !== 'LI') return;
        var inner = kids(li).trim().split('\n').map(function (l, k) { return k === 0 ? l : (l.trim() ? '  ' + l : l); }).join('\n');
        out += (ordered ? (i++) + '. ' : '- ') + inner + '\n';
      });
      return out + '\n';
    }
    function table(el) {
      var rows = Array.prototype.slice.call(el.querySelectorAll('tr'));
      if (!rows.length) return '';
      var w = 0;
      var g = rows.map(function (r) {
        var c = Array.prototype.slice.call(r.querySelectorAll('th,td')).map(function (x) { return textOf(x).replace(/\|/g, '\\|') || ' '; });
        w = Math.max(w, c.length); return c;
      });
      g.forEach(function (r) { while (r.length < w) r.push(' '); });
      var out = '\n| ' + g[0].join(' | ') + ' |\n|' + new Array(w + 1).join(' --- |') + '\n';
      for (var k = 1; k < g.length; k++) out += '| ' + g[k].join(' | ') + ' |\n';
      return out + '\n';
    }
    function node(n) {
      if (n.nodeType === 3) return (n.nodeValue || '').replace(/[ \t\r\n]+/g, ' ');
      if (n.nodeType !== 1) return '';
      var el = n, tag = el.tagName.toUpperCase();
      if (exclude.has(el)) return '';
      // Inline source chips / citation badges: keep the label as a marker.
      var cls = el.getAttribute('class') || '';
      if (/source-inline-chip/.test(cls) || el.getAttribute('data-d-component') === 'badge') {
        var lbl = textOf(el);
        return lbl ? ' [source: ' + lbl + '] ' : '';
      }
      if (SKIP[tag] || tag.indexOf('-') > 0 && /^(MESSAGE-ACTIONS|COPY-BUTTON|THUMB-UP-BUTTON|THUMB-DOWN-BUTTON|SOURCES-CAROUSEL-INLINE)$/.test(tag)) return '';
      if (isVisuallyHidden(el)) return '';
      switch (tag) {
        case 'BR': return '  \n';
        case 'HR': return '\n\n---\n\n';
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
          return '\n\n' + new Array(+tag[1] + 1).join('#') + ' ' + kids(el).trim() + '\n\n';
        case 'STRONG': case 'B': { var b = kids(el).trim(); return b ? '**' + b + '**' : ''; }
        case 'EM': case 'I': { var it = kids(el).trim(); return it ? '*' + it + '*' : ''; }
        case 'DEL': case 'S': { var d = kids(el).trim(); return d ? '~~' + d + '~~' : ''; }
        case 'CODE':
          if (el.parentElement && el.parentElement.tagName === 'PRE') return el.textContent;
          return el.textContent.trim() ? '`' + el.textContent.trim() + '`' : '';
        case 'PRE': {
          var codeEl = el.querySelector('code') || el;
          var lang = ((codeEl.getAttribute('class') || '').match(/language-([\w+-]+)/) || [])[1] || '';
          return '\n\n' + fence(codeEl.textContent, lang) + '\n\n';
        }
        case 'BLOCKQUOTE': { var q = kids(el).trim(); return q ? '\n\n' + quote(q) + '\n\n' : ''; }
        case 'A': {
          var href = el.getAttribute('href'), label = kids(el).trim() || textOf(el);
          if (!href || /^(javascript:|#)/i.test(href) || !label) return label;
          return '[' + label + '](' + absUrl(href) + ')';
        }
        case 'IMG': {
          var src = el.getAttribute('src');
          if (!src || /^data:/.test(src)) return el.getAttribute('alt') ? '[image: ' + el.getAttribute('alt') + ']' : '';
          return '![' + (el.getAttribute('alt') || '') + '](' + absUrl(src) + ')';
        }
        case 'UL': return list(el, false);
        case 'OL': return list(el, true);
        case 'TABLE': return table(el);
        case 'P': case 'DIV': case 'SECTION': case 'ARTICLE': case 'LI': case 'HEADER': case 'FOOTER': case 'FIGURE': {
          var inner = kids(el).trim();
          return inner ? '\n\n' + inner + '\n\n' : '';
        }
        default: return kids(el);
      }
    }
    return node(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  /* ------------------------------------------------------------------ *
   * Interaction helpers for the on-screen sites
   * ------------------------------------------------------------------ */
  function allLinks(scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll('a[href^="http"]'));
  }

  function isChromeLink(a) {
    // Site navigation / sidebar / own-chat links, never sources.
    // Only real navigation areas; some apps (e.g. Grok) wrap the whole page in
    // a container whose class merely contains the word "sidebar".
    if (a.closest('nav, [data-testid="sidebar"], side-navigation-content, mat-sidenav, [class~="sidebar"], [role="navigation"]')) return true;
    var host = location.hostname.replace(/^www\./, '');
    var h = ''; try { h = new URL(a.href).hostname.replace(/^www\./, ''); } catch (e) { return true; }
    return h === host || /(^|\.)google\.com$/.test(h) && /accounts|support|policies|about/.test(a.href);
  }

  function pressEscape() {
    ['keydown', 'keyup'].forEach(function (t) {
      try { document.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } catch (e) { /* ignore */ }
    });
  }

  // Click a button that reveals more links (a "Sources" panel or a source
  // chip), collect any new external links that appeared, then close it.
  async function clickAndHarvest(btn, sources, opts) {
    var before = new Set(allLinks().map(function (a) { return a.href; }));
    try { btn.click(); } catch (e) { return; }
    await sleep(700, opts);
    allLinks().forEach(function (a) {
      if (before.has(a.href) || isChromeLink(a)) return;
      sources.add(a.href, textOf(a).slice(0, 140));
    });
    pressEscape();
    await sleep(150, opts);
    if (btn.getAttribute('aria-expanded') === 'true') { try { btn.click(); } catch (e) { /* ignore */ } }
    await sleep(150, opts);
  }

  // Expand collapsed sections whose button text/label matches a pattern.
  async function expandMatching(scope, pattern, opts) {
    var n = 0;
    Array.prototype.slice.call(scope.querySelectorAll('button, [role="button"]')).forEach(function (b) {
      var label = ((b.getAttribute('aria-label') || '') + ' ' + textOf(b)).trim();
      if (!pattern.test(label)) return;
      if (b.getAttribute('aria-expanded') === 'true') return;
      try { b.click(); n++; } catch (e) { /* ignore */ }
    });
    if (n) await sleep(600, opts);
    return n;
  }

  // Text inside a reply container that is NOT the main answer: this is where
  // expanded thinking / "worked for" panels end up on every site.
  function extraWorkText(container, mainEls, dropSelector) {
    var clone = container.cloneNode(true);
    // Map main elements in the original to the clone by index path.
    function pathOf(el) { var p = []; while (el && el !== container) { var i = Array.prototype.indexOf.call(el.parentNode.children, el); p.unshift(i); el = el.parentNode; } return p; }
    function byPath(root, p) { var el = root; for (var k = 0; k < p.length && el; k++) el = el.children[p[k]]; return el; }
    mainEls.forEach(function (m) { if (!m || !container.contains(m)) return; var c = byPath(clone, pathOf(m)); if (c) c.remove(); });
    if (dropSelector) { try { clone.querySelectorAll(dropSelector).forEach(function (e) { e.remove(); }); } catch (e) { /* ignore */ } }
    clone.querySelectorAll('button, [role="button"], svg, [class*="sr-only"], .cdk-visually-hidden').forEach(function (e) { e.remove(); });
    var t = (clone.innerText || clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return t.length > 15 ? t : '';
  }

  /* ------------------------------------------------------------------ *
   * Claude: full conversation data (everything behind the summaries)
   * ------------------------------------------------------------------ */
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-.]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function claudeFetchConversation(convId) {
    var orgIds = [];
    var cookieOrg = getCookie('lastActiveOrg');
    if (cookieOrg) orgIds.push(cookieOrg);
    try {
      var orgs = await fetch('/api/organizations', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : []; });
      (orgs || []).forEach(function (o) { if (o && o.uuid && orgIds.indexOf(o.uuid) < 0) orgIds.push(o.uuid); });
    } catch (e) { /* fall through */ }
    for (var i = 0; i < orgIds.length; i++) {
      var url = '/api/organizations/' + orgIds[i] + '/chat_conversations/' + convId +
        '?tree=True&rendering_mode=messages&render_all_tools=true';
      try {
        var r = await fetch(url, { credentials: 'include' });
        if (r.ok) return await r.json();
      } catch (e) { /* try next org */ }
    }
    throw new Error('Could not load this conversation\'s data (are you signed in?)');
  }

  // Follow the branch that is currently shown (edits/retries create branches).
  function claudeActiveBranch(conv) {
    var msgs = conv.chat_messages || [];
    var byId = {};
    msgs.forEach(function (m) { byId[m.uuid] = m; });
    var leaf = conv.current_leaf_message_uuid && byId[conv.current_leaf_message_uuid];
    if (!leaf) return msgs.slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    var chain = [], cur = leaf, guard = 0;
    while (cur && guard++ < 10000) { chain.unshift(cur); cur = byId[cur.parent_message_uuid]; }
    return chain;
  }

  function collectUrls(obj, into, depth) {
    if (!obj || depth > 5) return;
    if (Array.isArray(obj)) { obj.forEach(function (x) { collectUrls(x, into, depth + 1); }); return; }
    if (typeof obj !== 'object') return;
    var url = obj.url || obj.uri || obj.source_url;
    if (typeof url === 'string' && /^https?:/i.test(url)) into.push({ url: url, title: obj.title || obj.name || obj.source || '' });
    Object.keys(obj).forEach(function (k) { if (obj[k] && typeof obj[k] === 'object') collectUrls(obj[k], into, depth + 1); });
  }

  // Render a tool's input readably: long/multiline strings (scripts, code,
  // commands, page text) become code blocks; short values stay inline.
  function renderToolInput(input, max) {
    if (input == null) return '';
    if (typeof input !== 'object') return fence(trim(String(input), max));
    var keys = Object.keys(input);
    if (!keys.length) return '_(no input)_';
    var inline = [], blocks = [];
    keys.forEach(function (k) {
      var v = input[k];
      if (typeof v === 'string' && (v.indexOf('\n') >= 0 || v.length > 160)) {
        var lang = /^(code|script|text|query)$/i.test(k) ? '' : '';
        if (/^(code|script)$/i.test(k)) lang = /^\s*(import |def |from |print\()/.test(v) ? 'python' : (/(const |function |=>|document\.)/.test(v) ? 'javascript' : '');
        if (/^command$/i.test(k)) lang = 'bash';
        blocks.push('`' + k + '`:\n' + fence(trim(v, max), lang));
      } else if (v !== null && typeof v === 'object') {
        var js = JSON.stringify(v, null, 2);
        if (js.length > 160) blocks.push('`' + k + '`:\n' + fence(trim(js, max), 'json'));
        else inline.push('`' + k + '`: ' + js.replace(/\n\s*/g, ' '));
      } else {
        inline.push('`' + k + '`: ' + String(v));
      }
    });
    return (inline.length ? inline.map(function (s) { return '- ' + s; }).join('\n') : '') +
      (inline.length && blocks.length ? '\n\n' : '') + blocks.join('\n\n');
  }

  function renderToolResult(block, max, sources) {
    var c = block.content;
    var parts = [];
    var links = [];
    if (typeof c === 'string') parts.push(fence(trim(c, max)));
    else if (Array.isArray(c)) {
      var textBuf = [];
      c.forEach(function (it) {
        if (!it || typeof it !== 'object') { textBuf.push(String(it)); return; }
        if (it.type === 'text' && typeof it.text === 'string') textBuf.push(it.text);
        else if (it.type === 'image') textBuf.push('[image / screenshot]');
        else if (it.type === 'knowledge' || it.url) {
          links.push({ url: it.url, title: it.title || '' });
          var snip = it.text || (it.metadata && it.metadata.text) || '';
          textBuf.push('- ' + (it.title || it.url) + (it.url ? ' (' + it.url + ')' : '') + (snip ? '\n  ' + trim(String(snip).replace(/\s+/g, ' '), 400) : ''));
        } else textBuf.push(JSON.stringify(it));
      });
      if (textBuf.length) parts.push(fence(trim(textBuf.join('\n'), max)));
    } else if (c != null) parts.push(fence(trim(JSON.stringify(c, null, 2), max), 'json'));
    collectUrls(block.content, links, 0);
    links.forEach(function (l) { sources.add(l.url, l.title); });
    return parts.join('\n\n') || '_(empty result)_';
  }

  async function exportClaude(opts) {
    var m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    if (!m) throw new Error('Open a Claude chat (claude.ai/chat/...) first.');
    toast('loading the full conversation data...');
    var conv = await claudeFetchConversation(m[1]);
    var branch = claudeActiveBranch(conv);
    var full = opts.mode === 'full';
    var max = opts.maxToolChars || 0;
    var allSources = SourceList();
    var stats = { messages: 0, toolCalls: 0, thinking: 0, sources: 0 };
    var out = [];
    var turn = 0;

    branch.forEach(function (msg) {
      var isUser = msg.sender === 'human';
      if (isUser) turn++;
      stats.messages++;
      var head = '## ' + (isUser ? 'You' : 'Claude') + ' (turn ' + turn + (msg.created_at ? ', ' + fmtDate(msg.created_at) : '') + ')';
      var body = [];
      var replySources = SourceList();
      var stepNo = 0;
      var toolNames = {};

      (msg.content || []).forEach(function (b) {
        if (!b || !b.type) return;
        if (b.type === 'text') {
          if (b.text && b.text.trim()) body.push(b.text.trim());
          var cites = [];
          collectUrls(b.citations, cites, 0);
          cites.forEach(function (s) { replySources.add(s.url, s.title); allSources.add(s.url, s.title); });
        } else if (b.type === 'thinking') {
          if (!full) return;
          var th = b.thinking || (b.summaries || []).map(function (s) { return s.summary || ''; }).join('\n');
          if (th && th.trim()) { stats.thinking++; body.push('**[Thinking]**\n\n' + quote(trim(th.trim(), max))); }
        } else if (b.type === 'tool_use') {
          if (!full) return;
          stepNo++; stats.toolCalls++;
          toolNames[b.id] = b.name;
          var desc = b.message || (b.display_content && b.display_content.text) || '';
          body.push('**[Step ' + stepNo + ': tool `' + (b.name || 'tool') + '`]**' + (desc ? ' ' + desc : '') +
            '\n\n' + renderToolInput(b.input, max));
        } else if (b.type === 'tool_result') {
          var res = renderToolResult(b, max, replySources);
          if (!full) return;
          var nm = b.name || toolNames[b.tool_use_id] || 'tool';
          body.push('**[Result of `' + nm + '`' + (b.is_error ? ', ERROR' : '') + ']**\n\n' + res);
        } else if (b.type === 'image') {
          body.push('[image]');
        } else if (full) {
          body.push('**[' + b.type + ']**\n\n' + fence(trim(JSON.stringify(b, null, 2), max), 'json'));
        }
      });

      replySources.items().forEach(function (s) { allSources.add(s.url, s.title); });

      var files = [].concat(msg.attachments || [], msg.files_v2 || msg.files || []);
      if (files.length) {
        body.unshift('**Attached:** ' + files.map(function (f) { return f.file_name || f.name || 'file'; }).join(', '));
        if (full) files.forEach(function (f) {
          if (f.extracted_content) body.push('**[Attachment content: ' + (f.file_name || 'file') + ']**\n\n' + fence(trim(f.extracted_content, max)));
        });
      }

      if (opts.includeSources && !isUser && replySources.items().length) {
        body.push('**Sources used in this reply:**\n\n' + replySources.md());
      }
      out.push(head + '\n\n' + (body.join('\n\n') || '_(no text)_'));
    });

    stats.sources = allSources.items().length;
    return {
      site: 'Claude',
      title: conv.name || document.title,
      model: conv.model || '',
      created: conv.created_at,
      body: out.join('\n\n---\n\n'),
      sources: allSources,
      stats: stats
    };
  }

  // Fallback for Claude when the conversation data can't be loaded: read the
  // page (step summaries only, like what you see on screen).
  async function exportClaudeFromPage(opts) {
    var full = opts.mode === 'full';
    if (full) await expandMatching(document, /more steps|actions\)|used .* and|show (all|more)|expand/i, opts);
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]'));
    var out = [], turn = 0;
    nodes.forEach(function (n) {
      var isUser = n.getAttribute('data-testid') === 'user-message';
      if (isUser) turn++;
      var body = [];
      if (!isUser && full) {
        var steps = Array.prototype.slice.call(n.querySelectorAll('[data-step-key]')).map(textOf).filter(Boolean);
        if (steps.length) body.push('**[Steps shown on screen]**\n\n' + steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n'));
      }
      var replyParts = isUser ? [n] : Array.prototype.slice.call(n.querySelectorAll('[data-perf-reply-text]'));
      var txt = replyParts.map(function (p) { return htmlToMd(p); }).join('\n\n').trim();
      if (txt) body.push(txt);
      out.push('## ' + (isUser ? 'You' : 'Claude') + ' (turn ' + turn + ')\n\n' + (body.join('\n\n') || '_(no text)_'));
    });
    return { site: 'Claude (from page)', title: document.title, body: out.join('\n\n---\n\n'), sources: SourceList(), stats: { messages: nodes.length } };
  }

  /* ------------------------------------------------------------------ *
   * ChatGPT (on-screen)
   * ------------------------------------------------------------------ */
  async function exportChatGPT(opts) {
    var full = opts.mode === 'full';
    var allSources = SourceList();
    var turns = Array.prototype.slice.call(document.querySelectorAll('[data-turn-key]'));
    if (!turns.length) turns = Array.prototype.slice.call(document.querySelectorAll('[data-message-author-role]'));
    var out = [], n = 0, turnNo = 0;

    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      toast('reading turn ' + (i + 1) + ' of ' + turns.length + '...');
      if (full) await expandMatching(t, /^(thought|thinking|reasoned|worked|searched|searching|analy[sz]ed|ran|used)\b/i, opts);

      var userEl = t.querySelector('[data-user-message-bubble]') ||
        (t.getAttribute('data-message-author-role') === 'user' ? t : null);
      if (userEl) {
        turnNo++;
        out.push('## You (turn ' + turnNo + ')\n\n' + (htmlToMd(userEl) || '_(no text)_'));
      }

      var mains = Array.prototype.slice.call(t.querySelectorAll('[data-markdown-text-style="assistant-message"], .markdown'));
      if (!mains.length && t.getAttribute('data-message-author-role') === 'assistant') mains = [t];
      if (!mains.length) continue;
      n++;
      var replySources = SourceList();
      var body = [];

      if (full) {
        var unit = mains[0].closest('[data-chatgpt-search-unit-key], [data-message-author-role]') || t;
        var work = extraWorkText(unit, mains, '.turn-action-controls, [data-user-message-bubble], h4');
        if (work) body.push('**[Thinking / work shown by ChatGPT]**\n\n' + quote(trim(work, opts.maxToolChars)));
      }
      body.push(mains.map(function (m) { return htmlToMd(m); }).join('\n\n'));

      allLinks(t).forEach(function (a) { if (!isChromeLink(a)) replySources.add(a.href, textOf(a)); });
      if (opts.includeSources) {
        var srcBtns = Array.prototype.slice.call(t.querySelectorAll('button[aria-label="Sources"], button')).filter(function (b) {
          return /^sources$/i.test((b.getAttribute('aria-label') || textOf(b)).trim());
        });
        for (var k = 0; k < srcBtns.length; k++) await clickAndHarvest(srcBtns[k], replySources, opts);
        if (replySources.items().length) body.push('**Sources used in this reply:**\n\n' + replySources.md());
      }
      replySources.items().forEach(function (s) { allSources.add(s.url, s.title); });
      out.push('## ChatGPT (turn ' + turnNo + ')\n\n' + body.join('\n\n'));
    }
    return { site: 'ChatGPT', title: document.title, body: out.join('\n\n---\n\n'), sources: allSources, stats: { replies: n } };
  }

  /* ------------------------------------------------------------------ *
   * Gemini (on-screen)
   * ------------------------------------------------------------------ */
  async function geminiLoadAll(opts) {
    // Gemini lazy-loads older turns when you scroll up.
    var scroller = document.querySelector('infinite-scroller.chat-history, [data-test-id="chat-history-container"]');
    if (!scroller) return;
    var last = -1;
    for (var i = 0; i < 40; i++) {
      var count = document.querySelectorAll('user-query').length;
      if (count === last) break;
      last = count;
      scroller.scrollTop = 0;
      toast('loading earlier messages (' + count + ')...');
      await sleep(900, opts);
    }
  }

  async function exportGemini(opts) {
    var full = opts.mode === 'full';
    await geminiLoadAll(opts);
    var allSources = SourceList();
    var queries = Array.prototype.slice.call(document.querySelectorAll('user-query'));
    var responses = Array.prototype.slice.call(document.querySelectorAll('model-response'));
    var items = queries.map(function (q) { return { el: q, user: true }; })
      .concat(responses.map(function (r) { return { el: r, user: false }; }))
      .sort(function (a, b) { return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
    var out = [], turn = 0;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.user) {
        turn++;
        var qt = it.el.querySelector('.query-text') || it.el;
        out.push('## You (turn ' + turn + ')\n\n' + (htmlToMd(qt) || '_(no text)_'));
        continue;
      }
      toast('reading Gemini reply ' + turn + '...');
      var r = it.el;
      var body = [];
      var main = r.querySelector('message-content .markdown, message-content') || r;
      if (full) {
        await expandMatching(r, /show thinking|thinking|thoughts/i, opts);
        var thoughts = r.querySelector('model-thoughts, [class*="thoughts-content"], [class*="thoughts-container"], thinking-overlay');
        var thinkText = thoughts ? (thoughts.innerText || thoughts.textContent || '').trim() : '';
        if (!thinkText) thinkText = extraWorkText(r, [main], 'message-actions, sources-list, .response-footer, .response-container-header');
        thinkText = thinkText.replace(/^(show|hide) thinking\s*/i, '').trim();
        if (thinkText.length > 15) body.push('**[Thinking shown by Gemini]**\n\n' + quote(trim(thinkText, opts.maxToolChars)));
      }
      body.push(htmlToMd(main));
      var replySources = SourceList();
      allLinks(r).forEach(function (a) { if (!isChromeLink(a)) replySources.add(a.href, textOf(a)); });
      if (opts.includeSources) {
        var chips = Array.prototype.slice.call(r.querySelectorAll('button[aria-label^="View source details"], .source-inline-chip-container button')).slice(0, 30);
        var footerBtns = Array.prototype.slice.call(r.querySelectorAll('sources-list button, .response-footer button')).filter(function (b) { return /source/i.test((b.getAttribute('aria-label') || '') + textOf(b)); });
        var btns = footerBtns.concat(chips);
        for (var k = 0; k < btns.length; k++) await clickAndHarvest(btns[k], replySources, opts);
        if (replySources.items().length) body.push('**Sources used in this reply:**\n\n' + replySources.md());
      }
      replySources.items().forEach(function (s) { allSources.add(s.url, s.title); });
      out.push('## Gemini (turn ' + turn + ')\n\n' + body.join('\n\n'));
    }
    return { site: 'Gemini', title: document.title, body: out.join('\n\n---\n\n'), sources: allSources, stats: { turns: turn } };
  }

  /* ------------------------------------------------------------------ *
   * Grok (on-screen)
   * ------------------------------------------------------------------ */
  async function exportGrok(opts) {
    var full = opts.mode === 'full';
    var allSources = SourceList();
    var rows = Array.prototype.slice.call(document.querySelectorAll('[id^="response-"]'));
    var out = [], turn = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var cls = r.getAttribute('class') || '';
      var isUser = /\bitems-end\b/.test(cls);
      var main = r.querySelector('.response-content-markdown') || r.querySelector('.message-bubble') || r;
      if (isUser) {
        turn++;
        out.push('## You (turn ' + turn + ')\n\n' + (htmlToMd(main) || '_(no text)_'));
        continue;
      }
      toast('reading Grok reply ' + turn + '...');
      var body = [];
      if (full) {
        var tc = r.querySelector('.thinking-container, [class*="thinking-container"]');
        if (tc) {
          await expandMatching(tc, /worked for|thought for|thinking|reasoning/i, opts);
          var th = extraWorkText(tc, [], '');
          th = th.replace(/^(worked|thought) for [^\n]*\n?/i, '').trim();
          if (th.length > 15) body.push('**[Thinking / work shown by Grok]**\n\n' + quote(trim(th, opts.maxToolChars)));
        }
      }
      body.push(htmlToMd(main));
      var replySources = SourceList();
      allLinks(r).forEach(function (a) { if (!isChromeLink(a)) replySources.add(a.href, textOf(a)); });
      if (opts.includeSources) {
        var sb = Array.prototype.slice.call(r.querySelectorAll('button')).filter(function (b) { return /^\d+\s+sources?$/i.test(textOf(b)); });
        for (var k = 0; k < sb.length; k++) await clickAndHarvest(sb[k], replySources, opts);
        if (replySources.items().length) body.push('**Sources used in this reply:**\n\n' + replySources.md());
      }
      replySources.items().forEach(function (s) { allSources.add(s.url, s.title); });
      out.push('## Grok (turn ' + turn + ')\n\n' + body.join('\n\n'));
    }
    return { site: 'Grok', title: document.title, body: out.join('\n\n---\n\n'), sources: allSources, stats: { turns: turn } };
  }

  /* ------------------------------------------------------------------ *
   * Entry point
   * ------------------------------------------------------------------ */
  function detectSite() {
    var h = location.hostname;
    if (/(^|\.)claude\.ai$/.test(h)) return 'claude';
    if (/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(h)) return 'chatgpt';
    if (/^gemini\.google\.com$/.test(h)) return 'gemini';
    if (/(^|\.)grok\.com$/.test(h) || (/(^|\.)x\.com$/.test(h) && /\/i\/grok/.test(location.pathname))) return 'grok';
    return '';
  }

  function buildDocument(res, opts) {
    var full = opts.mode === 'full';
    var meta = [
      '# ' + (res.title || 'AI chat').replace(/\s+-\s+(Claude|Google Gemini|Grok|ChatGPT)$/i, ''),
      '',
      '- **Source:** ' + res.site + ' (' + location.href + ')',
      res.model ? '- **Model:** ' + res.model : '',
      '- **Exported:** ' + fmtDate(new Date().toISOString()),
      '- **Export type:** ' + (full
        ? 'Full: messages plus thinking, every tool call (inputs) and tool result, in the order they happened'
        : 'Chat only: messages and replies'),
      opts.maxToolChars ? '- **Note:** long tool inputs/results trimmed to ' + opts.maxToolChars.toLocaleString() + ' characters each' : ''
    ].filter(Boolean).join('\n');
    var legend = full
      ? '\n\n> **How to read this file:** each `## You` / `## ' + res.site.split(' ')[0] + '` section is one message. ' +
        'Inside replies, **[Thinking]** is the AI\'s reasoning, **[Step N: tool ...]** shows exactly what the AI ran and with what input, ' +
        'and **[Result of ...]** shows what came back. Plain text is what the AI said to the user.'
      : '';
    var srcs = opts.includeSources && res.sources && res.sources.items().length
      ? '\n\n---\n\n## All sources (' + res.sources.items().length + ')\n\n' + res.sources.md()
      : '';
    var fm = '';
    if (opts.frontMatter) {
      var q = function (v) { return '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"'; };
      fm = ['---', 'title: ' + q(cleanTitle(res.title)), 'source: ' + q(location.href), 'site: ' + q(res.site.split(' ')[0]),
        res.model ? 'model: ' + q(res.model) : '', 'exported: ' + q(new Date().toISOString()),
        'type: ' + q(full ? 'ai-chat-full' : 'ai-chat'), 'tags: [ai-chat]', '---'].filter(Boolean).join('\n') + '\n\n';
    }
    return fm + meta + legend + '\n\n---\n\n' + res.body + srcs + '\n';
  }

  function cleanTitle(t) {
    return String(t || 'AI chat').replace(/\s+-\s+(Claude|Google Gemini|Gemini|Grok|ChatGPT)$/i, '').trim() || 'AI chat';
  }

  function makeFilename(template, res, opts) {
    var site = res.site.split(' ')[0];
    var name = (template || '{title} - {site} ({mode})').replace(/\{(\w+)\}/g, function (m, k) {
      if (k === 'title') return cleanTitle(res.title);
      if (k === 'site') return site;
      if (k === 'mode') return opts.mode === 'full' ? 'full' : 'chat';
      if (k === 'date') { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
      return m;
    });
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim().slice(0, 120);
    return (name || 'AI chat') + '.md';
  }

  function downloadText(name, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }

  window.__ptmAiExport = async function (options) {
    var opts = Object.assign({ mode: 'full', includeSources: true, maxToolChars: 0, download: true }, options || {});
    var site = detectSite();
    if (!site) return { ok: false, error: 'This tab is not a Claude, ChatGPT, Gemini or Grok chat.' };
    try {
      toast('starting...');
      var res;
      if (site === 'claude') {
        try { res = await exportClaude(opts); }
        catch (e) {
          toast('full data unavailable, reading the page instead...');
          res = await exportClaudeFromPage(opts);
          res.warning = e.message;
        }
      } else if (site === 'chatgpt') res = await exportChatGPT(opts);
      else if (site === 'gemini') res = await exportGemini(opts);
      else res = await exportGrok(opts);

      var doc = buildDocument(res, opts);
      var tpl = opts.filenameTemplate && opts.filenameTemplate !== '{title}' ? opts.filenameTemplate : '{title} - {site} ({mode})';
      var filename = makeFilename(tpl, res, opts);
      if (opts.download) downloadText(filename, doc);
      toastDone(opts.download ? 'saved "' + filename + '"' : 'done');
      return { ok: true, site: res.site, filename: filename, chars: doc.length, stats: res.stats, warning: res.warning || '', markdown: opts.download ? '' : doc };
    } catch (e) {
      toastDone('failed: ' + e.message);
      return { ok: false, error: e.message };
    }
  };
})();
