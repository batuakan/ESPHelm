#pragma once
// Engine tile geometry (ADR-0032), mirroring engineScale() and engineAngle() in
// packages/schema/src/engine.ts; fixtures/engine.cases.json proves they agree. The arcs, radii
// and icons are generated into esphelm_engine_shapes.h. Pure C++ (no ESPHome or LVGL), so g++
// tests it on the host.

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <initializer_list>

#include "esphelm_engine_shapes.h"
#include "esphelm_sizes.h"

namespace esphelm {
namespace engine {

enum class Gauge : uint8_t { RPM, LEFT, RIGHT, BOTTOM };

inline const engine_shapes::Arc &arc(Gauge g) {
  switch (g) {
    case Gauge::LEFT:
      return engine_shapes::LEFT_ARC;
    case Gauge::RIGHT:
      return engine_shapes::RIGHT_ARC;
    case Gauge::BOTTOM:
      return engine_shapes::BOTTOM_ARC;
    default:
      return engine_shapes::RPM_ARC;
  }
}

/// The angle of `value` on a gauge in degrees (clockwise from 3 o'clock), clamped to its scale;
/// its start when the range is empty.
inline double angle(Gauge g, double value, double min, double max) {
  const engine_shapes::Arc &a = arc(g);
  double f = 0;
  if (max > min) {
    f = (value - min) / (max - min);
    f = f < 0 ? 0 : (f > 1 ? 1 : f);
  }
  return a.start + a.sweep * f;
}

enum class Kind : uint8_t { MINOR, MEDIUM, MAJOR };

struct Tick {
  double value;
  Kind kind;
};

/// The most ticks a scale can have: at most 8 major intervals of 10 minor ones, plus one.
static constexpr size_t MAX_TICKS = 81;

struct Scale {
  double step = 0;
  /// 100 when the scale reaches 1000 or more (the labels read "x100"), else 1.
  int divisor = 1;
  size_t count = 0;
  Tick ticks[MAX_TICKS];
};

/// A tick label: the value at most 3 decimals, without trailing zeros (as engineTickLabel()).
inline const char *tick_label(double v, char (&buf)[16]) {
  double r = std::round(v * 1000.0) / 1000.0;
  if (r == 0) r = 0;  // no "-0"
  std::snprintf(buf, sizeof buf, "%.3f", r);
  char *dot = std::strchr(buf, '.');
  if (dot != nullptr) {
    char *end = buf + std::strlen(buf) - 1;
    while (end > dot && *end == '0') *end-- = '\0';
    if (end == dot) *end = '\0';
  }
  return buf;
}

/// The RPM arc's ticks for a scale min..max drawn at radius `radius` pixels: the smallest step of
/// 1, 2 or 5 times a power of ten with at most 8 intervals; minor ticks only when they are
/// sizes::ENGINE_MINOR_TICK_PX apart or more along the tick ring.
inline void scale(double min, double max, double radius, Scale &out) {
  constexpr double kEpsilon = 1e-9;
  out.count = 0;
  out.step = 0;
  out.divisor = 1;
  const double span = max - min;
  if (!(span > 0)) return;
  const int k = static_cast<int>(std::floor(std::log10(span / 8)));
  const double p = std::pow(10.0, k);
  double step = 10 * p;
  for (int m : {1, 2, 5}) {
    if (span / (m * p) <= 8 + kEpsilon) {
      step = m * p;
      break;
    }
  }
  out.step = step;
  out.divisor = std::fmax(std::fabs(min), std::fabs(max)) >= 1000 ? 100 : 1;
  const double minor = step / 10;
  const double minor_px = radius * engine_shapes::RPM_TICK_OUTER * M_PI * engine_shapes::RPM_ARC.sweep * minor /
                          (180.0 * span);
  const bool minors = minor_px >= sizes::ENGINE_MINOR_TICK_PX;
  const long first = static_cast<long>(std::ceil(min / minor - kEpsilon));
  const long last = static_cast<long>(std::floor(max / minor + kEpsilon));
  for (long i = first; i <= last && out.count < MAX_TICKS; i++) {
    const long n = ((i % 10) + 10) % 10;
    const Kind kind = n == 0 ? Kind::MAJOR : (n == 5 ? Kind::MEDIUM : Kind::MINOR);
    if (kind == Kind::MINOR && !minors) continue;
    out.ticks[out.count++] = {static_cast<double>(i) * minor, kind};
  }
}

}  // namespace engine
}  // namespace esphelm
