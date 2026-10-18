/**
 * extract.js
 *
 * Self-contained functions that get injected into a page with
 * chrome.scripting.executeScript. executeScript copies a function by its
 * source text, so each function here must not use anything from outside its
 * own body (only the page's document/window).
 *
 * Loaded as a plain <script> by popup.html and runner.html (and by the
 * background worker via importScripts) so they can pass these functions to
 * executeScript's `func` option.
 */

/* ---------------------------------------------------------------------- *
 * 1. pageToMarkdownExtract(options) -> { title, url, layout, items, markdown }
 *
 * options:
 *   clean               remove ads, menus, sidebars, cookie banners, share
 *                       and newsletter boxes, related-links blocks
 *   contentSelector     only this part of the page
 *   itemSelector        each match becomes its own section (posts, cards)
 *   itemHeadingSelector / itemDateSelector  pulled out as a heading per item
 *   excludeSelector     comma-separated things to leave out
 *   usePresets          recognise common forum layouts (default true)
 *   selectionOnly       only the highlighted text
 * ---------------------------------------------------------------------- */
function pageToMarkdownExtract(options) {
  options = options || {};
  var clean = !!options.clean;
  var contentSelector = options.contentSelector || '';
  var itemSelector = options.itemSelector || '';
  var excludeSelector = options.excludeSelector || '';
  var itemHeadingSelector = options.itemHeadingSelector || '';
  var itemDateSelector = options.itemDateSelector || '';
  var itemBodySelector = options.itemBodySelector || '';
  var itemNumberSelector = options.itemNumberSelector || '';
  var usePresets = options.usePresets !== false;
  var itemSeparator = '\n\n---\n\n';

  // Built-in layouts for common forum software. Used only when no
  // "repeating item" selector was given.
  var PRESETS = [
    {
      name: 'XenForo',
      item: 'article.message--post, article.message[data-content^="post-"], article.message',
      body: '.message-content .bbWrapper, .message-body .bbWrapper, .bbWrapper',
      heading: '.message-name, .message-userDetails .username',
      authorAttr: 'data-author',
      date: '.message-attribution-main time, time',
      number: '.message-attribution-opposite',
      exclude: '.bbCodeBlock-expandLink, .js-extrasHolder, .message-signature, .bbCodeBlock-sourceJump'
    },
    {
      name: 'Discourse',
      item: '.topic-post',
      body: '.cooked',
      heading: '.names .username, .names .first',
      date: '.post-date, .relative-date',
      number: '',
      exclude: '.quote-controls'
    },
    {
      name: 'phpBB',
      item: 'div.post.has-profile, div.post',
      body: '.content',
      heading: '.username, .username-coloured',
      date: 'time, .author',
      number: '',
      exclude: '.signature, .notice'
    },
    {
      name: 'vBulletin',
      item: 'li.postcontainer, li.postbitlegacy, li.postbit, div.postbit',
      body: '.postcontent, .postbody .content, .content',
      heading: '.username',
      date: '.date, .postdate',
      number: '.postcounter, .postnumber',
      exclude: '.signature'
    }
  ];

  // What "Clean up" removes.
  var CLUTTER_SELECTOR = 'nav, aside, form, button, select, input, textarea, iframe, ins, noscript, video, audio, canvas, ' +
    'object, embed, dialog, [role="banner"], [role="navigation"], [role="contentinfo"], [role="complementary"], ' +
    '[role="dialog"], [role="alertdialog"], [role="search"], [aria-modal="true"], [hidden]';
  var CLUTTER_WORDS = /(^|[\s_-])(ads?|adsbygoogle|adslot|adunit|advert\w*|sponsor\w*|promo\w*|banner|cookies?|cookie\w*|consent|gdpr|newsletter|subscri\w*|signup|sign-up|social|share|sharing|sharer|related|recommend\w*|trending|popular|sidebar|breadcrumbs?|popup|pop-up|modal|overlay|toast|outbrain|taboola|disqus|skip-link|back-to-top|paywall|cta)([\s_-]|$)/i;

  function absUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
  }

  function textOf(el) {
    return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, SVG: 1, LINK: 1, META: 1 };

  function isHidden(el) {
    if (!(el instanceof Element)) return false;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    var cls = el.getAttribute('class') || '';
    if (/(^|\s)(sr-only|visually-hidden|screen-reader-text|u-srOnly)(\s|$)/.test(cls)) return true;
    var style = window.getComputedStyle(el);
    if (!style) return false;
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function kids(node, ctx) {
    var out = '';
    node.childNodes.forEach(function (child) { out += renderNode(child, ctx); });
    return out;
  }

  function repeat(str, n) { return new Array(Math.max(0, n) + 1).join(str); }

  function oneLine(md) {
    return md.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l !== '---'; }).join(' · ');
  }

  function renderList(el, ctx, ordered) {
    var out = '\n\n';
    var index = 1;
    Array.prototype.forEach.call(el.children, function (li) {
      if (li.tagName !== 'LI' || isHidden(li) || (ctx.excludeEls && ctx.excludeEls.has(li))) return;
      var inner = tidyBlock(kids(li, ctx));
      if (!inner) return;
      inner = inner.split('\n').map(function (line, i) {
        return i === 0 ? line : (line.trim() ? '  ' + line : '');
      }).join('\n').replace(/\n{2,}/g, '\n');
      out += (ordered ? (index++) + '. ' : '- ') + inner + '\n';
    });
    return out + '\n';
  }

  function renderTable(el, ctx) {
    var rows = Array.prototype.slice.call(el.querySelectorAll('tr'));
    if (!rows.length) return '';
    var maxCols = 0;
    var grid = rows.map(function (row) {
      var cells = Array.prototype.slice.call(row.querySelectorAll('th,td'));
      maxCols = Math.max(maxCols, cells.length);
      return cells.map(function (c) { return oneLine(tidyBlock(kids(c, ctx))).replace(/\|/g, '\\|') || ' '; });
    });
    if (!maxCols) return '';
    grid.forEach(function (r) { while (r.length < maxCols) r.push(' '); });
    var out = '\n\n| ' + grid[0].join(' | ') + ' |\n|' + repeat(' --- |', maxCols) + '\n';
    for (var i = 1; i < grid.length; i++) out += '| ' + grid[i].join(' | ') + ' |\n';
    return out + '\n';
  }

  // A run of look-alike cards/tiles (a grid of links, a product list...)
  // reads best as one bullet per card.
  function cardChildren(el, ctx) {
    var ch = Array.prototype.filter.call(el.children, function (c) {
      return !SKIP_TAGS[c.tagName] && !isHidden(c) && !(ctx.excludeEls && ctx.excludeEls.has(c));
    });
    if (ch.length < 4) return null;
    var sig = function (c) { return c.tagName + '|' + (c.getAttribute('class') || ''); };
    var first = sig(ch[0]);
    var same = ch.filter(function (c) { return sig(c) === first; }).length;
    if (same < ch.length * 0.8) return null;
    if (!/^(A|DIV|ARTICLE|SECTION)$/.test(ch[0].tagName)) return null;
    var linked = 0, tooLong = 0;
    ch.forEach(function (c) {
      if (c.tagName === 'A' || c.querySelector('a[href]')) linked++;
      if (textOf(c).length > 280 || c.querySelector('h1,h2,p p,table,ul ul')) tooLong++;
    });
    if (linked < ch.length * 0.6 || tooLong > 0) return null;
    return ch;
  }

  function renderNode(node, ctx) {
    if (node.nodeType === 3) return (node.nodeValue || '').replace(/[ \t\r\n ]+/g, ' ');
    if (node.nodeType !== 1) return '';
    var el = node;
    var tag = el.tagName.toUpperCase();

    if (SKIP_TAGS[tag]) return '';
    if (ctx.excludeEls && ctx.excludeEls.has(el)) return '';
    if (isHidden(el)) return '';

    switch (tag) {
      case 'BR': return '\n';
      case 'HR': return '\n\n---\n\n';
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        var h = oneLine(tidyBlock(kids(el, ctx)));
        return h ? '\n\n' + repeat('#', +tag[1]) + ' ' + h + '\n\n' : '';
      }
      case 'STRONG': case 'B': { var b = kids(el, ctx).trim(); return b && !/\n/.test(b) ? '**' + b + '**' : b; }
      case 'EM': case 'I': { var it = kids(el, ctx).trim(); return it && !/\n/.test(it) ? '*' + it + '*' : it; }
      case 'DEL': case 'S': case 'STRIKE': { var d = kids(el, ctx).trim(); return d ? '~~' + d + '~~' : ''; }
      case 'CODE': {
        if (el.parentElement && el.parentElement.tagName === 'PRE') return el.textContent;
        var c = (el.textContent || '').trim();
        return c ? '`' + c + '`' : '';
      }
      case 'PRE': {
        var codeEl = el.querySelector('code') || el;
        var lang = ((codeEl.getAttribute('class') || '').match(/language-([\w+-]+)/) || [])[1] || '';
        return '\n\n```' + lang + '\n' + (codeEl.textContent || '').replace(/\n+$/, '') + '\n```\n\n';
      }
      case 'BLOCKQUOTE': {
        var q = tidyBlock(kids(el, ctx));
        if (!q) return '';
        return '\n\n' + q.split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n') + '\n\n';
      }
      case 'A': {
        var href = el.getAttribute('href');
        var inner = tidyBlock(kids(el, ctx));
        if (!inner) return '';
        if (!href || /^(javascript:|#$)/i.test(href)) return inner;
        var url = absUrl(href);
        var lines = inner.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        if (lines.length <= 1) return '[' + inner.trim() + '](' + url + ')';
        // A link wrapping a whole card: link the first line, keep the rest.
        return '\n\n[' + lines[0].replace(/^#+\s*/, '') + '](' + url + ')' + ' · ' + lines.slice(1).join(' · ') + '\n\n';
      }
      case 'IMG': {
        var src = el.getAttribute('src') || el.getAttribute('data-src') || '';
        if (!src || /^data:/.test(src)) return '';
        var w = +el.getAttribute('width') || 0, hgt = +el.getAttribute('height') || 0;
        if ((w && w <= 2) || (hgt && hgt <= 2)) return '';        // tracking pixels
        if (ctx.clean) {
          var alt0 = el.getAttribute('alt') || '';
          if (!alt0) return '';                                  // decorative images
          if (/\b(ad|ads|advert\w*|banner|sponsor\w*|promo\w*)\b/i.test(alt0)) return '';
          if (/\.svg(\?|#|$)|[\/_-](icons?|logos?|sprites?|avatars?)[\/_.-]/i.test(src)) return '';
          if ((w && w < 48) || (hgt && hgt < 48)) return '';    // small icons
        }
        return '![' + (el.getAttribute('alt') || '').replace(/[\[\]]/g, '') + '](' + absUrl(src) + ')';
      }
      case 'UL': return renderList(el, ctx, false);
      case 'OL': return renderList(el, ctx, true);
      case 'LI': return kids(el, ctx);
      case 'TABLE': return renderTable(el, ctx);
      case 'P': case 'DIV': case 'SECTION': case 'ARTICLE': case 'FIGURE': case 'HEADER': case 'FOOTER': case 'MAIN': case 'DETAILS': case 'SUMMARY': case 'DD': case 'DT': {
        var cards = cardChildren(el, ctx);
        if (cards) {
          var items = cards.map(function (c) { return oneLine(tidyBlock(renderNode(c, ctx))); }).filter(Boolean);
          return items.length ? '\n\n' + items.map(function (i) { return '- ' + i; }).join('\n') + '\n\n' : '';
        }
        var inner2 = kids(el, ctx).trim();
        return inner2 ? '\n\n' + inner2 + '\n\n' : '';
      }
      case 'FIGCAPTION': { var cap = tidyBlock(kids(el, ctx)); return cap ? '\n\n*' + oneLine(cap) + '*\n\n' : ''; }
      default: return kids(el, ctx);
    }
  }

  // Light tidy for a fragment (used inside the renderer).
  function tidyBlock(md) {
    return md.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  // Final tidy for the whole document. Code blocks are left exactly as they are.
  function tidyMarkdown(md) {
    var parts = md.replace(/\r/g, '').split(/(```[\s\S]*?```)/);
    for (var i = 0; i < parts.length; i += 2) {
      var s = parts[i]
        .replace(/[​-‍﻿]/g, '')
        .replace(/ /g, ' ')
        .replace(/[ \t]+$/gm, '')
        .replace(/^[ \t]+(?=[^ \t])(?![-*+] |\d+\. )/gm, '')        // stray indentation (keep nested lists)
        .replace(/(\S)[ \t]{2,}/g, '$1 ')
        .replace(/\[\s*\]\([^)]*\)/g, '')                  // empty links
        .replace(/\*\*\s*\*\*/g, '').replace(/~~\s*~~/g, '')
        .replace(/^\s*[*+·|•]\s*$/gm, '')                  // lone bullets / separators
        .replace(/^-\s*$/gm, '')
        .replace(/^#{1,6}\s*$/gm, '')                      // empty headings
        .replace(/^(>\s*\n){2,}/gm, '>\n')
        .replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2')        // blank line before headings
        .replace(/^(#{1,6} [^\n]+)\n(?=[^\n])/gm, '$1\n\n'); // and after
      // Keep list items together (no blank lines between bullets).
      var prev;
      do { prev = s; s = s.replace(/^((?:[-*+]|\d+\.) [^\n]+)\n\n(?=(?:[-*+]|\d+\.) )/gm, '$1\n'); } while (s !== prev);
      // Drop a short line repeated straight after itself (duplicated labels).
      var lines = s.split('\n'), out = [];
      for (var k = 0; k < lines.length; k++) {
        var L = lines[k];
        var lastText = null;
        for (var j = out.length - 1; j >= 0; j--) { if (out[j].trim()) { lastText = out[j]; break; } }
        if (L.trim() && L.trim().length < 80 && lastText !== null && lastText.trim() === L.trim() && !/^(---|\|)/.test(L.trim())) continue;
        out.push(L);
      }
      parts[i] = out.join('\n');
    }
    return parts.join('').replace(/\n{3,}/g, '\n\n').replace(/^(---\n+)+|(\n+---)+$/g, '').trim()
      .replace(/\n+[^\n]{1,60}:$/, '');                    // dangling label at the very end
  }

  function collectMatches(root, selector, into) {
    if (!selector) return;
    try { root.querySelectorAll(selector).forEach(function (e) { into.add(e); }); } catch (e) { /* bad selector */ }
  }

  // Everything "Clean up" leaves out, inside `root`.
  function clutterIn(root) {
    var set = new Set();
    // Measure real text only: inline scripts and styles (big on Next.js and
    // similar sites) would otherwise make the page look much "longer" than it
    // is, so whole content wrappers would pass as "small" and get dropped.
    function textLen(e) {
      var n = (e.textContent || '').length;
      e.querySelectorAll('script, style, noscript, template').forEach(function (s) { n -= (s.textContent || '').length; });
      return Math.max(0, n);
    }
    var total = textLen(root) || 1;
    function guard(e) { return textLen(e) < total * 0.5; }
    try { root.querySelectorAll(CLUTTER_SELECTOR).forEach(function (e) { if (guard(e)) set.add(e); }); } catch (e) { /* ignore */ }
    root.querySelectorAll('header, footer').forEach(function (e) {
      // Site-wide header and footer: dropped unless they hold the page title
      // or most of the page (then they are probably the content wrapper).
      if (!e.closest('main, article, [role="main"]') && !e.querySelector('h1') && textLen(e) < total * 0.85) set.add(e);
    });
    root.querySelectorAll('[class], [id]').forEach(function (e) {
      var words = (e.getAttribute('class') || '') + ' ' + (e.getAttribute('id') || '');
      if (CLUTTER_WORDS.test(words) && guard(e) && !e.querySelector('h1')) set.add(e);
    });
    // Menu-like blocks: many short links and little else.
    root.querySelectorAll('ul, ol, div').forEach(function (e) {
      if (set.has(e)) return;
      var links = e.querySelectorAll('a[href]');
      if (links.length < 6) return;
      var all = textOf(e).length || 1, linkText = 0;
      links.forEach(function (a) { linkText += textOf(a).length; });
      if (linkText / all > 0.8 && linkText / links.length < 18 && !e.querySelector('h1,h2,h3,p') && guard(e)) set.add(e);
    });
    return set;
  }

  function convertElementToMarkdown(root, extraExcludeEls, extraExcludeSelector) {
    var ctx = { clean: clean, excludeEls: extraExcludeEls ? new Set(extraExcludeEls) : new Set() };
    collectMatches(root, excludeSelector, ctx.excludeEls);
    collectMatches(root, extraExcludeSelector, ctx.excludeEls);
    if (clean) clutterIn(root).forEach(function (e) { ctx.excludeEls.add(e); });
    return tidyMarkdown(renderNode(root, ctx));
  }

  function guessMainContainer() {
    var main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (main && textOf(main).length > 200) return main;
    // Only use <article> when there is exactly one (on forums every post is one).
    var articles = document.querySelectorAll('article');
    if (articles.length === 1 && textOf(articles[0]).length > 200) return articles[0];
    return document.body;
  }

  function safeQueryAll(sel) {
    if (!sel) return [];
    try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; }
  }

  function safeQuery(root, sel) {
    if (!sel) return null;
    try { return root.querySelector(sel); } catch (e) { return null; }
  }

  function outermostOnly(els) {
    return els.filter(function (el) { return !els.some(function (o) { return o !== el && o.contains(el); }); });
  }

  var title = (document.title || '').trim();

  // "Convert selection": only what the user highlighted.
  if (options.selectionOnly) {
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && String(sel).trim()) {
      var holder = document.createElement('div');
      for (var r = 0; r < sel.rangeCount; r++) holder.appendChild(sel.getRangeAt(r).cloneContents());
      return { title: title, url: document.location.href, layout: 'selection', items: [], markdown: convertElementToMarkdown(holder) };
    }
  }

  var layout = null;
  if (itemSelector) {
    layout = { name: 'custom', item: itemSelector, body: itemBodySelector, heading: itemHeadingSelector, date: itemDateSelector, number: itemNumberSelector, exclude: '' };
  } else if (usePresets) {
    for (var p = 0; p < PRESETS.length; p++) {
      var found = safeQueryAll(PRESETS[p].item);
      if (found.length && found.some(function (el) { return !!safeQuery(el, PRESETS[p].body); })) { layout = PRESETS[p]; break; }
    }
  }

  var markdown = '';
  var itemsOut = [];

  if (layout) {
    var items = outermostOnly(safeQueryAll(layout.item));
    if (contentSelector) {
      var scope = safeQuery(document, contentSelector);
      if (scope) items = items.filter(function (i) { return scope.contains(i); });
    }
    items.forEach(function (item) {
      if (isHidden(item)) return;
      var headBits = new Set();
      var author = '';
      var hEl = safeQuery(item, layout.heading);
      if (hEl) { author = textOf(hEl); headBits.add(hEl); }
      if (layout.authorAttr && item.getAttribute(layout.authorAttr)) author = item.getAttribute(layout.authorAttr).trim();
      var dateStr = '';
      var dEl = safeQuery(item, layout.date);
      if (dEl) { dateStr = (dEl.getAttribute && dEl.getAttribute('title')) || textOf(dEl); headBits.add(dEl); }
      var num = '';
      var nEl = safeQuery(item, layout.number);
      if (nEl) { var m = textOf(nEl).match(/#\s?(\d+)/); if (m) num = '#' + m[1]; headBits.add(nEl); }
      var bodyRoot = safeQuery(item, layout.body) || item;
      var body = convertElementToMarkdown(bodyRoot, headBits, layout.exclude);
      if (!body) return;
      var key = item.getAttribute('data-content') || item.id || (num ? 'num:' + num : '') ||
        ('h:' + author + '|' + dateStr + '|' + body.slice(0, 160));
      var headParts = [num, author, dateStr].filter(Boolean);
      itemsOut.push({ key: key, markdown: (headParts.length ? '### ' + headParts.join(' | ') + '\n\n' : '') + body, plain: !headParts.length });
    });
    // Short custom items with no heading read best as a bullet list.
    var avg = itemsOut.reduce(function (n, i) { return n + i.markdown.length; }, 0) / (itemsOut.length || 1);
    if (layout.name === 'custom' && itemsOut.length && itemsOut.every(function (i) { return i.plain; }) && avg < 260) {
      itemsOut.forEach(function (i) { i.markdown = '- ' + oneLine(i.markdown); });
      markdown = itemsOut.map(function (i) { return i.markdown; }).join('\n');
    } else {
      markdown = itemsOut.map(function (i) { return i.markdown; }).join(itemSeparator);
    }
  }

  if (!markdown) {
    var root = null;
    if (contentSelector) root = safeQuery(document, contentSelector);
    if (!root) root = guessMainContainer();
    markdown = convertElementToMarkdown(root);
    itemsOut = [];
  }

  return {
    title: title,
    url: document.location.href,
    layout: itemsOut.length && layout ? layout.name : 'page',
    items: itemsOut,
    markdown: markdown
  };
}

/* ---------------------------------------------------------------------- *
 * 2. detectPaginationOnPage()
 *    -> { type: 'urls', urls, maxPage }   numbered pager (1 2 3 ... N)
 *    -> { type: 'next-link', url }        only a "Next" link
 *    -> { type: 'next-button', label }    a "Next page" / "Load more" button
 *    -> null
 * ---------------------------------------------------------------------- */
function detectPaginationOnPage() {
  function absUrl(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } }
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  var NEXT = /^(next( page)?|next\s*[›»>→]|[›»→]|load more( results| items)?|show more( results)?|more results|view more|see more|older( posts| entries)?)$/i;

  var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
  var byNumber = {};
  anchors.forEach(function (a) {
    var label = (a.textContent || '').trim();
    if (/^\d{1,4}$/.test(label)) {
      var href = a.getAttribute('href');
      if (!href || /^(#|javascript:)/i.test(href)) return;
      var n = parseInt(label, 10);
      if (!byNumber[n]) byNumber[n] = absUrl(href);
    }
  });
  document.querySelectorAll('a[rel="last"]').forEach(function (a) {
    var m = (a.getAttribute('href') || '').match(/(\d+)(?!.*\d)/);
    if (m && !byNumber[+m[1]]) byNumber[+m[1]] = absUrl(a.getAttribute('href'));
  });

  var numbers = Object.keys(byNumber).map(Number).sort(function (a, b) { return a - b; });
  if (numbers.length >= 2) {
    var template = null;
    outer:
    for (var i = 0; i < numbers.length; i++) {
      for (var j = 0; j < numbers.length; j++) {
        if (i === j || byNumber[numbers[i]] === byNumber[numbers[j]]) continue;
        var t = diffToTemplate(byNumber[numbers[i]], String(numbers[i]), byNumber[numbers[j]], String(numbers[j]));
        if (t) { template = t; break outer; }
      }
    }
    if (template) {
      var maxPage = numbers[numbers.length - 1];
      var page1 = byNumber[1] || document.location.href;
      var urls = [];
      for (var n = 1; n <= maxPage; n++) urls.push(n === 1 ? page1 : template(n));
      return { type: 'urls', urls: urls, maxPage: maxPage };
    }
  }

  var relNext = document.querySelector('a[rel~="next"][href], link[rel="next"][href]');
  if (relNext) return { type: 'next-link', url: absUrl(relNext.getAttribute('href')) };
  for (var k = 0; k < anchors.length; k++) {
    var lab = (anchors[k].textContent || '').trim();
    var h = anchors[k].getAttribute('href') || '';
    if ((NEXT.test(lab) || /^next/i.test(anchors[k].getAttribute('aria-label') || '')) && !/^(#|javascript:)/i.test(h)) {
      return { type: 'next-link', url: absUrl(h) };
    }
  }

  var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], a:not([href]), a[href^="#"], a[href^="javascript:"], input[type="button"], input[type="submit"]'));
  for (var b = 0; b < btns.length; b++) {
    var el = btns[b];
    var label = ((el.value || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
    var aria = el.getAttribute('aria-label') || '';
    if ((NEXT.test(label) || /^(next|load more)/i.test(aria)) && visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
      return { type: 'next-button', label: label || aria };
    }
  }
  return null;

  function diffToTemplate(hrefA, numA, hrefB, numB) {
    var i = 0;
    while (i < hrefA.length && i < hrefB.length && hrefA[i] === hrefB[i]) i++;
    while (i > 0 && /\d/.test(hrefA[i - 1])) i--;          // start of the number
    var j = 0;
    while (j < hrefA.length - i && j < hrefB.length - i && hrefA[hrefA.length - 1 - j] === hrefB[hrefB.length - 1 - j]) j++;
    var midA = hrefA.slice(i, hrefA.length - j), midB = hrefB.slice(i, hrefB.length - j);
    if (midA !== numA || midB !== numB) return null;
    var prefix = hrefA.slice(0, i), suffix = hrefA.slice(hrefA.length - j);
    return function (n) { return prefix + n + suffix; };
  }
}

/* ---------------------------------------------------------------------- *
 * 3. clickNextPageButton() -> Promise<{ clicked, changed, appended }>
 *    For sites whose "Next page" / "Load more" is a button that swaps or
 *    adds content without changing the address. Clicks it and waits until
 *    the page content has changed and settled.
 * ---------------------------------------------------------------------- */
function clickNextPageButton() {
  var NEXT = /^(next( page)?|next\s*[›»>→]|[›»→]|load more( results| items)?|show more( results)?|more results|view more|see more|older( posts| entries)?)$/i;
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], a:not([href]), a[href^="#"], a[href^="javascript:"], input[type="button"], input[type="submit"]'));
  var btn = null;
  for (var i = btns.length - 1; i >= 0; i--) {       // prefer the one below the list
    var el = btns[i];
    var label = ((el.value || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
    var aria = el.getAttribute('aria-label') || '';
    var cls = el.getAttribute('class') || '';
    if ((NEXT.test(label) || /^(next|load more)/i.test(aria)) && visible(el) && !el.disabled &&
        el.getAttribute('aria-disabled') !== 'true' && !/(^|\s)disabled(\s|$)/.test(cls)) { btn = el; break; }
  }
  if (!btn) return Promise.resolve({ clicked: false, changed: false });

  var root = document.querySelector('main, [role="main"]') || document.body;
  var before = root.innerText || '';
  try { btn.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
  btn.click();

  return new Promise(function (resolve) {
    var start = Date.now(), last = before, stable = 0, changed = false;
    var timer = setInterval(function () {
      var now = root.innerText || '';
      if (now !== before) changed = true;
      if (changed) { stable = now === last ? stable + 1 : 0; }
      last = now;
      // A list that is half empty is usually still loading (a spinner or
      // skeleton), so keep waiting for it to fill back up.
      var filled = now.length >= before.length * 0.6;
      if ((changed && stable >= 3 && filled) || Date.now() - start > 15000) {
        clearInterval(timer);
        resolve({ clicked: true, changed: changed, appended: changed && now.length > before.length && now.indexOf(before.slice(0, 500)) === 0 });
      }
    }, 400);
  });
}

/* ---------------------------------------------------------------------- *
 * 3b. waitForPageReady(opts) -> Promise<{ waited, chars, button, ready }>
 *    Many sites (Next.js, React, Vue) send an empty shell and draw the real
 *    list a moment later, and a page opened in a background tab is slower
 *    still. Waits until the text has stopped changing and, when the runner
 *    knows how much text the page should have (from the tab the user had
 *    open), until roughly that much is there. With needButton it also waits
 *    for the "Next page" / "Load more" button to show up.
 *    opts: { minChars, needButton, maxMs }
 * ---------------------------------------------------------------------- */
function waitForPageReady(opts) {
  opts = opts || {};
  var NEXT = /^(next( page)?|next\s*[›»>→]|[›»→]|load more( results| items)?|show more( results)?|more results|view more|see more|older( posts| entries)?)$/i;
  var maxMs = opts.maxMs || 15000;
  var minChars = opts.minChars || 0;
  function hasButton() {
    var els = document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]');
    for (var i = 0; i < els.length; i++) {
      var label = ((els[i].value || els[i].textContent || '') + '').replace(/\s+/g, ' ').trim();
      if (NEXT.test(label) || /^(next|load more)/i.test(els[i].getAttribute('aria-label') || '')) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    }
    return false;
  }
  return new Promise(function (resolve) {
    var start = Date.now(), last = -1, stable = 0;
    function tick() {
      var text = document.body ? (document.body.innerText || '') : '';
      var len = text.length;
      stable = len === last ? stable + 1 : 0;
      last = len;
      var waited = Date.now() - start;
      var enough = !minChars || len >= minChars * 0.6;
      var button = opts.needButton ? hasButton() : false;
      var buttonOk = !opts.needButton || button || waited > maxMs * 0.6;
      if ((waited >= 600 && stable >= 3 && enough && buttonOk) || waited >= maxMs) {
        resolve({ waited: waited, chars: len, button: button, ready: enough && buttonOk });
        return;
      }
      setTimeout(tick, 300);
    }
    tick();
  });
}

/* ---------------------------------------------------------------------- *
 * 4. startElementPicker(mode) -> Promise<{ selector, count } | null>
 *    mode 'single' (default): one element, e.g. the content area.
 *    mode 'repeat': one item of a repeated list (a post, a card); the
 *    selector matches all of its look-alikes, and they are all highlighted.
 *    mode 'inner': a part inside each item (title, date), matched by kind.
 * ---------------------------------------------------------------------- */
function startElementPicker(mode) {
  mode = mode || 'single';
  return new Promise(function (resolve) {
    var STYLE_ID = '__ptm_picker_style';
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[data-ptm-hl]{outline:2px solid #4c8cff !important;outline-offset:-2px !important;background-color:rgba(76,140,255,.10) !important;cursor:crosshair !important}' +
      '[data-ptm-hl-main]{outline:3px solid #2563eb !important}';
    document.documentElement.appendChild(style);
    var hint = document.createElement('div');
    hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;' +
      'background:#111827;color:#fff;padding:8px 14px;border-radius:10px;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:80vw;text-align:center';
    document.documentElement.appendChild(hint);
    var baseHint = mode === 'repeat'
      ? 'Click one item of the list (a post, a card). Everything highlighted will be exported. Esc to cancel.'
      : mode === 'inner'
        ? 'Click the title (or date) inside one item. Esc to cancel.'
        : 'Click the part of the page you want. Esc to cancel.';
    hint.textContent = baseHint;

    var SAFE = /^[A-Za-z_][\w-]*$/;
    var STATE = /^(active|selected|current|hover|focus|open|opened|closed|show|shown|hidden|visible|first|last|odd|even|is-|has-|js-)/i;
    function classes(el) {
      return Array.prototype.filter.call(el.classList || [], function (c) { return SAFE.test(c) && !STATE.test(c) && c.length < 40; }).slice(0, 3);
    }
    function sigOf(el) {
      var c = classes(el);
      return el.tagName.toLowerCase() + (c.length ? '.' + c.map(function (x) { return CSS.escape(x); }).join('.') : '');
    }
    function count(sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return 0; } }
    function uniquePath(el) {
      if (el.id && SAFE.test(el.id) && count('#' + CSS.escape(el.id)) === 1) return '#' + CSS.escape(el.id);
      var parts = [], node = el;
      for (var d = 0; node && node.nodeType === 1 && d < 7; d++) {
        var part = sigOf(node);
        if (node.parentElement) {
          var same = Array.prototype.filter.call(node.parentElement.children, function (s) { return sigOf(s) === sigOf(node); });
          if (same.length > 1) part += ':nth-of-type(' + (Array.prototype.indexOf.call(Array.prototype.filter.call(node.parentElement.children, function (s) { return s.tagName === node.tagName; }), node) + 1) + ')';
        }
        parts.unshift(part);
        var s = parts.join(' > ');
        if (count(s) === 1) return s;
        if (node.id && SAFE.test(node.id)) { parts[0] = '#' + CSS.escape(node.id); s = parts.join(' > '); if (count(s) === 1) return s; }
        node = node.parentElement;
      }
      return parts.join(' > ');
    }
    // The nearest ancestor that sits among look-alike siblings is the "item".
    function repeatingSelector(el) {
      var best = null;
      for (var node = el, d = 0; node && node !== document.body && d < 8; node = node.parentElement, d++) {
        var parent = node.parentElement;
        if (!parent) break;
        var sig = sigOf(node);
        var plain = !classes(node).length && /^(P|SPAN|LI|TD|TR|B|STRONG|EM|I|CODE|BR|A)$/.test(node.tagName);
        var siblings = Array.prototype.filter.call(parent.children, function (s) { return sigOf(s) === sig; }).length;
        if (siblings >= 2 && !plain) {
          var scoped = sigOf(parent) + ' > ' + sig;
          var sel = count(scoped) >= siblings ? scoped : sig;
          best = { selector: sel, count: count(sel), el: node };
          break;
        }
      }
      return best;
    }

    var marked = [];
    function clearMarks() { marked.forEach(function (e) { e.removeAttribute('data-ptm-hl'); e.removeAttribute('data-ptm-hl-main'); }); marked = []; }
    function mark(els, main) {
      clearMarks();
      els.slice(0, 400).forEach(function (e) { e.setAttribute('data-ptm-hl', ''); marked.push(e); });
      if (main) { main.setAttribute('data-ptm-hl-main', ''); marked.push(main); }
    }

    var current = null;
    function pick(target) {
      if (!target || target === hint || target === document.documentElement || target === document.body) return null;
      if (mode === 'inner') {
        // A part inside each item (its title, its date): match by kind, not position.
        var t2 = target;
        while (t2 && t2 !== document.body && !classes(t2).length && t2.parentElement && /^(SPAN|B|STRONG|EM|I|A)$/.test(t2.tagName) && !classes(t2.parentElement).length) t2 = t2.parentElement;
        var si = sigOf(t2);
        return { selector: si, count: count(si), els: Array.prototype.slice.call(document.querySelectorAll(si)) };
      }
      if (mode === 'repeat') {
        var r = repeatingSelector(target);
        if (r) return { selector: r.selector, count: r.count, els: Array.prototype.slice.call(document.querySelectorAll(r.selector)) };
        return null;
      }
      var s = uniquePath(target);
      return { selector: s, count: count(s), els: [target] };
    }

    function onMove(e) {
      var t = document.elementFromPoint(e.clientX, e.clientY);
      var p = pick(t);
      current = p;
      if (p) {
        mark(p.els, p.els.length === 1 ? null : p.els[0]);
        hint.textContent = mode === 'repeat' ? p.count + ' matching items. Click to choose.' : mode === 'inner' ? 'Found in ' + p.count + ' places. Click to choose.' : 'Click to choose this part.';
      } else {
        clearMarks();
        hint.textContent = baseHint;
      }
    }
    function block(e) { e.preventDefault(); e.stopPropagation(); }
    function finish(result) {
      clearMarks();
      hint.remove(); style.remove();
      document.removeEventListener('mousemove', onMove, true);
      ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'].forEach(function (t) { document.removeEventListener(t, t === 'click' ? onClick : block, true); });
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }
    function onClick(e) {
      block(e);
      if (!current) { var t = document.elementFromPoint(e.clientX, e.clientY); current = pick(t); }
      finish(current ? { selector: current.selector, count: current.count } : null);
    }
    function onKey(e) { if (e.key === 'Escape') { block(e); finish(null); } }

    document.addEventListener('mousemove', onMove, true);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'].forEach(function (t) { document.addEventListener(t, block, true); });
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
}

/* ---------------------------------------------------------------------- *
 * 5. findNextLinkOnPage() -> string | null   (used by "Follow Next links")
 * ---------------------------------------------------------------------- */
function findNextLinkOnPage() {
  function absUrl(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } }
  var relNext = document.querySelector('a[rel~="next"][href], link[rel="next"][href]');
  if (relNext) return absUrl(relNext.getAttribute('href'));
  var NEXT = /^(next( page)?|next\s*[›»>→]|[›»→]|more|older( posts| entries)?)$/i;
  var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
  for (var i = 0; i < anchors.length; i++) {
    var label = (anchors[i].textContent || '').replace(/\s+/g, ' ').trim();
    var href = anchors[i].getAttribute('href');
    if ((NEXT.test(label) || /^next/i.test(anchors[i].getAttribute('aria-label') || '')) && href && !/^(#|javascript:)/i.test(href)) return absUrl(href);
  }
  return null;
}
