// Host driver for the firmware's server zones (esphelm_server_zones.h), used by
// firmware/test/server-zones.cpp.test.ts. Usage: server_zones_driver file
// The file is a JSON array of {body, unit?, min?, max?}; prints one JSON line per entry:
// {"ok":bool,"zones":[{"from":x|null,"to":y|null,"state":n}]}.
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "esphelm_server_zones.h"

int main(int argc, char **argv) {
  if (argc != 2)
    return 2;
  std::ifstream in(argv[1]);
  std::stringstream text;
  text << in.rdbuf();
  ArduinoJson::JsonDocument cases;
  if (ArduinoJson::deserializeJson(cases, text.str()))
    return 3;
  for (ArduinoJson::JsonVariantConst c : cases.as<ArduinoJson::JsonArrayConst>()) {
    std::vector<esphelm::ServerZone> si;
    const bool ok = esphelm::parse_meta_zones(c["body"].as<std::string>(), si);
    const esphelm::units::UnitDef *unit =
        c["unit"].is<const char *>() ? esphelm::units::find_unit(c["unit"].as<const char *>()) : nullptr;
    const double min = c["min"].as<double>(), max = c["max"].as<double>();
    const bool range = c["min"].is<double>();
    std::vector<esphelm::Zone> zones;
    esphelm::server_zones_to_display(si, unit, range ? &min : nullptr, range ? &max : nullptr, zones);
    ArduinoJson::JsonDocument out;
    out["ok"] = ok;
    ArduinoJson::JsonArray arr = out["zones"].to<ArduinoJson::JsonArray>();
    for (const esphelm::Zone &z : zones) {
      ArduinoJson::JsonObject o = arr.add<ArduinoJson::JsonObject>();
      if (std::isfinite(z.from))
        o["from"] = z.from;
      if (std::isfinite(z.to))
        o["to"] = z.to;
      o["state"] = static_cast<int>(z.state);
    }
    serializeJson(out, std::cout);
    std::cout << "\n";
  }
  return 0;
}
