#pragma once
// Parsed, validated layout (schema v1). Pure C++: no ESPHome or LVGL dependencies.
// Mirrors packages/schema/src/{layout,pages,tiles,primitives}.ts.

#include <cstdint>
#include <string>
#include <vector>

#include "esphelm_units.h"

namespace esphelm {

enum class Theme : uint8_t { DAY, NIGHT };
enum class TileType : uint8_t { VALUE, GAUGE, BAR, SWITCH };
enum class ZoneState : uint8_t { NORMAL, WARN, ALARM, EMERGENCY };
enum class Orientation : uint8_t { HORIZONTAL, VERTICAL };
enum class PageKind : uint8_t { GRID, WIDGET };
enum class PageWidget : uint8_t { WIND_ROSE };

struct Zone {
  double from;
  double to;
  ZoneState state;
};

/// A value bound to one SignalK path (value tiles and full-page widget slots).
struct DataItem {
  std::string path;
  const units::UnitDef *unit{nullptr};  // nullptr: show the SI value as received
  int8_t decimals{-1};                  // -1: not set
  std::string label;
  float stale_after{0};                 // seconds; 0: not set (runtime default applies)
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
};

struct Page {
  PageKind kind;
  std::string id;
  std::string title;
  // grid pages
  uint16_t cols{0}, rows{0};
  std::vector<Tile> tiles;
  // widget pages
  PageWidget widget{PageWidget::WIND_ROSE};
  static constexpr int MAX_SLOTS = 3;
  bool has_slot[MAX_SLOTS]{};
  DataItem slots[MAX_SLOTS];
  std::string apparent_angle{"environment.wind.angleApparent"};
  std::string true_direction{"environment.wind.directionTrue"};
  std::string heading{"navigation.headingTrue"};
  bool show_true_wind{true};
};

struct Layout {
  std::string id;
  std::string name;
  Theme theme{Theme::DAY};
  std::vector<Page> pages;
};

}  // namespace esphelm
