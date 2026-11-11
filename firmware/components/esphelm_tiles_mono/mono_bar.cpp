// The mono bar tile (ADR-0035). Shared helpers: mono_common.h.
#include "mono_common.h"

#include <algorithm>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

/**
 * Caption, value and a bar: an outlined track filled in the ink, laid out like the colour bar
 * tile (horizontal or vertical, centre zero with a zero line and its end letters, ADR-0023).
 * Zones show as the tile's frame, as on a value tile. Stale: "--" and an empty track.
 * Memory: a bar and up to five labels.
 */
class BarWidget : public Widget {
 public:
  BarWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), frame_(cell, env.colors), min_(tile.min), max_(tile.max),
        zones_(tile.zones), center_zero_(tile.center_zero), sides_(tile.sides),
        sample_(value_sample(tile.data.decimals)) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    vertical_ = tile.orientation == esphelm::Orientation::VERTICAL;

    lv_obj_t *caption = label(cell, env.fonts.small, tile.data.label);
    lv_obj_align(caption, LV_ALIGN_TOP_LEFT, 0, 0);
    bar_ = lv_bar_create(cell);
    if (center_zero_) {
      lv_bar_set_range(bar_, -SCALE_STEPS, SCALE_STEPS);
      lv_bar_set_mode(bar_, LV_BAR_MODE_SYMMETRICAL);
      half_ = esphelm::center_zero::span(min_, max_);
    } else {
      lv_bar_set_range(bar_, 0, SCALE_STEPS);
    }
    lv_bar_set_orientation(bar_, vertical_ ? LV_BAR_ORIENTATION_VERTICAL : LV_BAR_ORIENTATION_HORIZONTAL);
    lv_obj_set_style_bg_opa(bar_, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(bar_, FRAME, LV_PART_MAIN);
    lv_obj_set_style_border_opa(bar_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_all(bar_, FRAME + 2, LV_PART_MAIN);  // a gap between the track and the fill
    lv_obj_set_style_radius(bar_, 4, LV_PART_MAIN);
    lv_obj_set_style_radius(bar_, 2, LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(bar_, LV_OPA_COVER, LV_PART_INDICATOR);
    if (center_zero_) {
      zero_ = lv_obj_create(bar_);
      lv_obj_remove_style_all(zero_);
      lv_obj_set_style_bg_opa(zero_, LV_OPA_COVER, LV_PART_MAIN);
      if (vertical_)
        lv_obj_set_size(zero_, lv_pct(100), 2);
      else
        lv_obj_set_size(zero_, 2, lv_pct(100));
      lv_obj_center(zero_);
      const bool ps = sides_ == esphelm::center_zero::Sides::PORT_STARBOARD;
      ends_[0] = label(bar_, env.fonts.small, ps ? "P" : "-");
      ends_[1] = label(bar_, env.fonts.small, ps ? "S" : "+");
      if (vertical_) {
        lv_obj_align(ends_[0], LV_ALIGN_BOTTOM_MID, 0, -2);
        lv_obj_align(ends_[1], LV_ALIGN_TOP_MID, 0, 2);
      } else {
        lv_obj_align(ends_[0], LV_ALIGN_LEFT_MID, 6, 0);
        lv_obj_align(ends_[1], LV_ALIGN_RIGHT_MID, -6, 0);
      }
    }
    recolour_();
    value_ = label(cell, env.fonts.label, "--");
    const bool has_unit = tile.data.unit != nullptr && tile.data.unit->label[0] != '\0';
    if (vertical_) {
      lv_obj_set_size(bar_, lv_pct(22), lv_pct(78));
      lv_obj_align(bar_, LV_ALIGN_BOTTOM_LEFT, 0, 0);
      lv_obj_t *unit = label(cell, env.fonts.small, has_unit ? tile.data.unit->label : "");
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
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const int32_t small_h = line_height(fonts_.small);
    const int32_t caption_h = b_.item.label.empty() ? 0 : small_h;
    const std::string sample = sample_ + suffix_;
    if (vertical_) {
      const lv_font_t *f = fit_font(fonts_, sample.c_str(), w * 74 / 100, (h - caption_h - small_h) / 2);
      lv_obj_set_style_text_font(value_, f, LV_PART_MAIN);
      lv_obj_align(value_, LV_ALIGN_BOTTOM_RIGHT, 0, -small_h);
    } else {
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
    std::string text = (stale ? "--" : b_.text) + suffix_;
    if (center_zero_ && live)
      text = center_zero_label(b_.number, b_.item.decimals, sides_, suffix_);
    set_text(value_, shown_, text);
    esphelm::ZoneState state = esphelm::ZoneState::NORMAL;
    const bool zoned = live && esphelm::value_zone_state(b_.number, zones_, state);
    if (frame_.show(zoned, state))
      recolour_();
    if (live) {
      const double v = std::clamp(b_.number, min_, max_);
      lv_bar_set_value(bar_, center_zero_ ? to_steps(v, -half_, half_) * 2 - SCALE_STEPS : to_steps(v, min_, max_),
                       LV_ANIM_OFF);
    } else {
      lv_bar_set_value(bar_, 0, LV_ANIM_OFF);  // stale: an empty track (centre zero: just the zero line)
    }
  }

 protected:
  /// The track, fill and zero line in the tile's ink (it changes when the tile is inverted).
  void recolour_() {
    const lv_color_t ink = frame_.ink();
    lv_obj_set_style_border_color(bar_, ink, LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar_, ink, LV_PART_INDICATOR);
    if (zero_ != nullptr)
      lv_obj_set_style_bg_color(zero_, ink, LV_PART_MAIN);
  }

  std::string id_;
  Fonts fonts_;
  lv_obj_t *cell_;
  Frame frame_;
  double min_, max_;
  std::vector<esphelm::Zone> zones_;
  bool center_zero_;
  esphelm::center_zero::Sides sides_;
  double half_{0};
  lv_obj_t *zero_{nullptr};
  lv_obj_t *ends_[2]{};
  std::string sample_;
  bool vertical_{false};
  Binding b_;
  lv_obj_t *bar_;
  lv_obj_t *value_{nullptr};
  std::string suffix_;
  std::string shown_{"--"};
};

std::unique_ptr<Widget> make_bar(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<BarWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
