/*
 * tiling-worker.js - one C++/WASM kernel instance per worker thread.
 *
 * Each worker owns a private linear memory, so no SharedArrayBuffer and no
 * cross-origin isolation headers are required. The main thread splits the
 * Euclidean skeleton into independent quadtree root regions and hands a
 * batch to each worker; results come back as one transferable buffer.
 */
/* global WasmModule, importScripts */
'use strict';

importScripts('wasm-module.js');

var PAGES = 128;                 // 8 MiB, far above the 1 MiB heap base
var SLOT_BYTES = 2097152;        // 65536 tiles x 32 bytes per worker slot
var modulePromise = WasmModule.compile();
var inst = null, mem = null, f64 = null, IN = 0, OUT = 0;

function align8(n) { return Math.ceil(n / 8) * 8; }

self.onmessage = function (e) {
  var d = e.data;
  if (d.type === 'init') {
    modulePromise.then(function (mod) {
      mem = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
      return WebAssembly.instantiate(mod, { env: { memory: mem } });
    }).then(function (i) {
      inst = i;
      var heap = inst.exports.__heap_base.value;
      IN = align8(heap + 1024);
      OUT = align8(IN + 4096);
      f64 = new Float64Array(mem.buffer);
      self.postMessage({ type: 'ready', version: inst.exports.kernel_version(), heap: heap });
    }).catch(function (err) {
      self.postMessage({ type: 'error', message: String(err) });
    });
    return;
  }
  if (d.type === 'run' || (d.type === 'error' && d.id != null)) {
    if (d.type === 'error') {
      self.postMessage({ type: 'done', id: d.id, n: 0, overflow: true, buffer: new ArrayBuffer(0) });
      return;
    }
    if (!inst) { self.postMessage({ type: 'error', id: d.id, message: 'not initialised' }); return; }
    var p = d.params, t = d.tasks, used = 0, overflow = false;
    f64[IN / 8] = p.nfoci;
    for (var k = 0; k < p.nfoci; k++) {
      f64[IN / 8 + 1 + 2 * k] = p.foci[2 * k];
      f64[IN / 8 + 2 + 2 * k] = p.foci[2 * k + 1];
    }
    for (var q = 0; q < t.length; q += 4) {
      var room = Math.floor((SLOT_BYTES - used * 32) / 32);
      if (room <= 0) { overflow = true; break; }
      var n = inst.exports.tile_region(
        t[q], t[q + 1], t[q + 2], p.hw, p.hh, p.scale,
        p.radius, p.power, p.farTarget, p.minPx, p.boost,
        p.maxDepth, Math.min(p.maxTiles, room), t[q + 3] | 0,
        IN, OUT + used * 32
      );
      if (n < 0) { overflow = true; break; }
      used += n;
    }
    var copy = mem.buffer.slice(OUT, OUT + used * 32);
    self.postMessage({ type: 'done', id: d.id, n: used, overflow: overflow, buffer: copy }, [copy]);
  }
};
