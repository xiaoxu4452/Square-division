/* ==========================================================================
 * app.js — Full-screen infinite canvas / camera / LOD rendering / glass UI  (v2)
 *
 * Depends on: window.I18N (i18n.js), window.Squaring (squaring.js)
 * Rendering strategy:
 *   · Generate only the tiles needed by the current viewport + zoom each frame
 *     (LOD); zooming in unfolds a new subdivision level;
 *   · Tile coordinates are doubles, remapped at draw time to local coordinates
 *     (world - viewCenter) * scale to avoid precision loss when summing large values;
 *   · Tiered quality rendering (radial gradient on large tiles / same-hue stroke
 *     on medium tiles / no stroke on small tiles), painted progressively across
 *     frames so tens of thousands of tiles never block in a single pass;
 *   · During pan/zoom, the previous frame's snapshot serves as an affine preview;
 *     an exact redraw runs once motion stops.
 * ========================================================================== */
(function () {
  'use strict';

  var T = window.I18N, S = window.Squaring, BD = window.BigDec;
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var TAU = Math.PI * 2;

  var canvas = $('stage');
  var ctx = canvas.getContext('2d', { alpha: false });

  var state = {
    theme: 'dark', lang: 'zh', W: 1, H: 1, dpr: 1,
    phase: 'select', rectN: null, drag: null, pointer: null,
    view: { cx: BD.from(0), cy: BD.from(0), cxHi: 0, cyHi: 0, offX: 0, offY: 0, scale: 1, fitScale: 1 },
    world: null, mode: 'quad', foci: [],
    staticBlocks: null, staticMeta: null,
    cache: new Map(), blocks: [], colors: [], drawOrder: [], meta: {},
    paint: {}, snapshot: null, snapView: null,
    renderQueue: null, raf: 0, dirty: true, anim: null,
    hover: -1, hoverRect: null, wheelTimer: 0,
    pinch: null, touches: new Map(),
    consoleOpen: true, modalOpen: false,
    pending: false, genToken: 0, parallelDisabled: false
  };

  /* ------------------------------ Core ------------------------------ */
  function readStore(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function writeStore(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function refreshPaint() {
    var dark = state.theme === 'dark';
    state.paint = {
      stage: cssVar('--stage'),
      grid: dark ? 'rgba(125,165,225,.075)' : 'rgba(35,85,155,.085)',
      gridStrong: dark ? 'rgba(125,165,225,.15)' : 'rgba(35,85,155,.16)',
      accent: cssVar('--accent'), accent2: cssVar('--accent-2'),
      text: cssVar('--text'), faint: cssVar('--faint')
    };
  }

  var toastTimer = 0;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function fmtSide(v) {
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    if (v >= 10) return (Math.round(v * 10) / 10).toString();
    if (v >= 0.1) return v.toFixed(2);
    return v.toExponential(1);
  }
  /* Seed hygiene: every hash in the kernel mixes the seed with Math.imul, so
     the value is folded through ToInt32. Anything outside the signed 32-bit
     range (1e300, "999999999999999999999", Infinity) would collapse to 0 and
     make every tile share one colour/jitter value. Keep the input inside
     [1, 2^31 - 2] instead of silently degrading. */
  var SEED_MIN = 1;
  var SEED_MAX = 2147483646;
  function clampSeed(v) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return SEED_MIN;
    return Math.min(SEED_MAX, Math.max(SEED_MIN, n));
  }
  function seed() { return clampSeed($('seed').value); }

  /** Rewrite the field when the typed value is out of range or not a number. */
  function normalizeSeedField() {
    var el = $('seed'), v = clampSeed(el.value);
    if (el.value !== String(v)) el.value = v;
    return v;
  }

  /* ------------------ Camera: BigDec high-precision coordinates ------------------ */
  function scaleBD() { return BD.from(state.view.scale); }

  /** Split into a double main value + a high-precision residual: rendering takes the fast double path while positions stay exact */
  function syncView() {
    var v = state.view;
    v.cxHi = BD.toNumber(v.cx);
    v.cyHi = BD.toNumber(v.cy);
    var s = scaleBD();
    v.offX = BD.toNumber(BD.mul(BD.sub(v.cx, BD.from(v.cxHi)), s));
    v.offY = BD.toNumber(BD.mul(BD.sub(v.cy, BD.from(v.cyHi)), s));
  }
  function screenX(wx) {
    var v = state.view;
    return (wx - v.cxHi) * v.scale + state.W / 2 - v.offX;
  }
  function screenY(wy) {
    var v = state.view;
    return (wy - v.cyHi) * v.scale + state.H / 2 - v.offY;
  }
  function viewport() {
    var v = state.view, s = scaleBD();
    var hw = BD.div(BD.from(state.W / 2), s), hh = BD.div(BD.from(state.H / 2), s);
    return {
      x0: BD.toNumber(BD.sub(v.cx, hw)), y0: BD.toNumber(BD.sub(v.cy, hh)),
      x1: BD.toNumber(BD.add(v.cx, hw)), y1: BD.toNumber(BD.add(v.cy, hh)),
      ox: v.cxHi, oy: v.cyHi, hw: BD.toNumber(hw), hh: BD.toNumber(hh),
      scale: v.scale
    };
  }
  function toWorld(px, py) {
    var v = state.view;
    return {
      x: v.cxHi + (px - state.W / 2) / v.scale + v.offX / v.scale,
      y: v.cyHi + (py - state.H / 2) / v.scale + v.offY / v.scale
    };
  }
  function toScreen(wx, wy) { return { x: screenX(wx), y: screenY(wy) }; }

  /* The world is finite, so the camera is finite too: zoom may go arbitrarily
     deep, but the viewport can never be panned off the rectangle. When the
     world is smaller than the viewport on an axis (possible once the canvas is
     expanded past the fitted frame) that axis is locked to the centre, which is
     exactly what a map does. */
  var ZOOM_OUT_FACTOR = 25;         // the canvas may expand to 25x the fitted span

  function clampCamera() {
    var w = state.world; if (!w) return false;
    var v = state.view, hit = false;
    var halfW = state.W / (2 * v.scale), halfH = state.H / (2 * v.scale);
    var midX = BD.from(w.gw / 2), midY = BD.from(w.gh / 2);

    if (w.gw <= halfW * 2) {
      if (BD.cmp(v.cx, midX) !== 0) { v.cx = midX; hit = true; }
    } else {
      var loX = BD.from(halfW), hiX = BD.sub(BD.from(w.gw), BD.from(halfW));
      if (BD.cmp(v.cx, loX) < 0) { v.cx = loX; hit = true; }
      else if (BD.cmp(v.cx, hiX) > 0) { v.cx = hiX; hit = true; }
    }
    if (w.gh <= halfH * 2) {
      if (BD.cmp(v.cy, midY) !== 0) { v.cy = midY; hit = true; }
    } else {
      var loY = BD.from(halfH), hiY = BD.sub(BD.from(w.gh), BD.from(halfH));
      if (BD.cmp(v.cy, loY) < 0) { v.cy = loY; hit = true; }
      else if (BD.cmp(v.cy, hiY) > 0) { v.cy = hiY; hit = true; }
    }
    return hit;
  }

  function minScale() {
    var f = state.view.fitScale;
    return f > 0 ? f / ZOOM_OUT_FACTOR : 1e-5;
  }

  function fitScaleFor(w) {
    // Portrait phones have very little horizontal room: use almost the full
    // width so the tiling is not reduced to a thin band on a tall screen.
    var margin = (state.W <= 640 && state.H > state.W) ? 0.99 : 0.94;
    return Math.min(state.W * margin / w.gw, state.H * margin / w.gh);
  }

  function fitView() {
    var w = state.world; if (!w) return;
    var s = fitScaleFor(w);
    var v = state.view;
    v.cx = BD.from(w.gw / 2); v.cy = BD.from(w.gh / 2);
    v.scale = s; v.fitScale = s;
    syncView();
    updateZoomLabel();
  }

  /** Anchored zoom: the world point is solved exactly with BigDec, so even 10^9x zoom does not drift */
  function zoomAt(factor, px, py) {
    var v = state.view;
    px = px == null ? state.W / 2 : px;
    py = py == null ? state.H / 2 : py;
    var s1 = scaleBD(), dx = BD.from(px - state.W / 2), dy = BD.from(py - state.H / 2);
    var ax = BD.add(v.cx, BD.div(dx, s1)), ay = BD.add(v.cy, BD.div(dy, s1));
    v.scale = clamp(v.scale * factor, minScale(), 1e12);
    var s2 = scaleBD();
    var bx = BD.add(v.cx, BD.div(dx, s2)), by = BD.add(v.cy, BD.div(dy, s2));
    v.cx = BD.add(v.cx, BD.sub(ax, bx));
    v.cy = BD.add(v.cy, BD.sub(ay, by));
    clampCamera();
    syncView();
    updateZoomLabel();
  }
  function zoomBy(factor, px, py) { if (state.phase === 'result') zoomAt(factor, px, py); }
  function updateZoomLabel() {
    var r = state.view.scale / (state.view.fitScale || 1);
    var txt;
    if (r < 1) txt = (r * 100).toFixed(r < 0.1 ? 1 : 0) + '%';
    else if (r < 10) txt = (r * 100).toFixed(0) + '%';
    else if (r < 1000) txt = r.toFixed(0) + '×';
    else txt = r.toExponential(1) + '×';
    $('zoomLabel').textContent = txt;
  }

  /* ---------------------------- Compute ---------------------------- */
  function runCompute(o) {
    o = o || {};
    var ratio = o.ratio;
    if (!ratio && state.rectN) ratio = state.rectN.w / state.rectN.h;
    if (!ratio) { toast(T.t('emptyWarn')); return; }

    var oldWorld = state.world;
    var world = S.buildWorld(ratio, { depth: +$('detail').value, rows: 12 });
    state.world = world;
    state.mode = $('algoMode').value;
    // User-placed dense centres survive a mode switch or a redrawn rectangle;
    // they are rescaled into the new world instead of being reset.
    if (o.keepFoci !== false && oldWorld && state.foci.length && state.phase === 'result') {
      state.foci = state.foci.map(function (f) {
        return {
          x: clamp(f.x / oldWorld.gw * world.gw, 0, world.gw),
          y: clamp(f.y / oldWorld.gh * world.gh, 0, world.gh)
        };
      });
    } else {
      state.foci = S.defaultFoci(world, +$('centers').value, seed());
    }
    state.cache.clear();
    // Classic tilings are generated per frame (viewport-driven LOD), so no
    // static block list has to be precomputed or kept in memory.
    state.staticBlocks = null;
    state.staticMeta = null;
    state.phase = 'result';
    state.hover = -1; state.hoverRect = null;
    state.snapshot = null; state.renderQueue = null;
    fitView();
    hideHint();
    $('btnCompute').classList.remove('pulse');
    updateAlgoHint();

    state.anim = ($('animate').checked && state.mode === 'quad' && !o.noAnim)
      ? { start: performance.now(), duration: 1000 } : null;
    requestRender(true);
  }

  function refreshResult() {
    if (state.phase !== 'result') return;
    state.snapshot = null;
    state.hover = -1; state.hoverRect = null;
    state.anim = null;
    requestRender(true);
  }

  /** Parameters shared by the synchronous kernel and the parallel workers. */
  function frameOpts(animating) {
    var w = state.world, minPx = 1.7;
    if (animating) {
      var p = clamp((performance.now() - state.anim.start) / state.anim.duration, 0, 1);
      minPx = 1.7 + 300 * Math.pow(1 - p, 2.2);
    }
    return {
      foci: state.foci,
      power: +$('power').value,
      maxDepth: 48,
      radius: Math.min(w.gw, w.gh) * (+$('radius').value),
      minPx: minPx,
      boost: clamp(0.5 + (+$('order').value) * 0.04, 0, 0.85),
      maxBlocks: animating ? 14000 : 100000
    };
  }

  function regenerate(prepared, view, options) {
    if (state.phase !== 'result' || !state.world) return;
    var t0 = performance.now();
    var w = state.world, v = view || viewport(), animating = !!state.anim;
    var opts = options || frameOpts(animating);

    // Quadtree tiles are always expressed in viewport-local coordinates.
    // The first frame uses the synchronous C++/WASM kernel; later frames are
    // computed by the worker pool and passed in as `prepared`.
    var blocks;
    if (state.mode === 'quad') {
      blocks = prepared || (window.WasmEngine && WasmEngine.generateSync(w, v, opts))
        || S.generate(w, v, opts);
    } else {
      // Euclidean / Smith-network tilings share the same user-defined dense
      // centres: ladder refinements are confined to a core around each
      // centre while the far field keeps its minimum-tile skeleton.
      var st = S.staticTiling(state.mode, w, {
        view: v, order: +$('order').value, foci: state.foci, radius: opts.radius,
        maxDepth: 22, maxBlocks: 60000
      });
      blocks = st.blocks;
      state.staticMeta = st.meta;
    }
    var localView = { x0: -v.hw, y0: -v.hh, x1: v.hw, y1: v.hh, scale: v.scale };
    var colors = S.colorize(blocks, state.cache, {
      palette: $('palette').value, theme: state.theme, seed: seed(),
      hueShift: seed() % 360, view: localView
    });

    var min = Infinity, max = 0, lmin = Infinity, lmax = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.s < min) min = b.s;
      if (b.s > max) max = b.s;
      if ((b.depth || 0) < lmin) lmin = b.depth || 0;
      if ((b.depth || 0) > lmax) lmax = b.depth || 0;
    }
    state.blocks = blocks;
    state.colors = colors;
    state.drawOrder = blocks.map(function (_, i2) { return i2; })
      .sort(function (a, b2) { return blocks[b2].s - blocks[a].s || a - b2; });
    state.meta = {
      count: blocks.length, min: blocks.length ? min : 0, max: max,
      lmin: blocks.length ? lmin : 0, lmax: lmax,
      capped: !!blocks.exceeded
    };
    updateHUD(performance.now() - t0);
  }

  /* --------------------------- Rendering --------------------------- */
  function requestRender(full) {
    state.dirty = true;
    // An in-flight parallel frame was computed for the previous camera.
    if (state.pending) state.genToken++;
    if (full) { state.renderQueue = null; state.snapshot = null; }
    schedule();
  }
  function schedule() { if (!state.raf) state.raf = requestAnimationFrame(loop); }

  function loop(ts) {
    state.raf = 0;
    if (state.modalOpen) return;

    if (state.anim) {
      if (ts - state.anim.start >= state.anim.duration) state.anim = null;
      state.dirty = true;
    }
    if (state.phase === 'select') {
      paintSelect();
      state.dirty = false;
      return;
    }
    if (state.pending) return;   // a parallel frame owns the canvas; keep current pixels

    if (state.dirty) {
      state.dirty = false;
      // First frame: synchronous C++/WASM so an image appears immediately.
      // Later frames: dispatch independent quadtree regions to the worker pool.
      var parallel = state.mode === 'quad' && !state.anim &&
        state.blocks.length > 0 && !state.parallelDisabled &&
        window.WasmEngine && WasmEngine.threads() > 0;
      if (parallel) {
        var token = ++state.genToken, pv = viewport(), po = frameOpts(false);
        state.pending = true;
        Promise.resolve(WasmEngine.generateAsync(state.world, pv, po)).then(function (blocks) {
          state.pending = false;
          if (token !== state.genToken) { schedule(); return; }
          if (!blocks) {
            // Native cap exceeded: render this frame with the adaptive JS
            // generator and stay on the synchronous path afterwards.
            state.parallelDisabled = true;
            regenerate(null, pv, po);
          } else {
            regenerate(blocks, pv, po);
          }
          paintBackground();
          paintRange(0, state.drawOrder.length);
          finishPaint();
          state.renderQueue = null;
          if (state.dirty || state.anim) schedule();
        }, function () {
          state.pending = false;
          state.genToken++;
          state.parallelDisabled = true;
          state.dirty = true;
          schedule();
        });
        return;
      }
      regenerate();
      paintBackground();
      // Full single-pass draw: prevents unpainted regions in any intermediate frame (relaxed time budget)
      paintRange(0, state.drawOrder.length);
      finishPaint();
      state.renderQueue = null;
    }
    if (state.dirty || state.anim) schedule();
  }

  function paintBackground() {
    var p = state.paint, W = state.W, H = state.H;
    ctx.fillStyle = p.stage;
    ctx.fillRect(0, 0, W, H);
    if (!$('showGrid').checked) return;
    var v = viewport();
    var target = 92 / v.scale;
    var step = Math.pow(2, Math.ceil(Math.log(Math.max(target, 1e-9)) / Math.LN2));
    if (!isFinite(step) || step <= 0) return;
    var fine = step / 4;
    // Two-level adaptive world grid
    drawGridLines(fine, p.grid, 0.6);
    drawGridLines(step, p.gridStrong, 1.0);
  }

  function drawGridLines(step, color, width) {
    var v = viewport(), W = state.W, H = state.H;
    var x0 = Math.floor(v.x0 / step) * step, y0 = Math.floor(v.y0 / step) * step;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    var count = 0;
    for (var x = x0; x <= v.x1 && count < 600; x += step, count++) {
      var sx = screenX(x);
      ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    count = 0;
    for (var y = y0; y <= v.y1 && count < 600; y += step, count++) {
      var sy = screenY(y);
      ctx.moveTo(0, sy); ctx.lineTo(W, sy);
    }
    ctx.stroke(); ctx.restore();
  }

  function paintRange(from, to) {
    var v = state.view, W = state.W, H = state.H;
    var blocks = state.blocks, colors = state.colors, order = state.drawOrder;
    var labels = $('showLabels').checked;
    for (var k = from; k < to; k++) {
      var i = order[k];
      if (i == null) continue;
      var b = blocks[i], col = colors[i];
      if (!b || !col) continue;
      // Local coordinates: sx = lx * scale + centre, with the BigDec residual
      // applied. Avoids catastrophic cancellation at extreme zoom levels.
      var sx = b.x * v.scale + W / 2 - v.offX;
      var sy = b.y * v.scale + H / 2 - v.offY;
      var ps = b.s * v.scale;
      if (ps <= 0 || sx > W + 2 || sy > H + 2 || sx + ps < -2 || sy + ps < -2) continue;

      // Reuse the integer-grid hash from the colouring stage: even at tiny scales neighbouring tiles will not collide into the same jitter value
      // Muted fill: only a few degrees of hue jitter, no fluorescent chroma,
      // no radial shading. The tile itself stays a flat, quiet colour.
      var j = col.j == null ? 0.5 : col.j;
      var h = (col.h + (j - 0.5) * 5 + 360) % 360;
      var sat = clamp(col.s + (j - 0.5) * 4, 22, 48);
      var l = clamp(col.l + (j - 0.5) * 3, 36, 72);
      ctx.fillStyle = 'hsl(' + h.toFixed(1) + ',' + sat.toFixed(1) + '%,' + l.toFixed(1) + '%)';
      // +0.45px removes sub-pixel seams (without visible overlap)
      ctx.fillRect(sx, sy, ps + 0.45, ps + 0.45);

      if (ps > 9) {
        ctx.strokeStyle = 'hsla(' + h + ',' + sat + '%,' + Math.max(18, l - 14) + '%,.42)';
        ctx.lineWidth = 0.7;
        ctx.strokeRect(sx + 0.35, sy + 0.35, Math.max(0, ps - 0.7), Math.max(0, ps - 0.7));
      }
      if (ps > 44) {
        // A barely visible bevel keeps large tiles from looking like flat ink.
        ctx.fillStyle = 'hsla(' + h + ',' + sat + '%,' + Math.min(88, l + 9) + '%,.16)';
        var e = Math.min(1.2, ps * 0.02);
        ctx.fillRect(sx, sy, ps, e);
        ctx.fillRect(sx, sy, e, ps);
      }
      if (labels && ps > 46) {
        var label = b.label != null ? String(b.label) : fmtSide(b.s);
        var fs = clamp(ps * 0.19, 10, 26);
        ctx.font = '700 ' + fs.toFixed(0) + 'px ui-monospace, Consolas, monospace';
        ctx.fillStyle = 'hsla(' + h + ',' + sat + '%,' + (l > 54 ? Math.max(12, l - 44) : Math.min(94, l + 44)) + '%,.92)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, sx + ps / 2, sy + ps / 2);
      }
    }
  }

  function finishPaint() {
    var w = state.world, v = state.view;
    if (!w) return;
    // A single restrained stroke marks the world boundary.
    var a = toScreen(0, 0), b2 = toScreen(w.gw, w.gh);
    ctx.save();
    ctx.strokeStyle = state.paint.accent; ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(a.x, a.y, b2.x - a.x, b2.y - a.y);
    ctx.restore();

    // The snapshot excludes the centre markers, so dragging a marker can
    // repaint the overlay without leaving ghost copies behind.
    saveSnapshot();
    if ($('showFoci').checked) paintFoci();
    if (state.drag) paintSelectFrame(normDrag(state.drag));
  }

  function paintFoci() {
    state.foci.forEach(function (f, i) {
      var p = toScreen(f.x, f.y);
      if (p.x < -40 || p.y < -40 || p.x > state.W + 40 || p.y > state.H + 40) return;
      ctx.save();
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
      g.addColorStop(0, 'rgba(146,178,205,.28)');
      g.addColorStop(1, 'rgba(146,178,205,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, TAU); ctx.fill();
      ctx.strokeStyle = state.paint.accent; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = state.paint.accent; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, TAU); ctx.fill();
      ctx.font = '700 10px ui-monospace, Consolas, monospace';
      ctx.fillStyle = state.paint.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x + 12, p.y - 9);
      ctx.restore();
    });
  }

  function saveSnapshot() {
    if (!state.snapshot) state.snapshot = document.createElement('canvas');
    var s = state.snapshot;
    if (s.width !== canvas.width || s.height !== canvas.height) {
      s.width = canvas.width; s.height = canvas.height;
    }
    var sc = s.getContext('2d');
    sc.drawImage(canvas, 0, 0);
    state.snapView = {
      cxD: BD.toNumber(state.view.cx), cyD: BD.toNumber(state.view.cy),
      scale: state.view.scale
    };
  }

  /** During pan/zoom: affine preview from the snapshot avoids regenerating tens of thousands of tiles every frame */
  function preview() {
    var s = state.snapshot, sv = state.snapView;
    if (!s || !sv || state.phase !== 'result') {
      // While the worker pool computes the next frame there may be no
      // snapshot; keep the existing pixels instead of clearing the canvas.
      if (state.phase === 'result' && state.blocks.length) return;
      paintSelect();
      return;
    }
    var v = state.view, ratio = v.scale / sv.scale;
    var tx = state.W / 2 - ratio * state.W / 2 + (sv.cxD - BD.toNumber(v.cx)) * v.scale;
    var ty = state.H / 2 - ratio * state.H / 2 + (sv.cyD - BD.toNumber(v.cy)) * v.scale;
    ctx.fillStyle = state.paint.stage;
    ctx.fillRect(0, 0, state.W, state.H);
    ctx.drawImage(s, tx, ty, state.W * ratio, state.H * ratio);
  }

  /* --------------------------- Selection state --------------------------- */
  function paintSelect() {
    var W = state.W, H = state.H;
    ctx.fillStyle = state.paint.stage;
    ctx.fillRect(0, 0, W, H);
    if ($('showGrid').checked) {
      ctx.save();
      ctx.strokeStyle = state.paint.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (var x = 0; x < W; x += 64) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); }
      for (var y = 0; y < H; y += 64) { ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); }
      ctx.stroke(); ctx.restore();
    }
    var r = state.drag ? normDrag(state.drag) : state.rectN;
    if (r) paintSelectFrame(r);
  }

  function paintSelectFrame(r) {
    ctx.save();
    ctx.fillStyle = state.theme === 'dark' ? 'rgba(146,178,205,.09)' : 'rgba(69,117,155,.09)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = state.paint.accent; ctx.lineWidth = 1.6;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    ctx.fillStyle = state.paint.accent;
    [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
      .forEach(function (q) { ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6); });
    var txt = T.t('dragSize', { w: Math.round(r.w), h: Math.round(r.h) });
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    var tw = ctx.measureText(txt).width;
    var bx = clamp(r.x + r.w / 2 - (tw + 16) / 2, 6, state.W - tw - 22);
    var by = r.y > 34 ? r.y - 26 : r.y + r.h + 6;
    ctx.fillStyle = state.theme === 'dark' ? 'rgba(13,19,32,.9)' : 'rgba(255,255,255,.92)';
    ctx.fillRect(bx, by, tw + 16, 20);
    ctx.fillStyle = state.paint.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + 8, by + 10);
    ctx.restore();
  }

  function normDrag(d) {
    return { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
  }

  /* --------------------------- HUD --------------------------- */
  function emptyHUD() {
    ['statRatio', 'statBlocks', 'statMin', 'statMax', 'statCenters', 'statCoverage', 'statTime']
      .forEach(function (id) { $(id).textContent = T.t('statEmpty'); });
    $('metaLine').textContent = '';
    $('zoomLabel').textContent = '—';
  }
  function updateHUD(ms) {
    var w = state.world, m = state.meta;
    if (!w) { emptyHUD(); return; }
    m.ms = ms;
    $('statRatio').textContent = w.m + ':' + w.n;
    $('statBlocks').textContent = m.count.toLocaleString('en-US');
    $('statMin').textContent = fmtSide(m.min) + ' u';
    $('statMax').textContent = fmtSide(m.max) + ' u';
    $('statCenters').textContent = String(state.foci.length);
    $('statCoverage').textContent = '100%';
    $('statTime').textContent = ms.toFixed(0) + ' ms';
    var line;
    if (state.mode === 'euclid' && state.staticMeta) {
      line = T.t('metaEuclid', {
        cf: state.staticMeta.cf.join(', '), steps: state.staticMeta.cf.length,
        count: m.count.toLocaleString('en-US'), order: state.staticMeta.order
      });
    } else if (state.mode === 'network' && state.staticMeta) {
      line = T.t('metaNetwork', {
        ratio: state.staticMeta.ratio, steps: state.staticMeta.steps,
        sides: state.staticMeta.sides.slice().sort(function (a, b) { return a - b; }).join(', '),
        cells: state.staticMeta.cells,
        count: m.count.toLocaleString('en-US'), order: state.staticMeta.order
      });
    } else {
      line = T.t('metaQuad', {
        gw: w.gw, gh: w.gh, d: w.depth, lmin: m.lmin, lmax: m.lmax,
        count: m.count, capped: m.capped ? T.t('capped') : ''
      });
    }
    if (state.mode === 'quad') {
      line += ' · ' + (window.WasmEngine ? WasmEngine.status() : 'JS') + ' kernel';
    }
    $('metaLine').textContent = line;
  }

  function updateAlgoHint() {
    var key = 'algoHint' + cap(state.mode);
    var el = $('algoHint');
    el.setAttribute('data-i18n', key);
    el.textContent = T.t(key);
    // Subdivision order is meaningful in every mode: it widens the dense
    // core / relaxes the centre pixel floor instead of being mode-specific.
    $('order').disabled = false;
  }

  function hideHint() { $('stageHint').classList.add('is-hidden'); }
  function showHint() { $('stageHint').classList.remove('is-hidden'); }

  /* --------------------------- Hover --------------------------- */
  function handleHover(p) {
    var tip = $('tooltip');
    if (state.phase !== 'result' || !state.snapshot || state.renderQueue || state.pointer || state.anim) {
      tip.hidden = true; return;
    }
    var vs = state.view;
    // Hit-test in the same viewport-local space used by the quadtree.
    var lx = (p.x - state.W / 2 + vs.offX) / vs.scale;
    var ly = (p.y - state.H / 2 + vs.offY) / vs.scale;
    var found = -1, bs = state.blocks;
    for (var i = bs.length - 1; i >= 0; i--) {
      var b = bs[i];
      if (lx >= b.x && lx < b.x + b.s && ly >= b.y && ly < b.y + b.s) { found = i; break; }
    }
    // Restore the previous highlight locally from the snapshot
    if (state.hoverRect) {
      var r0 = state.hoverRect, d = state.dpr;
      ctx.drawImage(state.snapshot, (r0.x - 3) * d, (r0.y - 3) * d, (r0.w + 6) * d, (r0.h + 6) * d,
        r0.x - 3, r0.y - 3, r0.w + 6, r0.h + 6);
    }
    state.hover = found; state.hoverRect = null;
    if (found < 0) { tip.hidden = true; canvas.style.cursor = state.phase === 'result' ? 'grab' : 'crosshair'; return; }
    var q = bs[found];
    var a = { x: q.x * vs.scale + state.W / 2 - vs.offX, y: q.y * vs.scale + state.H / 2 - vs.offY };
    var ps = q.s * vs.scale;
    ctx.save();
    ctx.strokeStyle = state.paint.accent; ctx.lineWidth = 1.6;
    ctx.strokeRect(a.x + 1, a.y + 1, Math.max(1, ps - 2), Math.max(1, ps - 2));
    ctx.restore();
    state.hoverRect = { x: a.x, y: a.y, w: ps, h: ps };

    var html = '<b>#' + (found + 1) + '</b> · ' + T.t('ttEdge') + ' ' + fmtSide(q.s) + ' u';
    html += '<br>' + T.t('ttArea') + ' ' + fmtSide(q.s * q.s) + ' u²';
    html += '<br>' + T.t('ttLevel') + ' ' + (q.depth || 0);
    html += '<br><span style="opacity:.62">' + T.t('clickHint') + '</span>';
    tip.innerHTML = html;
    tip.style.left = clamp(p.x + 15, 8, state.W - 175) + 'px';
    tip.style.top = clamp(p.y + 15, 8, state.H - 100) + 'px';
    tip.hidden = false;
  }

  /* --------------------------- Export --------------------------- */
  function exportPNG() {
    if (state.phase !== 'result') { toast(T.t('noResult')); return; }
    // If progressive drawing is unfinished, finish the remaining batches synchronously
    if (state.renderQueue) {
      paintRange(state.renderQueue.idx, state.drawOrder.length);
      state.renderQueue = null;
      finishPaint();
    } else if (state.dirty) { regenerate(); paintBackground(); paintRange(0, state.drawOrder.length); finishPaint(); }
    var a = document.createElement('a');
    a.download = T.t('exportName') + '-' + state.mode + '-' + Date.now() + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast(T.t('saved'));
  }

  /* --------------------------- Size / theme / language --------------------------- */
  function resize() {
    // Keep the zoom relative to the frame when the viewport changes: a frame
    // that was fitted stays fitted, an expanded canvas stays expanded, and a
    // zoomed-in frame keeps its absolute magnification.
    var wasFit = state.view.fitScale > 0 &&
                 Math.abs(state.view.scale - state.view.fitScale) < state.view.fitScale * 0.002;
    state.W = Math.max(1, window.innerWidth);
    state.H = Math.max(1, window.innerHeight);
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.W * state.dpr);
    canvas.height = Math.round(state.H * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.snapshot = null;
    if (state.world && state.phase === 'result') {
      var f = fitScaleFor(state.world);
      state.view.fitScale = f;
      state.view.scale = wasFit ? f : Math.max(state.view.scale, f / ZOOM_OUT_FACTOR);
      clampCamera();
      syncView();
      updateZoomLabel();
    }
    requestRender(true);
  }

  /* The essay is a self-contained bilingual document rendered in an iframe;
     language and theme are passed through the query string so it also works
     from file:// without cross-origin messaging. */
  function syncEssay() {
    var f = $('essayFrame');
    if (!f) return;
    var src = 'essay.' + (state.lang === 'en' ? 'en' : 'zh') + '.html?theme=' + state.theme;
    if (f.getAttribute('src') !== src) f.setAttribute('src', src);
  }
  function setTheme(v) {
    state.theme = v;
    document.documentElement.dataset.theme = v;
    writeStore('sqr.theme', v);
    refreshPaint();
    state.cache.clear();
    requestRender(true);
    if (state.modalOpen) syncEssay();
  }
  function setLang(v) {
    T.setLang(v);
    writeStore('sqr.lang', v);
    state.lang = v;
    $('langZh').classList.toggle('is-active', v === 'zh');
    $('langEn').classList.toggle('is-active', v === 'en');
    if (state.modalOpen) syncEssay();
  }

  function toggleConsole(force) {
    state.consoleOpen = force == null ? !state.consoleOpen : force;
    $('console').classList.toggle('is-collapsed', !state.consoleOpen);
    $('btnConsole').classList.toggle('is-active', state.consoleOpen);
    // On phones the expanded console covers the HUD; hide it to avoid overlap.
    document.body.classList.toggle('console-open', state.consoleOpen);
  }
  function openModal() {
    // Finish the current frame (including progressive drawing) before opening the explainer, so the background pattern is complete
    if (state.phase === 'result') {
      if (state.dirty) { state.dirty = false; regenerate(); paintBackground(); }
      if (state.renderQueue) {
        paintRange(state.renderQueue.idx, state.drawOrder.length);
        state.renderQueue = null;
      }
      finishPaint();
    }
    $('knowledge').hidden = false; state.modalOpen = true;
    syncEssay();
  }
  function closeModal() {
    $('knowledge').hidden = true; state.modalOpen = false;
    schedule();
  }

  function setRangeFill(el) {
    var min = +el.min, max = +el.max, pct = ((+el.value - min) / (max - min)) * 100;
    el.style.setProperty('--fill', pct.toFixed(1) + '%');
  }
  function syncCentersSlider() {
    $('centers').value = clamp(state.foci.length, 1, 6);
    $('centersVal').textContent = state.foci.length;
    setRangeFill($('centers'));
  }

  /* --------------------------- Events --------------------------- */
  function point(e) { return { x: e.clientX, y: e.clientY }; }

  /** Index of the dense centre whose marker is within r pixels of p, or -1. */
  function nearestFocus(p, r) {
    if (state.phase !== 'result' || !state.world) return -1;
    var best = r * r, hit = -1;
    state.foci.forEach(function (f, i) {
      var s = toScreen(f.x, f.y), dx = s.x - p.x, dy = s.y - p.y;
      var d = dx * dx + dy * dy;
      if (d <= best) { best = d; hit = i; }
    });
    return hit;
  }

  function bind() {
    $('themeToggle').addEventListener('click', function () { setTheme(state.theme === 'dark' ? 'light' : 'dark'); });
    $('langZh').addEventListener('click', function () { setLang('zh'); });
    $('langEn').addEventListener('click', function () { setLang('en'); });
    $('btnConsole').addEventListener('click', function () { toggleConsole(); });
    $('consoleCollapse').addEventListener('click', function () { toggleConsole(false); });
    $('btnKnowledge').addEventListener('click', openModal);
    $('modalClose').addEventListener('click', closeModal);
    $('modalBackdrop').addEventListener('click', closeModal);

    $('algoMode').addEventListener('change', function () {
      if (this.value === 'network') $('showLabels').checked = true;
      state.mode = this.value;
      updateAlgoHint();
      if (state.phase === 'result' && state.world) runCompute({ ratio: state.world.srcRatio });
      else $('btnCompute').classList.add('pulse');
    });

    var reparamTimer = 0;
    function reparam(rebuild) {
      clearTimeout(reparamTimer);
      reparamTimer = setTimeout(function () {
        if (rebuild) {
          if (state.phase === 'result' && state.world) runCompute({ ratio: state.world.srcRatio, noAnim: true });
        } else refreshResult();
      }, 70);
    }
    ['centers', 'power', 'radius', 'detail', 'order', 'palette', 'seed'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        if (id === 'centers') $('centersVal').textContent = this.value;
        if (id === 'power') $('powerVal').textContent = (+this.value).toFixed(1);
        if (id === 'radius') $('radiusVal').textContent = (+this.value).toFixed(2);
        if (id === 'detail') $('detailVal').textContent = this.value;
        if (id === 'order') $('orderVal').textContent = this.value;
        if (id === 'centers' || id === 'palette' || id === 'seed') state.cache.clear();
        if (id === 'centers' && state.world) {
          state.foci = S.defaultFoci(state.world, +this.value, seed());
        }
        if (this.type === 'range') setRangeFill(this);
        reparam(id === 'detail');
      });
    });
    ['showGrid', 'animate', 'showLabels', 'showFoci'].forEach(function (id) {
      $(id).addEventListener('change', function () { requestRender(true); });
    });
    $('reseed').addEventListener('click', function () {
      $('seed').value = Math.floor(Math.random() * 900000) + 1000;
      state.cache.clear(); refreshResult();
    });
    // Out-of-range or malformed seeds are rewritten on commit/blur so the
    // field always shows the value that is actually used. Regeneration is
    // already queued by the input handler above, so this stays cheap.
    $('seed').addEventListener('change', normalizeSeedField);

    $('ratioChips').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ratio]');
      if (!b) return;
      runCompute({ ratio: parseFloat(b.getAttribute('data-ratio')) });
    });

    $('btnCompute').addEventListener('click', function () { runCompute(); });
    $('btnRedraw').addEventListener('click', redraw);
    $('btnClear').addEventListener('click', clearAll);
    $('btnFit').addEventListener('click', function () { if (state.phase === 'result') { fitView(); requestRender(true); } });
    $('btnRandom').addEventListener('click', function () { runCompute({ ratio: 0.62 + Math.random() * 1.3 }); });
    $('btnExport').addEventListener('click', exportPNG);
    $('zoomIn').addEventListener('click', function () { zoomBy(1.6); preview(); requestRender(true); });
    $('zoomOut').addEventListener('click', function () { zoomBy(1 / 1.6); preview(); requestRender(true); });
    $('zoomFit').addEventListener('click', function () { fitView(); requestRender(true); });

    /* Pointer handling: one finger draws/pans, two fingers pinch-zoom.
       Camera maths stays in BigDec so deep zoom never drifts on touch. */
    canvas.addEventListener('pointerdown', function (e) {
      if (state.modalOpen || (e.pointerType === 'mouse' && e.button !== 0)) return;
      canvas.setPointerCapture(e.pointerId);
      var p = point(e);
      state.touches.set(e.pointerId, p);
      if (state.touches.size === 2) {
        var q = Array.from(state.touches.values());
        state.pinch = {
          dist: Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y),
          cx: (q[0].x + q[1].x) / 2, cy: (q[0].y + q[1].y) / 2
        };
        // A second finger cancels any in-flight draw/pan gesture.
        state.pointer = null; state.drag = null;
        $('tooltip').hidden = true;
        return;
      }
      if (state.touches.size > 2) return;
      // Dragging a marker repositions a dense centre in all three modes.
      if (state.phase === 'result' && !e.shiftKey && $('showFoci').checked) {
        var hit = nearestFocus(p, 16);
        if (hit >= 0) {
          state.pointer = { x0: p.x, y0: p.y, mode: 'focus', moved: false, focusIndex: hit };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
      var mode = (state.phase === 'select' || e.shiftKey) ? 'draw' : 'pan';
      state.pointer = {
        x0: p.x, y0: p.y, mode: mode, moved: false,
        startView: { cx: state.view.cx, cy: state.view.cy, scale: state.view.scale }
      };
      if (mode === 'draw') {
        state.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        if (state.phase === 'result') {
          state.phase = 'select'; state.blocks = []; state.snapshot = null;
          state.renderQueue = null; state.anim = null; state.hoverRect = null;
          showHint();
          emptyHUD();
        }
        $('tooltip').hidden = true;
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = point(e);
      if (state.touches.has(e.pointerId)) state.touches.set(e.pointerId, p);
      if (state.pinch && state.touches.size >= 2) {
        var q = Array.from(state.touches.values());
        var d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
        var cx = (q[0].x + q[1].x) / 2, cy = (q[0].y + q[1].y) / 2;
        if (state.phase === 'result' && state.pinch.dist > 1 && d > 1) {
          zoomAt(d / state.pinch.dist, state.pinch.cx, state.pinch.cy);
          var s = scaleBD();
          state.view.cx = BD.sub(state.view.cx, BD.div(BD.from(cx - state.pinch.cx), s));
          state.view.cy = BD.sub(state.view.cy, BD.div(BD.from(cy - state.pinch.cy), s));
          clampCamera();
          syncView();
          preview();
          state.pinch.dist = d; state.pinch.cx = cx; state.pinch.cy = cy;
          clearTimeout(state.wheelTimer);
          state.wheelTimer = setTimeout(function () { requestRender(true); }, 130);
        }
        return;
      }
      if (state.pointer) {
        var dx = p.x - state.pointer.x0, dy = p.y - state.pointer.y0;
        if (state.pointer.mode === 'focus') {
          var fw = toWorld(p.x, p.y);
          var fc = state.foci[state.pointer.focusIndex];
          fc.x = clamp(fw.x, 0, state.world.gw);
          fc.y = clamp(fw.y, 0, state.world.gh);
          state.pointer.moved = true;
          preview();
          paintFoci();
        } else if (state.pointer.mode === 'pan') {
          if (!state.pointer.moved && Math.hypot(dx, dy) < 3) return;
          state.pointer.moved = true;
          var s0 = state.pointer.startView;
          var sB = BD.from(s0.scale);
          state.view.cx = BD.sub(s0.cx, BD.div(BD.from(dx), sB));
          state.view.cy = BD.sub(s0.cy, BD.div(BD.from(dy), sB));
          clampCamera();
          syncView();
          canvas.style.cursor = 'grabbing';
          preview();
        } else {
          state.drag = { x0: state.pointer.x0, y0: state.pointer.y0, x1: p.x, y1: p.y };
          paintSelect();
        }
      } else if (e.pointerType === 'mouse') {
        handleHover(p);          // tooltips are mouse-only; hidden on touch
      }
    });

    canvas.addEventListener('pointerup', function (e) {
      state.touches.delete(e.pointerId);
      if (state.pinch) {
        if (state.touches.size < 2) { state.pinch = null; requestRender(true); }
        return;
      }
      if (!state.pointer) return;
      if (state.pointer.mode === 'focus') {
        canvas.style.cursor = 'grab';
        if (state.pointer.moved) { state.cache.clear(); refreshResult(); }
      } else if (state.pointer.mode === 'pan') {
        canvas.style.cursor = 'grab';
        if (state.pointer.moved) requestRender(true);
      } else {
        var d = state.drag;
        state.drag = null;
        var r = d ? normDrag(d) : null;
        if (r && r.w >= 40 && r.h >= 40) {
          state.rectN = r;
          hideHint();
          $('btnCompute').classList.add('pulse');
        } else {
          state.rectN = null;
          showHint();
          if (d) toast(T.t('minWarn'));
        }
        paintSelect();
      }
      state.pointer = null;
    });
    canvas.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      $('tooltip').hidden = true;
      canvas.style.cursor = state.phase === 'result' ? 'grab' : 'crosshair';
    });
    canvas.addEventListener('pointercancel', function (e) {
      state.touches.delete(e.pointerId);
      if (state.touches.size < 2) state.pinch = null;
      state.pointer = null; state.drag = null;
      canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (state.phase !== 'result') return;
      var p = point(e);
      zoomAt(Math.exp(-e.deltaY * 0.0014), p.x, p.y);
      preview();
      clearTimeout(state.wheelTimer);
      state.wheelTimer = setTimeout(function () { requestRender(true); }, 130);
    }, { passive: false });

    canvas.addEventListener('dblclick', function (e) {
      if (state.phase !== 'result') return;
      var p = point(e), w = toWorld(p.x, p.y);
      if (state.foci.length >= 6) { toast(T.t('focusMax')); return; }
      state.foci.push({ x: clamp(w.x, 0, state.world.gw), y: clamp(w.y, 0, state.world.gh) });
      syncCentersSlider();
      state.cache.clear();
      refreshResult();
      toast(T.t('focusAdded'));
    });
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (state.phase !== 'result' || state.foci.length <= 1) return;
      var hit = nearestFocus(point(e), 1e9);
      state.foci.splice(hit < 0 ? state.foci.length - 1 : hit, 1);
      syncCentersSlider();
      state.cache.clear();
      refreshResult();
      toast(T.t('focusRemoved'));
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (e.key === 'Escape') {
        if (state.modalOpen) closeModal();
        else toggleConsole(false);
      } else if (e.key === 'Enter' && tag !== 'input' && tag !== 'select' && tag !== 'button') {
        runCompute();
      } else if ((e.key === 'f' || e.key === 'F') && tag !== 'input') {
        fitView(); requestRender(true);
      } else if ((e.key === 'r' || e.key === 'R') && tag !== 'input') {
        redraw();
      } else if (e.key === '+' || e.key === '=') {
        zoomBy(1.6); preview(); requestRender(true);
      } else if (e.key === '-') {
        zoomBy(1 / 1.6); preview(); requestRender(true);
      }
    });

    // Worker readiness arrives after the first frame; refresh the HUD badge.
    document.addEventListener('wasm:ready', function () {
      updateHUD(state.meta.ms || 0);
    });

    document.addEventListener('i18n:change', function () {
      $('statPrecision').textContent = T.t('precisionValue');
      updateAlgoHint();
      updateHUD(0);
      if (state.drag) paintSelectFrame(normDrag(state.drag));
    });

    window.addEventListener('resize', resize);
  }

  function redraw() {
    state.phase = 'select';
    state.blocks = []; state.colors = []; state.drawOrder = [];
    state.world = null; state.snapshot = null; state.renderQueue = null;
    state.anim = null; state.hoverRect = null; state.drag = null; state.pointer = null;
    showHint(); emptyHUD();
    $('tooltip').hidden = true;
    requestRender(true);
  }
  function clearAll() {
    state.rectN = null;
    redraw();
    $('btnCompute').classList.remove('pulse');
  }

  /* --------------------------- Startup --------------------------- */
  function init() {
    state.theme = readStore('sqr.theme', 'dark') === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    state.lang = readStore('sqr.lang', 'zh') === 'en' ? 'en' : 'zh';
    T.setLang(state.lang);
    $('statPrecision').textContent = T.t('precisionValue');
    $('langZh').classList.toggle('is-active', state.lang === 'zh');
    $('langEn').classList.toggle('is-active', state.lang === 'en');
    ['centers', 'power', 'radius', 'detail', 'order'].forEach(function (id) { setRangeFill($(id)); });
    $('powerVal').textContent = (+$('power').value).toFixed(1);
    $('radiusVal').textContent = (+$('radius').value).toFixed(2);
    $('centersVal').textContent = $('centers').value;
    $('detailVal').textContent = $('detail').value;
    $('orderVal').textContent = $('order').value;
    refreshPaint();
    resize();
    bind();
    updateAlgoHint();
    emptyHUD();

    // On narrow / tall phone screens keep the canvas unobstructed by default;
    // the glass console opens from the top bar on demand.
    if (window.innerWidth <= 640) toggleConsole(false);

    // Demo/share entry point (the default is still an empty infinite canvas):
    // ?demo=1&mode=quad|euclid|network&centers=3&theme=dark|light&lang=zh|en&zoom=8&ratio=1.5
    var q = new URLSearchParams(location.search);
    if (q.get('demo')) {
      if (q.get('theme')) setTheme(q.get('theme') === 'light' ? 'light' : 'dark');
      if (q.get('lang')) setLang(q.get('lang') === 'en' ? 'en' : 'zh');
      if (q.get('mode')) $('algoMode').value = q.get('mode');
      if (q.get('centers')) { $('centers').value = q.get('centers'); $('centersVal').textContent = q.get('centers'); setRangeFill($('centers')); }
      if (q.get('order')) { $('order').value = q.get('order'); $('orderVal').textContent = q.get('order'); setRangeFill($('order')); }
      if (q.get('radius')) { $('radius').value = q.get('radius'); $('radiusVal').textContent = (+q.get('radius')).toFixed(2); setRangeFill($('radius')); }
      if (q.get('palette')) $('palette').value = q.get('palette');
      if (q.get('seed') !== null) $('seed').value = clampSeed(q.get('seed'));
      $('animate').checked = false;
      // A tall phone viewport is best served by a portrait-oriented world;
      // an explicit ?ratio= always wins.
      var portrait = window.innerWidth <= 640 && window.innerHeight > window.innerWidth;
      var demoRatio = parseFloat(q.get('ratio')) || (portrait ? 0.62 : 1.5);
      runCompute({ ratio: demoRatio, noAnim: true });
      if (portrait && !q.get('zoom')) {
        state.view.scale *= 1.16;
        syncView(); updateZoomLabel(); requestRender(true);
      }
      if (q.get('zoom')) {
        var z = parseFloat(q.get('zoom'));
        var f = state.foci[0] || { x: state.world.gw / 2, y: state.world.gh / 2 };
        state.view.cx = BD.from(f.x); state.view.cy = BD.from(f.y);
        state.view.scale = Math.max(minScale(), state.view.scale * z);
        clampCamera();
        syncView();
        updateZoomLabel();
        requestRender(true);
      }
      if (q.get('console') === '0') toggleConsole(false);
      if (q.get('console') === '1') toggleConsole(true);
      if (q.get('modal')) openModal();
    }

    /* Desktop installation: Chromium exposes beforeinstallprompt once the
       manifest, icons and secure origin checks pass. Other browsers install
       from their own menu; the button simply stays hidden there. */
    (function () {
      var btn = $('btnInstall'), deferred = null;
      if ('serviceWorker' in navigator &&
          (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
      }
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferred = e;
        btn.hidden = false;
      });
      btn.addEventListener('click', function () {
        if (!deferred) return;
        var prompt = deferred; deferred = null;
        prompt.prompt();
        if (prompt.userChoice) {
          prompt.userChoice.then(function (r) {
            btn.hidden = true;
            if (r && r.outcome === 'accepted') toast(T.t('installDone'));
          });
        } else { btn.hidden = true; }
      });
      window.addEventListener('appinstalled', function () {
        btn.hidden = true; deferred = null; toast(T.t('installDone'));
      });
      // Optional experimental path: the service worker injects COOP/COEP,
      // which enables SharedArrayBuffer after a single reload.
      if (q.get('coi') === '1' && !window.crossOriginIsolated &&
          'serviceWorker' in navigator && window.sessionStorage) {
        try {
          if (!sessionStorage.getItem('sqr.coi-reload')) {
            sessionStorage.setItem('sqr.coi-reload', '1');
            navigator.serviceWorker.ready.then(function () { location.reload(); });
          }
        } catch (e) { /* session storage may be disabled */ }
      }
    })();

    /* Native diagnostics for the browser test suite; it only exposes read-only
       accessors and is inert unless ?debug=1 is present. */
    if (q.get('debug') === '1') {
      window.SquaringLab = {
        view: function () {
          var v = state.view;
          return { cx: BD.toNumber(v.cx), cy: BD.toNumber(v.cy), scale: v.scale, fitScale: v.fitScale };
        },
        world: function () { var w = state.world; return w ? { gw: w.gw, gh: w.gh } : null; },
        seed: seed,
        limits: function () {
          var w = state.world; if (!w) return null;
          var v = state.view, hw = state.W / (2 * v.scale), hh = state.H / (2 * v.scale);
          var lockX = w.gw <= hw * 2, lockY = w.gh <= hh * 2;
          return {
            halfW: hw, halfH: hh,
            cxMin: lockX ? w.gw / 2 : hw, cxMax: lockX ? w.gw / 2 : w.gw - hw,
            cyMin: lockY ? w.gh / 2 : hh, cyMax: lockY ? w.gh / 2 : w.gh - hh,
            lockX: lockX, lockY: lockY
          };
        },
        phase: function () { return state.phase; }
      };
    }
  }

  init();
})();
