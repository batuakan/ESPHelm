#pragma once
// Widget renderers. Each widget is a pure function of (config, latest value, theme): it builds
// its LVGL objects inside a parent, says which SignalK paths it needs, takes values, and redraws
// itself at most every DRAW_INTERVAL_MS. No widget knows about any other (CLAUDE.md §6).
// Main loop only.

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <variant>
#include <vector>

#include <ArduinoJson.h>

#include "lvgl.h"
#include "layout_client.h"
#include "layout_model.h"

namespace esphome {
namespace esphelm_runtime {

struct Fonts {
  const lv_font_t *value{nullptr};
  const lv_font_t *label{nullptr};
  const lv_font_t *small{nullptr};
  /// Every font tile text can pick from, smallest line height first (ADR-0017). Filled once at
  /// setup by add(). `digits[i]`: ladder[i] has only DIGIT_GLYPHS, so only a value tile's number
  /// may use it, while its text is numeric. Of two fonts with the same line height the full one
  /// is kept.
  static const uint8_t MAX_LADDER = 10;
  const lv_font_t *ladder[MAX_LADDER]{};
  bool digits[MAX_LADDER]{};
  uint8_t count{0};
  void add(const lv_font_t *font, bool digits_only = false) {
    if (font == nullptr)
      return;
    const int32_t line = lv_font_get_line_height(font);
    uint8_t i = 0;
    while (i < this->count && lv_font_get_line_height(this->ladder[i]) < line)
      i++;
    if (i < this->count && lv_font_get_line_height(this->ladder[i]) == line) {
      if (this->digits[i] && !digits_only) {
        this->ladder[i] = font;
        this->digits[i] = false;
      }
      return;
    }
    if (this->count == MAX_LADDER)
      return;
    for (uint8_t j = this->count; j > i; j--) {
      this->ladder[j] = this->ladder[j - 1];
      this->digits[j] = this->digits[j - 1];
    }
    this->ladder[i] = font;
    this->digits[i] = digits_only;
    this->count++;
  }
};

struct Colors {
  lv_color_t background;
  lv_color_t tile;
  lv_color_t text;
  lv_color_t muted;
  lv_color_t accent;  // apparent wind needle, switch on
  lv_color_t second;  // true wind needle
  lv_color_t zone[4];  // normal, warn, alarm, emergency
  // Wind rose (the legacy wind page's colours by day, reds only at night)
  lv_color_t port, starboard;   // close-hauled sectors
  lv_color_t apparent, true_wind;  // A and T markers
  lv_color_t ring;              // outer ring ticks
  lv_color_t card, card_text;   // compass card band and its letters
  // Value tile colour names (esphelm::ValueColor order); all the text colour at night
  lv_color_t palette[6];
};

Colors colors_for(esphelm::Theme theme);

/// A PUT value (same alternatives as ESPHomeSignalK put_request).
using PutValue = std::variant<double, std::string, bool>;

/// What every widget gets when it is built.
struct WidgetEnv {
  Fonts fonts;
  Colors colors;
  uint32_t default_stale_ms;
  /// Send a PUT (switch and autopilot tiles). Main loop only.
  std::function<void(const std::string &path, const PutValue &value)> put;
  /// Whether a PUT can be sent now (connected to SignalK). Controls are disabled otherwise.
  std::function<bool()> can_put;
  /// Start a GET of `path` under the device API (e.g. "/tiles/<chart>/<z>/<x>/<y>") on the tile
  /// worker; the result comes back through Widget::on_http with `tag`. False when the worker is
  /// busy or the display isn't authorized yet (try again later). Main loop only.
  std::function<bool(const std::string &path, uint32_t tag, size_t max_body)> fetch;
  /// Whether the display has PSRAM (chart pages need about 3.2 MB for their tiles).
  bool psram{false};
  /// The layout's theme is night (charts are darkened and tinted red).
  bool night{false};
  /// Whether a value tile records its history (ADR-0018), and opening its popup. A tap only asks
  /// for it; the runtime opens it in loop(). Unset or false: the tile isn't tappable.
  std::function<bool(const std::string &tile_id)> has_history;
  std::function<void(const std::string &tile_id)> open_history;
};

class Widget {
 public:
  virtual ~Widget() = default;
  /// Tile id.
  virtual const std::string &id() const = 0;
  /// SignalK paths this widget wants values for.
  virtual void paths(std::vector<std::string> &out) const = 0;
  /// Sizes that depend on the final layout (round scales need their box size).
  virtual void layout_done() {}
  virtual void on_value(const std::string &path, ArduinoJson::JsonVariantConst value, uint32_t now) = 0;
  /// Redraw if something changed (throttled) and handle stale timeouts.
  virtual void tick(uint32_t now) = 0;
  /// The result of a fetch() this widget started (tile worker; main loop).
  virtual void on_http(const HttpResult &result) {}
  /// A tap from the test hook, as a touch would do it. `part` names a button for tiles that
  /// have several (autopilot: -10 -1 +1 +10 auto wind route standby); others ignore it.
  virtual void tap(const std::string &part) {}
};

/// Build the widget for a grid tile inside `cell` (an empty LVGL object placed in the grid).
std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);

/// Build a chart page filling `area` (chart.cpp).
std::unique_ptr<Widget> make_chart(lv_obj_t *area, const esphelm::Page &page, const WidgetEnv &env);

/// Format a SignalK value like the editor preview: converted, fixed decimals (default 1),
/// on/off for booleans, printable text for strings, "--" otherwise.
std::string format_value(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, int decimals);

/// Text the fonts can draw: printable ASCII and the degree sign; other characters become "?".
std::string printable(const char *s);

/// Width of `text` in `font`, in pixels.
int32_t text_width(const char *text, const lv_font_t *font);

/// The largest full ladder font, no taller than `max` if given, in which `lines` lines of `text`
/// fit w x h; the smallest when none does. Digits-only fonts are skipped: `text` may be anything.
const lv_font_t *fit_font(const Fonts &fonts, const char *text, int32_t w, int32_t h, int lines = 1,
                          const lv_font_t *max = nullptr);

/// Display-unit number from a SignalK value; false if it is not a finite number.
bool display_number(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, double &out);

}  // namespace esphelm_runtime
}  // namespace esphome
