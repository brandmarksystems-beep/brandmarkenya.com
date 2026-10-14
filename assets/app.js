/* Brandmark Atlas front end. Reads data/config.json, data/fx.json and data/listings.json. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODE = AtlasEngine.MODE_LABEL;

  let CFG, FX, DATA, E, LIST = [];
  const state = { usd: false, mode: 'smart', cat: 'all', origin: 'all', store: 'all', q: '', sort: 'new', picks: [], drawer: null, drawerMode: null };
  try { state.usd = localStorage.getItem('atlas.usd') === '1'; } catch (e) { /* storage may be blocked */ }

  /* ---------- helpers ---------- */
  const nf = (n, d) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const KES = () => CFG.destination.currency;
  function money(usd) {
    if (state.usd) return '$' + nf(usd, usd >= 100 ? 0 : 2);
    const v = usd * FX.rates[KES()];
    return KES() + ' ' + nf(v, v >= 100 ? 0 : 2);
  }
  const curCode = () => (state.usd ? 'USD' : KES());
  const listed = p => p.cur + ' ' + nf(p.price, p.price >= 100 ? 0 : 2);
  const toUSD = (a, c) => a / FX.rates[c];
  const midnight = iso => new Date(iso + 'T00:00:00');
  const todayMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysSince = iso => (iso ? Math.max(0, Math.floor((todayMs() - midnight(iso).getTime()) / 864e5)) : 9999);
  const fmtDate = iso => (iso ? midnight(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const agoText = d => (d === 0 ? 'today' : d + 'd ago');
  const isLocal = p => !!(CFG.origins[p.origin] && CFG.origins[p.origin].local);
  const flat = r => r.service || r.isLocal;
  const storeName = p => (CFG.stores && CFG.stores[p.store] ? CFG.stores[p.store].label : p.seller);
  const routeTxt = p => isLocal(p) ? storeName(p) + ' · Kenya' : storeName(p) + ' · ' + p.origin + ' → ' + CFG.destination.code;
  const calc = (p, mode) => E.landedForListing(p, mode || state.mode, false);
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function waLink(text) { return 'https://wa.me/' + CFG.contact.whatsapp + '?text=' + encodeURIComponent(text); }

  function segs(r) {
    const t = r.total;
    return [['s-item', r.item], ['s-ship', r.ship], ['s-duty', r.taxes], ['s-vat', r.vat]]
      .filter(s => s[1] > 0).map(s => `<i class="${s[0]}" style="width:${(s[1] / t * 100).toFixed(2)}%"></i>`).join('');
  }
  const barScaled = (r, max) => `<div class="bar" style="width:${(r.total / max * 100).toFixed(2)}%">${segs(r)}</div>`;

  /* price history comes from real runs of the refresh job, so a line needs two or more points */
  function trendPct(p) {
    const h = p.history || [];
    if (h.length < 2 || !(h[0][1] > 0)) return null;
    return (h[h.length - 1][1] - h[0][1]) / h[0][1] * 100;
  }
  function spark(p) {
    const h = (p.history || []).map(x => x[1]);
    if (h.length < 2) return '';
    const min = Math.min(...h), max = Math.max(...h), W = 84, H = 26;
    const pts = h.map((v, i) => [i / (h.length - 1) * W, H - 3 - (v - min) / (max - min || 1) * (H - 6)]);
    const down = h[h.length - 1] <= h[0], col = down ? 'var(--teal-bright)' : 'var(--warn)', last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.8" fill="${col}"/></svg>`;
  }
  function status(p) {
    if (!p.verified) return { k: 'i', t: 'Illustrative price' };
    const d = daysSince(p.checked_on);
    if (d > CFG.site.stale_days) return { k: 's', t: 'Re-check, ' + d + 'd old' };
    return { k: 'v', t: 'Verified ' + fmtDate(p.checked_on) };
  }
  const badge = p => { const s = status(p); return `<span class="badge ${s.k}">${s.t}</span>`; };

  /* ---------- load ---------- */
  async function load() {
    const bucket = Math.floor(Date.now() / 300000);
    const get = async f => {
      const dd = window.ATLAS_DATA_DIR != null ? window.ATLAS_DATA_DIR : 'data/';
      return AtlasJSON.get(dd + f + '?t=' + bucket, dd + f);
    };
    [CFG, FX, DATA] = await Promise.all([get('config.json'), get('fx.json'), get('listings.json')]);
  }
  function showLoadError(e) {
    $('#feed-chip').innerHTML = '<i class="dot" style="background:var(--warn)"></i>Data unavailable';
    $('#grid').innerHTML = `<div class="banner" style="grid-column:1/-1"><b>Atlas could not load its data.</b> ${esc(e.message)}. If you opened this file straight from your computer, open it through a web server or the Cloudflare link instead, because browsers block data files on local pages. <button type="button" class="btn btn-toggle btn-sm" onclick="location.reload()" style="margin-left:8px">Try again</button></div>`;
  }

  /* ---------- setup ---------- */
  function setup() {
    LIST = DATA.items.map(p => Object.assign({}, p, { ago: daysSince(p.launched_on) }));
    state.picks = [];
    $('#cur-local').textContent = KES();
    const origins = Object.entries(CFG.origins);
    const importOrigins = origins.filter(([k, o]) => !o.local);
    const optOrigin = origins.map(([k, o]) => `<option value="${k}">${esc(o.name)} · ${esc(o.city)}</option>`).join('');
    $('#originSel').innerHTML = '<option value="all">All origins</option>' + optOrigin;
    $('#e-origin').innerHTML = importOrigins.map(([k, o]) => `<option value="${k}">${esc(o.name)} · ${esc(o.city)}</option>`).join(''); $('#e-origin').value = CFG.origins.US ? 'US' : importOrigins[0][0];
    const stores = Object.entries(CFG.stores || {});
    $('#storeSel').innerHTML = '<option value="all">All stores</option><option value="kind:local">All Kenyan stores</option><option value="kind:import">All overseas stores</option>' + stores.map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('');
    const cats = Object.entries(CFG.categories);
    $('#e-cat').innerHTML = cats.filter(([k]) => k !== 'service').map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
    const curOpts = Object.keys(FX.rates).map(c => `<option>${c}</option>`).join('');
    $('#e-cur').innerHTML = curOpts; $('#e-cur').value = 'USD';
    $('#e-from').innerHTML = '<option value="">Custom shipment</option>' + LIST.filter(p => p.cat !== 'service' && !isLocal(p))
      .map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(storeName(p))}</option>`).join('');
    $('#chips').innerHTML = [['all', 'All listings']].concat(cats.map(([k, v]) => [k, v.label]))
      .map(([k, v]) => `<button type="button" class="btn btn-toggle" data-cat="${esc(k)}" aria-pressed="${k === 'all'}">${esc(v)}</button>`).join('');
    $('#cur-usd').setAttribute('aria-pressed', String(state.usd)); $('#cur-local').setAttribute('aria-pressed', String(!state.usd));
    const first = LIST.find(p => p.cat !== 'service' && !isLocal(p) && p.origin === $('#e-origin').value);
    if (first) { $('#e-from').value = first.id; fillEstFrom(first.id); }
    renderStatic();
  }

  function renderStatic() {
    const fxAge = daysSince(FX.fetched_on);
    $('#feed-chip').innerHTML = `<i class="dot"${fxAge > 3 ? ' style="background:var(--warn)"' : ''}></i>${fxAge > 3 ? 'Rates may be stale' : 'Rates current'}`;
    $('#feed-time').textContent = 'Rates ' + fmtDate(FX.fetched_on) + ' · listings ' + fmtDate(DATA.generated_on);
    $('#stats').innerHTML = [[LIST.length, 'listings'], [Object.keys(CFG.stores || {}).length, 'stores compared'], [LIST.filter(p => p.verified).length, 'verified prices'], ['3', 'freight modes']]
      .map(s => `<div class="stat"><strong>${s[0]}</strong><span>${s[1]}</span></div>`).join('');
    const D = CFG.destination, cats = Object.entries(CFG.categories);
    $('#method-body').innerHTML = `
      <div class="mbox"><h3>The formula</h3><ul>
        <li><b>1. Item.</b> The seller's price, converted to US dollars at the latest rate.</li>
        <li><b>2. Freight.</b> Billed kilograms times the origin rate, with a minimum charge and a fuel surcharge. Billed weight is the larger of actual weight and length × width × height ÷ ${CFG.freight.volumetric_divisor.air} (air) or ÷ ${CFG.freight.volumetric_divisor.sea} (sea).</li>
        <li><b>3. Customs value.</b> Item plus freight, fuel and any insurance.</li>
        <li><b>4. Taxes.</b> Duty and levies on the customs value, then ${(D.vat * 100).toFixed(0)}% VAT on customs value plus duty plus levies.</li>
        <li><b>5. Flat fees.</b> Handling, documents and local delivery sit outside customs value.</li></ul></div>
      <div class="mbox"><h3>Rates in use</h3><ul>
        ${cats.filter(([k]) => k !== 'service').map(([k, c]) => `<li><b>${esc(c.label)}</b> <span class="mono">duty ${(c.duty * 100).toFixed(0)}%</span><br>${esc(c.note)}</li>`).join('')}
        ${D.levies.map(l => `<li><b>${esc(l.name)}</b> <span class="mono">${(l.rate * 100).toFixed(1).replace('.0', '')}%</span></li>`).join('')}
        <li>VAT and levies last reviewed ${fmtDate(D.verified_on)}. Duty rates are indicative and freight rates were last reviewed ${fmtDate(CFG.freight.verified_on)}. ${esc(D.note)}</li>
        <li>${D.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(', ')}</li></ul></div>
      <div class="mbox"><h3>What Atlas cannot know</h3><ul>
        <li>${esc(CFG.freight.note)}</li>
        <li>Customs decides the final classification and may value goods above the invoice price.</li>
        <li>Courier parcels, postal items and forwarded cargo can be charged differently.</li>
        <li>Prices marked Illustrative are examples. Verified prices show a date and a link to the source.</li>
        <li>An estimate is not a quote. <a href="${waLink('Hello Brandmark, I would like a real import quote for Kenya.')}" target="_blank" rel="noopener">Ask us for one on WhatsApp</a>.</li></ul></div>`;
    const c = CFG.contact;
    $('#foot').innerHTML = `
      <div><div class="brand" style="margin-bottom:14px"><span class="brand-mark" aria-hidden="true"><img src="assets/logo-mark.png" alt="" width="40" height="40"></span><span class="brand-name">Brandmark<span>SYSTEMS LTD</span></span></div>
      <p>Branding, printing and cross-border market tools from Eldoret, Kenya.</p></div>
      <div><h4>Visit</h4><ul>${c.address.map(a => `<li>${esc(a)}</li>`).join('')}<li>${esc(c.email)}</li></ul></div>
      <div><h4>Legal</h4><ul>${((CFG.legal && CFG.legal.pages) || []).map(p => `<li><a href="${esc(p.href)}">${esc(p.title)}</a></li>`).join('')}</ul></div>
      <div><h4>Call and follow</h4><ul>${c.phones.map(p => `<li class="mono">${esc(p)}</li>`).join('')}<li>${esc(c.social)}</li></ul></div>`;
    $('#e-from').value = $('#e-from').value;
  }

  /* ---------- hero and ticker ---------- */
  function renderHero() {
    const grp = LIST.filter(p => p.group && p.group === CFG.site.hero_group).slice(0, 4);
    if (grp.length < 2) { $('#hcard').hidden = true; return; }
    $('#hcard').hidden = false;
    const rows = grp.map(p => ({ p, r: calc(p, 'smart') })).sort((a, b) => a.r.total - b.r.total), max = rows[rows.length - 1].r.total;
    $('#hc-title').textContent = rows[0].p.name;
    $('#hc-sub').textContent = 'What each store really costs in ' + CFG.destination.name + '. Imports include shipping, duty and VAT.';
    $('#hc-rows').innerHTML = rows.map((x, i) => `<div class="hrow">
      <div class="hrow-top"><span><span class="tag ${i === 0 ? 'best' : ''}">${esc(routeTxt(x.p))}</span> <span class="route">${esc(listed(x.p))}</span></span><b>${money(x.r.total)}</b></div>
      ${barScaled(x.r, max)}</div>`).join('');
  }
  function renderTicker() {
    const items = LIST.slice().sort((a, b) => a.ago - b.ago).slice(0, 10).map(p => {
      const t = trendPct(p);
      return `<span class="tk">${p.ago <= 3 ? '<span class="new">NEW</span>' : ''}<b>${esc(p.name)}</b>${esc(p.origin)}<span>${esc(listed(p))}</span>${t == null ? '' : `<span style="color:${t <= 0 ? 'var(--teal-bright)' : 'var(--warn)'}">${t <= 0 ? '▼' : '▲'} ${Math.abs(t).toFixed(1)}%</span>`}</span>`;
    }).join('');
    $('#ticker').innerHTML = items + items;
  }

  /* ---------- listings ---------- */
  function visible() {
    const q = state.q.trim().toLowerCase();
    const tot = p => calc(p).total;
    const list = LIST.filter(p => (state.cat === 'all' || p.cat === state.cat) && (state.origin === 'all' || p.origin === state.origin) && (state.store === 'all' || p.store === state.store || (state.store.startsWith('kind:') && CFG.stores[p.store] && CFG.stores[p.store].kind === state.store.slice(5))) &&
      (!q || (p.name + ' ' + CFG.categories[p.cat].label + ' ' + CFG.origins[p.origin].name + ' ' + p.seller + ' ' + storeName(p)).toLowerCase().includes(q)));
    const s = state.sort, tr = p => { const t = trendPct(p); return t == null ? 999 : t; };
    list.sort((a, b) => s === 'low' ? tot(a) - tot(b) : s === 'high' ? tot(b) - tot(a) : s === 'drop' ? tr(a) - tr(b) : a.ago - b.ago);
    return list;
  }
  function cardHTML(p) {
    const r = calc(p), t = trendPct(p), sel = state.picks.includes(p.id), O = CFG.origins[p.origin];
    const modeTxt = r.service ? 'Digital · no shipping' : r.isLocal ? 'In Kenya · no import costs' : `${MODE[r.mode]} · ${r.days} days`;
    const usd = toUSD(p.price, p.cur);
    return `<article class="card ${sel ? 'sel' : ''}">
      <div class="card-top"><span class="tag">${esc(CFG.categories[p.cat].label)}</span><span class="route">${esc(routeTxt(p))}</span></div>
      <h3>${esc(p.name)}</h3>
      <div class="seller">${esc(p.seller)} · ${agoText(p.ago)} ${p.ago <= 3 ? '<span class="new">NEW</span>' : ''}</div>
      <div>${badge(p)}</div>
      <div class="price-row">
        <div><span class="lbl">Listed</span><div class="mono">${esc(listed(p))} <small>${p.unit ? esc(p.unit) : '≈ $' + nf(usd, usd >= 100 ? 0 : 2)}</small></div></div>
        ${t == null ? '' : `<div class="trend ${t <= 0 ? 'down' : 'up'}">${spark(p)}<span>${t <= 0 ? '−' : '+'}${Math.abs(t).toFixed(1)}%</span></div>`}
      </div>
      <div class="landed">
        <span class="lbl">${r.service ? 'With VAT' : r.isLocal ? 'Shelf price in Kenya' : 'Landed in ' + esc(CFG.destination.name)}</span>
        <div class="landed-line"><strong>${money(r.total)}</strong>${r.isLocal ? '' : `<span class="mult">×${(r.total / r.item).toFixed(2)}</span>`}</div>
        <div class="bar">${segs(r)}</div>
      </div>
      <div class="card-meta"><span>${modeTxt}</span>${flat(r) ? '' : `<span>${nf(r.bw.billed, r.bw.billed < 10 ? 1 : 0)} kg billed</span>`}<span>${esc(O.city)}</span>${p.rating ? `<span>★ ${p.rating.toFixed(1)}</span>` : ''}</div>
      <div class="card-actions">
        <button type="button" class="btn btn-toggle btn-sm" data-pick="${esc(p.id)}" aria-pressed="${sel}">${sel ? 'Added' : 'Compare'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-open="${esc(p.id)}">Breakdown</button>
      </div>
    </article>`;
  }
  function renderGrid() {
    const list = visible();
    $('#grid').innerHTML = list.length ? list.map(cardHTML).join('')
      : `<div class="empty">No listings match “${esc(state.q)}”. Try a broader word, or <a class="src" href="#contribute">suggest a listing</a>.</div>`;
  }


  /* ---------- sourced in Kenya ---------- */
  function renderLocal() {
    const locals = LIST.filter(isLocal);
    $('#local').hidden = locals.length === 0;
    if (!locals.length) return;
    const stores = Object.entries(CFG.stores).filter(([k, v]) => v.kind === 'local' && locals.some(p => p.store === k));
    $('#local-stores').innerHTML = stores.map(([k, v]) => `<span class="tag">${esc(v.label)} · ${locals.filter(p => p.store === k).length}</span>`).join('');
    // same product, local versus imported (or local store versus local store)
    const groups = {};
    LIST.forEach(p => { if (p.group) (groups[p.group] = groups[p.group] || []).push(p); });
    const cards = [];
    Object.values(groups).forEach(g => {
      const loc = g.filter(isLocal).map(p => ({ p, t: calc(p).total })).sort((a, b) => a.t - b.t);
      const imp = g.filter(p => !isLocal(p) && p.cat !== 'service').map(p => ({ p, t: calc(p).total })).sort((a, b) => a.t - b.t);
      if (!loc.length) return;
      const name = loc[0].p.name, bestL = loc[0];
      if (imp.length) {
        const bestI = imp[0], diff = (bestI.t - bestL.t) / Math.max(bestI.t, bestL.t) * 100;
        const win = bestL.t <= bestI.t;
        cards.push(`<article class="vs ${win ? 'local-wins' : 'import-wins'}"><span class="lbl">Local or imported?</span><h3>${esc(name)}</h3>
          <div class="vs-row"><span>Kenya · ${esc(storeName(bestL.p))}</span><b>${money(bestL.t)}</b></div>
          <div class="vs-row"><span>Imported · ${esc(storeName(bestI.p))}, landed</span><b>${money(bestI.t)}</b></div>
          <p class="vs-note">${win ? 'Buying in Kenya is about ' + Math.round(Math.abs(diff)) + '% cheaper, and you have it today.' : 'Importing comes out about ' + Math.round(Math.abs(diff)) + '% cheaper, but expect to wait ' + esc(calc(bestI.p).days) + ' days plus clearance.'}</p></article>`);
      } else if (loc.length > 1) {
        const worst = loc[loc.length - 1];
        cards.push(`<article class="vs local-wins"><span class="lbl">Cheapest in Kenya</span><h3>${esc(name)}</h3>
          <div class="vs-row"><span>${esc(storeName(bestL.p))}</span><b>${money(bestL.t)}</b></div>
          <div class="vs-row"><span>${esc(storeName(worst.p))}</span><b>${money(worst.t)}</b></div>
          <p class="vs-note">Spread of ${money(worst.t - bestL.t)} between the cheapest and dearest store.</p></article>`);
      }
    });
    $('#vs-grid').innerHTML = cards.join('');
    $('#local-grid').innerHTML = locals.slice().sort((a, b) => a.ago - b.ago).slice(0, 6).map(cardHTML).join('');
  }

  /* ---------- compare ---------- */
  function renderCompare() {
    let picks = state.picks.map(id => LIST.find(p => p.id === id)).filter(Boolean);
    let example = false;
    if (picks.length < 2) {
      const grp = LIST.filter(p => p.group && p.group === CFG.site.hero_group).slice(0, 3);
      if (grp.length < 2) {
        $('#cmp-body').innerHTML = `<div class="cmp-empty">Choose at least two listings with the Compare buttons above. ${picks.length ? esc(picks[0].name) + ' is selected.' : ''}</div>`;
        return;
      }
      picks = grp; example = true;
    }
    const D = CFG.destination, rs = picks.map(p => ({ p, r: calc(p) }));
    const best = Math.min(...rs.map(x => x.r.total)), max = Math.max(...rs.map(x => x.r.total));
    const col = (x, inner, cls) => `<td class="${cls || ''} ${x.r.total === best ? 'win' : ''}">${inner}</td>`;
    const row = (label, fn, cls, tr) => `<tr class="${tr || ''}"><th scope="row">${label}</th>${rs.map(x => col(x, fn(x), cls === undefined ? 'num' : cls)).join('')}</tr>`;
    const levyNames = Array.from(new Set(rs.flatMap(x => x.r.levies.map(l => l.name))));
    $('#cmp-body').innerHTML = (example ? `<p class="note" style="margin:0 0 20px">Example comparison. Use the Compare buttons on any listing to build your own.</p>` : '') + `
      <div class="cmp-bars">${rs.map(x => `<div class="cmp-bar"><div class="name">${esc(x.p.name)}<small>${esc(routeTxt(x.p))} · ${x.r.service ? 'digital' : x.r.isLocal ? 'local price' : MODE[x.r.mode]}</small></div>
        <div class="track">${barScaled(x.r, max)}<span class="val">${money(x.r.total)}${x.r.total === best ? ' · lowest' : ' · +' + ((x.r.total / best - 1) * 100).toFixed(0) + '%'}</span></div></div>`).join('')}
        <div class="legend"><span style="--c:var(--seg-item)">Item</span><span style="--c:var(--seg-ship)">Shipping &amp; handling</span><span style="--c:var(--seg-duty)">Duty &amp; levies</span><span style="--c:var(--seg-vat)">VAT</span></div></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th></th>${rs.map(x => `<th class="col ${x.r.total === best ? 'win' : ''}">${esc(x.p.name)}<br><span class="route">${esc(CFG.origins[x.p.origin].name)} · ${esc(x.p.seller)}</span><br>${badge(x.p)}${x.r.total === best ? '<br><span class="pill">Lowest landed cost</span>' : ''}</th>`).join('')}</tr></thead>
        <tbody>
          ${row('Listed price', x => esc(listed(x.p)) + (x.p.unit ? '<br><small style="color:var(--dim)">' + esc(x.p.unit) + '</small>' : ''))}
          ${row('Item value', x => money(x.r.item))}
          ${row('Shipping & handling', x => flat(x.r) ? 'None' : money(x.r.ship))}
          ${row('Import duty', x => flat(x.r) ? '–' : money(x.r.duty) + ' <small style="color:var(--dim)">' + (x.r.dutyRate * 100).toFixed(0) + '%</small>')}
          ${levyNames.map(n => row(esc(n), x => { const l = x.r.levies.find(z => z.name === n); return l ? money(l.amt) : '–'; })).join('')}
          ${row('VAT ' + (D.vat * 100).toFixed(D.vat * 100 % 1 ? 1 : 0) + '%', x => x.r.isLocal ? 'In price' : money(x.r.vat))}
          ${row('Total cost in Kenya', x => money(x.r.total), 'num', 'total')}
          ${row('Delivery', x => x.r.service ? 'Instant' : x.r.isLocal ? 'Same day to ' + x.r.days + ' days<br><small style="color:var(--dim)">store delivery or pickup</small>' : x.r.days + ' days transit<br><small style="color:var(--dim)">+ ' + esc(x.r.clear) + ' days clearance</small>', '')}
          ${row('Source', x => x.p.url ? `<a class="src" href="${esc(x.p.url)}" target="_blank" rel="noopener nofollow">Open listing</a>` : '<small style="color:var(--dim)">None yet</small>', '')}
        </tbody></table></div>`;
  }
  function renderTray() {
    const picks = state.picks.map(id => LIST.find(p => p.id === id)).filter(Boolean);
    $('#tray').hidden = picks.length === 0;
    $('#tray-n').textContent = picks.length + ' of 3 selected';
    $('#tray-items').innerHTML = picks.map(p => `<span class="tray-chip"><span>${esc(p.name)} · ${esc(p.origin)}</span><button type="button" data-unpick="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join('');
  }
  function togglePick(id) {
    const i = state.picks.indexOf(id);
    if (i >= 0) state.picks.splice(i, 1);
    else if (state.picks.length >= 3) { toast('Compare holds three listings. Remove one first.'); return; }
    else state.picks.push(id);
    renderGrid(); renderCompare(); renderTray(); if (state.drawer) renderDrawer();
  }

  /* ---------- drawer ---------- */
  function renderDrawer() {
    const p = LIST.find(x => x.id === state.drawer); if (!p) return;
    const sel = state.picks.includes(p.id), service = p.cat === 'service', local = isLocal(p), noShip = service || local;
    const modes = noShip ? [] : ['exp', 'eco', 'sea'];
    const base = calc(p, 'smart');
    const active = noShip ? null : (state.drawerMode || base.mode);
    const r = calc(p, active || 'smart');
    const results = modes.map(m => ({ m, r: calc(p, m) }));
    const min = results.length ? Math.min(...results.map(x => x.r.total)) : 0;
    const lines = [[local ? 'Shelf price' : 'Item price', local ? 'Includes VAT. Delivery fees vary by store.' : 'Listed at ' + listed(p), r.item]].concat(noShip ? [] : [
      ['Freight', `${nf(r.bw.billed, 1)} kg billed (${nf(r.bw.actual, 1)} kg actual, ${nf(r.bw.volumetric, 1)} kg volumetric) at $${r.rate.toFixed(2)}/kg`, r.freight],
      ['Fuel surcharge', (r.fuel / r.freight * 100).toFixed(0) + '% of freight', r.fuel],
      ['Handling and documents', 'Flat fee', r.handling],
      ['Local delivery', 'Port or airport to your door', r.local]
    ], r.insurance ? [['Insurance', '1%', r.insurance]] : [], noShip ? [] : [
      ['Import duty', (r.dutyRate * 100).toFixed(0) + '% of customs value ' + money(r.cif), r.duty]
    ], r.levies.map(l => [l.name, (l.rate * 100).toFixed(1).replace('.0', '') + '% of customs value', l.amt]),
    local ? [] : [['VAT', (r.vatRate * 100).toFixed(r.vatRate * 100 % 1 ? 1 : 0) + '% on ' + (r.service ? 'the service' : 'value plus duty and levies'), r.vat]]);
    const wa = waLink(`Hello Brandmark, I would like a real import quote for Kenya.\nItem: ${p.name} (${p.origin})\nListed: ${listed(p)}\nAtlas estimate: ${money(r.total)}${service ? '' : ' by ' + MODE[r.mode]}`);
    $('#drawer').innerHTML = `
      <button type="button" class="close" id="d-close" aria-label="Close breakdown"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div><span class="tag">${esc(CFG.categories[p.cat].label)}</span> <span class="route" style="margin-left:6px">${esc(routeTxt(p))}</span></div>
      <div><h3>${esc(p.name)}</h3><p class="seller" style="margin-top:8px">${esc(p.seller)} · ${esc(CFG.origins[p.origin].city)}</p>
        <p style="margin-top:10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">${badge(p)}${p.url ? `<a class="src" href="${esc(p.url)}" target="_blank" rel="noopener nofollow">Open source listing</a>` : ''}</p></div>
      <div><span class="lbl">${r.service ? 'With VAT' : r.isLocal ? 'Shelf price in Kenya' : 'Landed in ' + esc(CFG.destination.name)}</span>
        <div class="res-total" style="margin-top:10px"><strong style="font-size:2.3rem">${money(r.total)}</strong>${r.isLocal ? '' : `<span class="mult">×${(r.total / r.item).toFixed(2)}</span>`}</div>
        <div class="bar" style="height:12px">${segs(r)}</div></div>
      ${modes.length ? `<div><span class="lbl">Compare shipping modes</span><div class="modes" style="margin-top:12px">${results.map(x => `
        <button type="button" class="mode" data-dmode="${x.m}" aria-pressed="${x.m === active}"><b>${MODE[x.m]}</b><span class="mono">${money(x.r.total)}</span><small>${x.r.days} days + ${esc(x.r.clear)} clearance</small><span class="delta">${x.r.total === min ? 'cheapest' : '+' + money(x.r.total - min)}</span></button>`).join('')}</div></div>` : ''}
      <div class="lines">${lines.map(l => `<div class="line"><b>${esc(l[0])}</b><span class="amt">${money(l[2])}</span><small>${esc(l[1])}</small></div>`).join('')}</div>
      <div class="cta-row" style="margin-top:0">
        <button type="button" class="btn ${sel ? 'btn-toggle' : 'btn-primary'}" data-pick="${esc(p.id)}" aria-pressed="${sel}">${sel ? 'Remove from compare' : 'Add to compare'}</button>
        ${noShip ? '' : `<button type="button" class="btn btn-ghost" data-est="${esc(p.id)}">Open in estimator</button>`}
        ${local ? '' : `<a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">Ask for a real quote</a>`}
      </div>
      <p class="note">Indicative estimate in ${curCode()}. Final charges are set by customs and your carrier.</p>`;
  }
  function openDrawer(id) {
    state.drawer = id; state.drawerMode = null; renderDrawer();
    $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
    setTimeout(() => { const c = $('#d-close'); if (c) c.focus(); }, 60);
  }
  function closeDrawer() {
    state.drawer = null; $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  }

  /* ---------- estimator ---------- */
  let shownTotal = 0;
  function tween(el, to, fmt) {
    const from = shownTotal; shownTotal = to;
    if (reduce) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 380; cancelAnimationFrame(tween.raf);
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) tween.raf = requestAnimationFrame(step); };
    tween.raf = requestAnimationFrame(step);
  }
  function readEst() {
    const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : d; };
    const cur = $('#e-cur').value, raw = parseFloat($('#e-val').value);
    return { valRaw: raw, cur, priceUSD: toUSD(isFinite(raw) ? raw : 0, cur), cat: $('#e-cat').value, origin: $('#e-origin').value,
      weight: num('#e-w', 0.1), dim: [num('#e-l', 1), num('#e-wd', 1), num('#e-h', 1)], mode: $('#e-mode').value, insured: $('#e-ins').checked };
  }
  function renderEst() {
    const o = readEst(), O = CFG.origins[o.origin];
    if (!(o.valRaw > 0)) {
      $('#r-total').textContent = '–'; $('#r-sub').textContent = 'Enter an item value to see the landed cost.';
      $('#r-lines').innerHTML = ''; $('#r-bar').innerHTML = ''; $('#r-mult').textContent = ''; $('#r-route').textContent = ''; return;
    }
    const r = E.landed(o), F = CFG.freight;
    $('#r-route').textContent = `${O.city} → ${CFG.destination.name} · ${MODE[r.mode]}`;
    tween($('#r-total'), r.total, v => { const x = state.usd ? v : v * FX.rates[KES()]; return (state.usd ? '$' : KES() + ' ') + nf(x, x >= 100 ? 0 : 2); });
    $('#r-mult').textContent = '×' + (r.total / r.item).toFixed(2) + ' the item price';
    $('#r-sub').textContent = `Arrives in about ${r.days} days, plus ${r.clear} days for customs clearance.`;
    $('#r-bar').innerHTML = segs(r);
    const L = (name, note, amt) => `<div class="line"><b>${esc(name)}</b><span class="amt">${money(amt)}</span><small>${esc(note)}</small></div>`;
    $('#r-lines').innerHTML = [
      L('Item', 'What the seller charges', r.item),
      L('Freight', `Billed on ${nf(r.bw.billed, 1)} kg: the larger of ${nf(r.bw.actual, 1)} kg actual and ${nf(r.bw.volumetric, 1)} kg volumetric`, r.freight),
      L('Fuel, handling and local delivery', `Fuel ${(F.fuel[r.mode] * 100).toFixed(0)}% of freight, plus flat handling and delivery`, r.fuel + r.handling + r.local),
      r.insurance ? L('Insurance', '1% of item plus freight', r.insurance) : '',
      L('Import duty', `${(r.dutyRate * 100).toFixed(0)}% of customs value ${money(r.cif)}`, r.duty)
    ].concat(r.levies.map(l => L(l.name, (l.rate * 100).toFixed(1).replace('.0', '') + '% of customs value', l.amt)),
      [L('VAT', `${(r.vatRate * 100).toFixed(r.vatRate * 100 % 1 ? 1 : 0)}% on value plus duty and levies`, r.vat)]).join('');
    const tip = r.mode !== 'sea' && r.bw.billed >= F.smart_sea_from_kg ? ' Heavy cargo is usually far cheaper by sea.' : '';
    $('#r-note').textContent = 'Indicative estimate. Final charges are set by customs and your carrier.' + tip;
    $('#r-wa').href = waLink(`Hello Brandmark, I would like a real import quote for Kenya.\nFrom: ${O.city}\nItem value: ${o.valRaw} ${o.cur}\nWeight: ${o.weight} kg, ${o.dim.join(' x ')} cm\nAtlas estimate: ${money(r.total)} by ${MODE[r.mode]}`);
  }
  function fillEstFrom(id) {
    const p = LIST.find(x => x.id === id); if (!p || p.cat === 'service') return;
    $('#e-origin').value = p.origin; $('#e-cat').value = p.cat; $('#e-val').value = p.price; $('#e-cur').value = p.cur;
    $('#e-w').value = p.w; $('#e-l').value = p.dim[0]; $('#e-wd').value = p.dim[1]; $('#e-h').value = p.dim[2];
  }


  /* ---------- live search (optional: needs the Cloudflare search function, see README) ---------- */
  function initLive() {
    const url = (CFG.site && CFG.site.live_search_url || '').trim();
    if (!url) return;
    $('#live').hidden = false;
    const kes = n => 'KES ' + Math.round(n).toLocaleString('en-KE');
    $('#live-form').addEventListener('submit', async e => {
      e.preventDefault();
      const q = $('#live-q').value.trim(), st = $('#live-status'), grid = $('#live-grid'), btn = e.target.querySelector('button');
      if (q.length < 2) return;
      btn.disabled = true; st.textContent = 'Searching the stores…'; grid.innerHTML = '';
      try {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.message || ('The search service answered ' + res.status));
        const chips = Object.values(j.stores).map(s => `${esc(s.label)}: ${s.status === 'ok' ? s.count + ' found' : esc(s.message || s.status)}`).join(' · ');
        st.innerHTML = (j.results.length ? `${j.results.length} live results. ` : 'Nothing could be confirmed. ') + chips;
        grid.innerHTML = j.results.map(r => `<article class="card"><div class="card-top"><span class="tag">${esc(r.store)}</span><span class="route">Live · unverified</span></div>
          <h3>${esc(r.title)}</h3><div class="landed"><span class="lbl">Shelf price in Kenya</span><div class="landed-line"><strong>${kes(r.price_kes)}</strong></div></div>
          <div class="card-actions"><a class="btn btn-ghost btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener nofollow">Open on ${esc(r.store)}</a></div></article>`).join('');
      } catch (err) { st.textContent = 'Live search is not available right now: ' + err.message; }
      btn.disabled = false;
    });
  }

  /* ---------- route map ---------- */
  function initMap() {
    const cv = $('#map'), ctx = cv.getContext('2d');
    const nodes = Object.values(CFG.origins).filter(o => !o.local).map(o => ({ k: o.code, lon: o.lon, lat: o.lat }));
    const dest = { k: 'NAIROBI', lon: 36.8, lat: -1.3 };
    let W = 0, H = 0, dpr = 1;
    const lon0 = -100, lon1 = 130, lat0 = 62, lat1 = -16;
    const P = n => [W * (.04 + .92 * (n.lon - lon0) / (lon1 - lon0)), H * (.1 + .78 * (n.lat - lat0) / (lat1 - lat0))];
    function resize() { const r = cv.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function draw(time) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(80,222,234,.13)';
      for (let x = 14; x < W; x += 30) for (let y = 14; y < H; y += 30) ctx.fillRect(x, y, 1.6, 1.6);
      ctx.strokeStyle = 'rgba(80,222,234,.07)'; ctx.lineWidth = 1;
      for (let lon = -100; lon <= 130; lon += 30) { const x = P({ lon: lon, lat: 0 })[0]; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let lat = 60; lat >= -15; lat -= 15) { const y = P({ lon: 0, lat: lat })[1]; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const d = P(dest);
      nodes.forEach((n, i) => {
        const a = P(n), mx = (a[0] + d[0]) / 2, my = (a[1] + d[1]) / 2 - Math.hypot(d[0] - a[0], d[1] - a[1]) * .32;
        ctx.strokeStyle = 'rgba(0,200,212,.3)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(mx, my, d[0], d[1]); ctx.stroke();
        const at = t => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * mx + t * t * d[0], u * u * a[1] + 2 * u * t * my + t * t * d[1]]; };
        const base = ((time / 4200) + i * .17) % 1;
        for (let k = 0; k < 14; k++) {
          const t = base - k * .012; if (t < 0) continue; const q = at(t);
          ctx.fillStyle = `rgba(90,242,252,${(1 - k / 14) * .95})`; ctx.beginPath(); ctx.arc(q[0], q[1], 2.6 - k * .12, 0, 6.3); ctx.fill();
        }
        ctx.fillStyle = '#5af2fc'; ctx.beginPath(); ctx.arc(a[0], a[1], 3.4, 0, 6.3); ctx.fill();
        ctx.font = '500 10px IBM Plex Mono, monospace'; ctx.fillStyle = 'rgba(155,188,193,.9)'; ctx.fillText(n.k, a[0] + 8, a[1] - 7);
      });
      const pr = ((time / 1800) % 1);
      ctx.strokeStyle = `rgba(90,242,252,${.7 * (1 - pr)})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(d[0], d[1], 6 + pr * 26, 0, 6.3); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(d[0], d[1], 5, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#00c8d4'; ctx.beginPath(); ctx.arc(d[0], d[1], 2.6, 0, 6.3); ctx.fill();
      ctx.font = '600 11px IBM Plex Mono, monospace'; ctx.fillStyle = '#fff'; ctx.fillText(dest.k, d[0] + 12, d[1] + 4);
    }
    resize(); window.addEventListener('resize', () => { resize(); if (reduce) draw(5200); });
    if (reduce) { draw(5200); return; }
    const loop = t => { if (!document.hidden) draw(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }

  /* ---------- wiring ---------- */
  function renderAll() {
    renderHero(); renderGrid(); renderLocal(); renderCompare(); renderTray(); renderEst();
    if (state.drawer) renderDrawer();
  }
  function setCurrency(usd) {
    state.usd = usd;
    try { localStorage.setItem('atlas.usd', usd ? '1' : '0'); } catch (e) { /* ignore */ }
    $('#cur-usd').setAttribute('aria-pressed', String(usd)); $('#cur-local').setAttribute('aria-pressed', String(!usd));
    renderAll();
  }
  function bind() {
    $('#cur-local').addEventListener('click', () => setCurrency(false));
    $('#cur-usd').addEventListener('click', () => setCurrency(true));
    $('#modeSel').addEventListener('change', e => { state.mode = e.target.value; state.drawerMode = null; renderAll(); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
    $('#originSel').addEventListener('change', e => { state.origin = e.target.value; renderGrid(); });
    $('#storeSel').addEventListener('change', e => { state.store = e.target.value; renderGrid(); });
    $('#local-all').addEventListener('click', () => { state.store = 'kind:local'; $('#storeSel').value = 'kind:local'; state.cat = 'all'; $$('#chips button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cat === 'all'))); renderGrid(); $('#discover').scrollIntoView({ behavior: 'smooth' }); });
    $('#q').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });
    $('#chips').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]'); if (!b) return; state.cat = b.dataset.cat;
      $$('#chips button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderGrid();
    });
    $('#tray-clear').addEventListener('click', () => { state.picks = []; renderGrid(); renderCompare(); renderTray(); if (state.drawer) renderDrawer(); });
    $('#scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.drawer) closeDrawer(); });
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-pick],[data-unpick],[data-open],[data-dmode],[data-est],#d-close'); if (!t) return;
      if (t.dataset.pick) togglePick(t.dataset.pick);
      else if (t.dataset.unpick) togglePick(t.dataset.unpick);
      else if (t.dataset.open) openDrawer(t.dataset.open);
      else if (t.dataset.dmode) { state.drawerMode = t.dataset.dmode; renderDrawer(); }
      else if (t.dataset.est) {
        const id = t.dataset.est; closeDrawer(); $('#e-from').value = id; fillEstFrom(id); $('#e-mode').value = state.mode; renderEst();
        $('#estimator').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      } else closeDrawer();
    });
    document.addEventListener('pointerdown', e => {
      const b = e.target.closest('.btn'); if (!b || reduce) return;
      const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), sp = document.createElement('span');
      sp.className = 'ripple'; sp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
      b.appendChild(sp); sp.addEventListener('animationend', () => sp.remove());
    });
    $('#e-from').addEventListener('change', e => { if (e.target.value) fillEstFrom(e.target.value); renderEst(); });
    $('#e-origin').addEventListener('change', e => { $('#e-cur').value = CFG.origins[e.target.value].cur; $('#e-from').value = ''; renderEst(); });
    ['#e-cat', '#e-val', '#e-cur', '#e-w', '#e-l', '#e-wd', '#e-h', '#e-mode', '#e-ins'].forEach(id => {
      $(id).addEventListener('input', () => { if (id !== '#e-mode' && id !== '#e-ins') $('#e-from').value = ''; renderEst(); });
    });
  }

  (async function boot() {
    try { await load(); } catch (e) { showLoadError(e); return; }
    E = AtlasEngine.makeEngine(CFG, FX);
    setup(); bind(); renderAll(); renderTicker(); initMap(); initLive();
    if (window.AtlasForms) AtlasForms.mountTabs($('#contrib-forms'), 'contribute', CFG);
  })();
})();
