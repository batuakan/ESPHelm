// The mono value tile (ADR-0035). Shared helpers: mono_common.h.
#include "mono_common.h"

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

/**
 * Caption, number and unit, sized like the colour value tile (ADR-0017): the number gets the
 * largest font whose sample fits between the caption and unit lines, and a wider live value steps
 * it down. Zones (the layout's or the server's, ADR-0020) show as the frame: heavy for warn,
 * inverted for alarm and emergency. A tile colour has no meaning here and is ignored. "--" when
 * stale. Memory: three labels.
 */
class ValueWidget : public Widget {
 public:
  ValueWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), frame_(cell, env.colors), zones_(tile.zones),
        sample_(value_sample(tile.data.decimals)) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    caption_ = label(cell, env.fonts.small, tile.data.label);
    value_ = label(cell, env.fonts.value, "--");
    lv_label_set_long_mode(value_, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_set_style_text_align(value_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      unit_ = label(cell, env.fonts.small, tile.data.unit->label);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }

  void layout_done() override {
    width_ = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    // In a tile too small for the caption too (e.g. under the alarm banner), the caption goes
    // rather than overlapping the number.
    const auto fit = [&](bool caption) {
      for (int i = fonts_.count - 1; i >= 0; i--) {
        const lv_font_t *c = companion_font(fonts_, fonts_.ladder[i]);
        const int32_t bands = (caption ? line_height(c) : 0) + (unit_ != nullptr ? line_height(c) : 0);
        if (text_width(sample_.c_str(), fonts_.ladder[i]) <= width_ && digit_height(fonts_.ladder[i]) + bands <= h)
          return i;
      }
      return -1;
    };
    bool has_caption = !b_.item.label.empty();
    level_ = fit(has_caption);
    if (level_ < 0 && has_caption) {
      has_caption = false;
      level_ = fit(false);
    }
    if (level_ < 0)
      level_ = 0;
    if (has_caption)
      lv_obj_remove_flag(caption_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(caption_, LV_OBJ_FLAG_HIDDEN);
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
    esphelm::ZoneState state = esphelm::ZoneState::NORMAL;
    const bool zoned = !stale && b_.has_number && esphelm::value_zone_state(b_.number, zones_, state);
    frame_.show(zoned, state);
  }

 protected:
  const lv_font_t *number_font_() const { return fonts_.count > 0 ? fonts_.ladder[level_] : fonts_.value; }
  void apply_number_font_() {
    lv_obj_set_style_text_font(value_, number_font_(), LV_PART_MAIN);
    lv_obj_align(value_, LV_ALIGN_CENTER, 0, offset_y_);
  }
  void shrink_to_fit_() {
    const bool numeric = is_numeric(shown_);
    if ((numeric && shown_.size() <= sample_.size()) || width_ <= 0)
      return;
    const int before = level_;
    while (level_ > 0 && ((fonts_.digits[level_] && !numeric) || text_width(shown_.c_str(), number_font_()) > width_))
      level_--;
    if (level_ != before)
      apply_number_font_();
  }

  std::string id_;
  Fonts fonts_;
  lv_obj_t *cell_;
  Frame frame_;
  std::vector<esphelm::Zone> zones_;
  std::string sample_;
  Binding b_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  lv_obj_t *unit_{nullptr};
  int level_{0};
  int32_t width_{0}, offset_y_{0};
  std::string shown_{"--"};
};

std::unique_ptr<Widget> make_value(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<ValueWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
