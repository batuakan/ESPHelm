#pragma once
// Heading tape geometry (ADR-0022), mirroring tapeMarks() and tapeX() in
// packages/schema/src/headingTape.ts; fixtures/heading-tape.cases.json proves they agree. Pure
// C++ (no ESPHome or LVGL), so g++ tests it on the host.

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

#include "esphelm_sizes.h"

namespace esphelm {
namespace heading_tape {

enum class Kind : uint8_t { MINOR, MEDIUM, MAJOR };

/// One tick: its compass degree, its x from the tape's left edge, and whether it has a label.
struct Tick {
  int deg;
  float x;
  Kind kind;
  bool labelled;
};

/// The most ticks a tape can have (180 degrees, every 5).
static constexpr size_t MAX_TICKS = 37;

inline int norm(int d) { return ((d % 360) + 360) % 360; }
inline double norm(double v) { return std::fmod(std::fmod(v, 360.0) + 360.0, 360.0); }

/// A labelled tick's text: N, E, S, W at the cardinal points, the degrees elsewhere.
inline const char *label(int deg, char (&buf)[4]) {
  switch (norm(deg)) {
    case 0:
      return "N";
    case 90:
      return "E";
    case 180:
      return "S";
    case 270:
      return "W";
    default:
      std::snprintf(buf, sizeof(buf), "%d", norm(deg));
      return buf;
  }
}

/// The ticks across a tape `width` pixels wide showing `span` degrees around `heading`, left to
/// right, into `out` (MAX_TICKS long). Returns how many.
inline size_t marks(double heading, double span, double width, Tick *out) {
  const double px_per_deg = width / span;
  const bool minors = px_per_deg * 5 >= sizes::HEADING_TAPE_MINOR_TICK_PX;
  const bool tens = px_per_deg * 10 >= sizes::HEADING_TAPE_LABEL10_PX;
  size_t n = 0;
  const int first = static_cast<int>(std::ceil((heading - span / 2) / 5)) * 5;
  for (int d = first; d <= heading + span / 2 && n < MAX_TICKS; d += 5) {
    const int deg = norm(d);
    const Kind kind = deg % 30 == 0 ? Kind::MAJOR : deg % 10 == 0 ? Kind::MEDIUM : Kind::MINOR;
    if (kind == Kind::MINOR && !minors)
      continue;
    const double x = width / 2 + (d - heading) * px_per_deg;
    out[n++] = {deg, static_cast<float>(x), kind, kind == Kind::MAJOR || (tens && kind == Kind::MEDIUM)};
  }
  return n;
}

/// Where a marker at `value` degrees sits: x clamped to the tape; `off` -1 beyond the left
/// edge, 1 beyond the right, 0 on the tape. The shorter way round decides the side.
struct Position {
  double x;
  int off;
};
inline Position tape_x(double value, double heading, double span, double width) {
  const double delta = norm(value - heading + 180) - 180;  // [-180, 180)
  if (delta < -span / 2)
    return {0, -1};
  if (delta > span / 2)
    return {width, 1};
  return {width / 2 + delta * width / span, 0};
}

}  // namespace heading_tape
}  // namespace esphelm
