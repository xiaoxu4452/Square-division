/*
 * smoke.js - real-browser end-to-end check via the Chrome DevTools Protocol.
 * Run: node tests/smoke.js
 * Uses the locally installed Microsoft Edge; needs no npm packages.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8791;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png'
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9333;
let edge;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waits = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const n = ++id; waits.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  return { ws, send };
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(require('os').tmpdir(), 'sqr-cdp-' + Date.now());
  edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (targets.length) break; } catch (e) {}
    await sleep(150);
  }
  if (!targets) throw new Error('Edge CDP did not start');
  const page = targets.find(t => t.type === 'page');
  const { ws, send } = await cdp(page.webSocketDebuggerUrl);
  const errors = [];
  await send('Runtime.enable');
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push(m.params.args.map(a => a.value || a.description).join(' '));
  };
  // Runtime.enable re-registered handler above overwrote the id resolver; use a
  // fresh channel for commands to keep both: re-open a second CDP session.
  const cmd = await cdp(page.webSocketDebuggerUrl);
  await cmd.send('Runtime.enable');
  async function evaluate(expr) {
    const r = await cmd.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result && r.result.result && r.result.result.value;
  }
  async function goto(url) {
    await cmd.send('Page.navigate', { url });
    for (let i = 0; i < 80; i++) {
      const ready = await evaluate('document.readyState === "complete"');
      if (ready) break;
      await sleep(100);
    }
    await sleep(400);
  }

  const base = 'http://127.0.0.1:' + PORT + '/';
  let fail = 0;
  function ok(name, cond, extra) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
    if (!cond) fail++;
  }

  await goto(base + '?demo=1&lang=zh');
  ok('page loads with canvas', await evaluate('!!document.getElementById("stage")'));
  ok('WASM engine ready', await evaluate('WasmEngine && WasmEngine.available()'));
  ok('perfect solver loaded', await evaluate('!!window.PerfectSolver'));

  await evaluate('document.getElementById("algoMode").value = "perfect"; document.getElementById("algoMode").dispatchEvent(new Event("change"))');
  await sleep(300);
  ok('custom rectangle fields visible in perfect mode',
    await evaluate('!document.getElementById("customRectField").hidden'));

  // Kick off the search by clicking the real button.
  await evaluate('document.getElementById("customW").value = 33; document.getElementById("customH").value = 32; document.getElementById("btnPerfectSearch").click(); true');
  let stats = null;
  for (let i = 0; i < 100; i++) {
    stats = await evaluate('window.__none; (function(){var s=document.getElementById("perfectSolutions"); return s && s.options.length ? s.options.length : 0})()');
    if (stats > 0) break;
    await sleep(150);
  }
  ok('perfect search returns at least one solution via UI', stats > 0, 'options=' + stats);
  const note = await evaluate('document.getElementById("perfectSearchNote").textContent');
  ok('HUD note reports WASM + solutions', /WASM/.test(note) && /\d/.test(note), note);
  const blocks = await evaluate('document.getElementById("statBlocks").textContent');
  ok('renders 9 squares for 33x32', blocks === '9', 'blocks=' + blocks);

  // A non-square frame cannot self-substitute: scale k still enlarges it.
  await evaluate('var e=document.getElementById("scaleK"); e.value=3; e.dispatchEvent(new Event("change")); true');
  await sleep(400);
  ok('integer scale keeps the square count for a non-square frame',
    await evaluate('document.getElementById("statBlocks").textContent') === '9',
    'blocks=' + await evaluate('document.getElementById("statBlocks").textContent'));

  // Switch to the built-in square instance and verify the BigInt chain renders.
  await evaluate('document.getElementById("chainLevel").value=0; document.getElementById("scaleK").value=1; true');
  // The 112x112 Duijvestijn instance goes through the picker; selecting it
  // clears the searched solution and re-enables the substitution slider.
  await evaluate('var sel=document.getElementById("perfectPick"); sel.value="duv112"; sel.dispatchEvent(new Event("change")); true');
  await sleep(400);
  await evaluate('var e=document.getElementById("chainLevel"); e.value=2; e.dispatchEvent(new Event("change")); true');
  await sleep(600);
  const blocks2 = await evaluate('document.getElementById("statBlocks").textContent');
  ok('substitution level 2 renders 81 squares', blocks2 === '81', 'blocks=' + blocks2);

  ok('no JavaScript errors in the browser', errors.length === 0, errors.join(' | '));

  ws.close(); cmd.ws.close();
  server.close();
  if (edge && !edge.killed) edge.kill();
  console.log('\n' + (fail ? fail + ' FAILED' : 'ALL PASS'));
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  server.close();
  if (edge && !edge.killed) edge.kill();
  process.exit(1);
});
