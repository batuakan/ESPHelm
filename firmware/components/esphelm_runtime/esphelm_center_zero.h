#pragma once
// Centre-zero gauges and bars (ADR-0023), mirroring centerZeroSpan(), centerZeroText() and
// centerZeroTick() in packages/schema/src/centerZero.ts; fixtures/center-zero.cases.json proves
// they agree. Pure C++ (no ESPHome or LVGL), so g++ tests it on the host.

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace esphelm {
namespace center_zero {

/// What the two sides mean (CenterZeroSides in the schema).
enum class Sides : uint8_t { PORT_STARBOARD, PLUS_MINUS };

/// Half the symmetric scale: it runs from -M to M, so zero is always in the middle.
inline double span(double min, double max) { return std::fmax(std::fabs(min), std::fabs(max)); }

/// |v| with `decimals` decimals, rounding halves up: floor(x + 0.5), as the TS copy does.
inline std::string magnitude(double v, int decimals) {
  const double s = std::pow(10.0, decimals);
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.*f", decimals, std::floor(std::fabs(v) * s + 0.5) / s);
  return buf;
}

/// A value's text and side ("", "P" or "S"). portStarboard: the magnitude and its side;
/// plusMinus: signed. A value that rounds to zero has no side or sign. `decimals` < 0: 1.
inline std::string text(double n, int decimals, Sides sides, const char *&side) {
  std::string t = magnitude(n, decimals < 0 ? 1 : decimals);
  side = "";
  if (std::atof(t.c_str()) == 0)
    return t;
  if (sides == Sides::PLUS_MINUS)
    return (n < 0 ? "-" : "+") + t;
  side = n < 0 ? "P" : "S";
  return t;
}

/// A tick label at `v` on a scale of half-span `m`: no decimals when the scale spans 20 or more.
inline std::string tick(double v, double m, Sides sides) {
  std::string t = magnitude(v, 2 * m >= 20 ? 0 : 1);
  if (sides == Sides::PORT_STARBOARD || std::atof(t.c_str()) == 0)
    return t;
  return (v < 0 ? "-" : "+") + t;
}

}  // namespace center_zero
}  // namespace esphelm
