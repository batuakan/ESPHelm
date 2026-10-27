#include "widgets.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.widget";
static const uint32_t DRAW_INTERVAL_MS = 250;     // at most 4 redraws per widget per second
static const uint32_t PUT_CONFIRM_MS = 5000;      // switch waits this long for its new state
static const int32_t SCALE_STEPS = 1000;          // gauge/bar values are mapped onto 0..1000

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

static lv_obj_t *make_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const std::string &text) {
  lv_obj_t *label = lv_label_create(parent);
  if (font != nullptr)
    lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(label, color, LV_PART_MAIN);
  lv_label_set_text(label, text.c_str());
  return label;
}

/// Set the label text if it changed; true if it did.
static bool set_text(lv_obj_t *label, std::string &shown, const std::string &text) {
  if (shown == text)
    return false;
  lv_label_set_text(label, text.c_str());
  shown = text;
  return true;
}

// ---- Text that follows the tile size (ADR-0017) ----

static int32_t line_height(const lv_font_t *font) { return lv_font_get_line_height(font); }

/// Width of `text` in `font`, in pixels.
static int32_t text_width(const char *text, const lv_font_t *font) {
  lv_point_t size;
  lv_text_get_size(&size, text, font, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
  return size.x;
}

/// Height of a digit's ink in `font` (a line also has room for ascenders and descenders).
static int32_t digit_height(const lv_font_t *font) {
  lv_font_glyph_dsc_t dsc;
  if (lv_font_get_glyph_dsc(font, &dsc, '8', 0))
    return dsc.box_h;
  return line_height(font);
}

/// The number a value-like tile sizes its font for: "88" plus its decimals (-1: the default 1).
static std::string value_sample(int decimals) {
  if (decimals < 0)
    decimals = 1;
  std::string s(esphelm::sizes::TEXT_SAMPLE_DIGITS, '8');
  if (decimals > 0)
    s += "." + std::string(decimals, '8');
  return s;
}

/// What a formatted number can contain; the digits-only fonts have just these glyphs.
static bool is_numeric(const std::string &text) {
  return text.find_first_not_of("0123456789.-") == std::string::npos;
}

/// The smallest full (not digits-only) font.
static const lv_font_t *smallest_font(const Fonts &fonts) {
  for (uint8_t i = 0; i < fonts.count; i++) {
    if (!fonts.digits[i])
      return fonts.ladder[i];
  }
  return fonts.small;
}

/// The largest full ladder font, no taller than `max` if given, in which `lines` lines of `text`
/// fit w x h; the smallest when none does. Digits-only fonts are skipped: `text` may be anything.
static const lv_font_t *fit_font(const Fonts &fonts, const char *text, int32_t w, int32_t h, int lines = 1,
                                 const lv_font_t *max = nullptr) {
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
static const lv_font_t *companion_font(const Fonts &fonts, const lv_font_t *font) {
  const lv_font_t *best = smallest_font(fonts);
  for (uint8_t i = 0; i < fonts.count; i++) {
    if (!fonts.digits[i] &&
        line_height(fonts.ladder[i]) * 100 <= line_height(font) * esphelm::sizes::TEXT_COMPANION_PERCENT)
      best = fonts.ladder[i];
  }
  return best;
}

static uint32_t stale_ms(const esphelm::DataItem &item, const WidgetEnv &env) {
  return item.stale_after > 0 ? static_cast<uint32_t>(item.stale_after * 1000) : env.default_stale_ms;
}

/// Zone styles (scale section arcs) per alert state and arc width. LVGL keeps pointers to them,
/// so they are static and only recoloured when a page is built. Widgets on one page may use
/// different widths (gauges and wind roses), hence one style per (state, width).
static lv_style_t *zone_style(esphelm::ZoneState state, const Colors &colors, int32_t width) {
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

static int32_t to_steps(double v, double min, double max) {
  double f = (v - min) / (max - min);
  return static_cast<int32_t>(std::lround(std::min(1.0, std::max(0.0, f)) * SCALE_STEPS));
}

static void label_number(char *buf, size_t n, double v, double span) {
  const int decimals = span >= 20 ? 0 : 1;
  std::snprintf(buf, n, "%.*f", decimals, v);
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

static void style_cell(lv_obj_t *cell, const Colors &c) {
  lv_obj_remove_flag(cell, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(cell, c.tile, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(cell, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(cell, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(cell, 16, LV_PART_MAIN);
  lv_obj_set_style_pad_all(cell, 10, LV_PART_MAIN);
}

// ---- value ----

/**
 * Caption, number and unit. The number gets the largest font whose sample ("88" plus the
 * decimals) fits the cell, with the caption line above and the unit line below; caption and unit
 * scale with it (ADR-0017). A wider live value (RPM, text) steps the number down a size until it
 * fits, and it stays there until the page is laid out again. Memory: three labels.
 */
class ValueWidget : public Widget {
 public:
  ValueWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), night_(env.night), color_(tile.color),
        zones_(tile.zones), sample_(value_sample(tile.data.decimals)) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    value_ = make_label(cell, env.fonts.value, env.colors.muted, "--");
    lv_label_set_long_mode(value_, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_set_style_text_align(value_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      unit_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.unit->label);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }

  void layout_done() override {
    width_ = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const bool has_caption = !b_.item.label.empty();
    level_ = 0;
    for (int i = fonts_.count - 1; i >= 0; i--) {
      const lv_font_t *c = companion_font(fonts_, fonts_.ladder[i]);
      const int32_t bands = (has_caption ? line_height(c) : 0) + (unit_ != nullptr ? line_height(c) : 0);
      if (text_width(sample_.c_str(), fonts_.ladder[i]) <= width_ && digit_height(fonts_.ladder[i]) + bands <= h) {
        level_ = i;
        break;
      }
    }
    const lv_font_t *companion = companion_font(fonts_, number_font_());
    const int32_t top = has_caption ? line_height(companion) : 0;
    const int32_t bottom = unit_ != nullptr ? line_height(companion) : 0;
    lv_obj_set_style_text_font(caption_, companion, LV_PART_MAIN);
    lv_obj_set_width(caption_, width_);
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    if (unit_ != nullptr) {
      lv_obj_set_style_text_font(unit_, companion, LV_PART_MAIN);
      lv_obj_align(unit_, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    }
    // The number centres in the band between the caption and the unit.
    offset_y_ = (top - bottom) / 2;
    lv_obj_set_width(value_, width_);
    apply_number_font_();
    shrink_to_fit_();
    if (!b_.stale_shown)
      b_.dirty = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == b_.item.path)
      b_.set(v, now);
  }
  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    if (set_text(value_, shown_, stale ? "--" : b_.text))
      shrink_to_fit_();
    lv_obj_set_style_text_color(value_, stale ? colors_.muted : number_color_(), LV_PART_MAIN);
  }

 protected:
  const lv_font_t *number_font_() const { return fonts_.count > 0 ? fonts_.ladder[level_] : fonts_.value; }
  void apply_number_font_() {
    lv_obj_set_style_text_font(value_, number_font_(), LV_PART_MAIN);
    lv_obj_align(value_, LV_ALIGN_CENTER, 0, offset_y_);
  }
  /// Step the number down while the shown text is wider than the cell, or isn't numeric in a
  /// digits-only font. Numeric text no longer than the sample fits by construction, so most
  /// values are never measured.
  void shrink_to_fit_() {
    const bool numeric = is_numeric(shown_);
    if ((numeric && shown_.size() <= sample_.size()) || width_ <= 0)
      return;
    const int before = level_;
    while (level_ > 0 && ((fonts_.digits[level_] && !numeric) || text_width(shown_.c_str(), number_font_()) > width_))
      level_--;
    if (level_ != before) {
      ESP_LOGD(TAG, "Value %s: smaller font (line %d px) for \"%s\"", id_.c_str(), (int) line_height(number_font_()),
               shown_.c_str());
      apply_number_font_();
    }
  }

  /// A matching zone, else the tile's colour, else the theme's text colour (ADR-0016).
  lv_color_t number_color_() const {
    esphelm::ZoneState state;
    if (b_.has_number && esphelm::value_zone_state(b_.number, zones_, state)) {
      // At night the dim "normal" zone shade would look stale: normal is the text colour.
      if (night_ && state == esphelm::ZoneState::NORMAL)
        return colors_.text;
      return colors_.zone[static_cast<int>(state)];
    }
    if (color_ != esphelm::ValueColor::NONE)
      return colors_.palette[static_cast<int>(color_)];
    return colors_.text;
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  bool night_;
  esphelm::ValueColor color_;
  std::vector<esphelm::Zone> zones_;
  std::string sample_;
  Binding b_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  lv_obj_t *unit_{nullptr};
  int level_{0};  // index of the number's font in fonts_.ladder
  int32_t width_{0}, offset_y_{0};
  std::string shown_{"--"};
};

// ---- gauge ----

class GaugeWidget : public Widget {
 public:
  GaugeWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), min_(tile.min), max_(tile.max),
        sample_(value_sample(tile.data.decimals)) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();

    scale_ = lv_scale_create(cell);
    lv_obj_center(scale_);
    lv_scale_set_mode(scale_, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_angle_range(scale_, 270);
    lv_scale_set_rotation(scale_, 135);
    lv_scale_set_range(scale_, 0, SCALE_STEPS);
    lv_scale_set_total_tick_count(scale_, 21);
    lv_scale_set_major_tick_every(scale_, 5);
    lv_scale_set_label_show(scale_, true);
    // Tick labels in display units (the scale itself runs 0..1000).
    const double span = max_ - min_;
    for (int i = 0; i < 5; i++) {
      char buf[16];
      label_number(buf, sizeof(buf), min_ + span * i / 4.0, span);
      tick_text_[i] = buf;
    }
    for (int i = 0; i < 5; i++)
      tick_ptrs_[i] = tick_text_[i].c_str();
    tick_ptrs_[5] = nullptr;
    lv_scale_set_text_src(scale_, tick_ptrs_);
    lv_obj_set_style_text_font(scale_, env.fonts.small, LV_PART_INDICATOR);
    lv_obj_set_style_pad_radial(scale_, 10, LV_PART_INDICATOR);  // keep labels off the major ticks
    lv_obj_set_style_text_color(scale_, env.colors.muted, LV_PART_INDICATOR);
    lv_obj_set_style_line_color(scale_, env.colors.muted, LV_PART_ITEMS);
    lv_obj_set_style_line_color(scale_, env.colors.muted, LV_PART_INDICATOR);
    lv_obj_set_style_length(scale_, 6, LV_PART_ITEMS);
    lv_obj_set_style_length(scale_, 12, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(scale_, env.colors.muted, LV_PART_MAIN);
    lv_obj_set_style_arc_width(scale_, 2, LV_PART_MAIN);
    for (const auto &z : tile.zones) {
      lv_scale_section_t *section = lv_scale_add_section(scale_);
      lv_scale_set_section_range(scale_, section, to_steps(z.from, min_, max_), to_steps(z.to, min_, max_));
      lv_scale_set_section_style_main(scale_, section, zone_style(z.state, env.colors, 8));
    }
    needle_ = lv_line_create(scale_);
    lv_obj_set_style_line_width(needle_, 4, LV_PART_MAIN);
    lv_obj_set_style_line_rounded(needle_, true, LV_PART_MAIN);
    lv_obj_set_style_line_color(needle_, env.colors.muted, LV_PART_MAIN);

    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    // Value and unit sit in the open bottom of the 270 degree arc, clear of the needle hub.
    value_ = make_label(cell, env.fonts.label, env.colors.muted, "--");
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      unit_suffix_ = std::string(" ") + tile.data.unit->label;
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }
  void layout_done() override {
    // The caption takes the top line; the scale gets the largest square below it.
    const int32_t h = lv_obj_get_content_height(cell_) - lv_obj_get_height(caption_);
    const int32_t d = std::max<int32_t>(16, std::min(lv_obj_get_content_width(cell_), h));
    lv_obj_set_size(scale_, d, d);
    lv_obj_align(scale_, LV_ALIGN_BOTTOM_MID, 0, 0);
    // Runs again when the page is laid out anew (alarm banner), so every choice is undone too.
    // Tiny gauges drop the unit (the caption names the quantity).
    const bool small = d < 160;
    suffix_ = small ? "" : unit_suffix_;
    // The value fits the open bottom of the arc (its chord is about 0.7 d), clear of the hub.
    const std::string sample = sample_ + suffix_;
    lv_obj_set_style_text_font(value_, fit_font(fonts_, sample.c_str(), d * 7 / 10, d / 4), LV_PART_MAIN);
    set_text(value_, shown_, "--" + suffix_);
    lv_obj_update_layout(value_);
    lv_obj_align_to(value_, scale_, LV_ALIGN_BOTTOM_MID, 0, 0);
    // Small gauge: tick labels would collide with the caption and value; keep the ticks.
    lv_scale_set_label_show(scale_, !small);
    lv_scale_set_total_tick_count(scale_, small ? 11 : 21);
    lv_scale_set_line_needle_value(scale_, needle_, -(d / 7), b_.has_number ? to_steps(b_.number, min_, max_) : 0);
    if (!b_.stale_shown)
      b_.dirty = true;  // show the value (and needle) again at the new size
  }
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == b_.item.path)
      b_.set(v, now);
  }
  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    const bool live = !stale && b_.has_number;
    if (set_text(value_, shown_, (stale ? "--" : b_.text) + suffix_))
      lv_obj_align_to(value_, scale_, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_text_color(value_, live ? colors_.text : colors_.muted, LV_PART_MAIN);
    lv_obj_set_style_line_color(needle_, live ? colors_.text : colors_.muted, LV_PART_MAIN);
    if (b_.has_number) {
      const int32_t d = lv_obj_get_width(scale_);
      lv_scale_set_line_needle_value(scale_, needle_, -(d / 7), to_steps(b_.number, min_, max_));
    }
  }

 protected:
  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  double min_, max_;
  std::string sample_;
  Binding b_;
  lv_obj_t *scale_;
  lv_obj_t *needle_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  std::string unit_suffix_;
  std::string suffix_;
  std::string shown_{"--"};
  std::string tick_text_[5];
  const char *tick_ptrs_[6];
};

// ---- bar ----

class BarWidget : public Widget {
 public:
  BarWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), min_(tile.min), max_(tile.max),
        zones_(tile.zones), sample_(value_sample(tile.data.decimals)) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    const bool vertical = tile.orientation == esphelm::Orientation::VERTICAL;
    vertical_ = vertical;

    lv_obj_t *caption = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_obj_align(caption, LV_ALIGN_TOP_LEFT, 0, 0);
    bar_ = lv_bar_create(cell);
    lv_bar_set_range(bar_, 0, SCALE_STEPS);
    lv_bar_set_orientation(bar_, vertical ? LV_BAR_ORIENTATION_VERTICAL : LV_BAR_ORIENTATION_HORIZONTAL);
    lv_obj_set_style_bg_color(bar_, env.colors.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(bar_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar_, env.colors.muted, LV_PART_INDICATOR);
    lv_obj_set_style_radius(bar_, 6, LV_PART_MAIN);
    lv_obj_set_style_radius(bar_, 6, LV_PART_INDICATOR);
    value_ = make_label(cell, env.fonts.label, env.colors.muted, "--");
    const bool has_unit = tile.data.unit != nullptr && tile.data.unit->label[0] != '\0';
    if (vertical) {
      // Narrow cells: the unit goes on its own line under the value, beside the bar.
      lv_obj_set_size(bar_, lv_pct(22), lv_pct(78));
      lv_obj_align(bar_, LV_ALIGN_BOTTOM_LEFT, 0, 0);
      lv_obj_t *unit = make_label(cell, env.fonts.small, env.colors.muted, has_unit ? tile.data.unit->label : "");
      lv_obj_align(unit, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
      lv_obj_align(value_, LV_ALIGN_BOTTOM_RIGHT, 0, -lv_font_get_line_height(env.fonts.small));
    } else {
      if (has_unit)
        suffix_ = std::string(" ") + tile.data.unit->label;
      set_text(value_, shown_, "--" + suffix_);
      lv_obj_set_size(bar_, lv_pct(100), lv_pct(26));
      lv_obj_align(bar_, LV_ALIGN_BOTTOM_MID, 0, 0);
      lv_obj_align(value_, LV_ALIGN_RIGHT_MID, 0, -4);
    }
  }
  const std::string &id() const override { return id_; }
  void layout_done() override {
    // The value takes the largest font that fits beside or above the bar (ADR-0017).
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const int32_t small_h = line_height(fonts_.small);
    const int32_t caption_h = b_.item.label.empty() ? 0 : small_h;
    const std::string sample = sample_ + suffix_;
    if (vertical_) {
      // Beside the bar (22 % of the width), over the unit line.
      const lv_font_t *f = fit_font(fonts_, sample.c_str(), w * 74 / 100, (h - caption_h - small_h) / 2);
      lv_obj_set_style_text_font(value_, f, LV_PART_MAIN);
      lv_obj_align(value_, LV_ALIGN_BOTTOM_RIGHT, 0, -small_h);
    } else {
      // Between the caption and the bar (the bottom 26 % of the height).
      const int32_t band = h * 74 / 100 - caption_h - 4;
      const lv_font_t *f = fit_font(fonts_, sample.c_str(), w, band);
      lv_obj_set_style_text_font(value_, f, LV_PART_MAIN);
      lv_obj_align(value_, LV_ALIGN_TOP_RIGHT, 0, caption_h + (band - line_height(f)) / 2);
    }
    if (!b_.stale_shown)
      b_.dirty = true;
  }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == b_.item.path)
      b_.set(v, now);
  }
  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    const bool live = !stale && b_.has_number;
    set_text(value_, shown_, (stale ? "--" : b_.text) + suffix_);
    lv_obj_set_style_text_color(value_, live ? colors_.text : colors_.muted, LV_PART_MAIN);
    lv_color_t fill = colors_.muted;
    if (live) {
      fill = colors_.zone[0];
      for (const auto &z : zones_) {
        if (b_.number >= z.from && b_.number <= z.to)
          fill = colors_.zone[static_cast<int>(z.state)];
      }
      lv_bar_set_value(bar_, to_steps(b_.number, min_, max_), LV_ANIM_OFF);
    }
    lv_obj_set_style_bg_color(bar_, fill, LV_PART_INDICATOR);
  }

 protected:
  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  double min_, max_;
  std::vector<esphelm::Zone> zones_;
  std::string sample_;
  bool vertical_{false};
  Binding b_;
  lv_obj_t *bar_;
  lv_obj_t *value_;
  std::string suffix_;
  std::string shown_{"--"};
};

// ---- switch ----

class SwitchWidget : public Widget {
 public:
  SwitchWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), path_(tile.data.path), colors_(env.colors), put_(env.put), cell_(cell) {
    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    sw_ = lv_switch_create(cell);
    lv_obj_set_style_bg_color(sw_, env.colors.background, LV_PART_MAIN);
    lv_obj_set_style_bg_color(sw_, env.colors.accent, static_cast<lv_style_selector_t>(LV_PART_INDICATOR) | LV_STATE_CHECKED);
    // Theme-coloured knob (LVGL's default is white: invisible on a day track, glaring at night).
    lv_obj_set_style_bg_color(sw_, env.colors.text, LV_PART_KNOB);
    lv_obj_set_style_bg_color(sw_, env.colors.tile, static_cast<lv_style_selector_t>(LV_PART_KNOB) | LV_STATE_CHECKED);
    lv_obj_add_event_cb(
        sw_, [](lv_event_t *e) { static_cast<SwitchWidget *>(lv_event_get_user_data(e))->toggled_(); },
        LV_EVENT_VALUE_CHANGED, this);
    state_ = make_label(cell, env.fonts.small, env.colors.muted, "--");
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(path_); }
  void layout_done() override {
    // The track is twice as wide as high. Three arrangements; the one with the largest track wins:
    //  - stacked: caption above, state below, the track between them (squarish cells)
    //  - side: caption and state on the left, the track on the right (wide, short cells)
    //  - split: caption across the top, state and track below it (narrow, short cells)
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const int32_t line = lv_font_get_line_height(lv_obj_get_style_text_font(caption_, LV_PART_MAIN));
    const int32_t stacked = std::min(w * 7 / 20, h - 2 * line - 8);
    const int32_t side = std::min(h * 8 / 10, (w - 4 * line - 8) / 2);  // leaves the text 4 lines' width
    const int32_t split = std::min(h - line - 6, (w - 2 * line - 8) / 2);
    lv_obj_set_height(caption_, line);  // one line, cut with dots
    if (side > stacked * 5 / 4 && side >= split) {
      const int32_t t = std::max<int32_t>(8, side);
      lv_obj_set_size(sw_, t * 2, t);
      lv_obj_align(sw_, LV_ALIGN_RIGHT_MID, 0, 0);
      lv_obj_set_width(caption_, std::max<int32_t>(0, w - t * 2 - 8));
      lv_obj_align(caption_, LV_ALIGN_LEFT_MID, 0, -(line / 2 + 2));
      lv_obj_align(state_, LV_ALIGN_LEFT_MID, 0, line / 2 + 2);
    } else if (split > stacked * 5 / 4) {
      const int32_t t = std::max<int32_t>(8, split);
      lv_obj_set_size(sw_, t * 2, t);
      lv_obj_align(sw_, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
      lv_obj_set_width(caption_, w);
      lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
      lv_obj_align(state_, LV_ALIGN_BOTTOM_LEFT, 0, -(t - line) / 2);
    } else {
      const int32_t t = std::max<int32_t>(8, stacked);
      lv_obj_set_size(sw_, t * 2, t);
      lv_obj_align(sw_, LV_ALIGN_CENTER, 0, 0);
      lv_obj_set_width(caption_, w);
      lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
      lv_obj_align(state_, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    }
  }
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path != path_ || !v.is<bool>())
      return;
    known_ = true;
    on_ = v.as<bool>();
    pending_ = false;
    dirty_ = true;
  }
  void tick(uint32_t now) override {
    if (pending_ && now - pending_since_ >= PUT_CONFIRM_MS) {
      // No confirmation: show the last known state and flag the failure.
      pending_ = false;
      failed_ = true;
      dirty_ = true;
      ESP_LOGW(TAG, "No confirmation for PUT %s", path_.c_str());
    }
    if (!dirty_)
      return;
    dirty_ = false;
    const bool shown_on = pending_ ? pending_value_ : on_;
    if (lv_obj_has_state(sw_, LV_STATE_CHECKED) != shown_on) {
      if (shown_on)
        lv_obj_add_state(sw_, LV_STATE_CHECKED);
      else
        lv_obj_remove_state(sw_, LV_STATE_CHECKED);
    }
    std::string text = !known_ && !pending_ ? "--" : pending_ ? "..." : (on_ ? "on" : "off");
    if (failed_ && !pending_)
      text += " !";
    lv_label_set_text(state_, text.c_str());
  }
  void tap(const std::string &) override {
    // Same as a touch: flip the switch, which fires LV_EVENT_VALUE_CHANGED.
    if (lv_obj_has_state(sw_, LV_STATE_CHECKED))
      lv_obj_remove_state(sw_, LV_STATE_CHECKED);
    else
      lv_obj_add_state(sw_, LV_STATE_CHECKED);
    lv_obj_send_event(sw_, LV_EVENT_VALUE_CHANGED, nullptr);
  }

 protected:
  void toggled_() {
    pending_value_ = lv_obj_has_state(sw_, LV_STATE_CHECKED);
    pending_ = true;
    pending_since_ = millis();
    failed_ = false;
    dirty_ = true;
    ESP_LOGI(TAG, "PUT %s = %s", path_.c_str(), pending_value_ ? "true" : "false");
    if (put_)
      put_(path_, pending_value_);
  }

  std::string id_;
  std::string path_;
  Colors colors_;
  std::function<void(const std::string &, const PutValue &)> put_;
  lv_obj_t *cell_;
  lv_obj_t *caption_;
  lv_obj_t *sw_;
  lv_obj_t *state_;
  bool known_{false}, on_{false}, pending_{false}, pending_value_{false}, failed_{false}, dirty_{true};
  uint32_t pending_since_{0};
};

// ---- autopilot ----

// Engage needs a second tap within this time (ADR-0011).
static const uint32_t ARM_MS = 3000;

static const char *mode_name(esphelm::AutopilotMode m) {
  switch (m) {
    case esphelm::AutopilotMode::WIND:
      return "wind";
    case esphelm::AutopilotMode::ROUTE:
      return "route";
    case esphelm::AutopilotMode::AUTO:
    default:
      return "auto";
  }
}

/// Display text for a steering.autopilot.state value.
static std::string state_title(const std::string &state) {
  if (state == "route")
    return "TRACK";
  std::string out;
  for (char c : state.substr(0, 12))
    out.push_back(c >= 'a' && c <= 'z' ? static_cast<char>(c - 'a' + 'A') : c);
  return out;
}

/// States in which the pilot is not steering (course changes would do nothing or surprise).
static bool disengaged(const std::string &state) {
  return state == "standby" || state == "off" || state == "disabled";
}

class AutopilotWidget : public Widget {
 public:
  AutopilotWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), put_(env.put), can_put_(env.can_put) {
    static const esphelm::AutopilotConfig DEFAULTS;
    const esphelm::AutopilotConfig &cfg = tile.autopilot ? *tile.autopilot : DEFAULTS;
    state_path_ = cfg.state_path;
    adjust_path_ = cfg.adjust_path;
    stale_ms_ = env.default_stale_ms;
    state_ms_ = millis();
    const esphelm::units::UnitDef *deg = esphelm::units::find_unit("deg");
    for (Binding *b : {&target_, &heading_}) {
      b->item.unit = deg;
      b->item.decimals = 0;
      b->stale_ms = env.default_stale_ms;
      b->last_value_ms = millis();
    }
    target_.item.path = cfg.target_path;
    heading_.item.path = cfg.heading_path;

    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    state_label_ = make_label(cell, env.fonts.label, env.colors.muted, "--");
    course_label_ = make_label(cell, env.fonts.small, env.colors.muted, "TGT --   HDG --");
    note_label_ = make_label(cell, env.fonts.small, env.colors.muted, "");

    // Buttons exist in every tier but are only shown (and usable) in the controls tier.
    static const char *const ADJUST[] = {"-10", "-1", "+1", "+10"};
    for (const char *part : ADJUST)
      add_button_(part, part, Kind::ADJUST);
    for (esphelm::AutopilotMode m : cfg.modes)
      add_button_(mode_name(m), state_title(mode_name(m)), Kind::MODE);
    add_button_("standby", "STANDBY", Kind::STANDBY);
  }

  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {
    out.push_back(state_path_);
    out.push_back(target_.item.path);
    out.push_back(heading_.item.path);
  }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    controls_ = w >= esphelm::sizes::AUTOPILOT_CONTROLS_WIDTH && h >= esphelm::sizes::AUTOPILOT_CONTROLS_HEIGHT;
    narrow_ = w < esphelm::sizes::AUTOPILOT_CONTROLS_WIDTH;
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    // Status lines span the tile and centre their text, so they stay centred as the text changes.
    // The state takes the largest font in which its longest word fits (ADR-0017): with buttons up
    // to the value font in a third of the height, status only in what the other lines leave.
    const int32_t small_line = lv_font_get_line_height(fonts_.small);
    const lv_font_t *state_font =
        controls_ ? fit_font(fonts_, "STANDBY", w, h / 3, 1, fonts_.value)
                  : fit_font(fonts_, "STANDBY", w, h - 4 * small_line);
    lv_obj_set_style_text_font(state_label_, state_font, LV_PART_MAIN);
    for (lv_obj_t *l : {state_label_, course_label_, note_label_}) {
      lv_obj_set_width(l, w);
      lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
      lv_label_set_long_mode(l, LV_LABEL_LONG_MODE_DOTS);
    }
    const int32_t small_h = lv_font_get_line_height(fonts_.small);
    const int32_t state_h = lv_font_get_line_height(state_font);
    const int32_t caption_h = lv_label_get_text(caption_)[0] != '\0' ? small_h : 0;
    // TGT and HDG side by side, stacked when narrow, and HDG dropped when even that won't fit.
    show_heading_ = !narrow_ || caption_h + state_h + 3 * small_h <= h;
    const int32_t course_h = narrow_ && show_heading_ ? 2 * small_h : small_h;
    lv_obj_set_height(course_label_, course_h);
    course_shown_.clear();
    set_text(course_label_, course_shown_, course_text_("--", "--"));
    if (!controls_) {
      // Status only: nothing on this tile can command the pilot.
      for (auto &b : buttons_)
        lv_obj_add_flag(b.obj, LV_OBJ_FLAG_HIDDEN);
      const int32_t top = std::max(caption_h, (h - state_h - course_h - small_h) / 2);
      lv_obj_align(state_label_, LV_ALIGN_TOP_MID, 0, top);
      lv_obj_align(course_label_, LV_ALIGN_TOP_MID, 0, top + state_h);
      lv_obj_align(note_label_, LV_ALIGN_TOP_MID, 0, top + state_h + course_h);
      return;
    }
    lv_obj_align(state_label_, LV_ALIGN_TOP_MID, 0, 0);
    lv_obj_align(course_label_, LV_ALIGN_TOP_MID, 0, state_h);
    lv_obj_align(note_label_, LV_ALIGN_TOP_MID, 0, state_h + course_h);
    const int32_t status_h = state_h + course_h + small_h + 4;

    // Rows: the four course buttons; then the modes and STANDBY. STANDBY gets a row of its own
    // when its label would not fit a quarter of the width.
    const int32_t gap = 6;
    const size_t modes = buttons_.size() - 5;
    const int32_t quarter = (w - 3 * gap) / 4;
    lv_obj_update_layout(buttons_.back().label);
    const bool standby_row = lv_obj_get_width(buttons_.back().label) + 12 > quarter && modes > 0;
    const int32_t rows = standby_row ? 3 : 2;
    const int32_t btn_h = std::max<int32_t>(48, std::min<int32_t>(96, (h - status_h - rows * gap) / rows));
    for (size_t i = 0; i < buttons_.size(); i++) {
      int32_t row, n, k;
      if (i < 4) {
        row = 0, n = 4, k = static_cast<int32_t>(i);
      } else if (standby_row && i == buttons_.size() - 1) {
        row = 2, n = 1, k = 0;
      } else {
        row = 1, n = static_cast<int32_t>(standby_row ? modes : modes + 1), k = static_cast<int32_t>(i - 4);
      }
      const int32_t bw = (w - gap * (n - 1)) / n;
      lv_obj_remove_flag(buttons_[i].obj, LV_OBJ_FLAG_HIDDEN);  // hidden if the tile was small before
      lv_obj_set_size(buttons_[i].obj, bw, btn_h);
      lv_obj_align(buttons_[i].obj, LV_ALIGN_BOTTOM_LEFT, k * (bw + gap), -(rows - 1 - row) * (btn_h + gap));
    }
    dirty_ = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == state_path_ && v.is<const char *>()) {
      state_ = v.as<const char *>();
      state_known_ = true;
      state_ms_ = now;
      if (pending_ && state_ == pending_state_)
        pending_ = false;
      dirty_ = true;
    }
    for (Binding *b : {&target_, &heading_}) {
      if (path == b->item.path)
        b->set(v, now);
    }
  }

  void tick(uint32_t now) override {
    if (armed_ >= 0 && now - armed_since_ >= ARM_MS) {
      ESP_LOGI(TAG, "Autopilot %s: arm expired (%s)", id_.c_str(), buttons_[armed_].part.c_str());
      armed_ = -1;
      dirty_ = true;
    }
    if (pending_ && now - pending_since_ >= PUT_CONFIRM_MS) {
      ESP_LOGW(TAG, "Autopilot %s: no confirmation for state %s", id_.c_str(), pending_state_.c_str());
      pending_ = false;
      failed_ = true;
      dirty_ = true;
    }
    const bool online = can_put_ && can_put_();
    const bool stale = !state_known_ || now - state_ms_ > stale_ms_;
    if (online != online_ || stale != stale_) {
      online_ = online;
      stale_ = stale;
      dirty_ = true;
    }
    bool s;
    if (target_.due(now, s) | heading_.due(now, s)) {
      const auto deg = [now](const Binding &b) {
        return b.has_number && now - b.last_value_ms <= b.stale_ms ? b.text + "\xC2\xB0" : std::string("--");
      };
      set_text(course_label_, course_shown_, course_text_(deg(target_), deg(heading_)));
    }
    if (!dirty_ || now - last_draw_ms_ < DRAW_INTERVAL_MS)
      return;
    dirty_ = false;
    last_draw_ms_ = now;
    redraw_();
  }

  void tap(const std::string &part) override {
    for (size_t i = 0; i < buttons_.size(); i++) {
      if (buttons_[i].part == part) {
        press_(i);
        return;
      }
    }
    ESP_LOGW(TAG, "Autopilot %s: no button \"%s\"", id_.c_str(), part.c_str());
  }

 protected:
  enum class Kind : uint8_t { ADJUST, MODE, STANDBY };
  struct Button {
    std::string part;
    std::string title;
    Kind kind;
    lv_obj_t *obj;
    lv_obj_t *label;
    std::string shown;
  };

  void add_button_(const std::string &part, const std::string &title, Kind kind) {
    lv_obj_t *btn = lv_button_create(cell_);
    lv_obj_set_style_radius(btn, 10, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(btn, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(btn, colors_.background, LV_PART_MAIN);
    // The default theme recolours disabled buttons grey, far too bright at night.
    lv_obj_set_style_recolor_opa(btn, LV_OPA_TRANSP, LV_STATE_DISABLED);
    lv_obj_set_style_bg_color(btn, colors_.background, LV_STATE_DISABLED);
    lv_obj_t *label = make_label(btn, fonts_.small, colors_.text, title);
    lv_obj_center(label);
    buttons_.push_back(Button{part, title, kind, btn, label, title});
    lv_obj_set_user_data(btn, reinterpret_cast<void *>(buttons_.size() - 1));
    lv_obj_add_event_cb(
        btn,
        [](lv_event_t *e) {
          auto *self = static_cast<AutopilotWidget *>(lv_event_get_user_data(e));
          auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
          self->press_(reinterpret_cast<uintptr_t>(lv_obj_get_user_data(target)));
        },
        LV_EVENT_CLICKED, this);
  }

  bool usable_(const Button &b) const {
    if (!controls_ || !online_)
      return false;
    if (b.kind == Kind::ADJUST)
      return !stale_ && !disengaged(state_);
    return true;
  }

  /// A touch or the test hook. The same rules as the enabled states, so the hook cannot do
  /// what a finger could not.
  void press_(size_t i) {
    Button &b = buttons_[i];
    const uint32_t now = millis();
    if (!usable_(b)) {
      ESP_LOGW(TAG, "Autopilot %s: %s ignored (%s)", id_.c_str(), b.part.c_str(),
               !controls_ ? "tile too small for controls" : !online_ ? "offline" : "not engaged");
      return;
    }
    const int was_armed = armed_;
    armed_ = -1;
    dirty_ = true;
    switch (b.kind) {
      case Kind::ADJUST: {
        const double delta = std::strtod(b.part.c_str(), nullptr);
        ESP_LOGI(TAG, "Autopilot %s: PUT %s = %+.0f", id_.c_str(), adjust_path_.c_str(), delta);
        put_(adjust_path_, PutValue{delta});
        break;
      }
      case Kind::STANDBY:
        send_state_("standby");
        break;
      case Kind::MODE:
        if (was_armed == static_cast<int>(i) && now - armed_since_ < ARM_MS) {
          send_state_(b.part);
        } else {
          armed_ = static_cast<int>(i);
          armed_since_ = now;
          ESP_LOGI(TAG, "Autopilot %s: armed %s, tap again to engage", id_.c_str(), b.part.c_str());
        }
        break;
    }
  }

  std::string course_text_(const std::string &target, const std::string &heading) const {
    if (!show_heading_)
      return "TGT " + target;
    return "TGT " + target + (narrow_ ? "\n" : "   ") + "HDG " + heading;
  }

  void send_state_(const std::string &state) {
    ESP_LOGI(TAG, "Autopilot %s: PUT %s = %s", id_.c_str(), state_path_.c_str(), state.c_str());
    pending_ = true;
    pending_state_ = state;
    pending_since_ = millis();
    failed_ = false;
    put_(state_path_, PutValue{state});
  }

  void redraw_() {
    const bool live = state_known_ && !stale_;
    set_text(state_label_, state_shown_, live ? state_title(state_) : "--");
    lv_obj_set_style_text_color(state_label_, live && !disengaged(state_) ? colors_.accent : colors_.text,
                                LV_PART_MAIN);
    std::string note;
    if (!online_)
      note = "offline";
    else if (armed_ >= 0)
      note = "tap " + buttons_[armed_].title + " again to engage";
    else if (pending_)
      note = "sending " + state_title(pending_state_) + "...";
    else if (failed_)
      note = "! no response from the autopilot";
    set_text(note_label_, note_shown_, note);
    if (!controls_)
      return;
    for (size_t i = 0; i < buttons_.size(); i++) {
      Button &b = buttons_[i];
      if (usable_(b))
        lv_obj_remove_state(b.obj, LV_STATE_DISABLED);
      else
        lv_obj_add_state(b.obj, LV_STATE_DISABLED);
      const bool armed = armed_ == static_cast<int>(i);
      const bool current = b.kind != Kind::ADJUST && live && state_ == b.part;
      lv_obj_set_style_bg_color(b.obj, armed ? colors_.accent : current ? colors_.tile : colors_.background,
                                LV_PART_MAIN);
      lv_obj_set_style_border_width(b.obj, current ? 2 : 0, LV_PART_MAIN);
      lv_obj_set_style_border_color(b.obj, colors_.accent, LV_PART_MAIN);
      lv_obj_set_style_text_color(b.label, armed ? colors_.background : usable_(b) ? colors_.text : colors_.muted,
                                  LV_PART_MAIN);
      set_text(b.label, b.shown, armed ? b.title + "?" : b.title);
    }
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  std::function<void(const std::string &, const PutValue &)> put_;
  std::function<bool()> can_put_;
  std::string state_path_, adjust_path_;
  uint32_t stale_ms_{0};
  Binding target_, heading_;
  lv_obj_t *caption_, *state_label_, *course_label_, *note_label_;
  std::string state_shown_{"--"}, course_shown_, note_shown_;
  std::vector<Button> buttons_;
  bool controls_{false}, narrow_{false}, show_heading_{true}, online_{false}, stale_{true}, dirty_{true};
  bool state_known_{false}, pending_{false}, failed_{false};
  std::string state_, pending_state_;
  uint32_t state_ms_{0}, pending_since_{0}, armed_since_{0}, last_draw_ms_{0};
  int armed_{-1};
};

// ---- wind rose ----

// Compass card letters, one per major tick (17 ticks from 0 to 360; the last one sits on N).
static const char *CARD_POINTS[] = {"N",  "NNE", "NE", "ENE", "E",  "ESE", "SE", "SSE", "S",
                                    "SSW", "SW", "WSW", "W",  "WNW", "NW", "NNW", "", nullptr};
static const char *CARD_CARDINALS[] = {"N", "", "", "", "E", "", "", "", "S",
                                       "", "", "", "W", "", "", "", "", nullptr};

/// Arc style for the close-hauled sectors (static: LVGL keeps the pointer). One per side.
static lv_style_t *sector_style(int side, lv_color_t color, int32_t width) {
  static lv_style_t styles[2];
  static bool init = false;
  if (!init) {
    for (auto &s : styles)
      lv_style_init(&s);
    init = true;
  }
  lv_style_t *s = &styles[side];
  lv_style_set_arc_color(s, color);
  lv_style_set_arc_opa(s, LV_OPA_COVER);
  lv_style_set_arc_width(s, width);
  lv_style_set_arc_rounded(s, false);
  return s;
}

/**
 * The legacy wind page as a tile: a fixed ring relative to the bow (ticks every 5 and 30
 * degrees, wide red/green close-hauled sectors), a compass card inside it turning with the
 * heading, triangle markers for apparent (A) and true (T) wind on the ring, the heading at the
 * top and up to three big values in the middle. Everything is drawn to the tile's size.
 */
class WindRoseWidget : public Widget {
 public:
  WindRoseWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), area_(cell) {
    static const esphelm::RoseConfig DEFAULTS;
    const esphelm::RoseConfig &cfg = tile.rose ? *tile.rose : DEFAULTS;
    show_true_ = cfg.show_true_wind;
    const esphelm::units::UnitDef *deg = esphelm::units::find_unit("deg");
    apparent_.item.path = cfg.apparent_angle;
    true_dir_.item.path = cfg.true_direction;
    heading_.item.path = cfg.heading;
    for (Binding *b : {&apparent_, &true_dir_, &heading_}) {
      b->item.unit = deg;
      b->item.decimals = 0;
      b->stale_ms = env.default_stale_ms;
      b->last_value_ms = millis();
    }
    // "12°T" for headingTrue, "12°M" for headingMagnetic.
    const std::string &hp = cfg.heading;
    heading_suffix_ = hp.find("Magnetic") != std::string::npos ? "M" : hp.find("True") != std::string::npos ? "T" : "";

    // Outer ring, fixed to the bow (0 at the top). Ticks are drawn over the sectors.
    ring_ = lv_scale_create(cell);
    lv_scale_set_mode(ring_, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_angle_range(ring_, 360);
    lv_scale_set_rotation(ring_, 270);
    lv_scale_set_range(ring_, 0, 360);
    lv_scale_set_label_show(ring_, false);
    lv_scale_set_draw_ticks_on_top(ring_, true);
    lv_obj_set_style_arc_opa(ring_, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_line_color(ring_, colors_.ring, LV_PART_ITEMS);
    lv_obj_set_style_line_color(ring_, colors_.ring, LV_PART_INDICATOR);
    sections_[0] = lv_scale_add_section(ring_);
    lv_scale_set_section_range(ring_, sections_[0], 20, 60);  // starboard
    sections_[1] = lv_scale_add_section(ring_);
    lv_scale_set_section_range(ring_, sections_[1], 300, 340);  // port

    // Compass card: a dark band with the compass points along it, turned by the heading.
    card_ = lv_scale_create(cell);
    lv_scale_set_mode(card_, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_angle_range(card_, 360);
    lv_scale_set_rotation(card_, 270);
    lv_scale_set_range(card_, 0, 360);
    lv_scale_set_total_tick_count(card_, 17);
    lv_scale_set_major_tick_every(card_, 1);
    lv_scale_set_label_show(card_, true);
    lv_scale_set_text_src(card_, CARD_POINTS);
    lv_obj_set_style_length(card_, 0, LV_PART_ITEMS);
    lv_obj_set_style_length(card_, 0, LV_PART_INDICATOR);
    lv_obj_set_style_line_width(card_, 0, LV_PART_ITEMS);
    lv_obj_set_style_line_width(card_, 0, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(card_, colors_.card, LV_PART_MAIN);
    lv_scale_set_draw_ticks_on_top(card_, true);  // letters over the band
    lv_obj_set_style_text_font(card_, env.fonts.small, LV_PART_INDICATOR);
    lv_obj_set_style_text_color(card_, colors_.card_text, LV_PART_INDICATOR);
    // Letters along the ring (a quarter turn from the tick direction), as on the legacy card.
    lv_obj_set_style_transform_rotation(card_, LV_SCALE_LABEL_ROTATE_MATCH_TICKS | 900, LV_PART_INDICATOR);

    // Markers are drawn on a transparent overlay covering the rose.
    markers_ = lv_obj_create(cell);
    lv_obj_remove_style_all(markers_);
    lv_obj_remove_flag(markers_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(
        markers_, [](lv_event_t *e) { static_cast<WindRoseWidget *>(lv_event_get_user_data(e))->draw_markers_(e); },
        LV_EVENT_DRAW_MAIN, this);

    center_ = lv_obj_create(cell);
    lv_obj_remove_style_all(center_);
    lv_obj_set_flex_flow(center_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(center_, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(center_, 0, LV_PART_MAIN);
    lv_obj_set_size(center_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    heading_label_ = make_label(center_, env.fonts.small, colors_.text, "--\xC2\xB0" + heading_suffix_);
    lv_obj_set_style_pad_bottom(heading_label_, 4, LV_PART_MAIN);
    for (int i = 0; i < esphelm::RoseConfig::MAX_SLOTS; i++) {
      if (!cfg.has_slot[i])
        continue;
      const esphelm::DataItem &item = cfg.slots[i];
      Slot s;
      s.b.item = item;
      s.b.stale_ms = stale_ms(item, env);
      s.b.last_value_ms = millis();
      std::string caption = item.label;
      if (item.unit != nullptr && item.unit->label[0] != '\0')
        caption += caption.empty() ? item.unit->label : std::string(" ") + item.unit->label;
      if (i < esphelm::RoseConfig::CENTER_SLOTS) {
        s.value = make_label(center_, env.fonts.value, colors_.muted, "--");
        s.caption = make_label(center_, env.fonts.small, colors_.text, caption);
        slots_.push_back(std::move(s));
        continue;
      }
      // Corner: a value over its caption, pushed into the tile's corner.
      s.corner = i - esphelm::RoseConfig::CENTER_SLOTS;  // 0 TL, 1 TR, 2 BL, 3 BR
      s.box = lv_obj_create(cell);
      lv_obj_remove_style_all(s.box);
      lv_obj_remove_flag(s.box, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_set_size(s.box, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
      lv_obj_set_flex_flow(s.box, LV_FLEX_FLOW_COLUMN);
      const bool right = s.corner % 2 == 1;
      lv_obj_set_flex_align(s.box, LV_FLEX_ALIGN_START, right ? LV_FLEX_ALIGN_END : LV_FLEX_ALIGN_START,
                            LV_FLEX_ALIGN_START);
      s.value = make_label(s.box, env.fonts.label, colors_.muted, "--");
      s.caption = make_label(s.box, env.fonts.small, colors_.text, caption);
      corners_.push_back(std::move(s));
    }
  }

  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {
    out.push_back(apparent_.item.path);
    out.push_back(heading_.item.path);
    if (show_true_)
      out.push_back(true_dir_.item.path);
    for (const auto &s : slots_)
      out.push_back(s.b.item.path);
    for (const auto &s : corners_)
      out.push_back(s.b.item.path);
  }

  void layout_done() override {
    const int32_t d = std::min(lv_obj_get_content_width(area_), lv_obj_get_content_height(area_));
    layout_corners_(d);
    // Size tiers (esphelm_sizes.h, shared with the editor's size hint).
    full_ = d >= esphelm::sizes::WIND_ROSE_FULL;
    const bool compact = !full_ && d >= esphelm::sizes::WIND_ROSE_COMPACT;
    const int32_t ring_w = std::max<int32_t>(6, d / (full_ ? 15 : 13));  // legacy: size / 15

    lv_obj_set_size(ring_, d, d);
    lv_obj_center(ring_);
    lv_scale_set_total_tick_count(ring_, full_ ? 73 : 13);  // every 5 degrees, or every 30
    lv_scale_set_major_tick_every(ring_, full_ ? 6 : 1);
    lv_obj_set_style_length(ring_, ring_w, LV_PART_INDICATOR);
    lv_obj_set_style_length(ring_, ring_w * 3 / 4, LV_PART_ITEMS);
    lv_obj_set_style_line_width(ring_, std::max<int32_t>(2, d / 90), LV_PART_INDICATOR);
    lv_obj_set_style_line_width(ring_, std::max<int32_t>(1, d / 360), LV_PART_ITEMS);
    lv_scale_set_section_style_main(ring_, sections_[0], sector_style(0, colors_.starboard, ring_w));
    lv_scale_set_section_style_main(ring_, sections_[1], sector_style(1, colors_.port, ring_w));

    // The card sits inside the ring with a small gap; its letters are centred in the band.
    const int32_t gap = std::max<int32_t>(2, d / 60);
    const int32_t card_d = d - 2 * (ring_w + gap);
    const int32_t band = std::max<int32_t>(4, ring_w * 9 / 10);
    lv_obj_set_size(card_, card_d, card_d);
    lv_obj_center(card_);
    lv_obj_set_style_arc_width(card_, band, LV_PART_MAIN);
    lv_scale_set_text_src(card_, full_ ? CARD_POINTS : CARD_CARDINALS);
    const int32_t text_h = lv_font_get_line_height(fonts_.small);
    // Label centres sit at edge - (15 + pad_radial): put them in the middle of the band.
    lv_obj_set_style_pad_radial(card_, band / 2 - 15, LV_PART_INDICATOR);
    lv_scale_set_label_show(card_, full_ || compact);
    if (!(full_ || compact))
      lv_obj_add_flag(card_, LV_OBJ_FLAG_HIDDEN);

    lv_obj_set_size(markers_, d, d);
    lv_obj_center(markers_);
    marker_ = std::max<int32_t>(8, ring_w * 6 / 5);
    ring_r_ = d / 2;

    // The values go inside the card band; the font steps down until every slot fits.
    const int32_t inner = card_d / 2 - band;
    // The stack is narrow, so it can use most of the disc's height (as the legacy page does).
    const int32_t room_h = inner * 19 / 10;
    const int32_t room_w = inner * 3 / 2;
    const int32_t small_h = text_h;
    const int32_t head_h = full_ ? small_h + 4 : 0;
    const lv_font_t *fonts[] = {fonts_.value, fonts_.label, fonts_.small};
    const lv_font_t *font = fonts_.small;
    size_t fit = 0;
    // Values are digits only, so their lines are tightened by a quarter (negative margins).
    const auto tight = [](int32_t fh) { return fh * 3 / 4; };
    for (const lv_font_t *f : fonts) {
      const int32_t fh = lv_font_get_line_height(f);
      const size_t n = static_cast<size_t>(std::max<int32_t>(0, room_h - head_h) / (tight(fh) + small_h));
      // "13.6" is about 2.4 line heights wide in these fonts.
      if (fh * 12 / 5 > room_w)
        continue;
      font = f;
      fit = n;
      if (n >= slots_.size())
        break;
    }
    if (!(full_ || compact))
      fit = 0;
    if (full_)
      lv_obj_remove_flag(heading_label_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(heading_label_, LV_OBJ_FLAG_HIDDEN);
    const int32_t fh = lv_font_get_line_height(font);
    for (size_t i = 0; i < slots_.size(); i++) {
      lv_obj_set_style_text_font(slots_[i].value, font, LV_PART_MAIN);
      lv_obj_set_style_margin_top(slots_[i].value, -(fh - tight(fh)) / 2, LV_PART_MAIN);
      lv_obj_set_style_margin_bottom(slots_[i].value, -(fh - tight(fh)) / 2, LV_PART_MAIN);
      for (lv_obj_t *o : {slots_[i].value, slots_[i].caption}) {
        if (i < fit)
          lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
        else
          lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
      }
    }
    lv_obj_center(center_);
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    for (Binding *b : {&apparent_, &true_dir_, &heading_}) {
      if (path == b->item.path)
        b->set(v, now);
    }
    for (auto *list : {&slots_, &corners_}) {
      for (auto &s : *list) {
        if (path == s.b.item.path)
          s.b.set(v, now);
      }
    }
  }

  void tick(uint32_t now) override {
    bool stale;
    bool markers = false;
    if (apparent_.due(now, stale)) {
      markers = true;
      apparent_stale_ = stale;
    }
    if (true_dir_.due(now, stale)) {
      markers = true;
      true_stale_ = stale;
    }
    if (heading_.due(now, stale)) {
      markers = true;
      heading_stale_ = stale;
      const bool known = !stale && heading_.has_number;
      set_text(heading_label_, heading_shown_, (known ? heading_.text : "--") + "\xC2\xB0" + heading_suffix_);
      // The card turns so that the boat's heading is at the top.
      if (known) {
        const int32_t h = static_cast<int32_t>(std::lround(heading_.number)) % 360;
        lv_scale_set_rotation(card_, (270 - h + 360) % 360);
      }
    }
    if (markers)
      lv_obj_invalidate(markers_);
    for (auto *list : {&slots_, &corners_}) {
      for (auto &s : *list) {
        if (!s.b.due(now, stale))
          continue;
        set_text(s.value, s.shown, stale ? "--" : s.b.text);
        lv_obj_set_style_text_color(s.value, stale ? colors_.muted : colors_.text, LV_PART_MAIN);
      }
    }
  }

 protected:
  struct Slot {
    Binding b;
    lv_obj_t *value{nullptr};
    lv_obj_t *caption{nullptr};
    std::string shown{"--"};
    int corner{-1};          // corner slots: 0 top left, 1 top right, 2 bottom left, 3 bottom right
    lv_obj_t *box{nullptr};  // corner slots: the value and caption container
  };

  /// Corner values sit outside the ring, in the tile's corners. Each shows only in the full tier
  /// and when its box (value in the label or small font, over its caption) clears the ring.
  void layout_corners_(int32_t d) {
    if (corners_.empty())
      return;
    const int32_t w = lv_obj_get_content_width(area_), h = lv_obj_get_content_height(area_);
    const double r = d / 2.0 + 2;
    const bool full = d >= esphelm::sizes::WIND_ROSE_FULL;
    const int32_t small_h = lv_font_get_line_height(fonts_.small);
    for (auto &s : corners_) {
      lv_obj_update_layout(s.caption);
      const int32_t caption_w = lv_obj_get_width(s.caption);
      bool shown = false;
      for (const lv_font_t *f : {fonts_.label, fonts_.small}) {
        const int32_t fh = lv_font_get_line_height(f);
        const int32_t bw = std::max<int32_t>(fh * 12 / 5, caption_w);  // "12.5" or the caption
        const int32_t bh = fh + small_h;
        // The box's inner corner, relative to the rose's centre, must be outside the ring.
        const double x = w / 2.0 - bw, y = h / 2.0 - bh;
        if (full && x >= 0 && y >= 0 && std::hypot(x, y) >= r) {
          lv_obj_set_style_text_font(s.value, f, LV_PART_MAIN);
          shown = true;
          break;
        }
      }
      if (!shown) {
        lv_obj_add_flag(s.box, LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      lv_obj_remove_flag(s.box, LV_OBJ_FLAG_HIDDEN);
      static const lv_align_t ALIGN[] = {LV_ALIGN_TOP_LEFT, LV_ALIGN_TOP_RIGHT, LV_ALIGN_BOTTOM_LEFT,
                                         LV_ALIGN_BOTTOM_RIGHT};
      lv_obj_align(s.box, ALIGN[s.corner], 0, 0);
      const lv_text_align_t ta = s.corner % 2 == 1 ? LV_TEXT_ALIGN_RIGHT : LV_TEXT_ALIGN_LEFT;
      lv_obj_set_style_text_align(s.value, ta, LV_PART_MAIN);
      lv_obj_set_style_text_align(s.caption, ta, LV_PART_MAIN);
    }
  }

  /// A triangle on the ring pointing at the centre, at `deg` clockwise from the bow, with a letter.
  void draw_marker_(lv_layer_t *layer, const lv_area_t &box, double deg, lv_color_t color, const char *letter) {
    const double a = deg * M_PI / 180.0;
    const double ux = std::sin(a), uy = -std::cos(a);  // outwards
    const double px = -uy, py = ux;                    // along the ring
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const double outer = ring_r_ - 1, tip = outer - marker_ * 1.3, half = marker_ * 0.62;
    lv_draw_triangle_dsc_t tri;
    lv_draw_triangle_dsc_init(&tri);
    tri.color = color;
    tri.opa = LV_OPA_COVER;
    tri.p[0] = {static_cast<lv_value_precise_t>(cx + ux * outer + px * half),
                static_cast<lv_value_precise_t>(cy + uy * outer + py * half)};
    tri.p[1] = {static_cast<lv_value_precise_t>(cx + ux * outer - px * half),
                static_cast<lv_value_precise_t>(cy + uy * outer - py * half)};
    tri.p[2] = {static_cast<lv_value_precise_t>(cx + ux * tip), static_cast<lv_value_precise_t>(cy + uy * tip)};
    lv_draw_triangle(layer, &tri);
    if (!full_)
      return;
    // The letter sits in the wide part of the triangle.
    const double lr = outer - marker_ * 0.5;
    const int32_t lx = static_cast<int32_t>(cx + ux * lr), ly = static_cast<int32_t>(cy + uy * lr);
    const int32_t fh = lv_font_get_line_height(fonts_.small);
    lv_draw_label_dsc_t label;
    lv_draw_label_dsc_init(&label);
    label.text = letter;
    label.font = fonts_.small;
    label.color = colors_.background;
    label.align = LV_TEXT_ALIGN_CENTER;
    lv_area_t area{lx - fh, ly - fh / 2, lx + fh, ly + fh / 2};
    lv_draw_label(layer, &label, &area);
  }

  void draw_markers_(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(markers_, &box);
    if (show_true_ && true_dir_.has_number && heading_.has_number) {
      // True wind relative to the bow: direction minus heading.
      const double rel = std::fmod(true_dir_.number - heading_.number + 720.0, 360.0);
      draw_marker_(layer, box, rel, true_stale_ || heading_stale_ ? colors_.muted : colors_.true_wind, "T");
    }
    if (apparent_.has_number)
      draw_marker_(layer, box, apparent_.number, apparent_stale_ ? colors_.muted : colors_.apparent, "A");
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *area_;
  bool show_true_{true};
  Binding apparent_, true_dir_, heading_;
  bool apparent_stale_{true}, true_stale_{true}, heading_stale_{true};
  std::string heading_suffix_;
  lv_obj_t *ring_, *card_, *markers_, *center_, *heading_label_;
  lv_scale_section_t *sections_[2]{};
  std::string heading_shown_;
  bool full_{false};
  int32_t marker_{12}, ring_r_{0};
  std::vector<Slot> slots_;    // the centre stack
  std::vector<Slot> corners_;  // corner values
};
// ---- position ----

/**
 * GPS position: the caption, then latitude over longitude in the tile's format
 * (esphelm_position.h, the same text as the editor preview). The largest font whose worst-case
 * text fits is chosen in layout_done(), which can run again (the alarm banner resizes pages).
 * Memory: three labels, like a value tile.
 */
class PositionWidget : public Widget {
 public:
  PositionWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), format_(tile.position_format),
        decimals_(tile.data.decimals) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    lat_ = make_label(cell, env.fonts.value, env.colors.muted, "--");
    lon_ = make_label(cell, env.fonts.value, env.colors.muted, "");
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t caption_h = b_.item.label.empty() ? 0 : lv_font_get_line_height(fonts_.small);
    const int32_t h = lv_obj_get_content_height(cell_) - caption_h;
    // The widest text this format can produce (8 is the widest digit in most fonts).
    std::string worst_lat, worst_lon;
    esphelm::position::format(-88.8888888, -178.8888888, format_, decimals_, worst_lat, worst_lon);
    const lv_font_t *font = fit_font(fonts_, worst_lon.c_str(), w, h, 2);
    const int32_t line = lv_font_get_line_height(font);
    const int32_t top = caption_h + std::max<int32_t>(0, (h - 2 * line) / 2);
    for (lv_obj_t *l : {lat_, lon_})
      lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
    lv_obj_align(lat_, LV_ALIGN_TOP_MID, 0, top);
    lv_obj_align(lon_, LV_ALIGN_TOP_MID, 0, top + line);
    if (!b_.stale_shown)
      b_.dirty = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path != b_.item.path)
      return;
    // Untrusted: only an object with two numbers in range is a position; anything else is "--".
    ArduinoJson::JsonVariantConst lat = v["latitude"], lon = v["longitude"];
    valid_ = v.is<ArduinoJson::JsonObjectConst>() && lat.is<double>() && !lat.is<bool>() && lon.is<double>() &&
             !lon.is<bool>() &&
             esphelm::position::format(lat.as<double>(), lon.as<double>(), format_, decimals_, lat_text_, lon_text_);
    b_.last_value_ms = now;
    b_.dirty = true;
  }

  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    const bool live = !stale && valid_;
    set_text(lat_, shown_lat_, live ? lat_text_ : "--");
    set_text(lon_, shown_lon_, live ? lon_text_ : "");
    for (lv_obj_t *l : {lat_, lon_})
      lv_obj_set_style_text_color(l, live ? colors_.text : colors_.muted, LV_PART_MAIN);
    // The texts changed width: keep them centred.
    lv_obj_align(lat_, LV_ALIGN_TOP_MID, 0, lv_obj_get_y_aligned(lat_));
    lv_obj_align(lon_, LV_ALIGN_TOP_MID, 0, lv_obj_get_y_aligned(lon_));
  }

 protected:
  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  esphelm::position::Format format_;
  int decimals_;
  Binding b_;
  lv_obj_t *caption_;
  lv_obj_t *lat_;
  lv_obj_t *lon_;
  bool valid_{false};
  std::string lat_text_, lon_text_;
  std::string shown_lat_{"--"}, shown_lon_;
};

// ---- factories ----

std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  style_cell(cell, env.colors);
  switch (tile.type) {
    case esphelm::TileType::WIND_ROSE:
      // The rose sits on the page background, as on the legacy wind page.
      lv_obj_set_style_bg_color(cell, env.colors.background, LV_PART_MAIN);
      return std::make_unique<WindRoseWidget>(cell, tile, env);
    case esphelm::TileType::AUTOPILOT:
      return std::make_unique<AutopilotWidget>(cell, tile, env);
    case esphelm::TileType::GAUGE:
      return std::make_unique<GaugeWidget>(cell, tile, env);
    case esphelm::TileType::BAR:
      return std::make_unique<BarWidget>(cell, tile, env);
    case esphelm::TileType::SWITCH:
      return std::make_unique<SwitchWidget>(cell, tile, env);
    case esphelm::TileType::POSITION:
      return std::make_unique<PositionWidget>(cell, tile, env);
    case esphelm::TileType::VALUE:
    default:
      return std::make_unique<ValueWidget>(cell, tile, env);
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
