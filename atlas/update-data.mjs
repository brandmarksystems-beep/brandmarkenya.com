#!/usr/bin/env node
/* Brandmark Atlas data refresh. No dependencies, needs Node 18 or newer.

   1. Exchange rates: fetched from a free, key-less endpoint into data/fx.json.
   2. Listings: read from a published Google Sheet (CSV) into data/listings.json,
      validated row by row, with price history kept per listing.

   Environment variables (all optional):
     SHEET_CSV_URL  published-to-web CSV link of your listings sheet
     FX_URL         default https://open.er-api.com/v6/latest/USD
     DATA_DIR       default ./data
     TODAY          YYYY-MM-DD override, used by tests
*/
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const FX_URL = process.env.FX_URL || 'https://open.er-api.com/v6/latest/USD';
const SHEET = (process.env.SHEET_CSV_URL || '').trim();
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);

const log = [];
const note = (level, msg) => { log.push({ level, msg }); console.log(`[${level}] ${msg}`); };

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(path.join(DATA, file), 'utf8')); } catch { return fallback; }
}
async function writeJson(file, obj) {
  await writeFile(path.join(DATA, file), JSON.stringify(obj, null, 2) + '\n');
}
async function getText(url, what) {
  const res = await fetch(url, { headers: { 'user-agent': 'BrandmarkAtlas/1.0 (+https://brandmarkenya.com)' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${what} responded with HTTP ${res.status}`);
  return res.text();
}

/* ---------- CSV (handles quotes, commas and newlines inside quotes) ---------- */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x.trim() !== ''));
  const keys = head.map(h => h.trim().toLowerCase());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/* ---------- exchange rates ---------- */
async function updateFx(cfg) {
  const old = await readJson('fx.json', null);
  try {
    const j = JSON.parse(await getText(FX_URL, 'Exchange-rate source'));
    if (j.result !== 'success' || !j.rates || typeof j.rates.KES !== 'number') throw new Error('unexpected response shape');
    const rates = {};
    for (const c of cfg.currencies) {
      if (typeof j.rates[c] !== 'number' || !(j.rates[c] > 0)) throw new Error(`missing rate for ${c}`);
      rates[c] = j.rates[c];
    }
    rates.USD = 1;
    const out = { base: 'USD', source: 'ExchangeRate-API', source_url: 'https://www.exchangerate-api.com', source_updated_utc: j.time_last_update_utc || null, fetched_on: TODAY, rates };
    if (old && JSON.stringify({ ...old, fetched_on: 0 }) === JSON.stringify({ ...out, fetched_on: 0 })) {
      note('info', 'Exchange rates unchanged.');
    } else { await writeJson('fx.json', out); note('ok', `Exchange rates updated (1 USD = ${rates.KES.toFixed(2)} KES).`); }
    return true;
  } catch (e) {
    note('warn', `Exchange rates NOT updated, keeping the previous file: ${e.message}`);
    return false;
  }
}

/* ---------- listings ---------- */
const num = v => (v === '' || v == null ? NaN : Number(String(v).replace(/,/g, '')));
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function validateRow(r, cfg, fx, line) {
  const err = m => ({ error: `Row ${line}${r.id ? ` (${r.id})` : ''}: ${m}` });
  if (!r.id || !/^[a-z0-9][a-z0-9-]*$/.test(r.id)) return err('id must be lowercase letters, numbers and hyphens');
  if (!r.name) return err('name is missing');
  if (!cfg.categories[r.category]) return err(`category "${r.category}" is not one of ${Object.keys(cfg.categories).join(', ')}`);
  if (!cfg.origins[r.origin]) return err(`origin "${r.origin}" is not one of ${Object.keys(cfg.origins).join(', ')}`);
  if (r.store && cfg.stores && !cfg.stores[r.store]) return err(`store "${r.store}" is not one of ${Object.keys(cfg.stores).join(', ')}`);
  const price = num(r.price);
  if (!(price > 0)) return err('price must be a number above 0');
  if (!fx.rates[r.currency]) return err(`currency "${r.currency}" is not one of ${Object.keys(fx.rates).join(', ')}`);
  const service = r.category === 'service' || !!cfg.origins[r.origin].local;
  const w = num(r.weight_kg), l = num(r.length_cm), wd = num(r.width_cm), h = num(r.height_cm);
  if (!service && !(w > 0 && l > 0 && wd > 0 && h > 0)) return err('weight_kg, length_cm, width_cm and height_cm are required for goods');
  if (r.launched_on && !isDate(r.launched_on)) return err('launched_on must look like 2026-10-09');
  if (r.checked_on && !isDate(r.checked_on)) return err('checked_on must look like 2026-10-09');
  const verified = r.verified.toLowerCase() === 'yes';
  if (verified && (!r.source_url || !r.checked_on)) return err('verified listings need source_url and checked_on');
  if (r.source_url && !/^https?:\/\//.test(r.source_url)) return err('source_url must start with http:// or https://');
  const rating = num(r.rating);
  return {
    item: {
      id: r.id, name: r.name, cat: r.category, origin: r.origin, store: r.store || (cfg.origins[r.origin].local ? '' : 'other'), price, cur: r.currency,
      ...(r.unit ? { unit: r.unit } : {}),
      ...(service ? {} : { w, dim: [l, wd, h] }),
      seller: r.seller || 'Unnamed seller', url: r.source_url || '', verified, checked_on: r.checked_on || '',
      launched_on: r.launched_on || TODAY, rating: rating >= 0 && rating <= 5 ? rating : null,
      group: r.group || '', notes: r.notes || ''
    }
  };
}

async function updateListings(cfg, fx) {
  if (!SHEET) { note('info', 'SHEET_CSV_URL is not set, so listings.json was left as it is.'); return; }
  let text;
  try { text = await getText(SHEET, 'Listings sheet'); }
  catch (e) { note('warn', `Listings NOT updated, keeping the previous file: ${e.message}`); return; }
  if (/^\s*<(!doctype|html)/i.test(text)) { note('warn', 'The sheet link returned a web page, not CSV. Re-publish the sheet as CSV. Keeping the previous file.'); return; }
  const rows = parseCsv(text);
  const old = await readJson('listings.json', { items: [] });
  const oldById = new Map(old.items.map(i => [i.id, i]));
  const items = [], seen = new Set(); let skipped = 0;
  rows.forEach((r, i) => {
    const v = validateRow(r, cfg, fx, i + 2);
    if (v.error) { skipped++; note('warn', `Skipped. ${v.error}`); return; }
    if (seen.has(v.item.id)) { skipped++; note('warn', `Skipped. Row ${i + 2}: duplicate id ${v.item.id}`); return; }
    seen.add(v.item.id);
    /* price history: add a point only when the price (or currency) changes */
    const prev = oldById.get(v.item.id);
    const hist = prev && Array.isArray(prev.history) ? [...prev.history] : [];
    const last = hist[hist.length - 1];
    if (!last || last[1] !== v.item.price || (prev && prev.cur !== v.item.cur)) hist.push([TODAY, v.item.price]);
    v.item.history = hist.slice(-30);
    items.push(v.item);
  });
  if (!items.length) { note('warn', 'The sheet produced no valid rows. Keeping the previous listings.json.'); return; }
  if (old.items.length >= 10 && items.length < old.items.length * 0.5) {
    note('warn', `The sheet has only ${items.length} valid rows against ${old.items.length} before. Keeping the previous file in case the sheet was damaged. Fix the sheet or delete data/listings.json to force an update.`);
    return;
  }
  const same = JSON.stringify(old.items) === JSON.stringify(items);
  if (same) { note('info', `Listings unchanged (${items.length}).`); return; }
  await writeJson('listings.json', { generated_on: TODAY, count: items.length, items });
  note('ok', `Listings updated: ${items.length} published, ${skipped} skipped.`);
}

/* ---------- run ---------- */
async function main() {
  const cfg = await readJson('config.json', null);
  if (!cfg) throw new Error('data/config.json is missing or invalid JSON');
  const fxOk = await updateFx(cfg);
  const fx = await readJson('fx.json', null);
  if (!fx) throw new Error('data/fx.json is missing and could not be fetched');
  await updateListings(cfg, fx);
  const warns = log.filter(l => l.level === 'warn').length;
  await writeFile(path.join(DATA, 'update-report.json'), JSON.stringify({ ran_on: TODAY, fx_ok: fxOk, warnings: warns, log }, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Atlas data refresh (${TODAY})\n\n` + log.map(l => `- **${l.level}** ${l.msg}`).join('\n') + '\n');
  }
  console.log(warns ? `Finished with ${warns} warning(s).` : 'Finished cleanly.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('update-data.mjs')) {
  main().catch(e => { console.error('Update failed:', e.message); process.exit(1); });
}
