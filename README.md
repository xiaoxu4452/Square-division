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

## 4. Project structure

```
Square-division/
├── index.html            # Glass top bar, console, HUD, zoom bar, essay modal
├── essay.zh.html         # Technical essay, Chinese (self-contained, inline SVG)
├── essay.en.html         # Technical essay, English (self-contained, inline SVG)
├── css/
│   └── style.css         # Themes, glassmorphism, subtle gradients, responsive layout
├── js/
│   ├── i18n.js           # Chinese / English dictionaries and DOM text binding
│   ├── bigdec.js         # BigInt fixed-point decimals (80 fractional digits)
│   ├── squaring.js       # Dissection engine, adjacency graph, colouring, validation
│   └── app.js            # Camera, rendering, gestures, state, export, UI bindings
├── tests/
│   └── verify.js         # Node verification suite (zero dependencies)
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

### Console parameters

| Parameter | Meaning |
| --- | --- |
| Dissection algorithm | Quadtree field / Euclidean / Moroń network |
| Dense centres | Number of foci, 1–6 |
| Focus strength | Exponent `power` of the size field |
| Macro precision | `D` in `L = 2^D` |
| Palette | Spectrum / Sky / Warm |
| Random seed | Deterministic colour and focus layout |
| Subdivision order | Ladder refinement level for `euclid` / `network` (0–6) |
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

Example:

```
https://xiaoxu4452.github.io/Square-division/?demo=1&mode=quad&centers=3&theme=dark&lang=en&zoom=2000000
```

---

## 6. Verification

`node tests/verify.js` asserts 24 invariants, including:

- exact area conservation, zero gaps, zero overlaps;
- zero same-colour adjacency over ~52 000 edges at 10^9× zoom;
- no black / white / grey fills, 30 distinct hues in the full view and 16 hue buckets at deep zoom;
- no large flat tiles at 10^9× zoom (all tiles ≈ 7.45 px);
- 4096 consecutive integer-grid coordinates produce 4096 distinct hashes;
- strict `target(far) = L` (no small tiles away from foci);
- `0.1 + 0.2 = 0.3` in `BigDec`, and 40 chained anchored zooms stay finite;
- exact full-frame coverage of `euclid` and `network` at seven aspect ratios;
- nine Moroń sides summing to `1056 = 33 x 32`, monotonic growth of the square count with the subdivision order, and gap-free coverage of a 44,851-square dense classic tiling.

Browser layout was additionally checked with real Chrome DevTools Protocol device emulation at `390 × 844`, `360 × 800`, `844 × 390` and `1600 × 900`, with zero overflowing elements.

---

## 7. Deployment (GitHub Pages)

The repository is a static site served from the root of the `main` branch.

1. Push the repository to `github.com/xiaoxu4452/Square-division`.
2. Open **Settings → Pages**.
3. Set **Build and deployment → Source** to *Deploy from a branch*, **Branch** to `main` / `root`.
4. Save; the site becomes available at `https://xiaoxu4452.github.io/Square-division/`.

No Jekyll build, no bundler and no `.nojekyll` marker are required.

---

## 8. References

- Brooks, R. L.; Smith, C. A. B.; Stone, A. H.; Tutte, W. T. — *The Dissection of Rectangles into Squares*, Duke Mathematical Journal, 1940.
- Moroń, Z. — *O rozkładach prostokątów na kwadraty*, 1925 (33 × 32 perfect rectangle).
- Sprague, R. — *Beispiel einer Zerlegung des Quadrats in lauter verschiedene Quadrate*, 1939.
- Duijvestijn, A. J. W. — *Simple perfect squared square of lowest order*, 1978 (order 21).
- Conway, J. H. — *Mrs. Perkins's Quilt*.
- Wikipedia — [Squaring the square](https://en.wikipedia.org/wiki/Squaring_the_square), [Continued fraction](https://en.wikipedia.org/wiki/Continued_fraction), [Smith diagram](https://en.wikipedia.org/wiki/Smith_diagram).
