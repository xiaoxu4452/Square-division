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

  /** Distance from (x,y) to the nearest user-defined dense centre. */
  function focusDistance(x, y, foci) {
    var best = Infinity;
    for (var i = 0; i < foci.length; i++) {
      var dx = x - foci[i].x, dy = y - foci[i].y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    return best;
  }

  /** Normalised dense-centre weight: 1 at a centre, 0 in the far field. */
  function focusWeight(x, y, world, opts) {
    var R = opts.radius || Math.min(world.gw, world.gh) * 0.62;
    var d = focusDistance(x, y, opts.foci || []);
    if (!isFinite(d)) return 0;
    return Math.pow(clamp(1 - d / R, 0, 1), opts.power || 2.4);
  }

  /**
   * Scale-free target edge length, evaluated in viewport-local coordinates.
   *
   * target = F * (d/R)^power with F = min(gw,gh), the side of the largest
   * square the Euclidean minimum-tile skeleton can contain. At d >= R the
   * target equals F, so no skeleton square satisfies s > 1.35 * target: the
   * far field keeps its minimum number of large squares. As d -> 0 there is
   * no absolute world-space floor, so zooming in keeps revealing new levels
   * of subdivision (LOD stops it at a screen-pixel size instead).
   */
  function sizeField(x, y, world, opts) {
    var R = opts.radius || Math.min(world.gw, world.gh) * 0.62;
    var d = focusDistance(x, y, opts.foci || []);
    var t = clamp(d / R, 0, 1);
    var far = opts.farTarget || Math.min(world.gw, world.gh);
    return far * Math.pow(t, opts.power || 2.4);
  }

  /**
   * Minimum-tile skeleton of the whole rectangle: the Euclidean algorithm
   * cuts the largest possible square at every step, producing sum(q_i)
   * squares (q_i = continued-fraction quotients of m:n). Every following
   * refinement is a partition of one of these squares, so coverage stays
   * exact while the far field retains the fewest possible large squares.
   */
  function minimumSkeleton(world, ox, oy) {
    var out = [];
    euclidChain(-ox, -oy, world.gw, world.gh, out, null);
    return out;
  }

  /* ------------------------------------------------------- LOD subdivision generation */
  /**
   * @param world result of buildWorld
   * @param view  {x0,y0,x1,y1,scale}  world-coordinate viewport + pixels/unit
   * @param opts  {foci,power,minSize,radius,minPx,maxBlocks,maxDepth}
   * @returns blocks [{x,y,s,depth}]
   */
  function generateOnce(world, view, opts, minPx, cap, boost) {
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
    var localOpts = {
      foci: foci, radius: opts.radius, power: opts.power,
      farTarget: Math.min(world.gw, world.gh)
    };

    function walk(x, y, s, depth) {
      if (exceeded) return;                    // abort instead of emitting a split-level mosaic
      if (x > hw || y > hh || x + s < -hw || y + s < -hh) return;
      if (blocks.length >= cap) { exceeded = true; return; }
      var cx = x + s / 2, cy = y + s / 2;
      var target = sizeField(cx, cy, world, localOpts);
      // A dense centre is rendered finely from the very first frame: its
      // screen-pixel floor is relaxed by the focus weight, so the initial
      // view already shows the characteristic tiny-square core.
      var w = focusWeight(cx, cy, world, localOpts);
      var floor = minPx * (1 - boost * w);
      // Termination is governed by screen pixels + depth only (no world floor).
      if (depth < maxDepth && s > target * 1.35 && s * scale > floor * 2.1) {
        var h = s / 2;
        walk(x, y, h, depth + 1);
        walk(x + h, y, h, depth + 1);
        walk(x, y + h, h, depth + 1);
        walk(x + h, y + h, h, depth + 1);
      } else {
        blocks.push({ x: x, y: y, s: s, depth: depth, wx: x + ox, wy: y + oy });
      }
    }

    var roots = minimumSkeleton(world, ox, oy);
    for (var i = 0; i < roots.length && !exceeded; i++) {
      walk(roots[i].x, roots[i].y, roots[i].s, 0);
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
    var boost = opts.boost == null ? 0.72 : opts.boost;
    var result = null;
    for (var attempt = 0; attempt < 9; attempt++) {
      result = generateOnce(world, view, opts, minPx, cap, boost);
      if (!result.exceeded) return result;
      // Relax the dense core before coarsening the whole frame: the far
      // field must keep its minimum-tile skeleton under any load.
      if (boost > 0.1) boost *= 0.7;
      else minPx *= 1.6;
    }
    // Fallback: a very coarse LOD with no tile cap; larger tiles are preferable to keep the whole view complete and at a consistent level
    result = generateOnce(world, view, opts, minPx * 3, Infinity, 0);
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
  /**
   * Restrained, low-chroma palette. Eight quiet hue families x four tonal
   * steps give 32 distinguishable but understated colours. Chroma is kept
   * well above zero so no tile is ever black, white or neutral grey, while
   * lightness stays in a narrow band to avoid a fluorescent mosaic.
   */
  function palette(name, theme) {
    var dark = theme === 'dark';
    var fam, out = [], i;
    if (name === 'sky') fam = [188, 198, 208, 218, 228, 238, 250, 262];
    else if (name === 'warm') fam = [14, 26, 38, 50, 62, 350, 338, 326];
    else if (name === 'mono') fam = [202, 206, 210, 214, 218, 222, 226, 230];
    else fam = [202, 224, 170, 46, 22, 344, 282, 250];
    for (i = 0; i < 32; i++) {
      var f = i & 7, t = i >> 3;
      out.push({
        h: (fam[f] + (t - 1.5) * 4 + 360) % 360,
        s: 28 + (t & 1) * 5,
        l: (dark ? 43 : 49) + t * 6
      });
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
        + hashGrid(ix[i2], iy[i2], isz[i2], (opts.seed || 1) ^ 0x5f3759df) * 34
        + ((ix[i2] - gx0) / gsx) * 210
        + ((iy[i2] - gy0) / gsy) * 145
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

  /**
   * Ladder (series/parallel) dissection of a square.
   *
   * With t = s/k the parent is partitioned into one (k-1)t square plus a
   * right strip of k tiles and a bottom strip of k-1 tiles: 2k axis-aligned
   * squares covering the parent exactly. In the Smith diagram this is the
   * elementary substitution of one 1-ohm resistor by a series element and a
   * parallel chain, so repeating it produces an arbitrarily large network
   * while preserving exact coverage at every level.
   */
  function ladderSplit(b, k, depth) {
    var t = b.s / k, big = t * (k - 1), out = [], i;
    out.push({ x: b.x, y: b.y, s: big, depth: depth });
    for (i = 0; i < k; i++)
      out.push({ x: b.x + big, y: b.y + i * t, s: t, depth: depth });
    for (i = 0; i < k - 1; i++)
      out.push({ x: b.x + i * t, y: b.y + big, s: t, depth: depth });
    return out;
  }

  var moronCache = null;
  function moronSolution() {
    if (!moronCache) moronCache = solvePacking(33, 32, MORON_SIDES);
    return moronCache;
  }

  /**
   * Embed the Moroń 33:32 perfect rectangle as a sub-network inside a square.
   * The square is divided into a 33x33 lattice of cells of side c = s/33:
   * the upper 33x32 cells are exactly the nine pairwise-distinct Moroń
   * squares, and the last row is closed by 33 unit squares. All 42 pieces are
   * squares and the parent is covered exactly, so one resistor in the Smith
   * diagram can be replaced by this network at any depth.
   */
  function moronEmbed(b, out) {
    var c = b.s / 33, i;
    var sol = moronSolution().squares;
    for (i = 0; i < sol.length; i++) {
      var sq = sol[i];
      out.push({
        x: b.x + sq.x * c, y: b.y + sq.y * c, s: sq.s * c,
        depth: 0, label: sq.s, kind: 'network'
      });
    }
    for (i = 0; i < 33; i++)
      out.push({ x: b.x + i * c, y: b.y + 32 * c, s: c, depth: 0, label: 1, kind: 'network' });
  }

  /**
   * Skeleton that already covers the WHOLE rectangle.
   *
   * Both modes start from the exact continued-fraction dissection of
   * w.gw x w.gh (their ratio is the integer ratio m:n, so every Euclidean
   * step is binary-exact). The network mode then substitutes each skeleton
   * square by the 42-square Moroń sub-network; the euclid mode keeps the
   * bare continued-fraction squares. Ladder subdivision later refines every
   * skeleton square down to the requested on-screen density.
   */
  function buildSkeleton(mode, world, meta) {
    var base = [], cf = [], out = [], i;
    euclidChain(0, 0, world.gw, world.gh, base, cf);
    meta.cf = cf;
    meta.cells = base.length;
    meta.ratio = world.m + ':' + world.n;
    if (mode !== 'network') return base;

    var r = moronSolution();
    if (!r.squares) return base;
    for (i = 0; i < base.length; i++) moronEmbed(base[i], out);
    meta.ratio = '33:32';
    meta.steps = r.steps;
    meta.sides = MORON_SIDES.slice();
    return out;
  }

  /**
   * One LOD pass over the skeleton. Splitting is driven by on-screen pixel
   * size, so zooming in keeps unfolding new ladder levels (unbounded depth)
   * while a frame only ever emits tiles that are actually visible.
   */
  function staticOnce(mode, world, opts, minPx, cap, boost) {
    var meta = {};
    var skeleton = buildSkeleton(mode, world, meta);
    var view = opts.view || null;
    var scale = view ? view.scale : 1;
    var ox = view ? view.ox : 0, oy = view ? view.oy : 0;
    var vx0 = view ? view.x0 : -Infinity, vy0 = view ? view.y0 : -Infinity;
    var vx1 = view ? view.x1 : Infinity, vy1 = view ? view.y1 : Infinity;
    var maxDepth = opts.maxDepth || 22, k = 3, out = [], exceeded = false;

    // All three tilings share the same user-defined dense centres. A ladder
    // level budget decreases linearly with the distance to the nearest
    // centre; outside the core radius the Euclidean / Moron skeleton is left
    // untouched, i.e. the far field keeps the fewest possible large squares.
    var R = opts.radius || Math.min(world.gw, world.gh) * 0.62;
    var order = clamp(opts.order == null ? 2 : opts.order, 0, 6);
    var coreR = R * (0.18 + 0.12 * order);
    var maxLevels = 4 + order * 2;
    var foci = opts.foci || [];

    function emit(b, depth) {
      if (exceeded) return;
      if (b.x > vx1 || b.y > vy1 || b.x + b.s < vx0 || b.y + b.s < vy0) return;
      if (out.length >= cap) { exceeded = true; return; }
      var px = b.s * scale;
      var d = focusDistance(b.x + b.s / 2, b.y + b.s / 2, foci);
      var w = clamp(1 - d / coreR, 0, 1);
      var budget = Math.round(maxLevels * Math.pow(w, 0.6));
      // The centre is fine from the very first frame: relax its pixel floor.
      var floor = minPx * (1 - boost * w);
      if (depth < budget && depth < maxDepth && px > floor * 2.4) {
        var parts = ladderSplit(b, k, depth + 1);
        for (var i = 0; i < parts.length && !exceeded; i++) emit(parts[i], depth + 1);
      } else {
        var nb = { x: b.x - ox, y: b.y - oy, s: b.s, depth: depth, wx: b.x, wy: b.y };
        if (b.label != null) nb.label = b.label;
        if (b.kind) nb.kind = b.kind;
        out.push(nb);
      }
    }
    for (var i = 0; i < skeleton.length && !exceeded; i++) emit(skeleton[i], 0);

    out.exceeded = exceeded;
    out.ox = ox; out.oy = oy;
    meta.count = out.length;
    meta.mode = mode;
    meta.coreRadius = coreR;
    meta.maxLevels = maxLevels;
    return { blocks: out, meta: meta };
  }

  /**
   * Classic dissection for the whole rectangle, with focus-driven LOD.
   * @param opts {view, order, foci, radius, minPx, maxBlocks, boost}
   *   order widens the dense core and raises its ladder-level budget, so the
   *   square count grows from a few hundred to tens of thousands while the
   *   far field keeps the minimum-tile skeleton. Without a view the coarse
   *   full dissection is returned in world coordinates (Node test suite).
   */
  function staticTiling(mode, world, opts) {
    opts = opts || {};
    var order = clamp(opts.order == null ? 2 : opts.order, 0, 6);
    // The pixel floor at a centre is fixed and small: the first rendered
    // frame already shows a genuinely fine core, independent of the order.
    var minPx = opts.minPx == null ? (opts.view ? 1.6 : 120) : opts.minPx;
    var cap = opts.maxBlocks || 60000;
    var boost = opts.boost == null ? 0.7 : opts.boost;
    var lo = {
      view: opts.view, radius: opts.radius, order: order,
      maxDepth: opts.maxDepth, foci: opts.foci
    };
    var result = null;
    for (var attempt = 0; attempt < 10; attempt++) {
      // The final pass drops the cap entirely: a coarse but COMPLETE frame is
      // always preferable to holes left by an aborted subdivision.
      result = staticOnce(mode, world, lo, minPx, attempt === 9 ? Infinity : cap, boost);
      if (!result.blocks.exceeded) break;
      if (boost > 0.08) boost *= 0.72;
      else minPx *= 1.3;
    }
    result.blocks.exceeded = false;
    result.meta.order = order;
    result.meta.minPx = minPx;
    return result;
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
    focusDistance: focusDistance,
    focusWeight: focusWeight,
    minimumSkeleton: minimumSkeleton,
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
