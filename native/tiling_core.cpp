/*
 * tiling_core.cpp - WebAssembly kernel for the squared-rectangle laboratory.
 *
 * This is a genuine C++17 kernel compiled to wasm32 with no runtime and no
 * libc. It performs the hot part of the quadtree dissection: the recursive,
 * focus-driven subdivision of a root square into visible tiles. The browser
 * runs several independent instances of this module, one per Web Worker, so
 * disjoint root regions are evaluated in parallel on separate CPU cores.
 *
 * Memory is IMPORTED from JavaScript. The host writes the dense-centre list
 * into a small input area and receives [x, y, s, depth] quadruples in an
 * output area. Using imported memory (rather than an exported one) lets the
 * host supply either a private WebAssembly.Memory or a SharedArrayBuffer-
 * backed shared memory without rebuilding the module.
 *
 * Build (Zig ships a clang that targets wasm32 without Emscripten):
 *   zig c++ -target wasm32-freestanding -O ReleaseFast -fno-exceptions \
 *      -fno-rtti -nostdlib -Wl,--no-entry -Wl,--import-memory \
 *      -o wasm/tiling_core.wasm native/tiling_core.cpp
 */

/* Freestanding: no C++ standard headers are available in wasm32-none. */
using u64 = unsigned long long;
using i32 = int;
using uptr = unsigned int;

/* ------------------------------------------------------------------ math */
/* wasm MVP has f64.sqrt, but no f64.pow / libm. Implement ln, exp and pow
 * from a mantissa/exponent decomposition plus short convergent series. The
 * size field only needs ~1e-9 relative accuracy, far below what is used. */

static inline double from_bits(u64 b) {
  double d;
  __builtin_memcpy(&d, &b, sizeof(d));
  return d;
}
static inline u64 to_bits(double d) {
  u64 b;
  __builtin_memcpy(&b, &d, sizeof(b));
  return b;
}
static inline double pow2i(int n) {
  if (n < -1022) return 0.0;
  if (n > 1023) return 1.7976931348623157e308;
  return from_bits(static_cast<u64>(n + 1023) << 52);
}
static inline double f_ln(double x) {
  if (x <= 0.0) return -745.0;
  u64 b = to_bits(x);
  int e = static_cast<int>((b >> 52) & 0x7ff) - 1023;
  double m = from_bits((b & 0x000fffffffffffffULL) | (1023ULL << 52));
  double z = (m - 1.0) / (m + 1.0), z2 = z * z, term = z, sum = 0.0;
  for (int k = 1; k <= 27; k += 2) { sum += term / k; term *= z2; }
  return 2.0 * sum + e * 0.69314718055994530942;
}
static inline double f_exp(double x) {
  if (x < -745.0) return 0.0;
  if (x > 709.0) return 1.7976931348623157e308;
  double y = x * 1.4426950408889634074;     // x / ln 2
  int n = static_cast<int>(y);              // truncates toward zero
  if (y < 0.0 && n != y) n -= 1;            // floor for negative y
  double f = y - n;                         // [0, 1)
  double u = f * 0.69314718055994530942, term = 1.0, sum = 1.0;
  for (int k = 1; k <= 15; ++k) { term *= u / k; sum += term; }
  return pow2i(n) * sum;
}
static inline double f_pow(double a, double b) {
  if (a <= 0.0) return 0.0;
  if (b == 1.0) return a;
  if (b == 2.0) return a * a;
  return f_exp(b * f_ln(a));
}
static inline double clamp01(double v) {
  return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

/* --------------------------------------------------------------- context */
struct Context {
  double *in;            // [nfoci, x0,y0, x1,y1, ...] in viewport-local units
  double *out;           // [x, y, s, depth] * tiles
  int nfoci;
  double hw, hh, scale;
  double radius, power, farTarget, minPx, boost;
  int maxDepth, maxTiles;
  int count;
  bool overflow;
};

static Context C;

static inline double focus_distance(double x, double y) {
  double best = 1.0e300;
  const double *p = C.in + 1;
  for (int i = 0; i < C.nfoci; ++i) {
    double dx = x - p[2 * i], dy = y - p[2 * i + 1];
    double d = __builtin_sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
}

static void walk(double x, double y, double s, int depth) {
  if (C.overflow) return;
  if (x > C.hw || y > C.hh || x + s < -C.hw || y + s < -C.hh) return;
  if (C.count >= C.maxTiles) { C.overflow = true; return; }

  double cx = x + s * 0.5, cy = y + s * 0.5;
  double d = focus_distance(cx, cy);
  double t = d / C.radius;
  if (t > 1.0) t = 1.0;
  double target = C.farTarget * f_pow(t, C.power);
  double w = f_pow(clamp01(1.0 - d / C.radius), C.power);
  double floorPx = C.minPx * (1.0 - C.boost * w);

  if (depth < C.maxDepth && s > target * 1.35 && s * C.scale > floorPx * 2.1) {
    double h = s * 0.5;
    walk(x, y, h, depth + 1);
    walk(x + h, y, h, depth + 1);
    walk(x, y + h, h, depth + 1);
    walk(x + h, y + h, h, depth + 1);
  } else {
    double *o = C.out + 4 * C.count;
    o[0] = x; o[1] = y; o[2] = s; o[3] = static_cast<double>(depth);
    ++C.count;
  }
}

/*
 * Subdivide one root square. The host pre-splits the Euclidean skeleton into
 * independent tasks, so each call is a self-contained, thread-safe job.
 *
 * Returns the tile count, or -1 when maxTiles was exceeded.
 */
extern "C" __attribute__((export_name("tile_region")))
int tile_region(
    double x, double y, double s, double hw, double hh, double scale,
    double radius, double power, double farTarget, double minPx, double boost,
    int maxDepth, int maxTiles, int depth0, int inPtr, int outPtr) {
  C.in = reinterpret_cast<double *>(static_cast<uptr>(inPtr));
  C.out = reinterpret_cast<double *>(static_cast<uptr>(outPtr));
  C.nfoci = static_cast<int>(C.in[0]);
  if (C.nfoci < 0) C.nfoci = 0;
  if (C.nfoci > 8) C.nfoci = 8;
  C.hw = hw; C.hh = hh; C.scale = scale;
  C.radius = radius; C.power = power; C.farTarget = farTarget;
  C.minPx = minPx; C.boost = boost;
  C.maxDepth = maxDepth; C.maxTiles = maxTiles;
  C.count = 0; C.overflow = false;
  walk(x, y, s, depth0);
  return C.overflow ? -1 : C.count;
}

/* ====================================================================== */
/* Perfect squared-rectangle search                                        */
/*                                                                         */
/* A skyline backtracker that tiles an arbitrary integer W x H rectangle   */
/* with squares whose side lengths are PAIRWISE DISTINCT integers. Every   */
/* tiling can be generated by repeatedly filling the leftmost lowest notch */
/* (the square covering that notch must have its lower-left corner there), */
/* so the enumeration is complete. Exact i64 area arithmetic is used for   */
/* the pruning bound and for the final verification; no floating point is  */
/* involved. Different seeds permute the candidate order, so a stream of   */
/* different solutions can be produced; scaling and self-substitution      */
/* then turn any primitive solution into an unbounded family.              */
/* ====================================================================== */
enum { PF_MAX_W = 512, PF_MAX_N = 1024, PF_OUT_CAP = 120000, PF_SIG_CAP = 8192 };
static int    pf_h[PF_MAX_W];
static int    pf_x[PF_MAX_N], pf_y[PF_MAX_N], pf_s[PF_MAX_N], pf_tmp[PF_MAX_N];
static unsigned long long pf_used[PF_MAX_W / 64 + 2];
static long long pf_prefix[PF_MAX_W + 1];
static int    pf_order[PF_MAX_W + 1];
static double pf_key[PF_MAX_W + 1];
static unsigned long long pf_sig[PF_SIG_CAP];
static int    pf_sigCount;
static int    pf_W, pf_H, pf_maxSide, pf_minOrder, pf_placed;
static long long pf_area, pf_target, pf_nodes, pf_maxNodes;
static int    pf_solutions, pf_maxSolutions, pf_bestOrder;
static int   *pf_out, pf_outUsed;
static bool   pf_truncated;
static unsigned pf_rng;

static inline unsigned pf_xr() {
  pf_rng ^= pf_rng << 13; pf_rng ^= pf_rng >> 17; pf_rng ^= pf_rng << 5;
  return pf_rng;
}
static inline bool pf_usedHas(int s) {
  return (pf_used[s >> 6] >> (s & 63)) & 1ULL;
}
static inline void pf_usedSet(int s, bool v) {
  unsigned long long bit = 1ULL << (s & 63);
  if (v) pf_used[s >> 6] |= bit; else pf_used[s >> 6] &= ~bit;
}
static unsigned long long pf_signature() {
  int n = pf_placed, i, j;
  for (i = 0; i < n; ++i) pf_tmp[i] = pf_s[i];
  for (i = 1; i < n; ++i) {
    int v = pf_tmp[i]; j = i - 1;
    while (j >= 0 && pf_tmp[j] > v) { pf_tmp[j + 1] = pf_tmp[j]; --j; }
    pf_tmp[j + 1] = v;
  }
  unsigned long long h = 1469598103934665603ULL;
  for (i = 0; i < n; ++i) {
    h ^= (unsigned long long)(unsigned)pf_tmp[i];
    h *= 1099511628211ULL;
  }
  return h;
}
static void pf_record() {
  unsigned long long sig = pf_signature();
  for (int i = 0; i < pf_sigCount; ++i) if (pf_sig[i] == sig) return;
  if (pf_sigCount < PF_SIG_CAP) pf_sig[pf_sigCount++] = sig;
  int need = 1 + 3 * pf_placed;
  if (pf_outUsed + need > PF_OUT_CAP) { pf_truncated = true; return; }
  int *o = pf_out + pf_outUsed;
  o[0] = pf_placed;
  for (int i = 0; i < pf_placed; ++i) {
    o[1 + 3 * i] = pf_x[i]; o[2 + 3 * i] = pf_y[i]; o[3 + 3 * i] = pf_s[i];
  }
  pf_outUsed += need;
  ++pf_solutions;
  if (pf_placed > pf_bestOrder) pf_bestOrder = pf_placed;
}
static void pf_dfs() {
  if (++pf_nodes > pf_maxNodes) { pf_truncated = true; return; }
  if (pf_placed >= PF_MAX_N) return;
  int y = 0x3fffffff, x = 0, i;
  for (i = 0; i < pf_W; ++i) if (pf_h[i] < y) { y = pf_h[i]; x = i; }
  if (y == pf_H) {
    if (pf_placed >= pf_minOrder) pf_record();
    return;
  }
  int avail = 0;
  while (x + avail < pf_W && pf_h[x + avail] == y) ++avail;
  int maxS = avail < (pf_H - y) ? avail : (pf_H - y);
  if (maxS > pf_maxSide) maxS = pf_maxSide;
  if (maxS < 1) return;
  // Even using every remaining distinct side we must be able to cover the
  // unplaced area. pf_area is exactly the sum of the squares already used.
  if (pf_prefix[pf_maxSide] - pf_area < pf_target - pf_area) return;
  for (int k = 0; k < pf_maxSide && !pf_truncated; ++k) {
    int s = pf_order[k];
    if (s > maxS || pf_usedHas(s)) continue;
    pf_usedSet(s, true);
    pf_x[pf_placed] = x; pf_y[pf_placed] = y; pf_s[pf_placed] = s;
    ++pf_placed; pf_area += (long long)s * s;
    for (i = 0; i < s; ++i) pf_h[x + i] = y + s;
    pf_dfs();
    for (i = 0; i < s; ++i) pf_h[x + i] = y;
    pf_area -= (long long)s * s; --pf_placed;
    pf_usedSet(s, false);
    if (pf_solutions >= pf_maxSolutions) return;
  }
}

/**
 * Search perfect dissections of a W x H integer rectangle.
 * Output: repeated [n, x0,y0,s0, ..., xn-1,yn-1,sn-1] int32 triples.
 * stats:  [nodes, solutions, truncated, largestOrder].
 * Returns the number of solutions written, or -1 for invalid parameters.
 */
extern "C" __attribute__((export_name("perfect_search")))
int perfect_search(int W, int H, unsigned seed, int maxNodes, int maxSolutions,
                   int minOrder, int outPtr, int statsPtr) {
  int *stats = reinterpret_cast<int *>(static_cast<uptr>(statsPtr));
  stats[0] = stats[1] = stats[2] = stats[3] = 0;
  if (W < 2 || H < 2 || W > PF_MAX_W || H > PF_MAX_W) return -1;
  pf_W = W; pf_H = H;
  pf_maxSide = W < H ? W : H;
  if (pf_maxSide > 384) pf_maxSide = 384;
  pf_minOrder = minOrder < 2 ? 2 : (minOrder > PF_MAX_N ? PF_MAX_N : minOrder);
  if (pf_minOrder > pf_maxSide) pf_minOrder = pf_maxSide;
  pf_maxNodes = maxNodes < 1 ? 1 : maxNodes;
  pf_maxSolutions = maxSolutions < 1 ? 1 : (maxSolutions > 256 ? 256 : maxSolutions);
  pf_target = (long long)W * H;
  pf_out = reinterpret_cast<int *>(static_cast<uptr>(outPtr));
  pf_outUsed = 0; pf_solutions = 0; pf_bestOrder = 0;
  pf_sigCount = 0; pf_truncated = false; pf_area = 0;
  pf_nodes = 0; pf_placed = 0; pf_rng = seed | 1U;
  for (int i = 0; i < pf_W; ++i) pf_h[i] = 0;
  for (unsigned i = 0; i < sizeof(pf_used) / sizeof(pf_used[0]); ++i) pf_used[i] = 0;
  pf_prefix[0] = 0;
  for (int i = 1; i <= pf_maxSide; ++i) pf_prefix[i] = pf_prefix[i - 1] + (long long)i * i;
  for (int i = 1; i <= pf_maxSide; ++i) {
    pf_order[i - 1] = i;
    pf_key[i - 1] = (double)i * (0.62 + 0.76 * ((double)pf_xr() / 4294967296.0));
  }
  for (int i = 1; i < pf_maxSide; ++i) {       // insertion sort by seeded key
    int os = pf_order[i]; double ks = pf_key[i], kj; int j = i - 1;
    while (j >= 0 && pf_key[j] < ks) {
      pf_order[j + 1] = pf_order[j]; pf_key[j + 1] = pf_key[j]; --j;
    }
    pf_order[j + 1] = os; pf_key[j + 1] = ks;
  }
  pf_dfs();
  stats[0] = pf_nodes > 2147483647LL ? 2147483647 : (int)pf_nodes;
  stats[1] = pf_solutions;
  stats[2] = pf_truncated ? 1 : 0;
  stats[3] = pf_bestOrder;
  return pf_solutions;
}

/* ---------------------- Exact tiling verification ---------------------- */
enum { VF_MAX_N = 2048, VF_MAX_X = 2 * VF_MAX_N + 4 };
static int vf_xs[VF_MAX_X], vf_y0[VF_MAX_N], vf_y1[VF_MAX_N];

/**
 * Verify an integer tiling exactly: positive distinct sides, inside frame,
 * area conservation and complete non-overlapping coverage.
 * stats: [gaps, overlaps, duplicateSides, area]. Returns 1 when all zero.
 */
extern "C" __attribute__((export_name("perfect_verify")))
int perfect_verify(int W, int H, int cellsPtr, int n, int statsPtr) {
  int *stats = reinterpret_cast<int *>(static_cast<uptr>(statsPtr));
  stats[0] = stats[1] = stats[2] = stats[3] = 0;
  if (W < 1 || H < 1 || n < 1 || n > VF_MAX_N) return 0;
  int *c = reinterpret_cast<int *>(static_cast<uptr>(cellsPtr));
  long long area = 0;
  int nx = 0;
  vf_xs[nx++] = 0; vf_xs[nx++] = W;
  for (int i = 0; i < n; ++i) {
    int x = c[3 * i], y = c[3 * i + 1], s = c[3 * i + 2];
    if (s <= 0 || x < 0 || y < 0 || x + s > W || y + s > H) return 0;
    area += (long long)s * s;
    vf_xs[nx++] = x; vf_xs[nx++] = x + s;
  }
  for (int i = 1; i < nx; ++i) {              // sort + unique slab boundaries
    int v = vf_xs[i], j = i - 1;
    while (j >= 0 && vf_xs[j] > v) { vf_xs[j + 1] = vf_xs[j]; --j; }
    vf_xs[j + 1] = v;
  }
  int m = 0;
  for (int i = 0; i < nx; ++i) if (i == 0 || vf_xs[i] != vf_xs[i - 1]) vf_xs[m++] = vf_xs[i];
  for (int k = 0; k + 1 < m; ++k) {
    int xa = vf_xs[k], xb = vf_xs[k + 1];
    if (xb - xa < 1) continue;
    int mid = (xa + xb) >> 1, cnt = 0;
    for (int i = 0; i < n; ++i) {
      int x = c[3 * i], s = c[3 * i + 2];
      if (x <= mid && mid < x + s) { vf_y0[cnt] = c[3 * i + 1]; vf_y1[cnt] = c[3 * i + 1] + s; ++cnt; }
    }
    for (int i = 1; i < cnt; ++i) {           // sort intervals by lower edge
      int a = vf_y0[i], b = vf_y1[i], j = i - 1;
      while (j >= 0 && vf_y0[j] > a) {
        vf_y0[j + 1] = vf_y0[j]; vf_y1[j + 1] = vf_y1[j]; --j;
      }
      vf_y0[j + 1] = a; vf_y1[j + 1] = b;
    }
    int cursor = 0;
    for (int i = 0; i < cnt; ++i) {
      if (vf_y0[i] > cursor) ++stats[0];
      else if (vf_y0[i] < cursor) ++stats[1];
      if (vf_y1[i] > cursor) cursor = vf_y1[i];
    }
    if (cursor < H) ++stats[0];
  }
  for (int i = 0; i < n; ++i) {                // pairwise-distinct side check
    for (int j = i + 1; j < n; ++j) if (c[3 * i + 2] == c[3 * j + 2]) ++stats[2];
  }
  long long target = (long long)W * H;
  stats[3] = area > 2147483647LL ? 2147483647 : (int)area;
  if (area != target) ++stats[0];
  return (stats[0] == 0 && stats[1] == 0 && stats[2] == 0) ? 1 : 0;
}

/* Version / capability probe, also useful to detect a stale build. */
extern "C" __attribute__((export_name("kernel_version")))
int kernel_version() { return 3; }
