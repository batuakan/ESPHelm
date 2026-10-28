// The bar tile. Shared helpers: widget_common.h.
#include "widget_common.h"

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {

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

std::unique_ptr<Widget> make_bar_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<BarWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
