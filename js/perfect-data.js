/* ==========================================================================
 * perfect-data.js — Verified perfect squared rectangles / squares (PSR/PSS)
 *
 * A "perfect" dissection tiles a rectangle with finitely many squares whose
 * side lengths are ALL DISTINCT. These are not computed at runtime: they are
 * exact integer coordinates decoded from Bouwkampcodes in the catalogues of
 * squaring.net (Brooks–Smith–Stone–Tutte / Duijvestijn / Anderson), then
 * verified for exact coverage (area = w*h, zero gaps, zero overlaps) and
 * pairwise-distinct integer sides. Coordinates are in world units [0..w]x[0..h].
 *
 * Each entry: { id, key, w, h, order, zh, en, note, cells:[x,y,s,...] }
 *   - order  = number of squares (all with distinct integer sides)
 *   - key    = compact URL token
 *   - note   = provenance shown in the HUD / explainer
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PerfectData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // cells are flat triples [x, y, side, x, y, side, ...] to keep the module tiny.
  var TILINGS = [
    {
      id: 'duv112', key: 'duv112', w: 112, h: 112, order: 21,
      zh: '杜伊费斯特因 112² 完美正方形', en: 'Duijvestijn 112² perfect square',
      noteZh: '唯一的最低阶完美正方形（21 阶，1978）',
      noteEn: 'The unique lowest-order perfect square (order 21, 1978)',
      cells: [0,0,50, 50,0,35, 85,0,27, 85,27,8, 93,27,19, 50,35,15, 65,35,17, 82,35,11, 82,46,6, 88,46,24, 0,50,29, 29,50,25, 54,50,9, 63,50,2, 63,52,7, 70,52,18, 54,59,16, 70,70,42, 29,75,4, 33,75,37, 0,79,33]
    },
    {
      id: 'mor32', key: 'mor32', w: 33, h: 32, order: 9,
      zh: '莫龙 33×32 完美矩形', en: 'Moroń 33×32 perfect rectangle',
      noteZh: '最小的完美矩形（9 阶，1925）',
      noteEn: 'The smallest perfect rectangle (order 9, 1925)',
      cells: [0,0,18, 18,0,15, 18,15,7, 25,15,8, 0,18,14, 14,18,4, 14,22,10, 24,22,1, 24,23,9]
    },
    {
      id: 'wide2to1', key: '2to1', w: 208, h: 103, order: 15,
      zh: '208×103 宽幅完美矩形', en: '208×103 wide perfect rectangle',
      noteZh: '接近 2:1 的完美矩形（15 阶）',
      noteEn: 'A near-2:1 perfect rectangle (order 15)',
      cells: [0,0,59, 59,0,60, 119,0,38, 157,0,51, 119,38,25, 144,38,13, 144,51,12, 156,51,52, 0,59,44, 44,59,15, 59,60,14, 73,60,43, 116,60,3, 116,63,40, 44,74,29]
    },
    {
      id: 'c57x55', key: '57x55', w: 57, h: 55, order: 10,
      zh: '57×55 完美矩形', en: '57×55 perfect rectangle',
      noteZh: '近正方形完美矩形（10 阶）',
      noteEn: 'A near-square perfect rectangle (order 10)',
      cells: [0,0,30, 30,0,27, 30,27,3, 33,27,11, 44,27,13, 0,30,25, 25,30,8, 25,38,17, 42,38,2, 42,40,15]
    },
    {
      id: 'c69x61', key: '69x61', w: 69, h: 61, order: 9,
      zh: '69×61 完美矩形', en: '69×61 perfect rectangle',
      noteZh: '低阶完美矩形（9 阶）',
      noteEn: 'A low-order perfect rectangle (order 9)',
      cells: [0,0,36, 36,0,33, 36,33,5, 41,33,28, 0,36,25, 25,36,9, 34,36,2, 34,38,7, 25,45,16]
    },
    {
      id: 'c115x94', key: '115x94', w: 115, h: 94, order: 10,
      zh: '115×94 完美矩形', en: '115×94 perfect rectangle',
      noteZh: '中幅完美矩形（10 阶）',
      noteEn: 'A medium-aspect perfect rectangle (order 10)',
      cells: [0,0,60, 60,0,55, 60,55,16, 76,55,39, 0,60,34, 34,60,15, 49,60,11, 49,71,4, 53,71,23, 34,75,19]
    },
    {
      id: 'c65x47', key: '65x47', w: 65, h: 47, order: 10,
      zh: '65×47 完美矩形', en: '65×47 perfect rectangle',
      noteZh: '经典完美矩形（10 阶）',
      noteEn: 'A classic perfect rectangle (order 10)',
      cells: [0,0,25, 25,0,17, 42,0,23, 25,17,11, 36,17,6, 36,23,5, 41,23,24, 0,25,22, 22,25,3, 22,28,19]
    },
    {
      id: 'c112x81', key: '112x81', w: 112, h: 81, order: 11,
      zh: '112×81 完美矩形', en: '112×81 perfect rectangle',
      noteZh: '含单位方块的完美矩形（11 阶）',
      noteEn: 'A perfect rectangle containing a unit square (order 11)',
      cells: [0,0,43, 43,0,29, 72,0,40, 43,29,19, 62,29,10, 62,39,9, 71,39,1, 71,40,41, 0,43,38, 38,43,5, 38,48,33]
    },
    {
      id: 'c130x79', key: '130x79', w: 130, h: 79, order: 10,
      zh: '130×79 完美矩形', en: '130×79 perfect rectangle',
      noteZh: '黄金比附近的完美矩形（10 阶）',
      noteEn: 'A near-golden-ratio perfect rectangle (order 10)',
      cells: [0,0,45, 45,0,44, 89,0,41, 89,41,3, 92,41,38, 45,44,12, 57,44,35, 0,45,34, 34,45,11, 34,56,23]
    }
  ];

  function all() { return TILINGS; }
  function byKey(key) {
    for (var i = 0; i < TILINGS.length; i++) if (TILINGS[i].key === key) return TILINGS[i];
    return null;
  }
  function byId(id) {
    for (var i = 0; i < TILINGS.length; i++) if (TILINGS[i].id === id) return TILINGS[i];
    return null;
  }

  /** Expand flat cells into block objects in world coordinates (with wx/wy for validate). */
  function blocks(t) {
    var out = [], c = t.cells;
    for (var i = 0; i < c.length; i += 3) {
      out.push({ x: c[i], y: c[i + 1], s: c[i + 2], wx: c[i], wy: c[i + 1], depth: 0, label: c[i + 2], kind: 'perfect' });
    }
    return out;
  }

  /** Independent structural audit: exact area, full coverage, pairwise-distinct integer sides. */
  function audit(t) {
    var c = t.cells, n = c.length / 3, sides = [], area = 0, ok = true;
    var occ = new Uint8Array(t.w * t.h);
    for (var i = 0; i < c.length; i += 3) {
      var x = c[i], y = c[i + 1], s = c[i + 2];
      sides.push(s); area += s * s;
      if (!(s > 0) || s % 1 !== 0 || x + s > t.w || y + s > t.h) { ok = false; continue; }
      for (var yy = y; yy < y + s; yy++) for (var xx = x; xx < x + s; xx++) {
        var idx = yy * t.w + xx;
        if (occ[idx]) ok = false; else occ[idx] = 1;
      }
    }
    for (var k = 0; k < occ.length; k++) if (!occ[k]) ok = false;
    var distinct = new Set(sides).size === sides.length;
    return {
      ok: ok && distinct && area === t.w * t.h && n === t.order,
      n: n, order: t.order, area: area, expected: t.w * t.h,
      distinct: distinct, uniqueSides: new Set(sides).size
    };
  }

  return { all: all, byKey: byKey, byId: byId, blocks: blocks, audit: audit };
});
