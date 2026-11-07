# Squaring the Rectangle · Infinite Canvas

[中文说明](README.zh-CN.md) · **Live demo:** <https://xiaoxu4452.github.io/Square-division/>

An interactive, dependency-free visual laboratory for **squaring the rectangle**: dissecting an arbitrary rectangle into a finite set of non-overlapping squares of many different sizes. Everything runs in the browser on a full-screen, near-infinitely zoomable canvas.

![Concept](https://img.shields.io/badge/stack-HTML%20%2F%20CSS%20%2F%20JavaScript-blue) ![Build](https://img.shields.io/badge/build-none-green) ![Precision](https://img.shields.io/badge/precision-80%20decimals-orange)

---

## 1. Highlights

- **Full-screen infinite canvas.** The entire page is a WebGL-free Canvas 2D surface with a high-precision camera. Zoom is anchored at the pointer and remains stable to ~10^12×.
- **Multi-focus dissection.** A scale-free size field produces two or more dense centres. Squares become arbitrarily fine near a focus and *stay strictly large* far away — no stray small tiles in the outskirts.
- **Exact tiling.** A dyadic quadtree splits a macro block into four equal squares, or not at all. Splits are disjoint and complete, so coverage is exactly 100 % with zero gaps and zero overlaps.
- **Near-infinite zoom.** The size field has no world-space lower bound. Level of detail (LOD) is driven by on-screen pixel size, so zooming in keeps revealing new levels instead of running out of geometry.
- **80-decimal camera arithmetic.** A built-in `BigDec` fixed-point library (BigInt, 80 fractional digits) maintains camera coordinates; rasterisation uses a double main value plus an exact residual correction.
- **Strict colouring.** A 32-colour low-chroma palette (no black, white or grey) with a smooth large-scale colour flow. A greedy graph colouring with a hard constraint guarantees that every pair of edge-adjacent squares differs.
- **Glassmorphic UI.** Translucent top bar, a control console that collapses into the top bar, a stats HUD, a zoom bar, and a single knowledge/explainer modal. Barely-there gradient controls (deliberately restrained, never neon), dark/light themes, Chinese/English.
- **Classic reference modes.** Euclidean continued fractions and the Smith / Moroń electrical-network dissection both cover the *entire* rectangle exactly; an L-shaped ladder substitution lets the square count grow from hundreds to tens of thousands via the *Subdivision order* slider.
- **Small-paper explainer.** The knowledge modal embeds a bilingual technical essay (`essay.zh.html` / `essay.en.html`): 11 numbered chapters, 27 numbered equations, 12 inline SVG plates, an abstract, references and a parameter appendix.
- **Mobile first.** Portrait long screens (19.5:9 / 20:9), `dvh`, safe-area insets, 40 px touch targets, two-finger pinch zoom, and a portrait-oriented default world on phones.
- **Custom dense centres in all three modes.** Double-click to add, drag a marker to move, right-click to remove the nearest; centres are already sub-pixel fine on the first frame and survive mode switches.
- **Minimum-tile far field.** An exact Euclidean / continued-fraction skeleton keeps only `Σ qᵢ` large squares away from the centres (see §3.8 for its theoretical limits).
- **C++ WASM multicore + installable PWA.** A ~9 KB freestanding C++17 kernel runs in a Web Worker pool; the result is tile-identical to the JS engine. A service worker adds offline caching and desktop installation.

---

## 2. Quick start

No build step, no package manager, no network access required.

```bash
git clone https://github.com/xiaoxu4452/Square-division.git
cd Square-division
python -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly via `file://` also works.

The prebuilt kernel is committed, so no compiler is needed. To rebuild it (Zig only) and regenerate the PWA icons:

```bash
node tools/build-wasm.js      # native/tiling_core.cpp -> wasm/ + js/wasm-module.js
node tools/make-icons.js      # icons/*.png
```

Run the algorithm verification suite (Node.js 18+):

```bash
node tests/verify.js
```

---

## 3. The mathematics

### 3.1 Squared rectangles and continued fractions

A rectangle `a × b` can be tiled by finitely many squares exactly when `a/b` is rational. The Euclidean algorithm performs the dissection: repeatedly remove the largest square with side `min(a, b)`. The sequence of quotients is the continued fraction of `a/b`; for `3:2` it is `[1, 2]`, for the golden ratio `φ = [1;1,1,…]` the process never terminates. A **perfect** squared rectangle additionally requires all side lengths to be distinct — the smallest classical example is Zbigniew Moroń's `33 × 32` rectangle from 1925 with sides `{18, 15, 14, 10, 9, 8, 7, 4, 1}`.

### 3.2 The Smith diagram / electrical-network analogy

Brooks, Smith, Stone and Tutte (1936–40) turned the problem into a planar electrical network:

| Geometry | Network |
| --- | --- |
| Each horizontal line of the dissection | A node |
| Each square | A `1 Ω` resistor between its top and bottom lines |
| Square side length | Current through that resistor |
| Vertical coordinate (height) | Electric potential |
| Sum of widths of squares on one horizontal line | Kirchhoff's current law |
| Sum of heights along a vertical path | Ohm's law |

If the outer boundary is itself a square, the equivalent resistance of the whole network is exactly `1`. This is why the field algorithm is often described as "circuit-like": the dense centres behave like regions of high current density.

### 3.3 The multi-focus dyadic field

The world is an `m × n` grid of macro blocks with side `L = 2^D` (binary-exact). Let `d(p)` be the distance from a point to the nearest focus and `R` the falloff radius. The target side length is

```
target(p) = L · (clamp(d(p) / R, 0, 1))^power
```

`target` is **scale-free** — it is evaluated in viewport-local coordinates and has no absolute world-space floor. A block of side `s` is split into four `s/2` squares only when

```
depth < maxDepth  AND  s > 1.35 · target(centre)  AND  s · scale > 2.1 · minPx
```

Consequences:

- Far from any focus, `target = L`, so a macro block never splits: no small squares in the outskirts.
- Near a focus, `target → 0`, so subdivision continues for as long as the zoom requires.
- Because every split is a partition of its parent into four congruent squares, the union is exactly the original rectangle.

### 3.4 Level of detail and exactness

Only tiles intersecting the current viewport are generated. `generate()` retries with a coarser `minPx` if the block cap is hit, so the whole frame stays at one consistent subdivision level instead of showing a half-fine / half-coarse seam. `validate()` uses a sweep-line interval union to assert `gaps = 0`, `overlaps = 0`, and exact area conservation.

### 3.5 Precision

`js/bigdec.js` implements BigInt fixed-point decimals with `PREC = 80`: `add`, `sub`, `mul`, `div`, `cmp`, `toNumber`, `toString`, plus parsing of decimal and scientific notation. Camera centres `cx`, `cy` and the anchored-zoom equations are kept in `BigDec`. For rasterisation the camera is decomposed into a double main value and a residual:

```
screenX = (worldX - cxHi) · scale + W/2 - offX
screenY = (worldY - cyHi) · scale + H/2 - offY
```

The residual `offX/offY` is the exact `BigDec` difference converted once to a double. This keeps the fast Canvas 2D path while eliminating the drift that plain doubles would accumulate after a billion-fold zoom.

### 3.6 Colouring

An `O(n log n)` sweep-line merge builds the edge-adjacency graph. Tiles are then coloured largest-first from a 32-entry low-chroma palette (saturation 28–35 %, lightness in a narrow band, no achromatic fills). A candidate colour is rejected outright if a coloured neighbour already uses it. A chained `mix32` integer-grid hash (two avalanches packed into an exact 53-bit double) supplies stable per-tile jitter and a viewport-relative hue flow, so dense regions read as a colour field rather than a checkerboard. Colours are cached by integer grid coordinates and remain stable while panning and across LOD changes.

### 3.7 Classic modes: exact coverage by substitution

Both classic modes start from an exact Euclidean dissection of the world (whose
aspect ratio is the integer ratio `m:n`), so the skeleton already covers the
**whole** frame. The `network` mode then applies the Smith-diagram idea that a
resistor may be replaced by a sub-network: every skeleton square becomes a
`33 x 33` lattice whose upper `33 x 32` cells are the nine distinct Moroń
squares and whose last row is closed by 33 unit squares — 42 squares in total,
still an exact cover.

Density is then controlled by an L-shaped ladder substitution. With `t = s/k`
(`k = 3`), one square becomes one `(k-1)t` square plus `2k-1` tiles of side
`t`: `2k` squares whose areas satisfy

```
((k-1)t)^2 + (2k-1)t^2 = k^2 t^2 = s^2 .
```

Every substitution is a partition, so coverage stays at exactly 100 % for any
number of levels. Splitting is driven by the on-screen size `s * scale` and the
*Subdivision order* slider: zooming in unfolds new levels, off-screen tiles are
pruned, and the square count can grow from a few hundred to tens of thousands.

---

### 3.8 Established algorithms, minimum tiling, and multicore WASM

A literature review (`essay.en.html`, Section 10) places the project among mature algorithms. Brooks–Smith–Stone–Tutte turned squaring into the enumeration of 3-connected planar graphs (c-nets); Tutte's Wheel Theorem and later [plantri](https://users.cecs.anu.edu.au/~bdm/plantri/) generate them isomorphism-free, Kirchhoff equations plus the [matrix-tree theorem](https://en.wikipedia.org/wiki/Kirchhoff%27s_theorem) give integer currents (= square sizes), and the results are archived as Bouwkampcode / tablecode by [Squaring.Net](https://www.squaring.net/sq/ss/tws.html). Cannon–Floyd–Parry's finite subdivision rules (`subdivide.c` / `squarect.c`) are the academic counterpart of our ladder and Moron substitutions.

The **far field** now starts from the Euclidean continued-fraction skeleton, i.e. the largest-square greedy dissection with exactly `Σ qᵢ` squares. This is deliberately called a *minimum-tile skeleton*, not a proven optimum: [Kenyon (1996)](https://arxiv.org/abs/math/9411215) proved a `log₂ p` lower bound and showed the greedy strategy needs `p+1` squares on a `p×(p+1)` rectangle where `O(log p)` suffices; exact solutions use ILP / MTRS models ([Monaci & dos Santos, 2014](http://www.din.uem.br/sbpo/sbpo2014/pdf/arq0373.pdf)). Our choice is constructive, binary-exact and preserves 100 % coverage when refined, while **user-defined dense centres** (double-click to add, drag a marker to move, right-click to remove) apply to all three modes and are already sub-pixel fine on the very first frame.

The subdivision hot path is a C++17 kernel (`native/tiling_core.cpp`) compiled with Zig's clang to `wasm32-freestanding` (no Emscripten, no libc, ~9 KB, one imported memory). Rebuild with `node tools/build-wasm.js`. A pool of up to eight Web Workers each instantiates the module and evaluates disjoint root regions in parallel; results are returned as transferable buffers, so **no SharedArrayBuffer / COOP / COEP headers are needed** (which GitHub Pages cannot set). The first frame uses a synchronous main-thread WASM instance; if WASM or Workers are unavailable the engine falls back to `js/squaring.js` with identical tiles. True wasm pthreads with shared linear memory remain available through the optional `?coi=1` mode, where `sw.js` injects COOP/COEP ([technique](https://github.com/gzuidhof/coi-serviceworker)) at the cost of one reload. The same service worker provides offline caching and [desktop installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

---

## 4. Project structure

```
Square-division/
├── index.html            # Glass top bar, console, HUD, zoom bar, essay modal
├── essay.zh.html         # Technical essay, Chinese (self-contained, inline SVG, linked refs)
├── essay.en.html         # Technical essay, English (self-contained, inline SVG, linked refs)
├── manifest.webmanifest  # Installable PWA manifest (standalone, 192/512 icons)
├── sw.js                 # Offline cache + optional COOP/COEP injection
├── css/style.css         # Themes, glassmorphism, subtle gradients, responsive layout
├── js/
│   ├── i18n.js           # Chinese / English dictionaries and DOM text binding
│   ├── bigdec.js         # BigInt fixed-point decimals (80 fractional digits)
│   ├── squaring.js       # Dissection engine, adjacency graph, colouring, validation
│   ├── wasm-module.js    # Generated: base64-inlined C++/WASM binary (offline workers)
│   ├── wasm-engine.js    # Task splitter, worker pool, synchronous first frame, fallbacks
│   ├── tiling-worker.js  # One C++/WASM instance per worker thread
│   └── app.js            # Camera, rendering, gestures, state, export, UI bindings
├── native/
│   └── tiling_core.cpp   # C++17 freestanding quadtree kernel (no libc)
├── wasm/
│   └── tiling_core.wasm  # Compiled kernel (~9 KB, imports one linear memory)
├── tools/
│   ├── build-wasm.js     # Rebuild kernel + js/wasm-module.js (needs Zig)
│   └── make-icons.js     # Generate PWA PNG icons (pure Node, no image library)
├── icons/                # icon-192.png, icon-512.png, icon-maskable-512.png
├── tests/verify.js       # Node verification suite, 34 assertions, zero dependencies
├── README.md             # This file
└── README.zh-CN.md       # 中文说明
```

All source comments are written in English; the user-facing Chinese strings live only in `js/i18n.js`.

---

## 5. Controls

### Gestures

| Action | Desktop | Touch |
| --- | --- | --- |
| Draw a rectangle / pan | Drag to draw (initial state); drag to pan afterwards | One-finger drag |
| Redraw a new rectangle | `Shift` + drag, or press `R` | Collapse the console, then use the **Redraw** button |
| Zoom | Mouse wheel (anchored at cursor), `+` / `-` | Two-finger pinch |
| Fit to view | `F` or the fit button | Fit button |
| Add a dense centre | Double-click (max 6) | — |
| Remove the nearest centre | Right-click (context menu) | — |
| Compute | `Enter` or the **Compute** button | **Compute** button |
| Close overlays | `Escape` | Close button |

The camera is finite even though the zoom is not: the viewport can never be dragged off the rectangle (it stops flush with the border, and an axis whose world extent is smaller than the screen is pinned to the centre), while zooming out stops at the fitted frame. Zooming in remains effectively unbounded — the scale ceiling is `10¹² ×` the fit scale.

### Console parameters

| Parameter | Meaning |
| --- | --- |
| Dissection algorithm | Quadtree field / Euclidean / Moroń network |
| Dense centres | Number of foci, 1–6 |
| Dense-centre radius | Influence radius as a fraction of `min(W,H)` (0.20–1.20) |
| Focus strength | Exponent `power` of the size field |
| Macro precision | `D` in `L = 2^D` |
| Palette | Spectrum / Sky / Warm |
| Random seed | Deterministic colour and focus layout; integer `1 – 2147483646`, values outside the range are clamped |
| Subdivision order | Core width / refinement budget, active in all three modes (0–6) |
| Ratio presets | `1:1`, `3:2`, `16:9`, golden ratio, `2:3`, … |
| Display options | Grid, animation, side labels, focus markers |

Theme and language are persisted in `localStorage`.

### URL parameters

Useful for sharing a state or for automated screenshots:

| Key | Example | Effect |
| --- | --- | --- |
| `demo` | `demo=1` | Generate a finished tiling immediately |
| `mode` | `mode=quad\|euclid\|network` | Dissection algorithm |
| `centers` | `centers=3` | Number of dense centres |
| `ratio` | `ratio=1.5` | Rectangle aspect ratio |
| `zoom` | `zoom=2000000` | Zoom multiplier centred on the first focus |
| `theme` | `theme=light` | `dark` or `light` |
| `lang` | `lang=en` | `zh` or `en` |
| `palette` | `palette=warm` | Palette name |
| `order` | `order=4` | Ladder subdivision order for the classic modes |
| `console` | `console=0` | Start with the console collapsed |
| `modal` | `modal=1` | Open the explainer on load |
| `radius` | `radius=0.8` | Dense-centre influence radius |
| `seed` | `seed=2026` | Random seed, clamped to `1 – 2147483646` |
| `debug` | `debug=1` | Expose the read-only `window.SquaringLab` diagnostics used by the browser tests |
| `coi` | `coi=1` | Optional COOP/COEP injection for shared-memory WASM |
| `pwa` | `pwa=1` | Start URL used by the installed app |

Example:

```
https://xiaoxu4452.github.io/Square-division/?demo=1&mode=quad&centers=3&theme=dark&lang=en&zoom=2000000
```

---

## 6. Verification

`node tests/verify.js` asserts 34 invariants, including:

- exact area conservation, zero gaps, zero overlaps;
- zero same-colour adjacency over ~93 000 edges at 10^9× zoom;
- no black / white / grey fills, 25 distinct hues in the full view and 16 hue buckets at deep zoom;
- no large flat tiles at 10^9× zoom (all tiles ≈ 5.59 px);
- 4096 consecutive integer-grid coordinates produce 4096 distinct hashes;
- strict `target(far) = min(W,H)` — the minimum-tile skeleton is never subdivided away from foci;
- `0.1 + 0.2 = 0.3` in `BigDec`, and 40 chained anchored zooms stay finite;
- exact full-frame coverage of `euclid` and `network` at seven aspect ratios;
- nine Moroń sides summing to `1056 = 33 x 32`, monotonic growth of the square count with the subdivision order, gap-free coverage of a 77,751-square dense classic tiling, and custom-centre tests for all three modes (fine cores follow the moved centre).

Browser layout was additionally checked with real Chrome DevTools Protocol device emulation at `390 × 844`, `360 × 800`, `844 × 390` and `1600 × 900`, with zero overflowing elements.

---

## 7. Deployment (GitHub Pages)

The repository is a static site served from the root of the `main` branch.

1. Push the repository to `github.com/xiaoxu4452/Square-division`.
2. Open **Settings → Pages**.
3. Set **Build and deployment → Source** to *Deploy from a branch*, **Branch** to `main` / `root`.
4. Save; the site becomes available at `https://xiaoxu4452.github.io/Square-division/`.

No Jekyll build, no bundler and no `.nojekyll` marker are required.
### Install as a desktop app

On HTTPS (or localhost) the site is an installable PWA: Chromium shows an **Install app** button in the top bar once the install prompt is available; Edge/Chrome also offer *Install this site* from the browser menu. The service worker caches every asset for offline use. Opening `?coi=1` additionally opts into cross-origin isolation for shared-memory WASM experiments.



---

## 8. References

- Brooks, R. L.; Smith, C. A. B.; Stone, A. H.; Tutte, W. T. — *The Dissection of Rectangles into Squares*, Duke Mathematical Journal, 1940.
- Moroń, Z. — *O rozkładach prostokątów na kwadraty*, 1925 (33 × 32 perfect rectangle).
- Sprague, R. — *Beispiel einer Zerlegung des Quadrats in lauter verschiedene Quadrate*, 1939.
- Duijvestijn, A. J. W. — *Simple perfect squared square of lowest order*, 1978 (order 21).
- Conway, J. H. — *Mrs. Perkins's Quilt*.
- Wikipedia — [Squaring the square](https://en.wikipedia.org/wiki/Squaring_the_square), [Continued fraction](https://en.wikipedia.org/wiki/Continued_fraction), [Smith diagram](https://en.wikipedia.org/wiki/Smith_diagram), [Dehn invariant](https://en.wikipedia.org/wiki/Dehn_invariant).
- R. Kenyon — [Tiling a rectangle with the fewest squares](https://arxiv.org/abs/math/9411215), 1996 (log₂p bound; greedy is not optimal).
- M. Monaci, A. G. dos Santos — [Minimum Tiling of a Rectangle by Squares](http://www.din.uem.br/sbpo/sbpo2014/pdf/arq0373.pdf), SBPO 2014.
- [Squaring.Net: Tiling by Squares](https://www.squaring.net/sq/ss/tws.html) · [order-21 SPSS](https://www.squaring.net/sq/ss/spss/o21/spsso21.html) · [CPSS catalogue](https://www.squaring.net/sq/ss/cpss/cpss.html) · [plantri](https://users.cecs.anu.edu.au/~bdm/plantri/).
- S. E. Anderson — [Compound Perfect Squared Squares of the Order Twenties](https://arxiv.org/abs/1303.0599), 2013.
- [Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html) · [web.dev: COOP/COEP](https://web.dev/articles/coop-coep) · [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) · [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
