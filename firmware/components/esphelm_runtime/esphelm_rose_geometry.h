#pragma once
// Geometry of the black-and-white wind rose (the mono tile set, ADR-0038): the radii of its parts
// for a rose of a given size, and the strokes of the letters on its markers. Angles are degrees
// clockwise from the bow (up). Pure C++ (no ESPHome or LVGL), so g++ tests it on the host.

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace esphelm {
namespace rose_geometry {

struct Point {
  double x, y;
};

/// The point at radius `r` and angle `deg` around (cx, cy).
inline Point polar(double cx, double cy, double r, double deg) {
  const double a = deg * 3.14159265358979323846 / 180.0;
  return {cx + r * std::sin(a), cy - r * std::cos(a)};
}

/// Radii in px of a rose of diameter `d`, from the outside in: the sectors, the ticks, the card
/// band and the tip of a marker (which points at the band). `marker_half` is half the width of a
/// marker's base, which sits on the outer edge.
struct Radii {
  int32_t sector_out, sector_in;
  int32_t tick_out, tick_in, tick_in_long;
  int32_t band_out, band_in;
  int32_t marker_tip, marker_half;
};

inline Radii radii(int32_t d) {
  const int32_t r = std::max<int32_t>(d, 8) / 2;
  const auto pct = [r](int32_t p) { return r * p / 100; };
  // From the outside in, each part at its share of the radius but at least a pixel inside the one
  // before it, so a small rose still has every part (rounding could put two on one pixel).
  Radii o;
  o.sector_out = std::max<int32_t>(pct(99), 7);
  o.sector_in = std::min(pct(91), o.sector_out - 1);
  o.tick_out = std::min(pct(89), o.sector_in - 1);
  o.tick_in = std::min(pct(84), o.tick_out - 1);
  o.tick_in_long = std::min(pct(82), o.tick_in - 1);
  o.band_out = std::min(pct(81), o.tick_in_long - 1);
  o.band_in = std::min(pct(66), o.band_out - 1);
  o.marker_tip = std::max(pct(82), o.band_out);
  // About 11 % of the radius, but not under 13 px (a marker's letter needs that much) unless the
  // rose is so small that 14 % of the radius is less.
  o.marker_half = std::max<int32_t>(1, std::min<int32_t>(std::max<int32_t>(pct(11), 13), pct(14)));
  return o;
}

/// A stroke of a letter, in the letter's own frame: x to the right, y up, the letter about 1 high
/// and centred on the origin.
struct Stroke {
  double x1, y1, x2, y2;
};

constexpr int MAX_STROKES = 10;  // a compass label of two letters has up to nine

/// The strokes of `letter` (A, T or W); the number written to `out`, 0 for another letter.
inline int letter(char letter, Stroke out[MAX_STROKES]) {
  switch (letter) {
    case 'A':
      out[0] = {-0.5, -0.5, 0.0, 0.5};
      out[1] = {0.0, 0.5, 0.5, -0.5};
      out[2] = {-0.27, -0.12, 0.27, -0.12};
      return 3;
    case 'T':
      out[0] = {-0.5, 0.5, 0.5, 0.5};
      out[1] = {0.0, 0.5, 0.0, -0.5};
      return 2;
    case 'W':
      out[0] = {-0.6, 0.5, -0.3, -0.5};
      out[1] = {-0.3, -0.5, 0.0, 0.2};
      out[2] = {0.0, 0.2, 0.3, -0.5};
      out[3] = {0.3, -0.5, 0.6, 0.5};
      return 4;
    default:
      return 0;
  }
}

/// The strokes of a compass label, `text` being "N", "E", "S" or "W", or two of them ("NE", "SW"):
/// blocky letters 0.6 wide and 1 high, centred on the origin as a whole. Drawn as strokes rather
/// than with a font because LVGL turns a 1-bit font by an arbitrary angle into broken streaks.
/// The number of strokes written to `out`, 0 for an unknown label.
inline int label(const char *text, Stroke out[MAX_STROKES]) {
  const int count = text[0] != '\0' && text[1] != '\0' ? 2 : 1;
  if (count == 2 && text[2] != '\0')
    return 0;
  int n = 0;
  for (int i = 0; i < count; i++) {
    const double dx = count == 2 ? (i == 0 ? -0.45 : 0.45) : 0.0;
    Stroke s[5];
    int k = 0;
    switch (text[i]) {
      case 'N':
        s[k++] = {-0.3, -0.5, -0.3, 0.5};
        s[k++] = {-0.3, 0.5, 0.3, -0.5};
        s[k++] = {0.3, -0.5, 0.3, 0.5};
        break;
      case 'E':
        s[k++] = {0.3, 0.5, -0.3, 0.5};
        s[k++] = {-0.3, 0.5, -0.3, -0.5};
        s[k++] = {-0.3, -0.5, 0.3, -0.5};
        s[k++] = {-0.3, 0.0, 0.2, 0.0};
        break;
      case 'S':  // a squared S: top, upper left, middle, lower right, bottom
        s[k++] = {0.3, 0.5, -0.3, 0.5};
        s[k++] = {-0.3, 0.5, -0.3, 0.0};
        s[k++] = {-0.3, 0.0, 0.3, 0.0};
        s[k++] = {0.3, 0.0, 0.3, -0.5};
        s[k++] = {0.3, -0.5, -0.3, -0.5};
        break;
      case 'W':
        s[k++] = {-0.3, 0.5, -0.15, -0.5};
        s[k++] = {-0.15, -0.5, 0.0, 0.15};
        s[k++] = {0.0, 0.15, 0.15, -0.5};
        s[k++] = {0.15, -0.5, 0.3, 0.5};
        break;
      default:
        return 0;
    }
    for (int j = 0; j < k; j++)
      out[n++] = {s[j].x1 + dx, s[j].y1, s[j].x2 + dx, s[j].y2};
  }
  return n;
}

/// Where a point of a letter lands on screen: the letter is `h` px high, its centre sits at radius
/// `r` and angle `deg` around (cx, cy), and its top points away from the centre (as the card's
/// letters do), so it turns with the marker.
inline Point letter_point(double x, double y, double cx, double cy, double r, double deg, double h) {
  const Point c = polar(cx, cy, r, deg);
  const double a = deg * 3.14159265358979323846 / 180.0;
  const double ux = std::sin(a), uy = -std::cos(a);  // outwards
  const double tx = std::cos(a), ty = std::sin(a);   // along the ring, clockwise
  return {c.x + h * (x * tx + y * ux), c.y + h * (x * ty + y * uy)};
}

/// The three corners of a marker at `deg`: the tip towards the centre, then the two base corners
/// on `outer`.
inline void marker_corners(double cx, double cy, double outer, double tip, double half, double deg, Point out[3]) {
  const double a = deg * 3.14159265358979323846 / 180.0;
  const double ux = std::sin(a), uy = -std::cos(a);
  const double px = -uy, py = ux;
  out[0] = {cx + ux * tip, cy + uy * tip};
  out[1] = {cx + ux * outer + px * half, cy + uy * outer + py * half};
  out[2] = {cx + ux * outer - px * half, cy + uy * outer - py * half};
}

}  // namespace rose_geometry
}  // namespace esphelm
