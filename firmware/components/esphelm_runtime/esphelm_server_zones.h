#pragma once
// Zones from SignalK metadata (ADR-0020): `meta.zones`, in SI, as a tile's zones in its display
// unit. When they are not empty they replace the tile's own. Pure C++ on ArduinoJson. Mirrors
// packages/schema/src/serverZones.ts; fixtures/server-zones.cases.json keeps the two in step.

#include <algorithm>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

#include <ArduinoJson.h>

#include "esphelm_sizes.h"
#include "esphelm_units.h"
#include "esphelm_value_zones.h"

namespace esphelm {

/// A usable zone of a path, in SI; a missing end is -inf / +inf.
struct ServerZone {
  double lower;
  double upper;
  ZoneState state;
};

inline bool server_zone_state(const char *s, ZoneState &out) {
  if (s == nullptr)
    return false;
  if (std::strcmp(s, "nominal") == 0 || std::strcmp(s, "normal") == 0)
    out = ZoneState::NORMAL;
  else if (std::strcmp(s, "alert") == 0 || std::strcmp(s, "warn") == 0)
    out = ZoneState::WARN;
  else if (std::strcmp(s, "alarm") == 0)
    out = ZoneState::ALARM;
  else if (std::strcmp(s, "emergency") == 0)
    out = ZoneState::EMERGENCY;
  else
    return false;
  return true;
}

/// The usable zones of a `zones` value: an unknown state, an end that isn't a number, no ends at
/// all, or lower not below upper drops a zone; at most SERVER_ZONES_MAX_PER_PATH are kept.
inline void parse_server_zones(ArduinoJson::JsonVariantConst zones, std::vector<ServerZone> &out) {
  out.clear();
  const double inf = std::numeric_limits<double>::infinity();
  for (ArduinoJson::JsonVariantConst v : zones.as<ArduinoJson::JsonArrayConst>()) {
    if (out.size() >= static_cast<size_t>(sizes::SERVER_ZONES_MAX_PER_PATH))
      break;
    if (!v.is<ArduinoJson::JsonObjectConst>())
      continue;
    ServerZone z{-inf, inf, ZoneState::NORMAL};
    ArduinoJson::JsonVariantConst lower = v["lower"], upper = v["upper"];
    if ((!lower.isNull() && !lower.is<double>()) || (!upper.isNull() && !upper.is<double>()))
      continue;
    if (lower.isNull() && upper.isNull())
      continue;
    if (!lower.isNull())
      z.lower = lower.as<double>();
    if (!upper.isNull())
      z.upper = upper.as<double>();
    if (!(z.lower < z.upper) || !v["state"].is<const char *>() || !server_zone_state(v["state"].as<const char *>(), z.state))
      continue;
    out.push_back(z);
  }
}

/// The zones in a body of GET .../<path>/meta; false if it can't be read (keep what you have).
/// Only `zones` is kept in memory; a body without them means the path has none.
inline bool parse_meta_zones(const std::string &body, std::vector<ServerZone> &out) {
  ArduinoJson::JsonDocument filter;
  filter["zones"] = true;
  ArduinoJson::JsonDocument doc;
  ArduinoJson::DeserializationError err =
      ArduinoJson::deserializeJson(doc, body, ArduinoJson::DeserializationOption::Filter(filter));
  if (err || !doc.is<ArduinoJson::JsonObjectConst>())
    return false;
  parse_server_zones(doc["zones"], out);
  return true;
}

/// A value tile's zones (`min` and `max` null: a missing end stays open), or a gauge's or bar's
/// (a missing end is its min or max, zones are clipped to the scale, one outside it is dropped).
/// `unit` may be null (SI). No wrapping: an angle zone across north never matches.
inline void server_zones_to_display(const std::vector<ServerZone> &zones, const units::UnitDef *unit,
                                    const double *min, const double *max, std::vector<Zone> &out) {
  out.clear();
  const auto display = [unit](double si) { return unit != nullptr ? si * unit->factor + unit->offset : si; };
  for (const ServerZone &z : zones) {
    double from = display(z.lower), to = display(z.upper);
    if (min != nullptr && max != nullptr) {
      from = std::max(from, *min);
      to = std::min(to, *max);
      if (from >= to)
        continue;
    }
    out.push_back({from, to, z.state});
  }
}

}  // namespace esphelm
