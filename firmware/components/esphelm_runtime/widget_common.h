#pragma once
// Helpers shared by the widget renderers (widgets.cpp, widget_*.cpp). Internal to the widgets:
// the runtime includes widgets.h, not this. Each widget_<type>.cpp holds one tile type and its
// factory; make_tile_widget() in widgets.cpp picks it.

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "widgets.h"

namespace esphome {
namespace esphelm_runtime {

static const uint32_t DRAW_INTERVAL_MS = 250;  // at most 4 redraws per widget per second
static const uint32_t PUT_CONFIRM_MS = 5000;   // switch waits this long for its new state
static const int32_t SCALE_STEPS = 1000;       // gauge/bar values are mapped onto 0..1000

/// A label in `font` (the theme's default if null) and `color`.
lv_obj_t *make_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const std::string &text);
/// Set the label text if it changed; true if it did.
bool set_text(lv_obj_t *label, std::string &shown, const std::string &text);
int32_t line_height(const lv_font_t *font);
/// Height of a digit's ink in `font`.
int32_t digit_height(const lv_font_t *font);
/// The number a value-like tile sizes its font for: "88" plus its decimals (-1: the default 1).
std::string value_sample(int decimals);
/// What a formatted number or a clock time can contain; the digits-only fonts have just these glyphs.
bool is_numeric(const std::string &text);
/// The smallest full (not digits-only) font.
const lv_font_t *smallest_font(const Fonts &fonts);
/// The item's staleAfter, or the layout default.
uint32_t stale_ms(const esphelm::DataItem &item, const WidgetEnv &env);
/// Zone style (scale section arcs) for an alert state and arc width; static, shared per page.
lv_style_t *zone_style(esphelm::ZoneState state, const Colors &colors, int32_t width);
/// `v` mapped onto 0..SCALE_STEPS between min and max, clamped.
int32_t to_steps(double v, double min, double max);
/// A scale label: no decimals for spans of 20 or more, else one.
void label_number(char *buf, size_t n, double v, double span);
/// The small sparkline that says a tile opens a history graph (ADR-0018); the caller places it.
lv_obj_t *make_history_mark(lv_obj_t *parent, const Colors &c);
/// Fill colour of a centre-zero value (ADR-0023): port red or starboard green by side, or the
/// accent for plus/minus. At night the theme makes them all red (port bright, starboard dim).
inline lv_color_t center_zero_color(const Colors &c, esphelm::center_zero::Sides sides, double v) {
  if (sides == esphelm::center_zero::Sides::PLUS_MINUS)
    return c.accent;
  return v < 0 ? c.port : c.starboard;
}
/// A centre-zero value's text with its unit and side: "12 ° S", "+8.2 A".
inline std::string center_zero_label(double v, int decimals, esphelm::center_zero::Sides sides,
                                     const std::string &unit_suffix) {
  const char *side;
  const std::string text = esphelm::center_zero::text(v, decimals, sides, side);
  return text + unit_suffix + (side[0] != '\0' ? std::string(" ") + side : std::string());
}
/// Tile background, radius and padding.
void style_cell(lv_obj_t *cell, const Colors &c);


/// State shared by widgets bound to one DataItem: latest text/number, change and stale tracking.
struct Binding {
  esphelm::DataItem item;
  uint32_t stale_ms{0};
  uint32_t last_value_ms{0};
  uint32_t last_draw_ms{0};
  bool has_number{false};
  double number{0};
  std::string text{"--"};
  bool dirty{false};
  bool stale_shown{true};

  void set(ArduinoJson::JsonVariantConst value, uint32_t now) {
    this->text = format_value(value, this->item.unit, this->item.decimals);
    this->has_number = display_number(value, this->item.unit, this->number);
    this->last_value_ms = now;
    this->dirty = true;
  }
  /// True if the widget should redraw now; `stale` tells it how.
  bool due(uint32_t now, bool &stale) {
    if (this->dirty && now - this->last_draw_ms >= DRAW_INTERVAL_MS) {
      this->dirty = false;
      this->last_draw_ms = now;
      this->stale_shown = false;
      stale = false;
      return true;
    }
    if (!this->dirty && !this->stale_shown && now - this->last_value_ms > this->stale_ms) {
      this->stale_shown = true;
      stale = true;
      return true;
    }
    return false;
  }
};

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
