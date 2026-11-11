#pragma once
// Helpers every tile set uses (ADR-0035): labels, text that follows the tile size, value formatting,
// redraw throttling and stale tracking. Part of the core, so the colour and mono tile sets share them;
// a tile set's own helpers live in its component.

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
/// `v` mapped onto 0..SCALE_STEPS between min and max, clamped.
int32_t to_steps(double v, double min, double max);
/// A scale label: no decimals for spans of 20 or more, else one.
void label_number(char *buf, size_t n, double v, double span);
/// A centre-zero value's text with its unit and side: "12 ° S", "+8.2 A".
inline std::string center_zero_label(double v, int decimals, esphelm::center_zero::Sides sides,
                                     const std::string &unit_suffix) {
  const char *side;
  const std::string text = esphelm::center_zero::text(v, decimals, sides, side);
  return text + unit_suffix + (side[0] != '\0' ? std::string(" ") + side : std::string());
}

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

}  // namespace esphelm_runtime
}  // namespace esphome
