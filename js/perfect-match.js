/* ==========================================================================
 * perfect-match.js — Match an arbitrary drawn aspect ratio to an exact
 * perfect squared rectangle from the Bouwkampcode catalogue.
 *
 * Fraction.js supplies an exact rational representation of the input ratio
 * and its continued-fraction expansion; Decimal.js evaluates the residual
 * error at 40 significant digits so a near-miss is never rounded to zero.
 * The tiling itself stays integral: only its aspect ratio is used for the
 * match, and the frame is adopted from the catalogue record.
 * ========================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PerfectMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function catalog() {
    if (root.PerfectCatalog) return root.PerfectCatalog;
    if (typeof require === 'function') return require('./perfect-catalog.js');
    return null;
  }
  function fractionClass() {
    if (root.Fraction) return root.Fraction;
    if (typeof require === 'function') return require('./vendor/fraction.min.js');
    return null;
  }
  function decimalClass() {
    if (root.Decimal) return root.Decimal;
    if (typeof require === 'function') return require('./vendor/decimal.min.js');
    return null;
  }

  /** Best rational approximation with denominator <= maxDen (continued fractions). */
  function rationalise(value, maxDen) {
    maxDen = maxDen || 20000;
    var x = Math.abs(Number(value));
    if (!isFinite(x) || x <= 0) return null;
    var F = fractionClass();
    var cf;
    if (F && F.prototype && F.prototype.toContinued) {
      cf = new F(x).toContinued();
    } else {
      cf = [];
      var y = x;
      for (var i = 0; i < 24; i++) {
        var a = Math.floor(y);
        cf.push(a);
        y -= a;
        if (y < 1e-15) break;
        y = 1 / y;
      }
    }
    var p0 = 0, q0 = 1, p1 = 1, q1 = 0;
    for (var k = 0; k < cf.length; k++) {
      var p2 = cf[k] * p1 + p0, q2 = cf[k] * q1 + q0;
      if (q2 > maxDen) break;
      p0 = p1; q0 = q1; p1 = p2; q1 = q2;
    }
    if (!q1) return null;
    if (F) {
      var f = new F(p1, q1);
      p1 = f.n; q1 = f.d;
    }
    return { n: p1, d: q1, value: p1 / q1, text: p1 + ':' + q1 };
  }

  /** Relative aspect-ratio error in percent, computed with 40-digit decimals. */
  function errorPercent(frac, record) {
    var D = decimalClass();
    if (!D) {
      return Math.abs(frac.value - record.w / record.h) / frac.value * 100;
    }
    if (D.set) D.set({ precision: 40 });
    var target = new D(frac.n).div(frac.d);
    var actual = new D(record.w).div(record.h);
    return actual.sub(target).abs().div(target).times(100).toNumber();
  }

  /**
   * @returns null when the catalogue is unavailable, otherwise
   * { record, cells, ratioText, errorPercent, ratio }
   */
  function match(ratio, opts) {
    opts = opts || {};
    var C = catalog();
    if (!C || !C.nearest || !C.pack) return null;
    var r = Math.abs(Number(ratio));
    if (!isFinite(r) || r <= 0) return null;
    var flipped = r < 1;
    if (flipped) r = 1 / r;
    var frac = rationalise(r, opts.maxDen || 20000);
    if (!frac) return null;
    var found = C.nearest(frac.value);
    if (!found || !found.tiling) return null;
    var rec = found.tiling;
    var cells = C.pack(rec);
    if (!cells) return null;
    var w = rec.w, h = rec.h;
    if (flipped) {
      // Transpose the whole dissection: it still tiles h x w exactly.
      w = rec.h; h = rec.w;
      cells = cells.map(function (c) { return [c[1], c[0], c[2]]; });
    }
    var keys = cells.length;   // pack() returns [x,y,s] triples
    return {
      record: { w: w, h: h, sides: rec.sides.slice(), order: keys, key: 'cat' + w + 'x' + h },
      cells: cells,
      ratio: { n: frac.n, d: frac.d, text: frac.text },
      errorPercent: errorPercent({ n: frac.n, d: frac.d, value: frac.value }, rec),
      ratioValue: r
    };
  }

  return { rationalise: rationalise, match: match, errorPercent: errorPercent };
});
