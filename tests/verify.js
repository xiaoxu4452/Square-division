/* ==========================================================================
 * Algorithm verification suite (no external dependencies).
 * Run with:  node tests/verify.js
 *
 * Covers exact coverage / area conservation, the adjacent-different-colour
 * constraint, the strict "no small tiles far from a focus" rule, integer-grid
 * hash distribution, scale-free deep zoom (1e9x), the BigDec fixed-point
 * camera arithmetic, and the two classic reference dissections.
 * ========================================================================== */
'use strict';

const S = require('../js/squaring.js');
const BD = require('../js/bigdec.js');

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  ' + extra : ''));
  if (!cond) fail++;
};

/* ------------------------------ BigDec ------------------------------ */
ok('BigDec 0.1 + 0.2 === 0.3',
  BD.toString(BD.add(BD.from('0.1'), BD.from('0.2'))) === '0.3');
ok('BigDec 1e-30 * 1e9 === 1e-21',
  BD.toNumber(BD.mul(BD.from('1e-30'), BD.from('1e9'))) === 1e-21);
{
  let cx = BD.from(0), scale = BD.from(1);
  for (let i = 0; i < 40; i++) {
    const ax = BD.add(cx, BD.div(BD.from(137), scale));
    scale = BD.mul(scale, BD.from(1.9));
    cx = BD.add(cx, BD.sub(ax, BD.add(cx, BD.div(BD.from(137), scale))));
  }
  ok('BigDec survives 40 anchored zooms',
    isFinite(BD.toNumber(cx)) && isFinite(BD.toNumber(scale)),
    'scale=' + BD.toNumber(scale).toExponential(3));
}

/* ------------------ Integer-grid hash at tiny scales ------------------ */
{
  // At extreme zoom the local integer grid reaches ~4e9; neighbouring tiles
  // differ by exactly one integer, so the hash must never collapse.
  const base = 4_000_000_000;
  const a = S.hashGrid(base, base, 1, 7);
  const b = S.hashGrid(base + 1, base, 1, 7);
  const c = S.hashGrid(base, base + 1, 1, 7);
  ok('hashGrid separates neighbouring tiles (x)', Math.abs(a - b) > 1e-6,
    'a=' + a.toFixed(6) + ' b=' + b.toFixed(6));
  ok('hashGrid separates neighbouring tiles (y)', Math.abs(a - c) > 1e-6,
    'a=' + a.toFixed(6) + ' c=' + c.toFixed(6));
  const vals = new Set();
  for (let i = 0; i < 4096; i++) vals.add(S.hashGrid(base + i, base, 1, 7));
  ok('hashGrid 4096 consecutive coordinates stay unique', vals.size === 4096,
    'unique=' + vals.size);
}

/* ---------- Full dissection: coverage / area / adjacent colours ---------- */
{
  const w = S.buildWorld(1.4, { depth: 5, rows: 4 });
  const foci = S.defaultFoci(w, 2, 42);
  const view = {
    x0: -1, y0: -1, x1: w.gw + 1, y1: w.gh + 1, scale: 1,
    ox: w.gw / 2, oy: w.gh / 2, hw: (w.gw + 2) / 2, hh: (w.gh + 2) / 2
  };
  const localView = { x0: -view.hw, y0: -view.hh, x1: view.hw, y1: view.hh, scale: 1 };
  const opts = {
    foci, power: 2.4, maxDepth: 20,
    radius: Math.min(w.gw, w.gh) * 0.62, minPx: 1.7, maxBlocks: 100000
  };
  const t0 = Date.now();
  const blocks = S.generate(w, view, opts);
  const v = S.validate(blocks, w);
  ok('full-viewport generation stays under the LOD cap', !blocks.exceeded,
    'n=' + blocks.length + ' ms=' + (Date.now() - t0));
  ok('validate: exact area, no gaps, no overlaps', v.ok,
    'gaps=' + v.gaps + ' overlaps=' + v.overlaps + ' area=' + (v.area / v.expected).toFixed(6));

  const colors = S.colorize(blocks, null, {
    palette: 'spectrum', theme: 'dark', seed: 9, hueShift: 33, view: localView
  });
  const g = S.buildAdjacency(blocks);
  let same = 0, edges = 0;
  for (let i = 0; i < g.adj.length; i++) {
    for (const j of g.adj[i]) {
      if (j <= i) continue;
      edges++;
      if (colors[i].k === colors[j].k) same++;
    }
  }
  ok('adjacent tiles never share a palette entry', same === 0,
    'edges=' + edges + ' same=' + same);

  const hues = new Set(colors.map(c => Math.round(c.h)));
  ok('palette diversity is preserved', hues.size >= 20, 'distinctHue=' + hues.size);
  ok('muted fills: chromatic but never black / white / grey',
    colors.every(c => c.s >= 24 && c.s <= 50 && c.l >= 35 && c.l <= 74),
    'minS=' + Math.min(...colors.map(c => c.s)).toFixed(1) +
    ' minL=' + Math.min(...colors.map(c => c.l)).toFixed(1) +
    ' maxL=' + Math.max(...colors.map(c => c.l)).toFixed(1));
  const js = new Set(colors.map(c => c.j));
  ok('per-tile jitter stays unique', js.size > blocks.length * 0.9,
    'uniqueJ=' + js.size + '/' + blocks.length);
}

/* ------------- Far from a focus only macro tiles survive ------------- */
{
  const w = S.buildWorld(1.5, { depth: 8, rows: 12 });
  const foci = [{ x: w.gw / 2, y: w.gh / 2 }];
  const opts = {
    foci, power: 2.4, minSize: w.L / Math.pow(2, 30),
    radius: Math.min(w.gw, w.gh) * 0.62
  };
  const near = S.sizeField(w.gw / 2, w.gh / 2, w, opts);
  const far = S.sizeField(0, 0, w, opts);
  ok('size field: centre much finer than the far field', near < far / 1000,
    'near=' + near.toExponential(2) + ' far=' + far.toFixed(1));
  ok('size field: far field equals the macro block side L', Math.abs(far - w.L) < 1e-6,
    'L=' + w.L + ' far=' + far.toFixed(6));
}

/* --------- Deep zoom: adaptive LOD keeps a uniform subdivision --------- */
{
  const w = S.buildWorld(1.5, { depth: 8, rows: 12 });
  const foci = S.defaultFoci(w, 3, 11);
  const opts = {
    foci, power: 2.4, maxDepth: 48,
    radius: Math.min(w.gw, w.gh) * 0.62, minPx: 1.7, maxBlocks: 100000
  };
  // Camera is 1e9x inside a focus; the viewport covers a minuscule world area.
  const scale = 1e9, W = 1600, H = 900;
  const cx = foci[0].x, cy = foci[0].y;
  const hw = W / (2 * scale), hh = H / (2 * scale);
  const view = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh, scale, ox: cx, oy: cy, hw, hh };
  const localView = { x0: -hw, y0: -hh, x1: hw, y1: hh, scale };
  const t0 = Date.now();
  const blocks = S.generate(w, view, opts);
  const ms = Date.now() - t0;
  const px = blocks.map(b => b.s * scale);
  const small = Math.min(...px), large = Math.max(...px);
  ok('deep zoom 1e9 stays under the LOD cap', !blocks.exceeded,
    'n=' + blocks.length + ' ms=' + ms);
  ok('deep zoom has no large flat tiles', large < 60,
    'minPx=' + small.toFixed(2) + ' maxPx=' + large.toFixed(2));

  const colors = S.colorize(blocks, null, {
    palette: 'spectrum', theme: 'dark', seed: 5, hueShift: 90, view: localView
  });
  const g = S.buildAdjacency(blocks);
  let same = 0, edges = 0;
  for (let i = 0; i < g.adj.length; i++) for (const j of g.adj[i]) {
    if (j <= i) continue;
    edges++;
    if (colors[i].k === colors[j].k) same++;
  }
  ok('deep zoom preserves adjacent-different colours', same === 0,
    'edges=' + edges + ' same=' + same);
  const hues = new Set(colors.map(c => Math.round(c.h / 6)));
  ok('deep zoom colours do not collapse', hues.size >= 8, 'hueBuckets=' + hues.size);
  const js = new Set(colors.map(c => c.j));
  ok('deep zoom jitter does not collapse', js.size > blocks.length * 0.9,
    'uniqueJ=' + js.size + '/' + blocks.length);
}

/* ------------------------- Classic references ------------------------- */
{
  // Both classic modes must cover the WHOLE rectangle for any aspect ratio,
  // not just an inscribed 33:32 patch in the middle of the canvas.
  const ratios = [1, 1.5, 16 / 9, 0.62, 2.3, 3.7, 33 / 32];
  let allOk = true, worst = 1;
  for (const r of ratios) {
    const w = S.buildWorld(r, { depth: 8, rows: 12 });
    for (const mode of ['euclid', 'network']) {
      const st = S.staticTiling(mode, w, { minPx: 200 });
      const v = S.validate(st.blocks, w);
      if (!v.ok || st.blocks.length < 9) allOk = false;
      worst = Math.min(worst, v.area / v.expected);
    }
  }
  ok('euclid + network cover every ratio exactly', allOk,
    'ratios=' + ratios.length + ' worstArea=' + worst.toFixed(6));

  const w = S.buildWorld(1.5, { depth: 8, rows: 12 });
  const nw = S.staticTiling('network', w, { minPx: 200 });
  ok('Moron sub-network: 9 pairwise-distinct sides, 33:32',
    nw.meta.ratio === '33:32' && nw.meta.sides.length === 9 &&
    new Set(nw.meta.sides).size === 9,
    'sides=' + nw.meta.sides.slice().sort((a, b) => a - b).join(', '));
  ok('Moron side squares sum to 33x32 = 1056',
    nw.meta.sides.reduce((a, s) => a + s * s, 0) === 1056, 'sum=1056');

  // Viewport LOD: a higher subdivision order must yield more squares.
  const W = 1600, H = 900, scale = Math.min(W * 0.94 / w.gw, H * 0.94 / w.gh);
  const hw = W / (2 * scale), hh = H / (2 * scale);
  const ox = w.gw / 2, oy = w.gh / 2;
  const view = { x0: ox - hw, y0: oy - hh, x1: ox + hw, y1: oy + hh, scale, ox, oy, hw, hh };
  const low = S.staticTiling('euclid', w, { view, order: 0 }).blocks.length;
  const high = S.staticTiling('euclid', w, { view, order: 4 }).blocks.length;
  ok('subdivision order increases the square count', high > low * 4,
    'order0=' + low + ' order4=' + high);
  const dense = S.staticTiling('network', w, { view, order: 6 });
  const dv = S.validate(dense.blocks, w);
  ok('dense classic tiling still covers exactly', dv.ok,
    'n=' + dense.blocks.length + ' gaps=' + dv.gaps);
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail ? 1 : 0);
