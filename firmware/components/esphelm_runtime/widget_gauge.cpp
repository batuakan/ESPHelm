// The gauge tile. Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {

class GaugeWidget : public Widget {
 public:
  GaugeWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), min_(tile.min), max_(tile.max),
        center_zero_(tile.center_zero), sides_(tile.sides), sample_(value_sample(tile.data.decimals)) {
    // Centre zero (ADR-0023): the scale is symmetric, -M..M, so zero sits at 12 o'clock; min and
    // max still clamp the value.
    lo_ = min_;
    hi_ = max_;
    if (center_zero_) {
      const double m = esphelm::center_zero::span(min_, max_);
      lo_ = -m;
      hi_ = m;
    }
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
    const double span = hi_ - lo_;
    for (int i = 0; i < 5; i++) {
      const double v = lo_ + span * i / 4.0;
      if (center_zero_) {
        tick_text_[i] = esphelm::center_zero::tick(v, hi_, sides_);
        continue;
      }
      char buf[16];
      label_number(buf, sizeof(buf), v, span);
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
      lv_scale_set_section_range(scale_, section, to_steps(z.from, lo_, hi_), to_steps(z.to, lo_, hi_));
      lv_scale_set_section_style_main(scale_, section, zone_style(z.state, env.colors, 8));
    }
    if (center_zero_) {
      // The fill from zero to the value, on the ring (LVGL draws a symmetrical arc from its middle).
      fill_ = lv_arc_create(scale_);
      lv_obj_remove_flag(fill_, LV_OBJ_FLAG_CLICKABLE);
      lv_arc_set_bg_angles(fill_, 135, 45);
      lv_arc_set_range(fill_, 0, SCALE_STEPS);
      lv_arc_set_mode(fill_, LV_ARC_MODE_SYMMETRICAL);
      lv_arc_set_value(fill_, SCALE_STEPS / 2);
      lv_obj_set_style_arc_opa(fill_, LV_OPA_TRANSP, LV_PART_MAIN);
      lv_obj_set_style_arc_rounded(fill_, false, LV_PART_INDICATOR);
      lv_obj_set_style_bg_opa(fill_, LV_OPA_TRANSP, LV_PART_KNOB);
      lv_obj_set_style_pad_all(fill_, 0, LV_PART_KNOB);
      lv_obj_set_style_pad_all(fill_, 0, LV_PART_MAIN);
      if (sides_ == esphelm::center_zero::Sides::PORT_STARBOARD) {
        side_labels_[0] = make_label(cell, env.fonts.small, env.colors.port, "P");
        side_labels_[1] = make_label(cell, env.fonts.small, env.colors.starboard, "S");
      }
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
    lv_scale_set_line_needle_value(scale_, needle_, -(d / 7), needle_steps_());
    if (fill_ != nullptr) {
      lv_obj_set_size(fill_, d, d);
      lv_obj_center(fill_);
      lv_obj_set_style_arc_width(fill_, std::max<int32_t>(4, d / 24), LV_PART_INDICATOR);
    }
    for (int i = 0; i < 2; i++) {
      if (side_labels_[i] == nullptr)
        continue;
      // In the top corners of the gauge's square, outside the ring: no needle or value reaches
      // there. Hidden on tiny gauges.
      if (small) {
        lv_obj_add_flag(side_labels_[i], LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      lv_obj_remove_flag(side_labels_[i], LV_OBJ_FLAG_HIDDEN);
      lv_obj_align_to(side_labels_[i], scale_, i == 0 ? LV_ALIGN_TOP_LEFT : LV_ALIGN_TOP_RIGHT, 0, 0);
    }
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
    std::string text = (stale ? "--" : b_.text) + suffix_;
    if (center_zero_ && live)
      text = center_zero_label(b_.number, b_.item.decimals, sides_, suffix_);
    if (set_text(value_, shown_, text))
      lv_obj_align_to(value_, scale_, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_text_color(value_, live ? colors_.text : colors_.muted, LV_PART_MAIN);
    lv_obj_set_style_line_color(needle_, live ? colors_.text : colors_.muted, LV_PART_MAIN);
    if (b_.has_number) {
      const int32_t d = lv_obj_get_width(scale_);
      lv_scale_set_line_needle_value(scale_, needle_, -(d / 7), needle_steps_());
    }
    if (fill_ != nullptr) {
      // A stale value keeps no fill: only the needle, muted, says where it was.
      lv_arc_set_value(fill_, live ? needle_steps_() : SCALE_STEPS / 2);
      lv_obj_set_style_arc_color(fill_, center_zero_color(colors_, sides_, b_.number), LV_PART_INDICATOR);
    }
  }

 protected:
  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  /// The needle's (and the fill's) position: the value clamped to min..max, on the drawn scale.
  int32_t needle_steps_() const {
    if (!b_.has_number)
      return center_zero_ ? SCALE_STEPS / 2 : 0;
    return to_steps(std::clamp(b_.number, min_, max_), lo_, hi_);
  }

  double min_, max_;
  double lo_, hi_;  // the drawn scale: min..max, or -M..M centred on zero
  bool center_zero_;
  esphelm::center_zero::Sides sides_;
  std::string sample_;
  Binding b_;
  lv_obj_t *scale_;
  lv_obj_t *fill_{nullptr};
  lv_obj_t *side_labels_[2]{};
  lv_obj_t *needle_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  std::string unit_suffix_;
  std::string suffix_;
  std::string shown_{"--"};
  std::string tick_text_[5];
  const char *tick_ptrs_[6];
};

std::unique_ptr<Widget> make_gauge_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<GaugeWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
