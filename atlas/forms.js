/* Brandmark Atlas form system.
   Forms are described in data/forms.json. This file turns a description into a working form,
   validates it, and sends it through Web3Forms. Edit forms.json, not this file, to change a form.
   Public API: AtlasForms.mountTabs(container, group, cfg) */
(function (root) {
  'use strict';

  var TYPES = ['text', 'email', 'tel', 'url', 'number', 'select', 'textarea', 'checkbox', 'hidden'];
  var lastSent = 0;
  var cache = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function dd() { return (typeof window !== 'undefined' && window.ATLAS_DATA_DIR != null) ? window.ATLAS_DATA_DIR : 'data/'; }
  function loadForms() {
    if (cache) return cache;
    var bucket = Math.floor(Date.now() / 300000);
    cache = root.AtlasJSON ? root.AtlasJSON.get(dd() + 'forms.json?t=' + bucket, dd() + 'forms.json') : fetch(dd() + 'forms.json?t=' + bucket).then(function (r) { return r.json(); });
    return cache;
  }

  function optionsFor(f, cfg) {
    if (f.options_from === 'origins') {
      return Object.keys(cfg.origins).map(function (k) { return [k, cfg.origins[k].name + ' · ' + cfg.origins[k].city]; });
    }
    if (f.options_from === 'currencies') {
      return cfg.currencies.map(function (c) { return [c, c]; });
    }
    return (f.options || []).map(function (o) {
      return typeof o === 'string' ? [o, o] : [o.value, o.label];
    });
  }

  function fieldHTML(f, uid, cfg) {
    var id = uid + '-' + f.name;
    var cls = 'fld' + (f.half ? '' : ' full');
    var req = f.required ? ' required' : '';
    var star = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
    if (f.type === 'hidden') {
      return '<input type="hidden" name="' + esc(f.name) + '" value="' + esc(f.value || '') + '">';
    }
    if (f.type === 'checkbox') {
      return '<label class="check full" for="' + id + '"><input id="' + id + '" name="' + esc(f.name) + '" type="checkbox" value="Yes"' + req + '>' +
        '<span>' + esc(f.label) + star + '</span></label>';
    }
    var control;
    if (f.type === 'select') {
      control = '<select id="' + id + '" name="' + esc(f.name) + '"' + req + '>' +
        (f.required ? '<option value="" disabled selected>Choose…</option>' : '<option value="">Choose…</option>') +
        optionsFor(f, cfg).map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    } else if (f.type === 'textarea') {
      control = '<textarea id="' + id + '" name="' + esc(f.name) + '"' + req + (f.max ? ' maxlength="' + f.max + '"' : '') + '></textarea>';
    } else {
      control = '<input id="' + id + '" name="' + esc(f.name) + '" type="' + f.type + '"' + req +
        (f.max ? ' maxlength="' + f.max + '"' : '') +
        (f.min != null ? ' min="' + f.min + '"' : '') +
        (f.step ? ' step="' + esc(f.step) + '"' : '') +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
        (f.type === 'email' ? ' autocomplete="email" inputmode="email"' : '') +
        (f.type === 'tel' ? ' autocomplete="tel" inputmode="tel"' : '') + '>';
    }
    return '<div class="' + cls + '"><label for="' + id + '">' + esc(f.label) + star + '</label>' + control + '</div>';
  }

  function formHTML(def, uid, cfg, settings) {
    var consent = def.consent !== false
      ? '<label class="check full" for="' + uid + '-consent"><input id="' + uid + '-consent" name="consent" type="checkbox" value="Yes" required><span>' + settings.consent_html + ' <span class="req" aria-hidden="true">*</span></span></label>'
      : '';
    return (def.title ? '<h3 class="form-title">' + esc(def.title) + '</h3>' : '') +
      (def.intro ? '<p class="form-intro">' + esc(def.intro) + '</p>' : '') +
      '<form class="form" novalidate>' +
        '<input type="checkbox" name="botcheck" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        def.fields.map(function (f) { return fieldHTML(f, uid, cfg); }).join('') +
        consent +
        '<div class="full"><button type="submit" class="btn btn-primary">' + esc(def.submit || 'Send') + '</button></div>' +
        '<p class="form-msg full" role="status" aria-live="polite"></p>' +
      '</form>';
  }

  function valueOf(form, f) {
    var el = form.elements[f.name];
    if (!el) return '';
    if (f.type === 'checkbox') return el.checked ? 'Yes' : '';
    return String(el.value || '').trim();
  }

  async function submit(form, id, def, cfg, settings) {
    var msg = form.querySelector('.form-msg');
    var say = function (t, c) { msg.textContent = t; msg.className = 'form-msg full ' + (c || ''); };
    if (!form.checkValidity()) { form.reportValidity(); say('Please complete the highlighted fields.', 'err'); return; }
    if (form.elements.botcheck && form.elements.botcheck.checked) return;
    var provider = settings.provider || 'cloudflare';
    var key = cfg.forms && cfg.forms.web3forms_key;
    if (provider === 'web3forms' && (!key || /^YOUR_/.test(key))) { say(settings.not_configured, 'err'); return; }
    if (Date.now() - lastSent < 8000) { say(settings.wait, 'err'); return; }

    var body = {};
    def.fields.forEach(function (f) { var v = valueOf(form, f); if (v !== '' || f.type === 'hidden') body[f.name] = v; });
    if (def.consent !== false) body.consent = 'Yes';
    body.source_page = location.href.split('#')[0];
    body.subject = (settings.subject_prefix || '') + (def.tab || def.title || id);

    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true; say('Sending…');
    var mail = (cfg.legal && cfg.legal.email) || (cfg.contact && cfg.contact.email) || '';
    try {
      var res;
      if (provider === 'cloudflare') {
        body.form = id;
        res = await fetch(settings.endpoint || '/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        });
        var jj = {};
        try { jj = await res.json(); } catch (x) { /* not JSON */ }
        if (res.status === 503) { say(settings.not_configured, 'err'); btn.disabled = false; return; }
        if (!res.ok || !jj.ok) throw new Error(jj.message || ('the server answered ' + res.status));
      } else {
        body.form = id; body.access_key = key; body.from_name = 'Brandmark Atlas';
        res = await fetch(settings.web3forms_endpoint || 'https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        });
        var j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.message || 'The service did not accept it');
      }
      lastSent = Date.now();
      form.reset();
      say(def.success || settings.success, 'ok');
    } catch (e) {
      say('That did not send: ' + e.message + '. Please email ' + mail + ' or message us on WhatsApp.', 'err');
    }
    btn.disabled = false;
  }

  /* Check a forms.json document and return a list of problems (used by tests and at load time). */
  function validate(doc) {
    var problems = [], seen = {};
    if (!doc || !doc.forms || !doc.settings) return ['forms.json needs "settings" and "forms"'];
    Object.keys(doc.forms).forEach(function (id) {
      var d = doc.forms[id], names = {};
      if (!Array.isArray(d.fields) || !d.fields.length) problems.push(id + ': no fields');
      (d.fields || []).forEach(function (f) {
        if (!f.name || !/^[a-z][a-z0-9_]*$/.test(f.name)) problems.push(id + ': bad field name "' + f.name + '"');
        if (TYPES.indexOf(f.type) < 0) problems.push(id + '.' + f.name + ': unknown type "' + f.type + '"');
        if (names[f.name]) problems.push(id + ': duplicate field "' + f.name + '"');
        names[f.name] = 1;
        if (f.type === 'select' && !f.options && !f.options_from) problems.push(id + '.' + f.name + ': select needs options');
        if (f.options_from && ['origins', 'currencies'].indexOf(f.options_from) < 0) problems.push(id + '.' + f.name + ': unknown options_from');
        if (['name', 'consent', 'botcheck', 'access_key', 'subject', 'from_name', 'form', 'source_page'].indexOf(f.name) >= 0 && f.name !== 'name') problems.push(id + '.' + f.name + ': reserved field name');
        if (!f.label && f.type !== 'hidden') problems.push(id + '.' + f.name + ': missing label');
      });
      if (!d.show_on || !d.show_on.length) problems.push(id + ': show_on is empty, so it never appears');
      if (!d.tab) problems.push(id + ': missing tab label');
    });
    return problems;
  }

  async function mountTabs(container, group, cfg) {
    if (!container) return;
    var doc;
    try { doc = await loadForms(); }
    catch (e) { container.innerHTML = '<div class="banner"><b>The form could not load.</b> ' + esc(e.message) + '. Please email us instead.</div>'; return; }
    var problems = validate(doc);
    if (problems.length && root.console) console.warn('forms.json problems:', problems);
    var ids = Object.keys(doc.forms).filter(function (id) { return (doc.forms[id].show_on || []).indexOf(group) >= 0; });
    if (!ids.length) { container.innerHTML = ''; return; }
    var uidBase = 'f-' + group;
    var tabs = ids.length > 1
      ? '<div class="seg tabs" role="tablist" aria-label="Choose a form">' + ids.map(function (id, i) {
          return '<button type="button" role="tab" id="' + uidBase + '-tab-' + id + '" aria-controls="' + uidBase + '-' + id + '" aria-selected="' + (i === 0) + '" aria-pressed="' + (i === 0) + '" data-form="' + esc(id) + '">' + esc(doc.forms[id].tab) + '</button>';
        }).join('') + '</div>'
      : '';
    container.innerHTML = tabs + ids.map(function (id, i) {
      return '<div class="form-panel" role="tabpanel" id="' + uidBase + '-' + id + '" data-form-id="' + esc(id) + '"' + (i === 0 ? '' : ' hidden') + '>' +
        formHTML(doc.forms[id], uidBase + '-' + id, cfg, doc.settings) + '</div>';
    }).join('');

    container.querySelectorAll('.form-panel').forEach(function (panel) {
      var id = panel.getAttribute('data-form-id');
      panel.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault(); submit(e.target, id, doc.forms[id], cfg, doc.settings);
      });
    });
    function show(id) {
      container.querySelectorAll('.form-panel').forEach(function (p) { p.hidden = p.getAttribute('data-form-id') !== id; });
      container.querySelectorAll('.tabs button').forEach(function (b) {
        var on = b.getAttribute('data-form') === id;
        b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on));
      });
    }
    container.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-form')); });
    });
    /* allow a link such as contact.html#data-request to open a particular form */
    var want = (location.hash || '').slice(1);
    if (want && ids.indexOf(want) >= 0) show(want);
  }

  var api = { mountTabs: mountTabs, validate: validate, TYPES: TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AtlasForms = api;
})(typeof self !== 'undefined' ? self : this);
