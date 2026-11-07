/*
 * make-icons.js - generate the PWA icons without any image library.
 * A tiny PNG encoder (zlib + CRC32) draws a squared-rectangle motif:
 * equal-area quadrants with increasing subdivision, echoing the app.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'icons');
fs.mkdirSync(dir, { recursive: true });

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(size, painter) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;                                  // filter: none
    for (let x = 0; x < size; x++) {
      const c = painter(x, y, size);
      const p = row + 1 + x * 4;
      raw[p] = c[0]; raw[p + 1] = c[1]; raw[p + 2] = c[2]; raw[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* Muted, low-chroma palette - same visual language as the canvas. */
const COLORS = [
  [122, 148, 172], [166, 143, 158], [176, 160, 128], [134, 165, 152],
  [143, 150, 184], [180, 146, 138], [150, 168, 140], [128, 152, 168],
  [172, 156, 168], [154, 164, 178]
];
const BG = [15, 24, 38];
function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function iconData(maskable) {
  // Quadrants with 2^0 .. 2^3 subdivision produce the "denser centre" motif.
  const tiles = [];
  const levels = [1, 2, 4, 8];
  for (let q = 0; q < 4; q++) {
    const n = levels[q];
    const qx = (q % 2) * 0.5, qy = Math.floor(q / 2) * 0.5;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      tiles.push({
        x: qx + i / (2 * n), y: qy + j / (2 * n), s: 1 / (2 * n),
        c: COLORS[Math.floor(hash(i + q * 11, j, n) * COLORS.length)]
      });
    }
  }
  return function painter(px, py, size) {
    // Maskable icons need a larger safe area, so the motif is inset more.
    const pad = maskable ? 0.18 : 0.09;
    const u = (px / size - pad) / (1 - 2 * pad);
    const v = (py / size - pad) / (1 - 2 * pad);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return BG;
    for (let k = 0; k < tiles.length; k++) {
      const t = tiles[k];
      if (u >= t.x && u < t.x + t.s && v >= t.y && v < t.y + t.s) {
        const gap = 0.004;
        const lx = (u - t.x) / t.s, ly = (v - t.y) / t.s;
        if (lx < gap || ly < gap || lx > 1 - gap || ly > 1 - gap) return BG;
        return t.c;
      }
    }
    return BG;
  };
}

for (const size of [192, 512]) {
  const file = path.join(dir, 'icon-' + size + '.png');
  fs.writeFileSync(file, png(size, iconData(false)));
  console.log('wrote icons/icon-' + size + '.png');
}
fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), png(512, iconData(true)));
console.log('wrote icons/icon-maskable-512.png');
