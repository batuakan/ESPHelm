#pragma once
// Wind rose performance geometry (ADR-0029), mirroring roseLaylines() and roseTarget() in
// packages/schema/src/windRose.ts; fixtures/wind-rose.cases.json proves they agree. Degrees,
// clockwise from the bow in [0, 360). Pure C++ (no ESPHome or LVGL), so g++ tests it on the host.

#include <cmath>

#include "esphelm_sizes.h"

namespace esphelm {
namespace wind_rose {

inline double norm(double v) { return std::fmod(std::fmod(v, 360.0) + 360.0, 360.0); }

/// Where `direction` (a compass direction) sits on the rose: clockwise from the bow.
inline double relative(double direction, double heading) { return norm(direction - heading); }

/// True wind angle in (-180, 180]: positive with the wind from starboard.
inline double true_wind_angle(double twd, double heading) {
  const double d = relative(twd, heading);
  return d > 180.0 ? d - 360.0 : d;
}

/// The tack angle used: SignalK's (by its size) when `known` and within min..max, else `fixed`.
inline double tack_angle(bool known, double from_signalk, int min, int max, int fixed) {
  if (!known || !std::isfinite(from_signalk))
    return fixed;
  const double a = std::fabs(from_signalk);
  return a >= min && a <= max ? a : fixed;
}

struct Laylines {
  bool upwind;       // |TWA| < 90: the beat angle, else the gybe angle
  double angle;      // the tack angle used
  double starboard;  // heading on starboard tack, from the bow
  double port;       // heading on port tack, from the bow
};

/// The laylines; `beat_known`/`gybe_known` say whether SignalK's angles are there and fresh.
inline Laylines laylines(double twd, double heading, bool beat_known, double beat, bool gybe_known, double gybe,
                         int fixed_beat = sizes::WIND_ROSE_BEAT_FIXED, int fixed_gybe = sizes::WIND_ROSE_GYBE_FIXED) {
  const double twa = true_wind_angle(twd, heading);
  Laylines l;
  l.upwind = std::fabs(twa) < 90.0;
  l.angle = l.upwind ? tack_angle(beat_known, beat, sizes::WIND_ROSE_BEAT_MIN, sizes::WIND_ROSE_BEAT_MAX, fixed_beat)
                     : tack_angle(gybe_known, gybe, sizes::WIND_ROSE_GYBE_MIN, sizes::WIND_ROSE_GYBE_MAX, fixed_gybe);
  l.starboard = norm(twa - l.angle);
  l.port = norm(twa + l.angle);
  return l;
}

/// Where the target true wind angle sits, on the side the wind comes from (starboard when dead
/// ahead or astern). False unless 0 < |target| < 180.
inline bool target(double twd, double heading, double target_angle, double &out) {
  const double t = std::fabs(target_angle);
  if (!(t > 0.0 && t < 180.0))
    return false;
  out = norm(true_wind_angle(twd, heading) >= 0.0 ? t : -t);
  return true;
}

}  // namespace wind_rose
}  // namespace esphelm
