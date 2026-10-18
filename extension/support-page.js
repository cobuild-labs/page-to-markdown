/* global ptmGetSettings, ptmMountSupport */
ptmGetSettings().then(function (s) {
  var root = document.getElementById('sp');
  if (!ptmMountSupport(root, s, { onClose: function () { window.close(); } })) root.textContent = 'No support link is set up.';
});
