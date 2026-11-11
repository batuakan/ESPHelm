#pragma once
// Helpers shared by the colour tile renderers (tiles_color.cpp, widget_*.cpp). Internal to this tile
// set: the runtime includes widgets.h, not this. Each widget_<type>.cpp holds one tile type and its
// factory; make_tile_widget() in tiles_color.cpp picks it. The helpers every tile set uses are in
// the core's widget_base.h.

#include <memory>
#include <string>
#include <vector>

#include "esphome/components/esphelm_runtime/widget_base.h"

namespace esphome {
namespace esphelm_runtime {

/// Zone style (scale section arcs) for an alert state and arc width; static, shared per page.
lv_style_t *zone_style(esphelm::ZoneState state, const Colors &colors, int32_t width);
/// The small sparkline that says a tile opens a history graph (ADR-0018); the caller places it.
lv_obj_t *make_history_mark(lv_obj_t *parent, const Colors &c);
/// Fill colour of a centre-zero value (ADR-0023): port red or starboard green by side, or the
/// accent for plus/minus. At night the theme makes them all red (port bright, starboard dim).
inline lv_color_t center_zero_color(const Colors &c, esphelm::center_zero::Sides sides, double v) {
  if (sides == esphelm::center_zero::Sides::PLUS_MINUS)
    return c.accent;
  return v < 0 ? c.port : c.starboard;
}
/// Tile background, radius and padding.
void style_cell(lv_obj_t *cell, const Colors &c);

/// Values in a tile's corners, outside its round drawing (the wind rose's and the engine tile's
/// corner slots; corner_values.cpp). Each is a value over its caption (label and unit).
class CornerValues {
 public:
  /// A value in `corner` (0 top left, 1 top right, 2 bottom left, 3 bottom right) of `cell`.
  void add(lv_obj_t *cell, int corner, const esphelm::DataItem &item, const WidgetEnv &env);
  bool empty() const { return corners_.empty(); }
  void paths(std::vector<std::string> &out) const;
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now);
  /// Shows new values (throttled) and "--" once a value goes stale.
  void tick(uint32_t now);
  /// Shows each value (in the label font, else the small one) whose box clears the circle of
  /// radius `r` around the middle of the w x h cell; hides it when it doesn't or when !allowed.
  /// A drawing open at the bottom (the engine tile) passes `open_below` >= 0: a bottom corner's box
  /// whose top is at least that far under the centre need only clear radius `open_r`.
  void layout(int32_t w, int32_t h, double r, bool allowed, double open_below = -1, double open_r = 0);
  /// Whether the value in `corner` is shown.
  bool shown(int corner) const;

 private:
  struct Corner {
    Binding b;
    int corner{0};
    lv_obj_t *box{nullptr};  // the value over its caption
    lv_obj_t *value{nullptr};
    lv_obj_t *caption{nullptr};
    std::string shown{"--"};
  };
  std::vector<Corner> corners_;
  Colors colors_;
  Fonts fonts_;
};

// One factory per tile type (widget_<type>.cpp).
std::unique_ptr<Widget> make_value_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_gauge_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_bar_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_switch_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_autopilot_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_wind_rose_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_position_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_graph_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_heading_tape_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_clock_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_chart_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_engine_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);

}  // namespace esphelm_runtime
}  // namespace esphome
