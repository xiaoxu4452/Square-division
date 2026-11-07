/* ==========================================================================
 * bigdec.js — Lightweight high-precision decimal library (BigInt fixed-point, 80 decimals)
 *
 * Purpose: keeps the "camera coordinates" of the infinite canvas exact.
 *   · Every value is a BigInt scaled by 10^PREC (scaled integer), so addition
 *     and subtraction are exact with no error;
 *   · At render time the camera splits into a double main value cxHi plus a
 *     high-precision residual cxLo:
 *         screenX = (worldX - cxHi) * scale + W/2 - toNumber(cxLo * scale)
 *     Tile drawing still takes the fast double path and needs only a few BigInt
 *     operations per frame, yet pixel coordinates do not drift even beyond
 *     10^9x zoom.
 *   · No external dependencies; runs under file:// and offline.
 *
 * API: from(x) add(a,b) sub(a,b) mul(a,b) div(a,b) neg(a) abs(a)
 *      cmp(a,b) toNumber(a) toString(a) half(a)
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BigDec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PREC = 80;
  var TEN = BigInt(10);
  var SCALE = TEN ** BigInt(PREC);
  var SCALE_NUM = Number(SCALE); // 1e80, safely representable as a double
  var ZERO = BigInt(0);

  function pow10(e) { return TEN ** BigInt(e); }

  /** number / string / BigInt(scaled) → scaled BigInt */
  function from(x) {
    if (typeof x === 'bigint') return x;
    if (typeof x === 'number' && !isFinite(x)) throw new Error('BigDec: non-finite number');
    var s = String(x).trim();
    var m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) throw new Error('BigDec: cannot parse "' + s + '"');
    var sign = m[1] === '-' ? BigInt(-1) : BigInt(1);
    var digits = (m[2] + (m[3] || '')).replace(/^0+(?=\d)/, '');
    var d = BigInt(digits || '0') * sign;
    var exp = m[4] ? parseInt(m[4], 10) : 0;
    var e = exp - (m[3] || '').length + PREC;
    if (e >= 0) return d * pow10(e);
    return d / pow10(-e); // digits beyond 80 decimals are truncated (never reached in this app)
  }

  function add(a, b) { return a + b; }
  function sub(a, b) { return a - b; }
  function mul(a, b) { return (a * b) / SCALE; }
  function div(a, b) {
    if (b === ZERO) throw new Error('BigDec: division by zero');
    return (a * SCALE) / b;
  }
  function neg(a) { return -a; }
  function abs(a) { return a < ZERO ? -a : a; }
  function half(a) { return a / BigInt(2); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function toNumber(a) { return Number(a) / SCALE_NUM; }

  function toString(a) {
    var negv = a < ZERO;
    var v = negv ? -a : a;
    var intPart = v / SCALE;
    var frac = (v % SCALE).toString().padStart(PREC, '0').replace(/0+$/, '');
    return (negv ? '-' : '') + intPart.toString() + (frac ? '.' + frac : '');
  }

  return {
    PREC: PREC, SCALE: SCALE, ZERO: ZERO,
    from: from, add: add, sub: sub, mul: mul, div: div,
    neg: neg, abs: abs, half: half, cmp: cmp,
    toNumber: toNumber, toString: toString
  };
});
