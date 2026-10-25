#pragma once
// GPS position text, mirroring packages/schema/src/position.ts (formatPosition). Both are
// checked against packages/schema/fixtures/position.cases.json (position.cpp.test.ts).
// Integer arithmetic on rounded units, so the digits match and rounding carries into the next
// unit (never 60' or 60"). Pure C++: no ESPHome or LVGL.

#include <cmath>
#include <cstdint>
#include <string>

namespace esphelm {
namespace position {

enum class Format : uint8_t { DDM, DMS, DD, DECIMAL };

/// Decimals of the last part when a tile sets none (POSITION_DEFAULT_DECIMALS).
inline int default_decimals(Format f) {
  switch (f) {
    case Format::DDM:
      return 3;
    case Format::DMS:
      return 1;
    case Format::DD:
      return 5;
    default:
      return 6;
  }
}

namespace detail {

/// `n` (non-negative) in decimal, zero-padded to at least `width` digits.
inline std::string padded(long long n, int width) {
  std::string s = std::to_string(n);
  if (static_cast<int>(s.size()) < width)
    s.insert(0, static_cast<size_t>(width - static_cast<int>(s.size())), '0');
  return s;
}

/// `units` counts 10^-decimals of the last part: its integer part padded to `width`, then the fraction.
inline std::string fixed(long long units, long long scale, int decimals, int width) {
  std::string s = padded(units / scale, width);
  if (decimals > 0)
    s += "." + padded(units % scale, decimals);
  return s;
}

/// floor(x + 0.5): the same rounding as position.ts (for the non-negative values used here).
inline long long round_units(double x) { return static_cast<long long>(std::floor(x + 0.5)); }

inline std::string part(double v, Format f, int decimals, int deg_width, char hemi) {
  long long scale = 1;
  for (int i = 0; i < decimals; i++)
    scale *= 10;
  const double a = std::fabs(v);
  const std::string deg_sign = "\xC2\xB0";  // UTF-8 degree sign
  const std::string h = std::string(" ") + hemi;
  switch (f) {
    case Format::DDM: {
      const long long units = round_units(a * 60 * static_cast<double>(scale));
      const long long per_deg = 60 * scale;
      const long long deg = units / per_deg;
      return padded(deg, deg_width) + deg_sign + " " + fixed(units - deg * per_deg, scale, decimals, 2) + "'" + h;
    }
    case Format::DMS: {
      const long long units = round_units(a * 3600 * static_cast<double>(scale));
      const long long per_deg = 3600 * scale;
      const long long per_min = 60 * scale;
      const long long deg = units / per_deg;
      const long long rest = units - deg * per_deg;
      const long long min = rest / per_min;
      return padded(deg, deg_width) + deg_sign + " " + padded(min, 2) + "' " +
             fixed(rest - min * per_min, scale, decimals, 2) + "\"" + h;
    }
    case Format::DD:
      return fixed(round_units(a * static_cast<double>(scale)), scale, decimals, 1) + deg_sign + h;
    default: {
      const long long units = round_units(a * static_cast<double>(scale));
      return (v < 0 && units > 0 ? "-" : "") + fixed(units, scale, decimals, 1);
    }
  }
}

}  // namespace detail

/// The two lines of a position tile; false (leave the tile at "--") unless latitude is finite
/// in -90..90 and longitude in -180..180. `decimals` < 0 means the format's default.
inline bool format(double lat, double lon, Format f, int decimals, std::string &lat_out, std::string &lon_out) {
  if (!std::isfinite(lat) || !std::isfinite(lon) || std::fabs(lat) > 90 || std::fabs(lon) > 180)
    return false;
  int d = decimals < 0 ? default_decimals(f) : decimals;
  d = d > 6 ? 6 : d;
  lat_out = detail::part(lat, f, d, 2, lat < 0 ? 'S' : 'N');
  lon_out = detail::part(lon, f, d, 3, lon < 0 ? 'W' : 'E');
  return true;
}

}  // namespace position
}  // namespace esphelm
