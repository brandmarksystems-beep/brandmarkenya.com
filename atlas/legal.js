/* Fills company details into the legal pages and adds the shared header and footer.
   Every value comes from data/config.json under "legal". The pages already contain the same
   words as defaults, so they stay readable if this script cannot run. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var here = (location.pathname.split('/').pop() || 'index.html');

  function chrome(L) {
    var head = document.getElementById('chrome-header');
    if (head) {
      head.innerHTML = '<header class="nav"><div class="wrap">' +
        '<a class="brand" href="index.html" aria-label="' + esc(L.service_name) + ' home"><span class="brand-mark" aria-hidden="true"><img src="assets/logo-mark.png" alt="" width="40" height="40"></span>' +
        '<span class="brand-name">Brandmark<span>ATLAS</span></span></a>' +
        '<nav class="nav-links" aria-label="Legal pages">' + L.pages.map(function (p) {
          return '<a href="' + esc(p.href) + '"' + (p.href === here ? ' aria-current="page" style="color:var(--white);background:var(--panel-2)"' : '') + '>' + esc(p.title) + '</a>';
        }).join('') + '</nav>' +
        '<a class="btn btn-ghost btn-sm" href="index.html">Back to Atlas</a></div></header>';
    }
    var foot = document.getElementById('chrome-footer');
    if (foot) {
      foot.innerHTML = '<footer><div class="wrap"><div class="foot">' +
        '<div><p><b style="color:var(--white)">' + esc(L.company_name) + '</b><br>' + L.address.map(esc).join('<br>') + '</p></div>' +
        '<div><h4>Legal</h4><ul>' + L.pages.map(function (p) { return '<li><a href="' + esc(p.href) + '">' + esc(p.title) + '</a></li>'; }).join('') + '</ul></div>' +
        '<div><h4>Reach us</h4><ul><li>' + esc(L.email) + '</li><li class="mono">' + esc(L.phone) + '</li></ul></div>' +
        '</div><p class="fine">© ' + new Date().getFullYear() + ' ' + esc(L.company_name) + '. ' + esc(L.service_name) + ' provides estimates, not quotes.</p></div></footer>';
    }
  }

  function fill(L) {
    document.querySelectorAll('[data-legal]').forEach(function (el) {
      var v = L[el.getAttribute('data-legal')];
      if (Array.isArray(v)) v = v.join(', ');
      if (v != null && v !== '') el.textContent = v;
    });
    document.querySelectorAll('[data-legal-show]').forEach(function (el) {
      el.hidden = !L[el.getAttribute('data-legal-show')];
    });
    document.querySelectorAll('[data-legal-mail]').forEach(function (el) {
      el.setAttribute('href', 'mailto:' + L.email); el.textContent = L.email;
    });
    document.querySelectorAll('[data-legal-site]').forEach(function (el) {
      el.setAttribute('href', L.website);
    });
  }

  var emptyCfg = { origins: {}, currencies: [], contact: { whatsapp: '254736900750' } };
  function mountForms(cfg) {
    if (window.AtlasForms && document.getElementById('contact-forms')) AtlasForms.mountTabs(document.getElementById('contact-forms'), 'contact', cfg);
  }
  AtlasJSON.get(((window.ATLAS_DATA_DIR != null) ? window.ATLAS_DATA_DIR : 'data/') + 'config.json?t=' + Math.floor(Date.now() / 300000), 'config.json')
    .then(function (cfg) {
      var L = cfg.legal;
      if (L) { chrome(L); fill(L); }
      mountForms(cfg);
      document.querySelectorAll('[data-wa]').forEach(function (a) { a.href = 'https://wa.me/' + cfg.contact.whatsapp + '?text=' + encodeURIComponent(a.getAttribute('data-wa') || 'Hello Brandmark'); });
    })
    .catch(function (e) {
      var head = document.getElementById('chrome-header');
      if (head) head.innerHTML = '<div class="wrap" style="padding-block:14px"><a class="btn btn-ghost btn-sm" href="index.html">Back to Atlas</a></div>';
      var box = document.getElementById('contact-forms');
      if (box) box.insertAdjacentHTML('beforebegin', '<div class="banner"><b>Some page settings did not load.</b> ' + String(e.message).replace(/</g, '&lt;') + '</div>');
      mountForms(emptyCfg);
    });
})();
