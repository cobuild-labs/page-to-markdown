/* support.js - the "Buy me a coffee" picker, shared by the popup (as a sheet)
 * and support.html (as a page). Choices come from config.js (supportTiers).
 * Picking one and pressing the button opens that payment link in a new tab.
 */
/* global ptmSupportTiers, ptmOpen */

var PTM_SUPPORT_ICONS = {
  cup: '<path d="M4 9h12v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/><path d="M3 21h15"/>',
  mug: '<path d="M5 6h11v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6Z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M5 10h11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M12 17.2s-3-1.8-3-3.6a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.8-3 3.6-3 3.6Z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>'
};

function ptmSupportIcon(name, size) {
  return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PTM_SUPPORT_ICONS[name] || PTM_SUPPORT_ICONS.cup) + '</svg>';
}

function ptmEscape(s) {
  return String(s || '').replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
}

// Renders the picker into `root`. opts.onClose: show a close button that calls it.
function ptmMountSupport(root, settings, opts) {
  opts = opts || {};
  var tiers = ptmSupportTiers(settings);
  var at = Math.min(1, tiers.length - 1);
  var paid = false;

  function draw() {
    var tier = tiers[at] || {};
    root.innerHTML =
      (opts.onClose ? '<button type="button" class="sp-x" aria-label="Close">' + ptmSupportIcon('close', 16) + '</button>' : '') +
      '<div class="sp-cup">' + ptmSupportIcon(paid ? 'heart' : 'cup', 28) + '</div>' +
      '<h2 class="sp-title">' + (paid ? 'Thank you' : 'Buy me a coffee') + '</h2>' +
      '<div class="sp-list" role="radiogroup" aria-label="Choose a coffee">' +
      tiers.map(function (t, i) {
        return '<button type="button" role="radio" data-i="' + i + '" aria-checked="' + (i === at) + '" class="sp-tier' + (i === at ? ' on' : '') + '">' +
          '<span class="sp-ic">' + ptmSupportIcon(t.icon, 19) + '</span>' +
          '<span class="sp-txt"><b>' + ptmEscape(t.name) + '</b>' + (t.note ? '<small>' + ptmEscape(t.note) + '</small>' : '') + '</span>' +
          '<span class="sp-price' + (t.price ? '' : ' any') + '">' + (t.price ? ptmEscape(t.price) : 'Any') + '</span></button>';
      }).join('') +
      '</div>' +
      '<button type="button" class="sp-go">' + (tier.price ? 'Support with ' + ptmEscape(tier.price) : 'Choose your amount') + '</button>';

    root.querySelectorAll('.sp-tier').forEach(function (b) {
      b.addEventListener('click', function () { at = +b.getAttribute('data-i'); paid = false; draw(); root.querySelector('.sp-tier.on').focus(); });
    });
    root.querySelector('.sp-list').addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      at = (at + d + tiers.length) % tiers.length; paid = false; draw();
      root.querySelector('.sp-tier.on').focus();
    });
    root.querySelector('.sp-go').addEventListener('click', function () {
      if (!tiers[at]) return;
      ptmOpen(tiers[at].url);
      if (opts.onPaid) opts.onPaid();
      paid = true; draw();
    });
    var x = root.querySelector('.sp-x');
    if (x) x.addEventListener('click', opts.onClose);
  }

  if (!tiers.length) { root.innerHTML = ''; return false; }
  draw();
  return true;
}
