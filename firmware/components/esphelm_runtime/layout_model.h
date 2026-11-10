#pragma once
// Parsed, validated layout (schema v1). Pure C++: no ESPHome or LVGL dependencies.
// Mirrors packages/schema/src/{layout,pages,tiles,settings,primitives}.ts.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "esphelm_center_zero.h"
#include "esphelm_clock.h"
#include "esphelm_position.h"
#include "esphelm_sizes.h"
#include "esphelm_units.h"
#include "esphelm_value_zones.h"

namespace esphelm {

/// Display themes (ADR-0034). DARK comes last: saved display choices keep their numbers.
enum class Theme : uint8_t { DAY, NIGHT, DARK };
/// Night: red on black, hue would cost night vision (zones by brightness, red-tinted charts).
inline bool red_only(Theme t) { return t == Theme::NIGHT; }
/// A dark page (Night or Dark): light marks on black or near black.
inline bool dark_page(Theme t) { return t != Theme::DAY; }
/// The theme's name in logs and the layout ("day", "night", "dark").
inline const char *theme_name(Theme t) {
  return t == Theme::NIGHT ? "night" : t == Theme::DARK ? "dark" : "day";
}
enum class TileType : uint8_t {
  VALUE,
  GAUGE,
  BAR,
  SWITCH,
  WIND_ROSE,
  AUTOPILOT,
  POSITION,
  GRAPH,
  HEADING_TAPE,
  CLOCK,
  CHART,
  ENGINE
};
enum class AutopilotMode : uint8_t { AUTO, WIND, ROUTE };
enum class Orientation : uint8_t { HORIZONTAL, VERTICAL };
/// Value tile colour names (schema VALUE_COLORS); the theme decides the actual colour.
enum class ValueColor : int8_t { NONE = -1, BLUE, GREEN, YELLOW, ORANGE, RED, PURPLE };

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
  // center1..3, then the corners topLeft, topRight, bottomLeft, bottomRight
  static constexpr int MAX_SLOTS = 7;
  static constexpr int CENTER_SLOTS = 3;
  bool has_slot[MAX_SLOTS]{};
  DataItem slots[MAX_SLOTS];
  std::string apparent_angle{"environment.wind.angleApparent"};
  std::string true_direction{"environment.wind.directionTrue"};
  std::string heading{"navigation.headingTrue"};
  bool show_true_wind{true};
  // Performance graphics (ADR-0029), each off unless the layout turns it on.
  bool show_laylines{false}, show_waypoint{false}, show_target{false};
  std::string beat_angle{"performance.beatAngle"};
  std::string gybe_angle{"performance.gybeAngle"};
  std::string target_angle{"performance.targetAngle"};
  std::string waypoint_bearing{"navigation.course.calcValues.bearingTrue"};
  int fixed_beat{sizes::WIND_ROSE_BEAT_FIXED}, fixed_gybe{sizes::WIND_ROSE_GYBE_FIXED};
  // Which values record (ADR-0019), in ROSE_HISTORY_NAMES order: the slots, then the angles.
  static constexpr int HISTORY_KEYS = MAX_SLOTS + 3;
  static constexpr int HISTORY_APPARENT = MAX_SLOTS, HISTORY_TRUE = MAX_SLOTS + 1, HISTORY_HEADING = MAX_SLOTS + 2;
  bool history[HISTORY_KEYS]{};
};

/// A wind rose's `history` names (ROSE_HISTORY_KEYS in packages/schema/src/tiles.ts).
inline constexpr const char *ROSE_HISTORY_NAMES[RoseConfig::HISTORY_KEYS] = {
    "center1",    "center2",     "center3",       "topLeft",       "topRight",
    "bottomLeft", "bottomRight", "apparentAngle", "trueDirection", "heading"};

/// A graph's `window` names, in HISTORY window order (GRAPH_WINDOWS in packages/schema/src/tiles.ts).
inline constexpr const char *GRAPH_WINDOWS[] = {"10m", "1h", "6h"};

/// Autopilot settings (only autopilot tiles carry them).
struct AutopilotConfig {
  std::vector<AutopilotMode> modes{AutopilotMode::AUTO, AutopilotMode::WIND, AutopilotMode::ROUTE};
  std::string state_path{"steering.autopilot.state"};
  std::string target_path{"steering.autopilot.target"};
  std::string adjust_path{"steering.autopilot.actions.adjustHeading"};
  std::string heading_path{"navigation.headingMagnetic"};
};

/// Heading tape settings (only heading_tape tiles carry them; ADR-0022). The caption is the
/// tile's data.label, its stale time data.stale_after.
struct HeadingTapeConfig {
  // HEADING_TAPE_MARKERS order: cog, bearing, target
  static constexpr int MARKERS = 3;
  static constexpr int COG = 0, BEARING = 1, TARGET = 2;
  int span{90};
  bool markers[MARKERS]{true, true, true};
  std::string heading_path{"navigation.headingTrue"};
  std::string paths[MARKERS]{"navigation.courseOverGroundTrue", "navigation.course.calcValues.bearingTrue",
                             "steering.autopilot.target"};
};

/// A heading tape's `markers` names (HEADING_TAPE_MARKERS in packages/schema/src/tiles.ts).
inline constexpr const char *HEADING_TAPE_MARKER_NAMES[HeadingTapeConfig::MARKERS] = {"cog", "bearing", "target"};

/// What a clock shows (ClockShow in the schema), and what the screen saver shows (OFF: nothing).
enum class ClockShow : uint8_t { TIME, DATE, BOTH, OFF };

/// Clock settings (only clock tiles carry them; ADR-0024). The caption is the tile's data.label.
struct ClockConfig {
  ClockShow show{ClockShow::TIME};
  bool hour12{false};
  bool seconds{false};
  wallclock::DateFormat date_format{wallclock::DateFormat::YMD};
  bool utc{false};
};

/// Chart tile settings (ADR-0030): which SignalK chart, zoom, and the paths it follows.
struct ChartConfig {
  std::string chart;
  int zoom{15};
  bool anchor{true};
  std::string position_path{"navigation.position"};
  std::string heading_path{"navigation.headingTrue"};
  std::string anchor_position_path{"navigation.anchor.position"};
  std::string anchor_radius_path{"navigation.anchor.maxRadius"};
  std::string anchor_alarm_path{"notifications.navigation.anchor"};
};

/// Engine slot icons, in the order of ENGINE_ICON_NAMES (esphelm_engine_shapes.h ICONS).
enum class EngineIcon : int8_t { NONE = -1, OIL, FUEL, TEMPERATURE, BATTERY };
inline constexpr const char *ENGINE_ICON_NAMES[] = {"oil", "fuel", "temperature", "battery"};

/// One of an engine tile's small gauges (ADR-0032).
struct EngineSlot {
  DataItem data;
  double min{0}, max{0};
  std::vector<Zone> zones;
  EngineIcon icon{EngineIcon::NONE};
};

/// Engine settings: its three slot gauges and four corner values (the RPM is the tile's own data,
/// min, max and zones).
struct EngineConfig {
  static constexpr int SLOTS = 3;    // left, right, bottom
  static constexpr int CORNERS = 4;  // topLeft, topRight, bottomLeft, bottomRight
  bool has_slot[SLOTS]{};
  EngineSlot slots[SLOTS];
  bool has_corner[CORNERS]{};
  DataItem corners[CORNERS];
};
inline constexpr const char *ENGINE_SLOT_NAMES[EngineConfig::SLOTS] = {"left", "right", "bottom"};
inline constexpr const char *ENGINE_CORNER_NAMES[EngineConfig::CORNERS] = {"topLeft", "topRight", "bottomLeft",
                                                                           "bottomRight"};

struct Tile {
  TileType type;
  std::string id;
  uint16_t x, y, w, h;
  DataItem data;  // switch tiles use data.path and data.label only
  // gauge / bar; graph when has_range (its fixed y axis)
  double min{0}, max{0};
  bool has_range{false};
  uint8_t graph_window{0};  // graph: index of its `window` in GRAPH_WINDOWS (the display may keep fewer)
  std::vector<Zone> zones;  // value tiles too, with open ends as -inf / +inf; the server's if it has any
  std::vector<Zone> own_zones;  // the layout's, used when the server has none (ADR-0020)
  ValueColor color{ValueColor::NONE};  // value
  bool history{false};                 // value: records its history, tap for the graph (ADR-0018/0019)
  Orientation orientation{Orientation::HORIZONTAL};
  // gauge / bar: centred on zero, filled from zero to the value (ADR-0023)
  bool center_zero{false};
  center_zero::Sides sides{center_zero::Sides::PORT_STARBOARD};
  // position (data.path defaults to navigation.position; data.decimals -1 = the format's default)
  position::Format position_format{position::Format::DDM};
  // wind_rose; shared so that copying a layout stays cheap and other tiles stay small
  std::shared_ptr<const RoseConfig> rose;
  // autopilot (data.label is its caption)
  std::shared_ptr<const AutopilotConfig> autopilot;
  // heading_tape
  std::shared_ptr<const HeadingTapeConfig> tape;
  // clock
  ClockConfig clock;
  // chart
  std::shared_ptr<const ChartConfig> chart;
  // engine: the RPM in data, min, max and zones like a gauge; the slots here
  std::shared_ptr<const EngineConfig> engine;
};

/// A grid page, the only page kind (the wind rose and the chart were page kinds; ADR-0010, ADR-0030).
struct Page {
  std::string id;
  std::string title;
  uint16_t cols{0}, rows{0};
  std::vector<Tile> tiles;
};

enum class AutoTheme : uint8_t { OFF, SUN };

/// Display settings (Phase 6, ADR-0015); defaults as SETTINGS_DEFAULTS in the schema.
struct Settings {
  uint8_t brightness_day{100};   // %
  uint8_t brightness_night{30};  // %
  std::string start_page;        // empty: the first page
  AutoTheme auto_theme{AutoTheme::OFF};
  std::string auto_theme_path{"environment.sun"};
  uint16_t screen_timeout{0};  // seconds; 0: never (the runtime applies at least 10)
  // Clocks (ADR-0024): the zone (UTC when absent), where the time comes from, the screen saver.
  std::string time_zone_name;  // the IANA name, for the log
  wallclock::Tz time_zone;
  std::string clock_path{"navigation.datetime"};
  ClockShow screen_saver{ClockShow::OFF};
  uint8_t screen_saver_brightness{30};  // %
  uint16_t rotation{0};                 // degrees clockwise: how the display is mounted (ADR-0028)
  // Sound on displays with a speaker (ADR-0033).
  uint8_t sound_volume{60};  // %, 10..100
  bool sound_touch{true};    // a click when a button or tile is touched
};

struct Layout {
  std::string id;
  std::string name;
  Theme theme{Theme::DAY};
  std::vector<Page> pages;
  Settings settings;
};

}  // namespace esphelm
