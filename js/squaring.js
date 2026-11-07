/* ==========================================================================
 * squaring.js — Core dissection algorithm / Squared-rectangle engine  (v2)
 *
 * Default algorithm: dyadic quadtree + multi-focus size field
 *   · The world consists of m×n macro blocks of L×L, with L = 2^depth
 *     (integer units, exact in binary).
 *   · The size field S(p) grows monotonically with distance to the nearest
 *     focus; an L×L block is split into four s/2 squares only when
 *     s > 1.35·S(centre).
 *     => Far from a focus S = L, so it never subdivides — no small tiles (strict).
 *     => Near a focus S shrinks, allowing subdivision down to tiny sizes
 *        (multiple dense centres).
 *   · A quadtree split is a disjoint, complete partition, so coverage is
 *     100% with zero overlaps.
 *   · Generation is LOD-based on the current viewport + zoom: zooming in keeps
 *     unfolding new levels for near-infinite magnification while each frame
 *     produces only visible tiles.
 *   · Coordinates are doubles, remapped to viewport-relative local coordinates
 *     at draw time to preserve precision.
 *   · Adjacency graph + greedy colouring: neighbouring tiles always differ;
 *     the palette excludes black / white / grey.
 *
 * Two classic references are also kept: the Euclidean continued fraction and
 * Moroń's 33×32 perfect rectangle (electrical-network solution).
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Squaring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var TAU = Math.PI * 2;

  function mulberry32(seed) {
    var a = (seed | 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash3(x, y, s, seed) {
    var n = Math.imul(Math.round(x * 1024) | 0, 374761393) ^
            Math.imul(Math.round(y * 1024) | 0, 668265263) ^
            Math.imul(Math.round(s * 2048) | 0, 2147483647) ^
            Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  /**
   * Integer-grid hash. Coordinates are first normalised to integers
   * (K(x), K(y), s/minS) by the current smallest tile side, then bit-mixed.
   * Even at 2^-30 zoom the integer coordinates of adjacent tiles still differ
   * by exactly 1, so floating-point quantisation cannot collapse every tile
   * into a single hash value (which would produce flat fills and a checkerboard).
   */
  function mix32(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function hashGrid(ix, iy, is, seed) {
    // Chain the mixes instead of XOR-combining raw multiples: an XOR of two
    // lattice products has systematic collisions on dense integer grids.
    var h = mix32(ix | 0);
    h = mix32((h ^ Math.imul(iy | 0, 0x9e3779b1)) | 0);
    h = mix32((h ^ Math.imul((is ^ seed) | 0, 0x85ebca6b)) | 0);
    var h2 = mix32((h ^ 0xc2b2ae35) | 0);
    // Pack two avalanches into a 53-bit double: exact in IEEE-754 and
    // collision-free for the integer grids produced at any zoom level.
    return (h * 2097152 + (h2 & 0x1fffff)) / 9007199254740992; // 2^53
  }

  /* ---------------------------------------------------------------- World */
  /** Build the dyadic world from the user's rectangle aspect ratio: gw=m·L, gh=n·L */
  function buildWorld(ratio, opts) {
    opts = opts || {};
    var D = clamp(opts.depth | 0 || 8, 3, 11);       // macro block side L = 2^D
    var L = Math.pow(2, D);
    var n = clamp(opts.rows | 0 || 12, 3, 26);       // number of macro block rows
    var m = Math.max(1, Math.round(ratio * n));      // number of macro block columns
    return {
      gw: m * L, gh: n * L, m: m, n: n, L: L, depth: D,
      ratio: m / n, srcRatio: ratio
    };
  }

  /** Multiple dense centres: one centred; several are spread evenly by the golden angle */
  function defaultFoci(world, count, seed) {
    count = clamp(count | 0 || 1, 1, 6);
    if (count === 1) return [{ x: world.gw / 2, y: world.gh / 2 }];
    var out = [], golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < count; i++) {
      var a = i * golden + (seed % 97) * 0.017;
      var r = 0.26 + 0.05 * (i % 2);
      out.push({
        x: world.gw * (0.5 + r * Math.cos(a)),
        y: world.gh * (0.5 + r * Math.sin(a) * 0.92)
      });
    }
    return out;
  }

  /**
   * Scale-free target edge length, evaluated in viewport-local coordinates.
   * target = L * (d/R)^power, so d -> 0 yields arbitrarily small tiles and
   * there is NO absolute world-space floor: zooming in always reveals a new
   * level of subdivision (LOD stops it on screen-pixel size instead).
   * At d >= R the target equals L exactly, therefore a macro tile with s = L
   * never satisfies s > 1.35 * target; far-field tiles are strictly large.
   */
  function sizeField(x, y, world, opts) {
    var foci = opts.foci || [], best = Infinity;
    for (var i = 0; i < foci.length; i++) {
      var dx = x - foci[i].x, dy = y - foci[i].y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    var R = opts.radius || Math.min(world.gw, world.gh) * 0.62;
    var t = clamp(best / R, 0, 1);
    return world.L * Math.pow(t, opts.power || 2.4);
  }

  /* ------------------------------------------------------- LOD subdivision generation */
  /**
   * @param world result of buildWorld
   * @param view  {x0,y0,x1,y1,scale}  world-coordinate viewport + pixels/unit
   * @param opts  {foci,power,minSize,radius,minPx,maxBlocks,maxDepth}
   * @returns blocks [{x,y,s,depth}]
   */
  function generateOnce(world, view, opts, minPx, cap) {
    var blocks = [];
    var maxDepth = opts.maxDepth || 48;
    var scale = view.scale;
    var exceeded = false;

    // Quadtree coordinates are stored relative to the viewport centre.
    // Absolute world coordinates near 10^3 have a ~10^-13 ULP, which would
    // swallow any tile smaller than that; local coordinates keep the full
    // 53-bit mantissa available at every zoom level (near-infinite zoom).
    var ox = view.ox || 0, oy = view.oy || 0;
    var hw = view.hw || (view.x1 - view.x0) / 2;
    var hh = view.hh || (view.y1 - view.y0) / 2;
    var foci = (opts.foci || []).map(function (f) {
      return { x: f.x - ox, y: f.y - oy };
    });
    var localOpts = { foci: foci, radius: opts.radius, power: opts.power };

    function walk(x, y, s, depth) {
      if (exceeded) return;                    // abort instead of emitting a split-level mosaic
      if (x > hw || y > hh || x + s < -hw || y + s < -hh) return;
      if (blocks.length >= cap) { exceeded = true; return; }
      var target = sizeField(x + s / 2, y + s / 2, world, localOpts);
      // Termination is governed by screen pixels + depth only (no world floor).
      if (depth < maxDepth && s > target * 1.35 && s * scale > minPx * 2.1) {
        var h = s / 2;
        walk(x, y, h, depth + 1);
        walk(x + h, y, h, depth + 1);
        walk(x, y + h, h, depth + 1);
        walk(x + h, y + h, h, depth + 1);
      } else {
        blocks.push({ x: x, y: y, s: s, depth: depth, wx: x + ox, wy: y + oy });
      }
    }

    for (var j = 0; j < world.n; j++) {
      for (var i = 0; i < world.m; i++) {
        walk(i * world.L - ox, j * world.L - oy, world.L, 0);
      }
    }
    blocks.exceeded = exceeded;
    blocks.ox = ox; blocks.oy = oy;
    return blocks;
  }

  /**
   * When the tile cap is hit, coarsen the LOD and regenerate: the whole view
   * keeps one subdivision level, so no "half ultra-fine, half forced-large-block"
   * seam appears.
   */
  function generate(world, view, opts) {
    opts = opts || {};
    var minPx = opts.minPx == null ? 2.4 : opts.minPx;
    var cap = opts.maxBlocks || 60000;
    var result = null;
    for (var attempt = 0; attempt < 7; attempt++) {
      result = generateOnce(world, view, opts, minPx, cap);
      if (!result.exceeded) return result;
      minPx *= 1.8;
    }
    // Fallback: a very coarse LOD with no tile cap; larger tiles are preferable to keep the whole view complete and at a consistent level
    result = generateOnce(world, view, opts, minPx * 3, Infinity);
    result.exceeded = false;
    return result;
  }

  /* ---------------------------------------------------------- Adjacency graph */
  /** Tiles sharing an edge are neighbours; coordinates normalised by minS give integer keys (dyadic exact) */
  function buildAdjacency(blocks) {
    var n = blocks.length, minS = Infinity, i;
    for (i = 0; i < n; i++) if (blocks[i].s < minS) minS = blocks[i].s;
    if (!isFinite(minS) || minS <= 0) minS = 1;
    // dyadic coordinates are all integer multiples of minS → integer keys are exact, avoiding floating-point error
    var K = function (v) { return Math.round(v / minS); };
    var EX = new Map(), EY = new Map();
    function push(map, key, side, a, b, idx) {
      if (!map.has(key)) map.set(key, { L: [], R: [] });
      map.get(key)[side].push({ a: a, b: b, i: idx });
    }
    for (i = 0; i < n; i++) {
      var q = blocks[i];
      push(EX, K(q.x), 'L', K(q.y), K(q.y + q.s), i);
      push(EX, K(q.x + q.s), 'R', K(q.y), K(q.y + q.s), i);
      push(EY, K(q.y), 'L', K(q.x), K(q.x + q.s), i);
      push(EY, K(q.y + q.s), 'R', K(q.x), K(q.x + q.s), i);
    }
    var adj = new Array(n);
    for (i = 0; i < n; i++) adj[i] = [];
    function link(a, b) { if (a !== b) { adj[a].push(b); adj[b].push(a); } }
    // Along a split line, intervals on each side are mutually disjoint → two-pointer linear merge O(n log n)
    function merge(map) {
      map.forEach(function (g) {
        var L = g.L, R = g.R;
        L.sort(function (p, q) { return p.a - q.a; });
        R.sort(function (p, q) { return p.a - q.a; });
        var a = 0, b = 0;
        while (a < L.length && b < R.length) {
          var u = L[a], v = R[b];
          if (Math.min(u.b, v.b) > Math.max(u.a, v.a)) link(u.i, v.i);
          if (u.b < v.b) a++; else b++;
        }
      });
    }
    merge(EX); merge(EY);
    return { adj: adj, keyOf: K, minS: minS };
  }

  /* ------------------------------------------------------------ Palette */
  /** All colours: lightness 36-72%, saturation >= 52%, no black / white / grey */
  function palette(name, theme) {
    var dark = theme === 'dark';
    var out = [], i, h, s, l;
    if (name === 'mono') {
      for (i = 0; i < 22; i++) {
        out.push({ h: 200 + (i % 3) * 7, s: dark ? 76 : 68, l: 36 + i * 1.6 });
      }
    } else if (name === 'sky') {
      for (i = 0; i < 28; i++) {
        h = 182 + (i / 28) * 128;              // sky blue → cyan → indigo → purple
        out.push({ h: h, s: dark ? 82 : 72, l: (dark ? 50 : 45) + (i % 4) * 3.0 });
      }
    } else if (name === 'warm') {
      for (i = 0; i < 28; i++) {
        h = (338 + (i / 28) * 124) % 360;      // magenta → orange → yellow → yellow-green
        out.push({ h: h, s: dark ? 84 : 74, l: (dark ? 52 : 46) + (i % 4) * 3.0 });
      }
    } else {
      for (i = 0; i < 32; i++) {
        h = (i / 32) * 360;
        out.push({ h: h, s: dark ? 80 : 72, l: (dark ? 50 : 45) + (i % 5) * 2.8 });
      }
    }
    return out;
  }

  function colorDist(a, b) {
    var dh = Math.abs(a.h - b.h) % 360;
    if (dh > 180) dh = 360 - dh;
    return dh / 90 + Math.abs(a.l - b.l) / 24;
  }

  /**
   * Adjacency-different colouring (greedy + hard constraint + cache; reuses
   * already-computed colours while panning)
   * @returns [{h,s,l,j,k}] one-to-one with blocks; j = per-tile jitter, k = palette index
   */
  function colorize(blocks, cache, opts) {
    opts = opts || {};
    var pal = palette(opts.palette, opts.theme);
    var n = blocks.length;
    if (n === 0) return [];

    var g = buildAdjacency(blocks);
    var adj = g.adj, keyOf = g.keyOf, minS = g.minS;
    var chosen = new Array(n).fill(-1);
    var keys = new Array(n), ix = new Array(n), iy = new Array(n),
        isz = new Array(n), jitter = new Array(n);
    var i, k;

    for (i = 0; i < n; i++) {
      var b = blocks[i];
      ix[i] = keyOf(b.x); iy[i] = keyOf(b.y); isz[i] = Math.round(b.s / minS);
      keys[i] = ix[i] + ',' + iy[i] + ',' + isz[i];
      // Integer-grid hash: a tile keeps a stable colour across LOD changes, and adjacent tiles never collide even at tiny scales
      jitter[i] = hashGrid(ix[i], iy[i], isz[i], opts.seed || 1);
      if (cache && cache.has(keys[i])) chosen[i] = cache.get(keys[i]);
    }

    // Low-frequency colour flow within the viewport: uses integer-grid coordinate differences, still exact at deep zoom
    var view = opts.view;
    var gx0 = view ? Math.round(view.x0 / minS) : 0;
    var gy0 = view ? Math.round(view.y0 / minS) : 0;
    var gsx = view ? Math.max(1, (view.x1 - view.x0) / minS) : 1;
    var gsy = view ? Math.max(1, (view.y1 - view.y0) / minS) : 1;

    if (n <= 24) {
      return blocks.map(function (_, i2) {
        var c = Math.floor(i2 * pal.length / n) % pal.length, p = pal[c];
        return { h: p.h, s: p.s, l: p.l, j: jitter[i2], k: c };
      });
    }

    // Precompute colour distances to avoid millions of repeated calculations during colouring
    var D = [], a0, b0;
    for (a0 = 0; a0 < pal.length; a0++) {
      D[a0] = [];
      for (b0 = 0; b0 < pal.length; b0++) D[a0][b0] = colorDist(pal[a0], pal[b0]);
    }
    var order = blocks.map(function (_, idx) { return idx; })
      .sort(function (a, b) { return blocks[b].s - blocks[a].s || a - b; });

    function hueDist(a, b) {
      var d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    }
    function pick(i2) {
      var nb = adj[i2];
      // Per-tile target hue + low-frequency viewport flow: naturally varied without degenerating into a checkerboard
      var flow = opts.hueShift == null ? null : (
        opts.hueShift
        + hashGrid(ix[i2], iy[i2], isz[i2], (opts.seed || 1) ^ 0x5f3759df) * 150
        + ((ix[i2] - gx0) / gsx) * 170
        + ((iy[i2] - gy0) / gsy) * 130
      ) % 360;
      var strict = -1, strictScore = -Infinity;
      var loose = -1, looseScore = -Infinity;
      var fallback = 0, fallbackScore = -Infinity;
      for (var c = 0; c < pal.length; c++) {
        var minD = 4, same = false;
        for (k = 0; k < nb.length; k++) {
          var ci = chosen[nb[k]];
          if (ci < 0) continue;
          if (ci === c) same = true;
          var d = D[c][ci];
          if (d < minD) minD = d;
        }
        // Each tile keeps its own hue target; adjacency distance only refines
        // the choice, which avoids the mechanical checkerboard of a pure
        // "maximise distance from neighbours" greedy pass.
        var score = (flow == null ? 1 : 1 - hueDist(pal[c].h, flow) / 180)
                  + Math.min(minD, 4) * 0.3 + jitter[i2] * 0.08;
        if (score > fallbackScore) { fallbackScore = score; fallback = c; }
        if (!same && score > looseScore) { looseScore = score; loose = c; }
        if (!same && minD >= 0.35 && score > strictScore) { strictScore = score; strict = c; }
      }
      // Prefer a clearly distinct hue; fall back to "different index", then to
      // the best available colour when a tile has more neighbours than hues.
      return strict >= 0 ? strict : (loose >= 0 ? loose : fallback);
    }

    for (var oi = 0; oi < order.length; oi++) {
      i = order[oi];
      if (chosen[i] < 0) {
        chosen[i] = pick(i);
      } else {
        var conflict = false, nb2 = adj[i];
        for (k = 0; k < nb2.length; k++) {
          if (chosen[nb2[k]] === chosen[i]) { conflict = true; break; }
        }
        if (conflict) chosen[i] = pick(i);
      }
    }

    if (cache) for (i = 0; i < n; i++) cache.set(keys[i], chosen[i]);
    return chosen.map(function (c, i2) {
      var p = pal[c] || pal[0];
      return { h: p.h, s: p.s, l: p.l, j: jitter[i2], k: c };
    });
  }

  /* ------------------------------------------------- Classic references (static tilings) */
  function euclidChain(x, y, w, h, out, cf) {
    while (w > 0 && h > 0) {
      var big = Math.max(w, h), small = Math.min(w, h);
      var q = Math.floor(big / small), r = big - q * small;
      if (cf) cf.push(q);
      for (var i = 0; i < q; i++) {
        if (w >= h) out.push({ x: x + i * small, y: y, s: small, depth: 0, label: small, kind: 'euclid' });
        else out.push({ x: x, y: y + i * small, s: small, depth: 0, label: small, kind: 'euclid' });
      }
      if (r === 0) return;
      if (w >= h) { x += q * small; w = r; } else { y += q * small; h = r; }
    }
  }

  function solvePacking(W, H, sizes) {
    var heights = new Array(W).fill(0);
    var order = sizes.slice().sort(function (a, b) { return b - a; });
    var used = order.map(function () { return false; });
    var placed = [], steps = 0;
    function dfs() {
      steps++;
      if (steps > 300000) return false;
      var minH = Infinity, x = 0, i;
      for (i = 0; i < W; i++) if (heights[i] < minH) { minH = heights[i]; x = i; }
      if (minH === H) return true;
      var avail = 0;
      while (x + avail < W && heights[x + avail] === minH) avail++;
      var last = -1;
      for (var k = 0; k < order.length; k++) {
        if (used[k] || order[k] === last) continue;
        var s = order[k]; last = s;
        if (s > avail || minH + s > H) continue;
        used[k] = true; placed.push({ x: x, y: minH, s: s, label: s, kind: 'network' });
        for (i = x; i < x + s; i++) heights[i] = minH + s;
        if (dfs()) return true;
        for (i = x; i < x + s; i++) heights[i] = minH;
        placed.pop(); used[k] = false;
      }
      return false;
    }
    return dfs() ? { squares: placed, steps: steps } : { squares: null, steps: steps };
  }

  var MORON_SIDES = [18, 15, 14, 10, 9, 8, 7, 4, 1];

  /** Static tiling: euclid (continued fraction) or network (Moroń perfect rectangle) */
  function staticTiling(mode, world) {
    if (mode === 'euclid') {
      var out = [], cf = [];
      euclidChain(0, 0, world.gw, world.gh, out, cf);
      return { blocks: out, meta: { cf: cf, count: out.length } };
    }
    var best = null, orient = [[33, 32], [32, 33]];
    for (var i = 0; i < orient.length; i++) {
      var W0 = orient[i][0], H0 = orient[i][1];
      var r = solvePacking(W0, H0, MORON_SIDES);
      if (!r.squares) continue;
      var scale = Math.min(world.gw / W0, world.gh / H0);
      var w = W0 * scale, h = H0 * scale;
      if (!best || w * h > best.w * best.h) {
        best = { W0: W0, H0: H0, scale: scale, w: w, h: h, sol: r.squares, steps: r.steps };
      }
    }
    if (!best) return { blocks: [], meta: {} };
    var ox = (world.gw - best.w) / 2, oy = (world.gh - best.h) / 2;
    var blocks = best.sol.map(function (q) {
      return { x: ox + q.x * best.scale, y: oy + q.y * best.scale, s: q.s * best.scale, depth: 0, label: q.s, kind: 'network' };
    });
    return {
      blocks: blocks,
      meta: {
        inset: { x: ox, y: oy, w: best.w, h: best.h },
        W0: best.W0, H0: best.H0, ratio: best.W0 + ':' + best.H0,
        steps: best.steps, sides: MORON_SIDES.slice(),
        count: blocks.length
      }
    };
  }

  /* ------------------------------------------------------------ Validation */
  /** Exact sweep-line validation: area conservation + every column fully tiled without overlap (for Node tests) */
  function validate(blocks, world) {
    var bx = function (b) { return b.wx != null ? b.wx : b.x; };
    var by = function (b) { return b.wy != null ? b.wy : b.y; };
    var xs = [0, world.gw], i;
    for (i = 0; i < blocks.length; i++) { xs.push(bx(blocks[i]), bx(blocks[i]) + blocks[i].s); }
    xs.sort(function (a, b) { return a - b; });
    var uniq = [];
    for (i = 0; i < xs.length; i++) if (!uniq.length || xs[i] - uniq[uniq.length - 1] > 1e-9) uniq.push(xs[i]);
    var eps = 1e-7, gaps = 0, overlaps = 0;
    for (i = 0; i < uniq.length - 1; i++) {
      var xa = uniq[i], xb = uniq[i + 1];
      if (xb - xa < eps) continue;
      var mid = (xa + xb) / 2;
      var segs = [];
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j];
        if (bx(b) <= mid + eps && bx(b) + b.s >= mid - eps) segs.push([by(b), by(b) + b.s]);
      }
      segs.sort(function (a, b) { return a[0] - b[0]; });
      var cursor = 0;
      for (var k = 0; k < segs.length; k++) {
        if (segs[k][0] > cursor + eps) gaps++;
        else if (segs[k][0] < cursor - eps) overlaps++;
        cursor = Math.max(cursor, segs[k][1]);
      }
      if (cursor < world.gh - eps) gaps++;
    }
    var area = 0;
    for (i = 0; i < blocks.length; i++) area += blocks[i].s * blocks[i].s;
    return {
      ok: gaps === 0 && overlaps === 0 && Math.abs(area - world.gw * world.gh) < 1e-4,
      area: area, expected: world.gw * world.gh, gaps: gaps, overlaps: overlaps, blocks: blocks.length
    };
  }

  return {
    buildWorld: buildWorld,
    defaultFoci: defaultFoci,
    sizeField: sizeField,
    generate: generate,
    buildAdjacency: buildAdjacency,
    palette: palette,
    colorize: colorize,
    staticTiling: staticTiling,
    validate: validate,
    mulberry32: mulberry32,
    hashGrid: hashGrid,
    MORON_SIDES: MORON_SIDES
  };
});
