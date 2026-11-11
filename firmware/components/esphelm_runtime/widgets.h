#pragma once
// Widget renderers. Each widget is a pure function of (config, latest value, theme): it builds
// its LVGL objects inside a parent, says which SignalK paths it needs, takes values, and redraws
// itself at most every DRAW_INTERVAL_MS. No widget knows about any other (CLAUDE.md §6).
// Main loop only.
//
// This header is the contract between the core (esphelm_runtime) and a tile set (ADR-0035): the
// functions marked "tile set" are defined by the one tile set the firmware is built with
// (esphelm_tiles_color today), never by the core.

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
#include "value_history.h"

namespace esphome {
namespace esphelm_runtime {

class ChartTileStore;  // chart_store.h, with USE_ESPHELM_CHARTS

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

/// Tile set: the theme's colours, for the tiles and the core's banner, footer, panel and popup.
Colors colors_for(esphelm::Theme theme);

/// QR code colours: dark modules on light ones by day; at night the light ones are the dim red text
/// colour. The dark theme uses black on white: cameras read inverted codes badly.
inline void qr_colors(esphelm::Theme theme, const Colors &c, lv_color_t &dark, lv_color_t &light) {
  if (theme == esphelm::Theme::NIGHT) {
    dark = c.background;
    light = c.text;
  } else if (theme == esphelm::Theme::DARK) {
    dark = lv_color_hex(0x000000);
    light = lv_color_hex(0xFFFFFF);
  } else {
    dark = c.text;
    light = c.background;
  }
}

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
  /// The map tiles every chart tile shares (ADR-0030); lives as long as the runtime.
  ChartTileStore *charts{nullptr};
  /// Whether the display has PSRAM (chart tiles keep their map tiles there).
  bool psram{false};
  /// The theme is night, red only (charts are darkened and tinted red; zones by brightness).
  bool night{false};
  /// The page is dark (night or dark theme): zone bands are drawn a little stronger.
  bool dark{false};
  /// Whether a value records its history (ADR-0018, ADR-0019): a value tile by its id, a wind
  /// rose value by "<tile id>/<name>"; and opening a tile's popup. A tap only asks for it; the
  /// runtime opens it in loop(). Unset or false: the tile isn't tappable.
  std::function<bool(const std::string &key)> has_history;
  std::function<void(const std::string &tile_id)> open_history;
  /// The recorded values, read by graph tiles (ADR-0021). Lives as long as the layout.
  const esphelm::ValueHistory *history{nullptr};
  /// The display's clock (ADR-0024): Unix seconds now, false until it has been set. Clock tiles
  /// show it in `time_zone` (UTC when the layout has none).
  std::function<bool(int64_t &utc)> utc_now;
  esphelm::wallclock::Tz time_zone;
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
  /// A tap from the test hook, as a touch would do it. `part` names a button for tiles that
  /// have several (autopilot: -10 -1 +1 +10 auto wind route standby); others ignore it.
  virtual void tap(const std::string &part) {}
};

/// Tile set: build the widget for a grid tile inside `cell` (an empty LVGL object placed in the
/// grid).
std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);

/// Tile set: the tile types it renders (schema names, for hello.widgets); `psram` says whether the
/// display has PSRAM.
void tile_types(std::vector<const char *> &out, bool psram);

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

/// Caption and unit font beside a number in `font` (ADR-0017).
const lv_font_t *companion_font(const Fonts &fonts, const lv_font_t *font);

/// Display-unit number from a SignalK value; false if it is not a finite number.
bool display_number(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, double &out);

}  // namespace esphelm_runtime
}  // namespace esphome
