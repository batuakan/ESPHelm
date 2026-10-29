#include "widget_common.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {

Colors colors_for(esphelm::Theme theme) {
  if (theme == esphelm::Theme::NIGHT) {
    // Red on black keeps night vision; zones differ in brightness, not hue.
    return Colors{lv_color_hex(0x000000), lv_color_hex(0x140404), lv_color_hex(0xE0302A), lv_color_hex(0x6A2020),
                  lv_color_hex(0xE0302A), lv_color_hex(0x9A2A22),
                  {lv_color_hex(0x6A2020), lv_color_hex(0xB0401A), lv_color_hex(0xFF3B30), lv_color_hex(0xFF6060)},
                  // port bright, starboard dim; apparent bright, true dim
                  lv_color_hex(0xFF3B30), lv_color_hex(0x7A1A12), lv_color_hex(0xE0302A), lv_color_hex(0x8A1E18),
                  lv_color_hex(0x6A2020), lv_color_hex(0x1C0606), lv_color_hex(0x9A2A22),
                  // value tile colours: hue would cost night vision, so all are the text red
                  {lv_color_hex(0xE0302A), lv_color_hex(0xE0302A), lv_color_hex(0xE0302A), lv_color_hex(0xE0302A),
                   lv_color_hex(0xE0302A), lv_color_hex(0xE0302A)}};
  }
  // Day: light, for sunlight. White page, light grey tiles, dark text.
  return Colors{lv_color_hex(0xFFFFFF), lv_color_hex(0xE6EAEE), lv_color_hex(0x111820), lv_color_hex(0x5D6B78),
                lv_color_hex(0x0A6CD6), lv_color_hex(0xB07800),
                {lv_color_hex(0x1D8A4F), lv_color_hex(0xC77700), lv_color_hex(0xD32F2F), lv_color_hex(0x9C27B0)},
                // The legacy wind page: red port, green starboard, orange A, purple T; a dark card.
                lv_color_hex(0xFF0000), lv_color_hex(0x00C800), lv_color_hex(0xFF8000), lv_color_hex(0xA020F0),
                lv_color_hex(0x555555), lv_color_hex(0x2E2E2E), lv_color_hex(0xFFFFFF),
                // value tile colours: blue, green, yellow, orange, red, purple (dark enough for the
                // light grey tile in sunlight)
                {lv_color_hex(0x0A6CD6), lv_color_hex(0x1D8A4F), lv_color_hex(0xA68A00), lv_color_hex(0xD96C00),
                 lv_color_hex(0xD32F2F), lv_color_hex(0x8E24AA)}};
}

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

/// What a formatted number can contain; the digits-only fonts have just these glyphs.
bool is_numeric(const std::string &text) {
  return text.find_first_not_of("0123456789.-") == std::string::npos;
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

/// Zone styles (scale section arcs) per alert state and arc width. LVGL keeps pointers to them,
/// so they are static and only recoloured when a page is built. Widgets on one page may use
/// different widths (gauges and wind roses), hence one style per (state, width).
lv_style_t *zone_style(esphelm::ZoneState state, const Colors &colors, int32_t width) {
  static constexpr int WIDTHS = 4;
  static lv_style_t styles[4][WIDTHS];
  static int32_t widths[WIDTHS] = {0};
  static bool init = false;
  if (!init) {
    for (auto &row : styles)
      for (auto &s : row)
        lv_style_init(&s);
    init = true;
  }
  int w = 0;
  while (w < WIDTHS - 1 && widths[w] != 0 && widths[w] != width)
    w++;
  widths[w] = width;  // more than WIDTHS distinct widths share the last slot
  lv_style_t *s = &styles[static_cast<int>(state)][w];
  lv_style_set_arc_color(s, colors.zone[static_cast<int>(state)]);
  lv_style_set_arc_width(s, width);
  lv_style_set_line_color(s, colors.zone[static_cast<int>(state)]);
  return s;
}

int32_t to_steps(double v, double min, double max) {
  double f = (v - min) / (max - min);
  return static_cast<int32_t>(std::lround(std::min(1.0, std::max(0.0, f)) * SCALE_STEPS));
}

void label_number(char *buf, size_t n, double v, double span) {
  const int decimals = span >= 20 ? 0 : 1;
  std::snprintf(buf, n, "%.*f", decimals, v);
}

void style_cell(lv_obj_t *cell, const Colors &c) {
  lv_obj_remove_flag(cell, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(cell, c.tile, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(cell, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(cell, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(cell, 16, LV_PART_MAIN);
  lv_obj_set_style_pad_all(cell, 10, LV_PART_MAIN);
}

lv_obj_t *make_history_mark(lv_obj_t *parent, const Colors &c) {
  static const lv_point_precise_t MARK[] = {{0, 10}, {6, 4}, {12, 7}, {20, 0}};
  lv_obj_t *mark = lv_line_create(parent);
  lv_line_set_points(mark, MARK, 4);
  lv_obj_set_style_line_width(mark, 2, LV_PART_MAIN);
  lv_obj_set_style_line_rounded(mark, true, LV_PART_MAIN);
  lv_obj_set_style_line_color(mark, c.muted, LV_PART_MAIN);
  return mark;
}

// ---- factories ----

std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  style_cell(cell, env.colors);
  switch (tile.type) {
    case esphelm::TileType::WIND_ROSE:
      // The rose sits on the page background, as on the legacy wind page.
      lv_obj_set_style_bg_color(cell, env.colors.background, LV_PART_MAIN);
      return make_wind_rose_widget(cell, tile, env);
    case esphelm::TileType::AUTOPILOT:
      return make_autopilot_widget(cell, tile, env);
    case esphelm::TileType::GAUGE:
      return make_gauge_widget(cell, tile, env);
    case esphelm::TileType::BAR:
      return make_bar_widget(cell, tile, env);
    case esphelm::TileType::SWITCH:
      return make_switch_widget(cell, tile, env);
    case esphelm::TileType::POSITION:
      return make_position_widget(cell, tile, env);
    case esphelm::TileType::VALUE:
    default:
      return make_value_widget(cell, tile, env);
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
