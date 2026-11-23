// The mono battery tile (ADR-0046). Shared helpers: mono_common.h; its values: battery_values.h.
#include "mono_common.h"

#include <algorithm>

#include "esphome/components/esphelm_runtime/battery_values.h"
#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

/**
 * The colour battery tile's layout in the ink: an outline filled solid to the state of charge, the
 * % beside it, the same rows. The state of charge's zone shows as the tile's frame, as on a value
 * tile: warn a heavy frame, alarm inverted. Stale: "--" and an empty outline. No history popup on
 * mono. Memory: 12 LVGL objects.
 */
class BatteryWidget : public Widget {
 public:
  BatteryWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), frame_(cell, env.colors) {
    v_.init(tile, env, millis());
    caption_ = label(cell, env.fonts.small, v_.label());
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    voltage_ = label(cell, env.fonts.small, "");
    body_ = lv_obj_create(cell);
    lv_obj_remove_style_all(body_);
    lv_obj_remove_flag(body_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_border_opa(body_, LV_OPA_COVER, LV_PART_MAIN);
    fill_ = lv_obj_create(body_);
    lv_obj_remove_style_all(fill_);
    lv_obj_remove_flag(fill_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(fill_, LV_OPA_COVER, LV_PART_MAIN);
    nub_ = lv_obj_create(cell);
    lv_obj_remove_style_all(nub_);
    lv_obj_remove_flag(nub_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(nub_, LV_OPA_COVER, LV_PART_MAIN);
    percent_ = label(cell, env.fonts.value, "--");
    current_ = label(cell, env.fonts.small, "");
    power_ = label(cell, env.fonts.small, "");
    status_ = label(cell, env.fonts.small, "");
    lv_label_set_long_mode(status_, LV_LABEL_LONG_MODE_DOTS);
    solar_caption_ = label(cell, env.fonts.small, v_.solar_label());
    solar_ = label(cell, env.fonts.small, "");
    recolour_();
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { v_.paths(out); }

  void layout_done() override {
    // Inside the frame: the cell's padding already keeps the content clear of it.
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const lv_font_t *f;
    rows_ = battery_rows(fonts_, w, h, v_.caption_row(), v_.power_row(), v_.status_row(), v_.solar_row(), f);
    for (lv_obj_t *l : {caption_, voltage_, current_, power_, status_, solar_caption_, solar_})
      lv_obj_set_style_text_font(l, f, LV_PART_MAIN);
    show_(caption_, rows_.caption && !v_.label().empty());
    show_(voltage_, rows_.caption && v_.has(esphelm::BatteryConfig::VOLTAGE));
    lv_obj_set_width(caption_, w / 2);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_align(voltage_, LV_ALIGN_TOP_RIGHT, 0, 0);
    const lv_font_t *pf = fit_font(fonts_, "100%", w * 40 / 100, rows_.height);
    lv_obj_set_style_text_font(percent_, pf, LV_PART_MAIN);
    box_ = battery_box(w, rows_, text_width("100%", pf));
    lv_obj_set_style_border_width(body_, box_.border, LV_PART_MAIN);
    lv_obj_set_style_radius(body_, box_.border * 2, LV_PART_MAIN);
    lv_obj_set_size(body_, box_.w, box_.h);
    lv_obj_set_pos(body_, box_.x, box_.y);
    lv_obj_set_size(nub_, box_.nub_w, box_.nub_h);
    lv_obj_align_to(nub_, body_, LV_ALIGN_OUT_RIGHT_MID, 0, 0);
    lv_obj_set_height(fill_, std::max<int32_t>(0, box_.h - 2 * box_.inset));
    lv_obj_set_pos(fill_, box_.inset - box_.border, box_.inset - box_.border);
    lv_obj_align_to(percent_, body_, LV_ALIGN_OUT_RIGHT_MID, box_.nub_w + box_.gap, 0);
    int32_t ry = rows_.top + rows_.height;
    show_(current_, rows_.power && v_.has(esphelm::BatteryConfig::CURRENT));
    show_(power_, rows_.power && v_.shows_power());
    lv_obj_align(current_, LV_ALIGN_TOP_LEFT, 0, ry);
    lv_obj_align(power_, LV_ALIGN_TOP_RIGHT, 0, ry);
    if (rows_.power)
      ry += rows_.line;
    show_(status_, rows_.status);
    lv_obj_set_width(status_, w);
    lv_obj_align(status_, LV_ALIGN_TOP_LEFT, 0, ry);
    if (rows_.status)
      ry += rows_.line;
    show_(solar_caption_, rows_.solar);
    show_(solar_, rows_.solar);
    lv_obj_align(solar_caption_, LV_ALIGN_TOP_LEFT, 0, ry);
    lv_obj_align(solar_, LV_ALIGN_TOP_RIGHT, 0, ry);
    draw_();
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    v_.on_value(path, v, now);
  }
  void tick(uint32_t now) override {
    if (v_.due(now))
      draw_();
  }

 protected:
  static void show_(lv_obj_t *o, bool on) {
    if (on)
      lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
  }
  /// The outline, nub and fill in the tile's ink (it changes when the tile is inverted).
  void recolour_() {
    const lv_color_t ink = frame_.ink();
    lv_obj_set_style_border_color(body_, ink, LV_PART_MAIN);
    lv_obj_set_style_bg_color(nub_, ink, LV_PART_MAIN);
    lv_obj_set_style_bg_color(fill_, ink, LV_PART_MAIN);
  }
  void draw_() {
    set_text(percent_, shown_[0], v_.percent);
    set_text(voltage_, shown_[1], v_.voltage);
    set_text(current_, shown_[2], v_.current);
    set_text(power_, shown_[3], v_.power);
    set_text(status_, shown_[4], v_.status);
    set_text(solar_, shown_[5], v_.solar);
    esphelm::ZoneState state = esphelm::ZoneState::NORMAL;
    const bool zoned = v_.zone(state);
    if (frame_.show(zoned, state))
      recolour_();
    lv_obj_set_width(fill_, static_cast<int32_t>(box_.inner_w * v_.fraction + 0.5));
  }

  std::string id_;
  Fonts fonts_;
  lv_obj_t *cell_;
  Frame frame_;
  BatteryValues v_;
  esphelm::battery::Rows rows_;
  BatteryBox box_;
  lv_obj_t *caption_, *voltage_, *body_, *fill_, *nub_, *percent_, *current_, *power_, *status_, *solar_caption_,
      *solar_;
  std::string shown_[6];
};

std::unique_ptr<Widget> make_battery(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<BatteryWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
