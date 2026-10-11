/* Loads a JSON data file and forgives the usual hand-editing slips (a trailing comma, a stray byte-order mark).
   If the file is still broken it says WHICH file and WHERE, so the fix takes seconds. */
(function (root) {
  'use strict';
  function stripTrailingCommas(t) {
    var out = '', inStr = false, esc = false, i, c, j;
    for (i = 0; i < t.length; i++) {
      c = t[i];
      if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ',') { j = i + 1; while (j < t.length && /\s/.test(t[j])) j++; if (t[j] === '}' || t[j] === ']') continue; }
      out += c;
    }
    return out;
  }
  function where(text, err) {
    var m = /position (\d+)/.exec(err.message || ''), pos = m ? +m[1] : -1;
    if (pos < 0) return '';
    var before = text.slice(0, pos).split('\n'), line = before.length, col = before[before.length - 1].length + 1;
    return ' near line ' + line + ', column ' + col + ': "' + (text.split('\n')[line - 1] || '').trim().slice(0, 80) + '"';
  }
  function parse(text, name) {
    text = text.replace(/^﻿/, '');
    try { return JSON.parse(text); } catch (e1) {
      try { return JSON.parse(stripTrailingCommas(text)); } catch (e2) {
        throw new Error(name + ' has a typo' + where(text, e1) + '. Check commas and double quotes there (jsonlint.com can find it)');
      }
    }
  }
  function get(url, name) {
    name = name || url.split('?')[0];
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' returned ' + r.status);
      return r.text();
    }).then(function (t) { return parse(t, name); });
  }
  var api = { get: get, parse: parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AtlasJSON = api;
})(typeof self !== 'undefined' ? self : this);
