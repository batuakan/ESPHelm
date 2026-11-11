// Text, value and timing helpers every tile set uses (ADR-0035).
#include "widget_base.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {

// ---- Value formatting (same rules as packages/editor/src/format.ts) ----

std::string printable(const char *s) {
  std::string out;
  for (const char *p = s; *p != '\0'; p++) {
    auto c = static_cast<unsigned char>(*p);
    if (c >= 0x20 && c <= 0x7E) {
      out.push_back(static_cast<char>(c));
    } else if (c == 0xC2 && static_cast<unsigned char>(p[1]) == 0xB0) {
      out.append("\xC2\xB0");
      p++;
    } else if (c >= 0x80) {
      out.push_back('?');
      while ((static_cast<unsigned char>(p[1]) & 0xC0) == 0x80)
        p++;
    }
  }
  return out;
}

bool display_number(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, double &out) {
  if (value.is<bool>() || !value.is<double>())
    return false;
  double v = value.as<double>();
  if (unit != nullptr)
    v = esphelm::units::to_display(v, *unit);
  if (!std::isfinite(v))
    return false;
  out = v;
  return true;
}

std::string format_value(ArduinoJson::JsonVariantConst value, const esphelm::units::UnitDef *unit, int decimals) {
  if (value.is<bool>())
    return value.as<bool>() ? "on" : "off";
  double v;
  if (display_number(value, unit, v)) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.*f", decimals >= 0 ? decimals : 1, v);
    return buf;
  }
  if (value.is<const char *>())
    return printable(value.as<const char *>());
  return "--";
}

// ---- Helpers ----

lv_obj_t *make_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const std::string &text) {
  lv_obj_t *label = lv_label_create(parent);
  if (font != nullptr)
    lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(label, color, LV_PART_MAIN);
  lv_label_set_text(label, text.c_str());
  return label;
}

/// Set the label text if it changed; true if it did.
bool set_text(lv_obj_t *label, std::string &shown, const std::string &text) {
  if (shown == text)
    return false;
  lv_label_set_text(label, text.c_str());
  shown = text;
  return true;
}

// ---- Text that follows the tile size (ADR-0017) ----

int32_t line_height(const lv_font_t *font) { return lv_font_get_line_height(font); }

int32_t text_width(const char *text, const lv_font_t *font) {
  lv_point_t size;
  lv_text_get_size(&size, text, font, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
  return size.x;
}

/// Height of a digit's ink in `font` (a line also has room for ascenders and descenders).
int32_t digit_height(const lv_font_t *font) {
  lv_font_glyph_dsc_t dsc;
  if (lv_font_get_glyph_dsc(font, &dsc, '8', 0))
    return dsc.box_h;
  return line_height(font);
}

/// The number a value-like tile sizes its font for: "88" plus its decimals (-1: the default 1).
std::string value_sample(int decimals) {
  if (decimals < 0)
    decimals = 1;
  std::string s(esphelm::sizes::TEXT_SAMPLE_DIGITS, '8');
  if (decimals > 0)
    s += "." + std::string(decimals, '8');
  return s;
}

/// What a formatted number or a clock time can contain; the digits-only fonts have just these glyphs.
bool is_numeric(const std::string &text) {
  return text.find_first_not_of("0123456789.-:") == std::string::npos;
}

/// The smallest full (not digits-only) font.
const lv_font_t *smallest_font(const Fonts &fonts) {
  for (uint8_t i = 0; i < fonts.count; i++) {
    if (!fonts.digits[i])
      return fonts.ladder[i];
  }
  return fonts.small;
}

const lv_font_t *fit_font(const Fonts &fonts, const char *text, int32_t w, int32_t h, int lines,
                          const lv_font_t *max) {
  for (int i = fonts.count - 1; i >= 0; i--) {
    const lv_font_t *f = fonts.ladder[i];
    if (fonts.digits[i] || (max != nullptr && line_height(f) > line_height(max)))
      continue;
    if (lines * line_height(f) <= h && text_width(text, f) <= w)
      return f;
  }
  return smallest_font(fonts);
}

/// Caption and unit font beside a number in `font`: the largest full font at most
/// TEXT_COMPANION_PERCENT of its line height, never below the smallest.
const lv_font_t *companion_font(const Fonts &fonts, const lv_font_t *font) {
  const lv_font_t *best = smallest_font(fonts);
  for (uint8_t i = 0; i < fonts.count; i++) {
    if (!fonts.digits[i] &&
        line_height(fonts.ladder[i]) * 100 <= line_height(font) * esphelm::sizes::TEXT_COMPANION_PERCENT)
      best = fonts.ladder[i];
  }
  return best;
}

uint32_t stale_ms(const esphelm::DataItem &item, const WidgetEnv &env) {
  return item.stale_after > 0 ? static_cast<uint32_t>(item.stale_after * 1000) : env.default_stale_ms;
}

int32_t to_steps(double v, double min, double max) {
  double f = (v - min) / (max - min);
  return static_cast<int32_t>(std::lround(std::min(1.0, std::max(0.0, f)) * SCALE_STEPS));
}

void label_number(char *buf, size_t n, double v, double span) {
  const int decimals = span >= 20 ? 0 : 1;
  std::snprintf(buf, n, "%.*f", decimals, v);
}

}  // namespace esphelm_runtime
}  // namespace esphome
