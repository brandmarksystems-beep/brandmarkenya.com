/* Brandmark Atlas pricing engine. Pure functions, no DOM.
   Works in the browser (window.AtlasEngine) and in Node (require). */
(function (root) {
  'use strict';

  var MODE_LABEL = { exp: 'Air Express', eco: 'Air Economy', sea: 'Sea freight' };

  function makeEngine(cfg, fx) {
    var D = cfg.destination, F = cfg.freight;

    function toUSD(amount, cur) { return amount / fx.rates[cur]; }
    function fromUSD(usd, cur) { return usd * fx.rates[cur]; }

    function pickMode(mode, weightKg) {
      if (mode !== 'smart') return mode;
      return weightKg >= F.smart_sea_from_kg ? 'sea' : 'eco';
    }

    /* Billed weight is the larger of actual and volumetric weight. */
    function billedWeight(w, dim, mode) {
      var vol = dim[0] * dim[1] * dim[2];
      var divisor = mode === 'sea' ? F.volumetric_divisor.sea : F.volumetric_divisor.air;
      var volumetric = vol / divisor;
      return { actual: w, volumetric: volumetric, billed: Math.max(w, volumetric) };
    }

    /* o = { priceUSD, cat, origin, weight, dim:[l,w,h], mode, insured } -> every amount in USD */
    function landed(o) {
      var cat = cfg.categories[o.cat] || { duty: 0 };
      if (o.cat === 'service') {
        var svcVat = o.priceUSD * D.vat;
        return {
          service: true, mode: null, item: o.priceUSD, freight: 0, fuel: 0, handling: 0, local: 0, insurance: 0,
          cif: o.priceUSD, dutyRate: 0, duty: 0, levies: [], levySum: 0, vatRate: D.vat, vat: svcVat,
          ship: 0, taxes: 0, total: o.priceUSD + svcVat, bw: null, rate: 0, days: 'Instant', clear: null
        };
      }
      var O = cfg.origins[o.origin];
      if (O && O.local) {
        /* Bought inside Kenya: the shelf price already has VAT and duty in it, so nothing is added. */
        return {
          service: false, isLocal: true, mode: null, item: o.priceUSD, freight: 0, fuel: 0, handling: 0, local: 0, insurance: 0,
          cif: o.priceUSD, dutyRate: 0, duty: 0, levies: [], levySum: 0, vatRate: 0, vat: 0,
          ship: 0, taxes: 0, total: o.priceUSD, bw: null, rate: 0, days: O.days.eco, clear: null
        };
      }
      var mode = pickMode(o.mode, o.weight);
      var bw = billedWeight(o.weight, o.dim, mode);
      var rate = (mode === 'sea' ? O.rates.sea : O.rates[mode]);
      var freight = Math.max(bw.billed * rate, F.min[mode]);
      var fuel = freight * F.fuel[mode];
      var insurance = o.insured ? (o.priceUSD + freight + fuel) * F.insurance_rate : 0;
      var cif = o.priceUSD + freight + fuel + insurance;
      var dutyRate = cat.duty || 0;
      var duty = cif * dutyRate;
      var levies = D.levies.map(function (l) {
        var amt = cif * l.rate;
        if (l.apply_min && l.min_kes) amt = Math.max(amt, l.min_kes / fx.rates.KES);
        return { name: l.name, rate: l.rate, amt: amt };
      });
      var levySum = levies.reduce(function (s, l) { return s + l.amt; }, 0);
      var vat = (cif + duty + levySum) * D.vat;
      var handling = F.handling[mode];
      var local = D.local_delivery_usd;
      var ship = freight + fuel + handling + local + insurance;
      var taxes = duty + levySum;
      var total = o.priceUSD + ship + taxes + vat;
      return {
        service: false, mode: mode, item: o.priceUSD, freight: freight, fuel: fuel, handling: handling, local: local,
        insurance: insurance, cif: cif, dutyRate: dutyRate, duty: duty, levies: levies, levySum: levySum,
        vatRate: D.vat, vat: vat, ship: ship, taxes: taxes, total: total, bw: bw, rate: rate,
        days: O.days[mode], clear: D.clear_days
      };
    }

    function landedForListing(p, mode, insured) {
      return landed({
        priceUSD: toUSD(p.price, p.cur), cat: p.cat, origin: p.origin,
        weight: p.w || 0, dim: p.dim || [0, 0, 0], mode: mode, insured: !!insured
      });
    }

    return { toUSD: toUSD, fromUSD: fromUSD, pickMode: pickMode, billedWeight: billedWeight, landed: landed, landedForListing: landedForListing, MODE_LABEL: MODE_LABEL };
  }

  var api = { makeEngine: makeEngine, MODE_LABEL: MODE_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AtlasEngine = api;
})(typeof self !== 'undefined' ? self : this);
