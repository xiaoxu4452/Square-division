/* ==========================================================================
 * perfect-solver.js — user-defined perfect squared rectangles, end to end.
 *
 *  1. Rationalise the user's width / height with Fraction.js (exact).
 *  2. Scale to an integer frame W x H that the C++/WASM searcher can handle.
 *  3. Search for perfect dissections (pairwise-distinct integer sides) in a
 *     Worker pool; each worker uses a different seed.
 *  4. Verify every result with the WASM exact-integer checker (gaps,
 *     overlaps, duplicate sides, area conservation in i64).
 *  5. Produce an unbounded family from each primitive solution by integer
 *     scaling (x k) and self-substitution; BigInt keeps coordinates exact
 *     far beyond Number.MAX_SAFE_INTEGER, Decimal.js maps them to floats
 *     only at the final drawing step.
 *
 * Reference algorithms: Brooks–Smith–Stone–Tutte (electrical networks),
 * Bouwkamp's code, Duijvestijn's enumeration, Anderson's substitution.
 * ========================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PerfectSolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function F() {
    if (root.Fraction) return root.Fraction;
    if (typeof require === 'function') {
      return require('./vendor/fraction.min.js');
    }
    return null;
  }
  function D() {
    if (root.Decimal) return root.Decimal;
    if (typeof require === 'function') return require('./vendor/decimal.min.js');
    return null;
  }
  function engine() { return root.WasmEngine || null; }

  /* ---------------------------------------------------------- input frame */
  /**
   * Turn a user's w:h (either integers or arbitrary numbers) into an integer
   * frame with edge <= maxEdge. Uses Fraction.js continued fractions so a
   * decimal such as 1.618 is rationalised to 144/89 rather than 1618/1000.
   * @returns {w,h,n,d,text,scaled}
   */
  function toFrame(w, h, maxEdge) {
    maxEdge = maxEdge || 384;
    var frac = null, FC = F();
    if (FC && typeof w === 'number' && typeof h === 'number') {
      try {
        var f = new FC(w).div(new FC(h));
        if (f.d <= 100000) frac = { n: Math.round(f.n), d: Math.round(f.d) };
        else {
          // continued-fraction truncation with bounded denominator
          var cf = f.toContinued ? f.toContinued() : null;
          if (cf && cf.length) {
            var p0 = 0, q0 = 1, p1 = 1, q1 = 0;
            for (var k = 0; k < cf.length; k++) {
              var p2 = cf[k] * p1 + p0, q2 = cf[k] * q1 + q0;
              if (q2 > 100000) break;
              p0 = p1; q0 = q1; p1 = p2; q1 = q2;
            }
            frac = { n: p1, d: q1 };
          }
        }
      } catch (e) { /* fall through to plain integers */ }
    }
    var n = frac ? frac.n : Math.round(Math.abs(w));
    var d = frac ? frac.d : Math.round(Math.abs(h));
    if (!(n > 0) || !(d > 0)) return null;
    var g = gcd(n, d); n /= g; d /= g;
    // If the reduced denominator still exceeds the searcher's edge budget,
    // fall back to a bounded continued-fraction convergent (the same path
    // used by PerfectMatch) so the search stays feasible.
    if (Math.max(n, d) > maxEdge && FC) {
      try {
        var cf = new FC(n).div(new FC(d)).toContinued();
        var p0 = 0, q0 = 1, p1 = 1, q1 = 0;
        for (var c = 0; c < cf.length; c++) {
          var p2 = cf[c] * p1 + p0, q2 = cf[c] * q1 + q0;
          if (Math.max(p2, q2) > maxEdge) break;
          p0 = p1; q0 = q1; p1 = p2; q1 = q2;
        }
        if (q1 > 0) { n = p1; d = q1; }
      } catch (e2) { /* keep the exact reduced fraction */ }
    }
    if (Math.max(n, d) > maxEdge) {
      var k = Math.max(n, d) / maxEdge; n = Math.round(n / k); d = Math.round(d / k);
    }
    var scale = Math.max(1, Math.floor(maxEdge / Math.max(n, d)));
    return {
      w: n * scale, h: d * scale, n: n, d: d,
      text: n + ':' + d, scaled: scale > 1
    };
  }

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  /* ------------------------------------------------------------- search */
  /**
   * Search perfect dissections for the given integer frame.
   * @returns Promise<{frame,solutions,stats}>
   *   solutions: [{cells:[x,y,s,...], w,h, order, sides:[...], verify:{...}}]
   */
  function search(w, h, opts) {
    opts = opts || {};
    var E = engine();
    var run;
    if (E && E.available && E.perfectSearchAsync) {
      run = E.perfectSearchAsync(w, h, {
        seed: opts.seed || 2026,
        maxNodes: opts.maxNodes || 3000000,
        maxSolutions: opts.maxSolutions || 8,
        minOrder: opts.minOrder || 9
      });
    } else {
      run = Promise.resolve(jsSearch(w, h, opts));
    }
    return Promise.resolve(run).then(function (res) {
      res = res || { solutions: [], nodes: 0, truncated: false, bestOrder: 0 };
      var out = [];
      for (var i = 0; i < res.solutions.length; i++) {
        var flat = res.solutions[i];
        var v = E && E.verify ? E.verify(w, h, flat) : jsVerify(w, h, flat);
        if (!v || !v.ok) continue;                 // never expose a false tiling
        // Independent arbitrary-precision re-check: a single checker bug
        // cannot certify an incorrect dissection.
        var big = verifyBigInt(w, h, flat);
        if (!big.ok) continue;
        v.big = big;                               // area/distinct/primitive/gaps
        var sides = [];
        for (var j = 2; j < flat.length; j += 3) sides.push(flat[j]);
        sides.sort(function (a, b) { return b - a; });
        out.push({
          cells: flat.slice(), w: w, h: h, order: flat.length / 3,
          sides: sides, verify: v
        });
      }
      return {
        frame: { w: w, h: h }, solutions: out,
        stats: {
          nodes: res.nodes, truncated: !!res.truncated,
          bestOrder: res.bestOrder || 0,
          engine: E && E.available ? E.status() : 'JS',
          ms: opts._t0 ? (Date.now() - opts._t0) : 0
        }
      };
    });
  }

  /* ------------------------------------------------- JS fallback searcher */
  function jsSearch(W, H, opts) {
    var maxSide = Math.min(W, H), nodes = 0;
    var maxNodes = opts.maxNodes || 300000, maxSol = opts.maxSolutions || 4;
    var minOrder = opts.minOrder || 9;
    var heights = new Int32Array(W), cur = [], used = Object.create(null);
    var sols = [], seen = Object.create(null);
    var seed = opts.seed || 1;
    function rnd() {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }
    function walk(area) {
      if (++nodes > maxNodes || sols.length >= maxSol) return;
      var y = Infinity, x = 0;
      for (var i = 0; i < W; i++) if (heights[i] < y) { y = heights[i]; x = i; }
      if (y === H) {
        if (cur.length >= minOrder) {
          var key = cur.slice().sort(function (a, b) { return a - b; }).join(',');
          if (!seen[key]) { seen[key] = 1; sols.push(cur.slice()); }
        }
        return;
      }
      var avail = 0;
      while (x + avail < W && heights[x + avail] === y) avail++;
      var ms = Math.min(avail, H - y, maxSide);
      var cands = [];
      for (var s = 1; s <= ms; s++) if (!used[s]) cands.push(s);
      cands.sort(function (a, b) { return b * (0.62 + 0.76 * rnd()) - a * (0.62 + 0.76 * rnd()); });
      for (var k = 0; k < cands.length; k++) {
        var sz = cands[k];
        used[sz] = 1; cur.push([x, y, sz]);
        for (var q = 0; q < sz; q++) heights[x + q] = y + sz;
        walk(area + sz * sz);
        for (var q2 = 0; q2 < sz; q2++) heights[x + q2] = y;
        cur.pop(); delete used[sz];
        if (sols.length >= maxSol) return;
      }
    }
    walk(0);
    return {
      solutions: sols.map(function (cells) {
        var flat = [];
        cells.forEach(function (c) { flat.push(c[0], c[1], c[2]); });
        return flat;
      }),
      nodes: nodes, truncated: nodes >= maxNodes, bestOrder: 0
    };
  }

  function jsVerify(W, H, flat) {
    var area = 0, sides = Object.create(null), dup = 0;
    for (var i = 0; i < flat.length; i += 3) {
      var x = flat[i], y = flat[i + 1], s = flat[i + 2];
      if (s <= 0 || x < 0 || y < 0 || x + s > W || y + s > H) {
        return { ok: false, gaps: 1, overlaps: 0, duplicates: 0, area: 0 };
      }
      area += s * s;
      if (sides[s]) dup++; sides[s] = 1;
    }
    return { ok: area === W * H && dup === 0, gaps: area === W * H ? 0 : 1,
             overlaps: 0, duplicates: dup, area: area };
  }

  /**
   * Independent BigInt re-verification: exact area, pairwise-distinct sides,
   * in-frame bounds and a full scan-line coverage test. This is deliberately
   * separate from the WASM i64 checker so a single bug cannot certify a false
   * tiling. Returns {ok, area, distinct, primitive, gaps, overlaps}.
   */
  function verifyBigInt(W, H, flat) {
    var n = flat.length / 3;
    var area = 0n, sides = Object.create(null), distinct = true, primitive = true;
    var target = BigInt(W) * BigInt(H), FW = BigInt(W), FH = BigInt(H);
    for (var i = 0; i < flat.length; i += 3) {
      var x = BigInt(flat[i]), y = BigInt(flat[i + 1]), s = BigInt(flat[i + 2]);
      if (s <= 0n || x < 0n || y < 0n || x + s > FW || y + s > FH) {
        return { ok: false, gaps: 1, overlaps: 0, area: '0', distinct: false, primitive: false };
      }
      area += s * s;
      var key = s.toString();
      if (sides[key]) distinct = false; sides[key] = 1;
    }
    // gcd of all sides (BigInt Euclid) decides primitivity.
    var g = 0;
    for (i = 2; i < flat.length; i += 3) g = gcd(g, flat[i]);
    primitive = g === 1;
    // Exact scan-line coverage over x-slabs.
    var xs = [0, W], j;
    for (i = 0; i < flat.length; i += 3) { xs.push(flat[i], flat[i] + flat[i + 2]); }
    xs.sort(function (a, b) { return a - b; });
    var gaps = 0, overlaps = 0;
    for (j = 0; j + 1 < xs.length; j++) {
      if (xs[j + 1] === xs[j]) continue;
      var mid = (xs[j] + xs[j + 1]) / 2, segs = [];
      for (i = 0; i < flat.length; i += 3) {
        if (flat[i] <= mid && mid < flat[i] + flat[i + 2]) {
          segs.push([flat[i + 1], flat[i + 1] + flat[i + 2]]);
        }
      }
      segs.sort(function (a, b) { return a[0] - b[0]; });
      var cursor = 0;
      for (var k = 0; k < segs.length; k++) {
        if (segs[k][0] > cursor) gaps++;
        else if (segs[k][0] < cursor) overlaps++;
        if (segs[k][1] > cursor) cursor = segs[k][1];
      }
      if (cursor < H) gaps++;
    }
    return {
      ok: area === target && distinct && gaps === 0 && overlaps === 0,
      area: area.toString(), distinct: distinct, primitive: primitive,
      gaps: gaps, overlaps: overlaps
    };
  }

  /* --------------------------------------------------- unbounded family */
  /** Integer scaling: multiply every coordinate and side by k (BigInt-safe). */
  function scaleCells(flat, k) {
    k = BigInt(k);
    var out = new Array(flat.length);
    for (var i = 0; i < flat.length; i++) out[i] = BigInt(flat[i]) * k;
    return out;
  }

  /**
   * Self-substitution (Anderson): replace the smallest square whose side
   * divides the frame by a scaled copy of the whole tiling. Exact BigInt
   * arithmetic; rejects any result whose sides are no longer distinct.
   * @param cells array of BigInt triples [x,y,s,...] with outer frame frame
   * @returns {cells, frame, via} or null
   */
  function substituteOnce(cells, frame) {
    frame = BigInt(frame);
    var seen = Object.create(null), cand = [];
    for (var i = 0; i < cells.length; i += 3) {
      var s = cells[i + 2];
      if (s <= 0n) continue;
      if (frame % s === 0n && !seen[s.toString()]) {
        seen[s.toString()] = 1; cand.push(s);
      }
    }
    cand.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    for (var ci = 0; ci < cand.length; ci++) {
      var sc = cand[ci], m = frame / sc, tgt = -1;
      for (i = 0; i < cells.length; i += 3) if (cells[i + 2] === sc) { tgt = i; break; }
      if (tgt < 0) continue;
      var out = [];
      for (i = 0; i < cells.length; i += 3) {
        if (i === tgt) continue;
        out.push(cells[i] * m, cells[i + 1] * m, cells[i + 2] * m);
      }
      var tx = cells[tgt] * m, ty = cells[tgt + 1] * m;
      for (i = 0; i < cells.length; i += 3) {
        out.push(tx + cells[i], ty + cells[i + 1], cells[i + 2]);
      }
      var distinct = Object.create(null), ok = true;
      for (i = 2; i < out.length; i += 3) {
        var key = out[i].toString();
        if (distinct[key]) { ok = false; break; }
        distinct[key] = 1;
      }
      if (!ok) continue;
      return { cells: out, frame: frame * m, via: sc.toString() };
    }
    return null;
  }

  /** Apply `levels` substitution steps; returns exact BigInt cells + frame. */
  function infiniteFamily(solution, levels, scaleK) {
    var cells = solution.cells.map(BigInt);
    var frameW = BigInt(solution.w), frameH = BigInt(solution.h);
    if (frameW !== frameH) {
      // Non-square frames cannot self-substitute; scaling still works.
      var onlyScale = scaleCells(cells, scaleK || 1);
      return { cells: onlyScale, w: frameW * BigInt(scaleK || 1),
               h: frameH * BigInt(scaleK || 1), levels: 0, square: false };
    }
    if (scaleK && scaleK > 1) {
      cells = scaleCells(cells, scaleK);
      frameW *= BigInt(scaleK); frameH *= BigInt(scaleK);
    }
    var levelsDone = 0;
    for (var L = 0; L < levels; L++) {
      var r = substituteOnce(cells, frameW);
      if (!r) break;
      cells = r.cells; frameW = r.frame; frameH = r.frame; levelsDone++;
    }
    return { cells: cells, w: frameW, h: frameH,
             levels: levelsDone, square: true };
  }

  /**
   * Convert exact BigInt cells to safe float triples for rendering, using
   * Decimal.js at 40 digits to avoid 2^53 rounding in the division.
   */
  function toFloatCells(family) {
    var Dec = D();
    var wN = Number(family.w), hN = Number(family.h);
    var out = new Array(family.cells.length);
    if (Dec && Dec.set) Dec.set({ precision: 40 });
    var dw = Dec ? new Dec(family.w.toString()) : null;
    var dh = Dec ? new Dec(family.h.toString()) : null;
    for (var i = 0; i < family.cells.length; i += 3) {
      var x = Number(family.cells[i]), y = Number(family.cells[i + 1]);
      var s = Number(family.cells[i + 2]);
      if (dw && dh) {
        x = new Dec(family.cells[i].toString()).div(dw).times(wN).toNumber();
        y = new Dec(family.cells[i + 1].toString()).div(dh).times(hN).toNumber();
        s = new Dec(family.cells[i + 2].toString()).div(dw).times(wN).toNumber();
      }
      out[i] = x; out[i + 1] = y; out[i + 2] = s;
    }
    return out;
  }

  return {
    toFrame: toFrame, gcd: gcd, search: search,
    scaleCells: scaleCells, substituteOnce: substituteOnce,
    infiniteFamily: infiniteFamily, toFloatCells: toFloatCells,
    jsSearch: jsSearch, jsVerify: jsVerify, verifyBigInt: verifyBigInt
  };
});
