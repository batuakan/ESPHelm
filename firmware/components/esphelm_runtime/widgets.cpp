#include "widgets.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

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
                  {lv_color_hex(0x6A2020), lv_color_hex(0xB0401A), lv_color_hex(0xFF3B30), lv_color_hex(0xFF6060)}};
  }
  return Colors{lv_color_hex(0x10161C), lv_color_hex(0x1E2A36), lv_color_hex(0xF2F5F8), lv_color_hex(0x7A8794),
                lv_color_hex(0x4A9EFF), lv_color_hex(0xF2C14E),
                {lv_color_hex(0x3DBB74), lv_color_hex(0xF0B04A), lv_color_hex(0xE5484D), lv_color_hex(0xD34DD9)}};
}

// ---- Value formatting (same rules as packages/editor/src/format.ts) ----

static std::string printable(const char *s) {
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

class ValueWidget : public Widget {
 public:
  ValueWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) : id_(tile.id), colors_(env.colors) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    lv_obj_t *caption = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_obj_align(caption, LV_ALIGN_TOP_LEFT, 0, 0);
    value_ = make_label(cell, env.fonts.value, env.colors.muted, "--");
    lv_obj_align(value_, LV_ALIGN_CENTER, 0, 0);
    if (tile.data.unit != nullptr) {
      lv_obj_t *unit = make_label(cell, env.fonts.small, env.colors.muted, tile.data.unit->label);
      lv_obj_align(unit, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    }
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == b_.item.path)
      b_.set(v, now);
  }
  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    set_text(value_, shown_, stale ? "--" : b_.text);
    lv_obj_set_style_text_color(value_, stale ? colors_.muted : colors_.text, LV_PART_MAIN);
  }

 protected:
  std::string id_;
  Colors colors_;
  Binding b_;
  lv_obj_t *value_;
  std::string shown_{"--"};
};

// ---- gauge ----

class GaugeWidget : public Widget {
 public:
  GaugeWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), cell_(cell), min_(tile.min), max_(tile.max) {
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
    label_font_ = env.fonts.label;
    small_font_ = env.fonts.small;
    // Value and unit sit in the open bottom of the 270 degree arc, clear of the needle hub.
    value_ = make_label(cell, env.fonts.label, env.colors.muted, "--");
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      suffix_ = std::string(" ") + tile.data.unit->label;
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }
  void layout_done() override {
    // The caption takes the top line; the scale gets the largest square below it.
    const int32_t h = lv_obj_get_content_height(cell_) - lv_obj_get_height(caption_);
    const int32_t d = std::max<int32_t>(16, std::min(lv_obj_get_content_width(cell_), h));
    lv_obj_set_size(scale_, d, d);
    lv_obj_align(scale_, LV_ALIGN_BOTTOM_MID, 0, 0);
    // Small gauges: the label font would run into the ends of the arc; tiny ones drop the unit
    // (the caption names the quantity).
    lv_obj_set_style_text_font(value_, d >= 240 ? label_font_ : small_font_, LV_PART_MAIN);
    if (d < 160)
      suffix_.clear();
    set_text(value_, shown_, "--" + suffix_);
    lv_obj_update_layout(value_);
    lv_obj_align_to(value_, scale_, LV_ALIGN_BOTTOM_MID, 0, 0);
    if (d < 160) {
      // Small gauge: tick labels would collide with the caption and value; keep the ticks.
      lv_scale_set_label_show(scale_, false);
      lv_scale_set_total_tick_count(scale_, 11);
    }
    lv_scale_set_line_needle_value(scale_, needle_, -(d / 7), 0);
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
  lv_obj_t *cell_;
  double min_, max_;
  Binding b_;
  lv_obj_t *scale_;
  lv_obj_t *needle_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  const lv_font_t *label_font_{nullptr};
  const lv_font_t *small_font_{nullptr};
  std::string suffix_;
  std::string shown_{"--"};
  std::string tick_text_[5];
  const char *tick_ptrs_[6];
};

// ---- bar ----

class BarWidget : public Widget {
 public:
  BarWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), min_(tile.min), max_(tile.max), zones_(tile.zones) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    const bool vertical = tile.orientation == esphelm::Orientation::VERTICAL;

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
  double min_, max_;
  std::vector<esphelm::Zone> zones_;
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
    lv_obj_t *caption = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_obj_align(caption, LV_ALIGN_TOP_LEFT, 0, 0);
    sw_ = lv_switch_create(cell);
    lv_obj_set_style_bg_color(sw_, env.colors.background, LV_PART_MAIN);
    lv_obj_set_style_bg_color(sw_, env.colors.accent, static_cast<lv_style_selector_t>(LV_PART_INDICATOR) | LV_STATE_CHECKED);
    lv_obj_add_event_cb(
        sw_, [](lv_event_t *e) { static_cast<SwitchWidget *>(lv_event_get_user_data(e))->toggled_(); },
        LV_EVENT_VALUE_CHANGED, this);
    state_ = make_label(cell, env.fonts.small, env.colors.muted, "--");
    lv_obj_align(state_, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(path_); }
  void layout_done() override {
    // Keep the track twice as wide as high, whatever the cell's shape.
    const int32_t w = lv_obj_get_content_width(cell_) * 7 / 10;
    const int32_t h = std::min(w / 2, lv_obj_get_content_height(cell_) * 4 / 10);
    lv_obj_set_size(sw_, h * 2, h);
    lv_obj_align(sw_, LV_ALIGN_CENTER, 0, 6);
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
  void tap() override {
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
  std::function<void(const std::string &, bool)> put_;
  lv_obj_t *cell_;
  lv_obj_t *sw_;
  lv_obj_t *state_;
  bool known_{false}, on_{false}, pending_{false}, pending_value_{false}, failed_{false}, dirty_{true};
  uint32_t pending_since_{0};
};

// ---- wind rose ----

static const char *ROSE_LABELS[] = {"0",   "30",  "60",  "90", "120", "150", "180",
                                          "150", "120", "90",  "60", "30",  nullptr};

class WindRoseWidget : public Widget {
 public:
  WindRoseWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), area_(cell) {
    static const esphelm::RoseConfig DEFAULTS;
    const esphelm::RoseConfig &cfg = tile.rose ? *tile.rose : DEFAULTS;
    show_true_ = cfg.show_true_wind;
    deg_ = esphelm::units::find_unit("deg");
    apparent_.item.path = cfg.apparent_angle;
    true_dir_.item.path = cfg.true_direction;
    heading_.item.path = cfg.heading;
    for (Binding *b : {&apparent_, &true_dir_, &heading_}) {
      b->item.unit = deg_;
      b->item.decimals = 0;
      b->stale_ms = env.default_stale_ms;
      b->last_value_ms = millis();
    }

    rose_ = lv_scale_create(cell);
    lv_scale_set_mode(rose_, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_angle_range(rose_, 360);
    lv_scale_set_rotation(rose_, 270);  // 0 (the bow) at the top
    lv_scale_set_range(rose_, 0, 360);
    lv_scale_set_total_tick_count(rose_, 37);
    lv_scale_set_major_tick_every(rose_, 3);
    lv_scale_set_label_show(rose_, true);
    lv_scale_set_text_src(rose_, ROSE_LABELS);
    lv_obj_set_style_text_font(rose_, env.fonts.small, LV_PART_INDICATOR);
    lv_obj_set_style_pad_radial(rose_, 10, LV_PART_INDICATOR);
    lv_obj_set_style_text_color(rose_, env.colors.muted, LV_PART_INDICATOR);
    lv_obj_set_style_line_color(rose_, env.colors.muted, LV_PART_ITEMS);
    lv_obj_set_style_line_color(rose_, env.colors.muted, LV_PART_INDICATOR);
    lv_obj_set_style_length(rose_, 8, LV_PART_ITEMS);
    lv_obj_set_style_length(rose_, 16, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(rose_, env.colors.muted, LV_PART_MAIN);
    lv_obj_set_style_arc_width(rose_, 2, LV_PART_MAIN);
    // Close-hauled sectors: starboard green (normal), port red (alarm), like the legacy page.
    lv_scale_section_t *stbd = lv_scale_add_section(rose_);
    lv_scale_set_section_range(rose_, stbd, 20, 60);
    lv_scale_section_t *port = lv_scale_add_section(rose_);
    lv_scale_set_section_range(rose_, port, 300, 340);
    sections_[0] = stbd;
    sections_[1] = port;

    true_needle_ = lv_line_create(rose_);
    lv_obj_set_style_line_width(true_needle_, 6, LV_PART_MAIN);
    lv_obj_set_style_line_rounded(true_needle_, true, LV_PART_MAIN);
    lv_obj_add_flag(true_needle_, LV_OBJ_FLAG_HIDDEN);
    apparent_needle_ = lv_line_create(rose_);
    lv_obj_set_style_line_width(apparent_needle_, 8, LV_PART_MAIN);
    lv_obj_set_style_line_rounded(apparent_needle_, true, LV_PART_MAIN);
    lv_obj_add_flag(apparent_needle_, LV_OBJ_FLAG_HIDDEN);

    heading_label_ = make_label(cell, env.fonts.small, env.colors.muted, "HDG --");
    fonts_ = env.fonts;

    center_ = lv_obj_create(cell);
    lv_obj_remove_style_all(center_);
    lv_obj_set_flex_flow(center_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(center_, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(center_, 4, LV_PART_MAIN);
    lv_obj_set_size(center_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
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
      s.value = make_label(center_, env.fonts.label, env.colors.muted, "--");
      s.caption = make_label(center_, env.fonts.small, env.colors.muted, caption);
      slots_.push_back(std::move(s));
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
  }
  void layout_done() override {
    const int32_t d = std::min(lv_obj_get_content_width(area_), lv_obj_get_content_height(area_));
    lv_obj_set_size(rose_, d, d);
    lv_obj_center(rose_);
    // Size tiers (esphelm_sizes.h, shared with the editor's size hint).
    const bool full = d >= esphelm::sizes::WIND_ROSE_FULL;
    const bool compact = !full && d >= esphelm::sizes::WIND_ROSE_COMPACT;
    lv_scale_set_label_show(rose_, full);
    if (!full) {
      lv_scale_set_total_tick_count(rose_, 13);  // every 30 degrees
      lv_scale_set_major_tick_every(rose_, 3);
      lv_obj_set_style_length(rose_, 5, LV_PART_ITEMS);
      lv_obj_set_style_length(rose_, 10, LV_PART_INDICATOR);
    }
    const int32_t arc = full ? 14 : 8;
    lv_scale_set_section_style_main(rose_, sections_[0], zone_style(esphelm::ZoneState::NORMAL, colors_, arc));
    lv_scale_set_section_style_main(rose_, sections_[1], zone_style(esphelm::ZoneState::ALARM, colors_, arc));
    lv_obj_set_style_line_width(apparent_needle_, std::max<int32_t>(3, d / 58), LV_PART_MAIN);
    lv_obj_set_style_line_width(true_needle_, std::max<int32_t>(2, d / 77), LV_PART_MAIN);
    if (full) {
      lv_obj_remove_flag(heading_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_align(heading_label_, LV_ALIGN_CENTER, 0, -d / 4);
    } else {
      lv_obj_add_flag(heading_label_, LV_OBJ_FLAG_HIDDEN);
    }
    // Slots go inside the pointers' inner end (0.64 r). Values use the label font if every slot
    // fits that way, else the small font; then show as many as fit, in order.
    const int32_t room = full ? d * 55 / 100 : d * 62 / 100;
    const int32_t small_h = lv_font_get_line_height(fonts_.small);
    const int32_t big_slot = lv_font_get_line_height(fonts_.label) + small_h + 4;
    const int32_t small_slot = 2 * small_h + 4;
    const bool big = static_cast<size_t>(room / big_slot) >= slots_.size();
    const size_t fit = full || compact ? static_cast<size_t>(room / (big ? big_slot : small_slot)) : 0;
    for (auto &slot : slots_)
      lv_obj_set_style_text_font(slot.value, big ? fonts_.label : fonts_.small, LV_PART_MAIN);
    for (size_t i = 0; i < slots_.size(); i++) {
      for (lv_obj_t *o : {slots_[i].value, slots_[i].caption}) {
        if (i < fit)
          lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
        else
          lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
      }
    }
    lv_obj_align(center_, LV_ALIGN_CENTER, 0, full ? d / 16 : 0);
    lv_obj_update_layout(rose_);
    cx_ = lv_obj_get_content_width(rose_) / 2.0;
    cy_ = lv_obj_get_content_height(rose_) / 2.0;
    radius_ = std::min(cx_, cy_);
  }
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    for (Binding *b : {&apparent_, &true_dir_, &heading_}) {
      if (path == b->item.path)
        b->set(v, now);
    }
    for (auto &s : slots_) {
      if (path == s.b.item.path)
        s.b.set(v, now);
    }
  }
  void tick(uint32_t now) override {
    bool stale;
    bool needles = false;
    if (apparent_.due(now, stale)) {
      needles = true;
      apparent_stale_ = stale;
    }
    if (true_dir_.due(now, stale)) {
      needles = true;
      true_stale_ = stale;
    }
    if (heading_.due(now, stale)) {
      needles = true;
      heading_stale_ = stale;
      set_text(heading_label_, heading_shown_,
               stale || !heading_.has_number ? "HDG --" : "HDG " + heading_.text + "\xC2\xB0");
    }
    if (needles)
      this->draw_needles_();
    for (auto &s : slots_) {
      if (!s.b.due(now, stale))
        continue;
      set_text(s.value, s.shown, stale ? "--" : s.b.text);
      lv_obj_set_style_text_color(s.value, stale ? colors_.muted : colors_.text, LV_PART_MAIN);
    }
  }

 protected:
  struct Slot {
    Binding b;
    lv_obj_t *value{nullptr};
    lv_obj_t *caption{nullptr};
    std::string shown{"--"};
  };

  /// Point a needle at `deg` (clockwise from the bow) as a segment of the outer ring, from
  /// `inner` to `outer` times the radius, so the centre slots stay readable.
  void point_(lv_obj_t *needle, lv_point_precise_t *pts, double deg, double inner, double outer) {
    const double a = deg * M_PI / 180.0;
    const double sx = std::sin(a), cy = -std::cos(a);
    pts[0] = {static_cast<lv_value_precise_t>(cx_ + radius_ * inner * sx),
              static_cast<lv_value_precise_t>(cy_ + radius_ * inner * cy)};
    pts[1] = {static_cast<lv_value_precise_t>(cx_ + radius_ * outer * sx),
              static_cast<lv_value_precise_t>(cy_ + radius_ * outer * cy)};
    lv_line_set_points(needle, pts, 2);
  }

  void draw_needles_() {
    if (apparent_.has_number) {
      lv_obj_remove_flag(apparent_needle_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_set_style_line_color(apparent_needle_, apparent_stale_ ? colors_.muted : colors_.accent, LV_PART_MAIN);
      point_(apparent_needle_, apparent_pts_, apparent_.number, 0.64, 0.97);
    }
    if (show_true_ && true_dir_.has_number && heading_.has_number) {
      // True wind relative to the bow: direction minus heading, 0..360.
      double rel = std::fmod(true_dir_.number - heading_.number + 720.0, 360.0);
      lv_obj_remove_flag(true_needle_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_set_style_line_color(true_needle_, true_stale_ || heading_stale_ ? colors_.muted : colors_.second,
                                  LV_PART_MAIN);
      point_(true_needle_, true_pts_, rel, 0.64, 0.86);
    }
  }

  std::string id_;
  Colors colors_;
  lv_obj_t *area_;
  bool show_true_;
  const esphelm::units::UnitDef *deg_;
  Binding apparent_, true_dir_, heading_;
  bool apparent_stale_{true}, true_stale_{true}, heading_stale_{true};
  lv_obj_t *rose_;
  lv_obj_t *apparent_needle_;
  lv_obj_t *true_needle_;
  lv_obj_t *heading_label_;
  std::string heading_shown_{"HDG --"};
  lv_obj_t *center_;
  lv_scale_section_t *sections_[2]{};
  Fonts fonts_;
  // Rose centre and radius in its content box; needle end points (LVGL keeps the pointers).
  double cx_{0}, cy_{0}, radius_{0};
  lv_point_precise_t apparent_pts_[2]{};
  lv_point_precise_t true_pts_[2]{};
  std::vector<Slot> slots_;
};

// ---- factories ----

std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  style_cell(cell, env.colors);
  switch (tile.type) {
    case esphelm::TileType::WIND_ROSE:
      return std::make_unique<WindRoseWidget>(cell, tile, env);
    case esphelm::TileType::GAUGE:
      return std::make_unique<GaugeWidget>(cell, tile, env);
    case esphelm::TileType::BAR:
      return std::make_unique<BarWidget>(cell, tile, env);
    case esphelm::TileType::SWITCH:
      return std::make_unique<SwitchWidget>(cell, tile, env);
    case esphelm::TileType::VALUE:
    default:
      return std::make_unique<ValueWidget>(cell, tile, env);
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
