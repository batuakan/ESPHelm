#pragma once
// Parsed, validated layout (schema v1). Pure C++: no ESPHome or LVGL dependencies.
// Mirrors packages/schema/src/{layout,pages,tiles,primitives}.ts.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "esphelm_units.h"

namespace esphelm {

enum class Theme : uint8_t { DAY, NIGHT };
enum class TileType : uint8_t { VALUE, GAUGE, BAR, SWITCH, WIND_ROSE };
enum class ZoneState : uint8_t { NORMAL, WARN, ALARM, EMERGENCY };
enum class Orientation : uint8_t { HORIZONTAL, VERTICAL };

struct Zone {
  double from;
  double to;
  ZoneState state;
};

/// A value bound to one SignalK path (value-like tiles and wind rose slots).
struct DataItem {
  std::string path;
  const units::UnitDef *unit{nullptr};  // nullptr: show the SI value as received
  int8_t decimals{-1};                  // -1: not set
  std::string label;
  float stale_after{0};                 // seconds; 0: not set (runtime default applies)
};

/// Wind rose settings (only wind_rose tiles carry them).
struct RoseConfig {
  static constexpr int MAX_SLOTS = 3;
  bool has_slot[MAX_SLOTS]{};
  DataItem slots[MAX_SLOTS];
  std::string apparent_angle{"environment.wind.angleApparent"};
  std::string true_direction{"environment.wind.directionTrue"};
  std::string heading{"navigation.headingTrue"};
  bool show_true_wind{true};
};

struct Tile {
  TileType type;
  std::string id;
  uint16_t x, y, w, h;
  DataItem data;  // switch tiles use data.path and data.label only
  // gauge / bar
  double min{0}, max{0};
  std::vector<Zone> zones;
  Orientation orientation{Orientation::HORIZONTAL};
  // wind_rose; shared so that copying a layout stays cheap and other tiles stay small
  std::shared_ptr<const RoseConfig> rose;
};

/// A grid page (the only page kind in v1).
struct Page {
  std::string id;
  std::string title;
  uint16_t cols{0}, rows{0};
  std::vector<Tile> tiles;
};

struct Layout {
  std::string id;
  std::string name;
  Theme theme{Theme::DAY};
  std::vector<Page> pages;
};

}  // namespace esphelm
