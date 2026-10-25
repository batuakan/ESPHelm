#pragma once
// Widget renderers. Each widget is a pure function of (config, latest value, theme): it builds
// its LVGL objects inside a parent, says which SignalK paths it needs, takes values, and redraws
// itself at most every DRAW_INTERVAL_MS. No widget knows about any other (CLAUDE.md §6).
// Main loop only.

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <ArduinoJson.h>

#include "lvgl.h"
#include "layout_model.h"

namespace esphome {
namespace esphelm_runtime {

struct Fonts {
  const lv_font_t *value{nullptr};
  const lv_font_t *label{nullptr};
  const lv_font_t *small{nullptr};
};

struct Colors {
  lv_color_t background;
  lv_color_t tile;
  lv_color_t text;
  lv_color_t muted;
  lv_color_t accent;  // apparent wind needle, switch on
  lv_color_t second;  // true wind needle
  lv_color_t zone[4];  // normal, warn, alarm, emergency
};

Colors colors_for(esphelm::Theme theme);

/// What every widget gets when it is built.
struct WidgetEnv {
  Fonts fonts;
  Colors colors;
  uint32_t default_stale_ms;
  /// Send a PUT (switch tiles). Main loop only.
  std::function<void(const std::string &path, bool value)> put;
};

class Widget {
 public:
  virtual ~Widget() = default;
  /// Tile id (empty for page widgets).
  virtual const std::string &id() const = 0;
  /// SignalK paths this widget wants values for.
  virtual void paths(std::vector<std::string> &out) const = 0;
  /// Sizes that depend on the final layout (round scales need their box size).
  virtual void layout_done() {}
  virtual void on_value(const std::string &path, ArduinoJson::JsonVariantConst value, uint32_t now) = 0;
  /// Redraw if something changed (throttled) and handle stale timeouts.
  virtual void tick(uint32_t now) = 0;
  /// A tap from the test hook (switch tiles act on it).
  virtual void tap() {}
};

/// Build the widget for a grid tile inside `cell` (an empty LVGL object placed in the grid).
std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);

/// Build the wind rose filling `area`.
std::unique_ptr<Widget> make_wind_rose(lv_obj_t *area, const esphelm::Page &page, const WidgetEnv &env);

/// Format a SignalK value like the editor preview: converted, fixed decimals (default 1),
/// on/off for booleans, printable text for strings, "--" otherwise.
std::string format_value(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, int decimals);

/// Display-unit number from a SignalK value; false if it is not a finite number.
bool display_number(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, double &out);

}  // namespace esphelm_runtime
}  // namespace esphome
