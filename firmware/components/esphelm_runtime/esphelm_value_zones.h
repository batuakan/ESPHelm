#pragma once
// Alert zones (gauge, bar and value tiles) and the value tile's zone matching. Pure C++: no
// ESPHome or LVGL dependencies. Mirrors packages/schema/src/valueZones.ts;
// fixtures/value-zones.cases.json keeps the two in step.

#include <cstdint>
#include <vector>

namespace esphelm {

enum class ZoneState : uint8_t { NORMAL, WARN, ALARM, EMERGENCY };

/// A range in display units. On value tiles a missing end is stored as -inf / +inf.
struct Zone {
  double from;
  double to;
  ZoneState state;
};

/// The zone state a value tile shows for `n`: both ends included, the last matching zone wins.
/// False when no zone matches.
inline bool value_zone_state(double n, const std::vector<Zone> &zones, ZoneState &out) {
  bool found = false;
  for (const Zone &z : zones) {
    if (n >= z.from && n <= z.to) {
      out = z.state;
      found = true;
    }
  }
  return found;
}

}  // namespace esphelm
