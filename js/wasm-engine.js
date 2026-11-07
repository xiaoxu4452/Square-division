/*
 * wasm-engine.js - C++/WebAssembly quadtree kernel with a Web Worker pool.
 *
 * Architecture (works on plain HTTPS hosts such as GitHub Pages):
 *   - The Euclidean minimum-tile skeleton is split into independent root
 *     regions on the main thread (cheap, deterministic).
 *   - Each region is evaluated by native/tiling_core.cpp compiled to wasm32.
 *   - Several Web Workers own one WASM instance each, so disjoint regions
 *     run in parallel on different CPU cores; results are transferred back
 *     as ArrayBuffers (no SharedArrayBuffer / COOP / COEP required).
 *   - A synchronous main-thread WASM instance covers the first frame and
 *     environments where Workers are unavailable (e.g. file:// previews).
 *   - If WASM is unavailable at all the caller falls back to js/squaring.js.
 *
 * Real wasm pthreads (shared linear memory + memory.atomics) need the
 * COOP/COEP response headers, which GitHub Pages cannot set. See README.
 */
(function (root) {
  'use strict';

  var S = root.Squaring;
  var TASK_DEPTH = 4;
  var SLOT_TILES = 65536;
  var PAGES_MAIN = 256;

  var module = null, memory = null, instance = null, f64 = null;
  var IN = 0, OUT = 0, heapBase = 0, version = 0;
  var available = false;
  var workers = [], readyCount = 0, nextId = 1;
  var pending = new Map();

  function align8(n) { return Math.ceil(n / 8) * 8; }

  /* ---------------------------------------------------------- main thread */
  try {
    if (root.WasmModule && typeof WebAssembly !== 'undefined') {
      module = new WebAssembly.Module(root.WasmModule.bytes());
      memory = new WebAssembly.Memory({ initial: PAGES_MAIN, maximum: PAGES_MAIN });
      instance = new WebAssembly.Instance(module, { env: { memory: memory } });
      heapBase = instance.exports.__heap_base.value;
      IN = align8(heapBase + 1024);
      OUT = align8(IN + 4096);
      f64 = new Float64Array(memory.buffer);
      version = instance.exports.kernel_version();
      available = typeof instance.exports.tile_region === 'function';
    }
  } catch (err) { available = false; }

  function initWorkers() {
    if (!available || typeof Worker === 'undefined') return;
    var hw = (root.navigator && root.navigator.hardwareConcurrency) || 2;
    var count = Math.max(1, Math.min(hw, 8));
    for (var i = 0; i < count; i++) {
      try {
        var w = new Worker('js/tiling-worker.js');
        var slot = { w: w, ready: false };
        w.onmessage = function (idx, e) {
          var d = e.data;
          if (d.type === 'ready' && !workers[idx].ready) {
            workers[idx].ready = true; readyCount++;
            if (root.document && root.document.dispatchEvent) {
              root.document.dispatchEvent(new root.CustomEvent('wasm:ready'));
            }
          } else if (d.type === 'error') {
            workers[idx].ready = false;
          } else if (d.type === 'done' || d.type === 'error') {
            var p = pending.get(d.id);
            if (p) { pending.delete(d.id); p(d); }
          }
        }.bind(null, i);
        w.onerror = function (idx) { if (workers[idx].ready) { workers[idx].ready = false; readyCount--; } }.bind(null, i);
        w.postMessage({ type: 'init' });
        workers.push(slot);
      } catch (err) { break; }
    }
  }

  /* -------------------------------------------------------------- tasks */
  function buildTasks(world, view, opts, minPx, boost) {
    var ox = view.ox || 0, oy = view.oy || 0;
    var hw = view.hw || (view.x1 - view.x0) / 2;
    var hh = view.hh || (view.y1 - view.y0) / 2;
    var scale = view.scale;
    var far = Math.min(world.gw, world.gh);
    var localFoci = (opts.foci || []).map(function (f) {
      return { x: f.x - ox, y: f.y - oy };
    });
    var lo = {
      foci: localFoci, radius: opts.radius, power: opts.power,
      farTarget: far
    };
    var roots = S.minimumSkeleton(world, ox, oy);
    var tasks = [], finished = [], overflow = false;
    var maxDepth = opts.maxDepth || 48;

    function expand(x, y, s, depth) {
      if (overflow) return;
      if (x > hw || y > hh || x + s < -hw || y + s < -hh) return;
      var cx = x + s / 2, cy = y + s / 2;
      var target = S.sizeField(cx, cy, world, lo);
      var w = S.focusWeight(cx, cy, world, lo);
      var floor = minPx * (1 - boost * w);
      var canSplit = depth < maxDepth && s > target * 1.35 && s * scale > floor * 2.1;
      if (!canSplit) {
        finished.push({ x: x, y: y, s: s, depth: depth, wx: x + ox, wy: y + oy });
        return;
      }
      if (depth >= TASK_DEPTH) {
        tasks.push(x, y, s, depth);
        return;
      }
      var h = s / 2;
      expand(x, y, h, depth + 1);
      expand(x + h, y, h, depth + 1);
      expand(x, y + h, h, depth + 1);
      expand(x + h, y + h, h, depth + 1);
    }
    for (var i = 0; i < roots.length && !overflow; i++) {
      expand(roots[i].x, roots[i].y, roots[i].s, 0);
    }
    return {
      tasks: new Float64Array(tasks),
      finished: finished,
      params: {
        hw: hw, hh: hh, scale: scale,
        radius: opts.radius, power: opts.power, farTarget: far,
        minPx: minPx, boost: boost, maxDepth: maxDepth,
        maxTiles: SLOT_TILES, nfoci: Math.min(localFoci.length, 8),
        foci: (function () {
          var a = [];
          for (var k = 0; k < Math.min(localFoci.length, 8); k++) a.push(localFoci[k].x, localFoci[k].y);
          return a;
        })()
      },
      ox: ox, oy: oy
    };
  }

  function collect(packed, n, ox, oy, into) {
    for (var i = 0; i < n; i++) {
      var j = i * 4;
      into.push({
        x: packed[j], y: packed[j + 1], s: packed[j + 2], depth: packed[j + 3],
        wx: packed[j] + ox, wy: packed[j + 1] + oy
      });
    }
    return into;
  }

  /* --------------------------------------------------- synchronous path */
  function runLocal(job) {
    var p = job.params, t = job.tasks, used = 0;
    f64[IN / 8] = p.nfoci;
    for (var k = 0; k < p.nfoci; k++) {
      f64[IN / 8 + 1 + 2 * k] = p.foci[2 * k];
      f64[IN / 8 + 2 + 2 * k] = p.foci[2 * k + 1];
    }
    var limit = Math.floor((memory.buffer.byteLength - OUT) / 32);
    for (var q = 0; q < t.length; q += 4) {
      var n = instance.exports.tile_region(
        t[q], t[q + 1], t[q + 2], p.hw, p.hh, p.scale,
        p.radius, p.power, p.farTarget, p.minPx, p.boost,
        p.maxDepth, Math.min(limit - used, SLOT_TILES), t[q + 3] | 0,
        IN, OUT + used * 32
      );
      if (n < 0) return null;
      used += n;
    }
    var blocks = job.finished.slice();
    collect(new Float64Array(memory.buffer, OUT, used * 4), used, job.ox, job.oy, blocks);
    return { blocks: blocks, tiles: used };
  }

  /* ---------------------------------------------------- asynchronous path */
  function runParallel(job) {
    var live = workers.filter(function (s) { return s.ready; });
    if (!live.length) return Promise.resolve(runLocal(job));
    var t = job.tasks, nTasks = t.length / 4;
    // Greedy least-loaded bin packing: large root squares cost far more than
    // small ones, so a plain round-robin can overflow one worker's slot.
    var idx = [];
    for (var i = 0; i < nTasks; i++) idx.push(i);
    idx.sort(function (a, b) { return t[b * 4 + 2] - t[a * 4 + 2]; });
    var bins = live.map(function () { return { load: 0, items: [] }; });
    idx.forEach(function (v) {
      var best = 0;
      for (var b = 1; b < bins.length; b++) if (bins[b].load < bins[best].load) best = b;
      bins[best].items.push(v);
      var s = t[v * 4 + 2];
      bins[best].load += s * s;
    });
    var buckets = bins.map(function (b) { return b.items; });

    var jobs = buckets.map(function (list, k) {
      var arr = new Float64Array(list.length * 4);
      list.forEach(function (v, q) {
        arr[q * 4] = t[v * 4]; arr[q * 4 + 1] = t[v * 4 + 1];
        arr[q * 4 + 2] = t[v * 4 + 2]; arr[q * 4 + 3] = t[v * 4 + 3];
      });
      return new Promise(function (resolve) {
        var id = nextId++;
        pending.set(id, function (msg) {
          resolve(msg.type === 'done' && !msg.overflow
            ? { n: msg.n, packed: new Float64Array(msg.buffer) }
            : null);
        });
        live[k].w.postMessage({ type: 'run', id: id, params: job.params, tasks: arr }, [arr.buffer]);
        // Never hang the renderer if a worker dies unexpectedly.
        setTimeout(function () { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 8000);
      });
    });

    return Promise.all(jobs).then(function (parts) {
      if (parts.some(function (p) { return !p; })) return null;
      var blocks = job.finished.slice();
      parts.forEach(function (p) { collect(p.packed, p.n, job.ox, job.oy, blocks); });
      return { blocks: blocks, tiles: blocks.length - job.finished.length };
    });
  }

  /* --------------------------------------------------------------- API */
  function attempt(world, view, opts, state, n) {
    if (n >= 8) return Promise.resolve(null);
    var cap = opts.maxBlocks || 100000;
    var job = buildTasks(world, view, opts, state.minPx, state.boost);
    return Promise.resolve(runParallel(job)).then(function (r) {
      if (r && r.blocks.length <= cap) {
        r.blocks.exceeded = false;
        r.blocks.ox = job.ox; r.blocks.oy = job.oy;
        return r.blocks;
      }
      if (state.boost > 0.1) state.boost *= 0.7;
      else state.minPx *= 1.6;
      return attempt(world, view, opts, state, n + 1);
    });
  }

  initWorkers();

  root.WasmEngine = {
    available: function () { return available; },
    version: function () { return version; },
    sha: function () { return root.WasmModule ? root.WasmModule.sha : ''; },
    threads: function () { return readyCount; },
    status: function () {
      if (!available) return 'JS';
      return readyCount > 0 ? 'WASM x' + readyCount : 'WASM';
    },
    generateSync: function (world, view, opts) {
      if (!available) return null;
      var cap = opts.maxBlocks || 100000;
      var state = {
        minPx: opts.minPx == null ? 1.7 : opts.minPx,
        boost: opts.boost == null ? 0.72 : opts.boost
      };
      for (var a = 0; a < 8; a++) {
        var job = buildTasks(world, view, opts, state.minPx, state.boost);
        var r = runLocal(job);
        if (r && r.blocks.length <= cap) {
          r.blocks.exceeded = false;
          r.blocks.ox = job.ox; r.blocks.oy = job.oy;
          return r.blocks;
        }
        if (state.boost > 0.1) state.boost *= 0.7;
        else state.minPx *= 1.6;
      }
      return null;
    },
    generateAsync: function (world, view, opts) {
      if (!available) return Promise.resolve(null);
      if (readyCount === 0) {
        return Promise.resolve(this.generateSync(world, view, opts));
      }
      return attempt(world, view, opts, {
        minPx: opts.minPx == null ? 1.7 : opts.minPx,
        boost: opts.boost == null ? 0.72 : opts.boost
      }, 0);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
