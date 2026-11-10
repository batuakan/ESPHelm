// The engine tile's icons (ADR-0032) filled into an A8 mask at the size they are shown: the
// contours from esphelm_engine_shapes.h (generated from packages/schema/src/engine.ts), the nonzero
// rule as in the editor's SVG, antialiased with SUBSAMPLES sub-scanlines per row and exact
// coverage along each span. Runs at layout time, never per value update. No LVGL in here, so the
// schema's g++ test can check it.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "esphelm_engine_shapes.h"

namespace esphelm {
namespace icon {

inline constexpr int SUBSAMPLES = 4;

namespace detail {
/// Adds the coverage of the span [a, b) on one sub-scanline to `acc` (one entry per pixel).
inline void add_span(std::vector<float> &acc, double a, double b) {
  const int n = static_cast<int>(acc.size());
  a = std::max(0.0, a);
  b = std::min(static_cast<double>(n), b);
  if (b <= a)
    return;
  const int ia = static_cast<int>(a), ib = static_cast<int>(b);
  if (ia == ib) {
    acc[ia] += static_cast<float>(b - a);
    return;
  }
  acc[ia] += static_cast<float>(ia + 1 - a);
  for (int i = ia + 1; i < ib; i++)
    acc[i] += 1.0f;
  if (ib < n)
    acc[ib] += static_cast<float>(b - ib);
}
}  // namespace detail

/// `out` becomes side x side bytes (row by row) of `icon` scaled to the box, 0 outside, 255 inside.
inline void rasterize(const engine_shapes::Icon &icon, int side, std::vector<uint8_t> &out) {
  out.assign(side > 0 ? static_cast<size_t>(side) * side : 0, 0);
  if (side <= 0)
    return;
  struct Cross {
    double x;
    int dir;
  };
  std::vector<Cross> xs;
  std::vector<float> acc(side);
  for (int row = 0; row < side; row++) {
    std::fill(acc.begin(), acc.end(), 0.0f);
    for (int k = 0; k < SUBSAMPLES; k++) {
      const double y = row + (k + 0.5) / SUBSAMPLES;
      xs.clear();
      for (uint8_t c = 0; c < icon.count; c++) {
        const engine_shapes::Contour &ct = icon.contours[c];
        for (uint16_t i = 0; i < ct.count; i++) {
          const uint16_t j = (i + 1) % ct.count;
          const double x0 = ct.pts[2 * i] * side, y0 = ct.pts[2 * i + 1] * side;
          const double x1 = ct.pts[2 * j] * side, y1 = ct.pts[2 * j + 1] * side;
          if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y))
            xs.push_back({x0 + (y - y0) * (x1 - x0) / (y1 - y0), y1 > y0 ? 1 : -1});
        }
      }
      std::sort(xs.begin(), xs.end(), [](const Cross &a, const Cross &b) { return a.x < b.x; });
      int winding = 0;
      double start = 0;
      for (const Cross &x : xs) {
        const int before = winding;
        winding += x.dir;
        if (before == 0 && winding != 0)
          start = x.x;
        else if (before != 0 && winding == 0)
          detail::add_span(acc, start, x.x);
      }
    }
    for (int x = 0; x < side; x++) {
      const long v = std::lround(acc[x] * 255.0f / SUBSAMPLES);
      out[static_cast<size_t>(row) * side + x] = static_cast<uint8_t>(std::min(255L, std::max(0L, v)));
    }
  }
}

}  // namespace icon
}  // namespace esphelm
