/*
 * sw.js - offline cache + optional cross-origin isolation for the
 * squared-rectangle laboratory.
 *
 * GitHub Pages cannot set response headers, so real WebAssembly threads
 * (SharedArrayBuffer + shared linear memory) are normally unavailable.
 * Opening the app with ?coi=1 makes this worker inject COOP/COEP into the
 * navigation response, which enables crossOriginIsolated after one reload.
 * The default Worker-pool path needs no isolation and is unaffected.
 */
'use strict';

const VERSION = 'sqr-v12';
const CACHE = VERSION + '-static';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css?v=12',
  './js/i18n.js?v=12', './js/bigdec.js?v=12',
  './js/vendor/fraction.min.js?v=12', './js/vendor/decimal.min.js?v=12',
  './js/perfect-catalog.js?v=12', './js/perfect-data.js?v=12', './js/perfect-match.js?v=12',
  './js/squaring.js?v=12',
  './js/wasm-module.js?v=12', './js/wasm-engine.js?v=12', './js/perfect-solver.js?v=12',
  './js/tiling-worker.js', './js/tiling-worker.js?v=12', './js/app.js?v=12',
  './essay.zh.html', './essay.en.html',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './wasm/tiling_core.wasm'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // A single missing optional asset must not abort the whole install.
      return Promise.all(CORE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf(VERSION + '-') !== 0; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isolated(res, enabled) {
  if (!enabled || !res) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // credentialless keeps external reference links usable while isolating.
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, {
    status: res.status, statusText: res.statusText, headers: headers
  });
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const coi = url.searchParams.get('coi') === '1';
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put('./index.html', copy); }).catch(function () {});
        return isolated(res, coi);
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return isolated(hit, coi) || Response.error();
        });
      })
    );
    return;
  }

  // Static assets: NETWORK-FIRST with cache fallback.
  // A cache-first policy made users keep a stale app after a new deploy: the
  // old service worker served an outdated index.html/js/css indefinitely, so
  // new modes (e.g. perfect dissection) never appeared until a hard reload.
  // GitHub Pages is online and fast; fetching fresh first guarantees updates,
  // while the cached copy keeps the app fully usable offline.
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || Response.error();
      });
    })
  );
});
