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

/* Version / capability probe, also useful to detect a stale build. */
extern "C" __attribute__((export_name("kernel_version")))
int kernel_version() { return 2; }
