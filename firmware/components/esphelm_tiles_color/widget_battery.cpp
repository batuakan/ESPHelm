// The battery tile (ADR-0046). Shared helpers: widget_common.h; its values: battery_values.h.
#include "widget_common.h"

#include <algorithm>

#include "esphome/components/esphelm_runtime/battery_values.h"
#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {

/**
 * A battery outline filled to the state of charge with the % beside it; above it the label and the
 * voltage, below it the current and power, the state line and solar. The rows share the height as
 * esphelm::battery::rows() says (batteryRows() in the editor), dropped from the bottom when the
 * tile is short. Value changes only resize the fill and set texts. Memory: 13 LVGL objects.
 */
class BatteryWidget : public Widget {
 public:
  BatteryWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), night_(env.night) {
    v_.init(tile, env, millis());
    const Colors &c = colors_;
    caption_ = make_label(cell, env.fonts.small, c.muted, v_.label());
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    voltage_ = make_label(cell, env.fonts.small, c.text, "");
    body_ = lv_obj_create(cell);
    lv_obj_remove_style_all(body_);
    lv_obj_remove_flag(body_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_border_color(body_, c.text, LV_PART_MAIN);
    fill_ = lv_obj_create(body_);
    lv_obj_remove_style_all(fill_);
    lv_obj_remove_flag(fill_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(fill_, LV_OPA_COVER, LV_PART_MAIN);
    nub_ = lv_obj_create(cell);
    lv_obj_remove_style_all(nub_);
    lv_obj_remove_flag(nub_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(nub_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(nub_, c.text, LV_PART_MAIN);
    percent_ = make_label(cell, env.fonts.value, c.text, "--");
    current_ = make_label(cell, env.fonts.small, c.text, "");
    power_ = make_label(cell, env.fonts.small, c.text, "");
    status_ = make_label(cell, env.fonts.small, c.text, "");
    lv_label_set_long_mode(status_, LV_LABEL_LONG_MODE_DOTS);
    solar_caption_ = make_label(cell, env.fonts.small, c.muted, v_.solar_label());
    solar_ = make_label(cell, env.fonts.small, c.text, "");
    if (env.has_history && env.open_history && env.has_history(tile.id)) {
      // Tap for the state of charge's history (ADR-0018), as on a value tile.
      open_history_ = env.open_history;
      mark_ = make_history_mark(cell, env.colors);
      lv_obj_add_flag(cell, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_add_event_cb(
          cell, [](lv_event_t *e) { static_cast<BatteryWidget *>(lv_event_get_user_data(e))->tap(""); },
          LV_EVENT_CLICKED, this);
    } else {
      lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
    }
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { v_.paths(out); }
  void tap(const std::string &part) override {
    if (open_history_)
      open_history_(id_);
  }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const lv_font_t *f;
    rows_ = battery_rows(fonts_, w, h, v_.caption_row(), v_.power_row(), v_.status_row(), v_.solar_row(), f);
    for (lv_obj_t *l : {caption_, voltage_, current_, power_, status_, solar_caption_, solar_})
      lv_obj_set_style_text_font(l, f, LV_PART_MAIN);
    const int32_t line = rows_.line;
    // Caption row: the label on the left, the voltage on the right.
    show_(caption_, rows_.caption && !v_.label().empty());
    show_(voltage_, rows_.caption && v_.has(esphelm::BatteryConfig::VOLTAGE));
    lv_obj_set_width(caption_, w / 2);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_align(voltage_, LV_ALIGN_TOP_RIGHT, 0, 0);
    // The battery: the largest % that fits 40 % of the width and the band (less the history mark's
    // room below it), the outline in the rest.
    const int32_t mark_room = mark_ != nullptr ? MARK_ROOM : 0;
    const lv_font_t *pf = fit_font(fonts_, "100%", w * 40 / 100, rows_.height - mark_room);
    lv_obj_set_style_text_font(percent_, pf, LV_PART_MAIN);
    box_ = battery_box(w, rows_, text_width("100%", pf));
    lv_obj_set_style_border_width(body_, box_.border, LV_PART_MAIN);
    lv_obj_set_style_radius(body_, box_.border * 2, LV_PART_MAIN);
    lv_obj_set_size(body_, box_.w, box_.h);
    lv_obj_set_pos(body_, box_.x, box_.y);
    lv_obj_set_size(nub_, box_.nub_w, box_.nub_h);
    lv_obj_align_to(nub_, body_, LV_ALIGN_OUT_RIGHT_MID, 0, 0);
    lv_obj_set_style_radius(nub_, box_.border, LV_PART_MAIN);
    lv_obj_set_style_radius(fill_, box_.border, LV_PART_MAIN);
    lv_obj_set_height(fill_, std::max<int32_t>(0, box_.h - 2 * box_.inset));
    // Inside the outline, whose children are placed from its border.
    lv_obj_set_pos(fill_, box_.inset - box_.border, box_.inset - box_.border);
    lv_obj_align_to(percent_, body_, LV_ALIGN_OUT_RIGHT_MID, box_.nub_w + box_.gap, 0);
    // The history mark under the %, at the bottom of the battery's band, clear of the rows below.
    if (mark_ != nullptr)
      lv_obj_set_pos(mark_, box_.x + box_.w + box_.nub_w + box_.gap, rows_.top + rows_.height - mark_room);
    // Rows below the battery.
    int32_t ry = rows_.top + rows_.height;
    show_(current_, rows_.power && v_.has(esphelm::BatteryConfig::CURRENT));
    show_(power_, rows_.power && v_.shows_power());
    lv_obj_align(current_, LV_ALIGN_TOP_LEFT, 0, ry);
    lv_obj_align(power_, LV_ALIGN_TOP_RIGHT, 0, ry);
    if (rows_.power)
      ry += line;
    show_(status_, rows_.status);
    lv_obj_set_width(status_, w);
    lv_obj_align(status_, LV_ALIGN_TOP_LEFT, 0, ry);
    if (rows_.status)
      ry += line;
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

  /// The fill's colour: its zone's, else the normal zone's; the text colour for normal at night
  /// (the dim normal shade would look stale), muted while stale.
  lv_color_t fill_color_() const {
    if (!v_.live)
      return colors_.muted;
    esphelm::ZoneState state = esphelm::ZoneState::NORMAL;
    v_.zone(state);
    if (night_ && state == esphelm::ZoneState::NORMAL)
      return colors_.text;
    return colors_.zone[static_cast<int>(state)];
  }

  void draw_() {
    set_text(percent_, shown_[0], v_.percent);
    set_text(voltage_, shown_[1], v_.voltage);
    set_text(current_, shown_[2], v_.current);
    set_text(power_, shown_[3], v_.power);
    set_text(status_, shown_[4], v_.status);
    set_text(solar_, shown_[5], v_.solar);
    const lv_color_t fill = fill_color_();
    lv_obj_set_style_bg_color(fill_, fill, LV_PART_MAIN);
    lv_obj_set_width(fill_, static_cast<int32_t>(box_.inner_w * v_.fraction + 0.5));
    lv_obj_set_style_text_color(percent_, v_.live ? colors_.text : colors_.muted, LV_PART_MAIN);
    const lv_color_t frame = v_.live ? colors_.text : colors_.muted;
    lv_obj_set_style_border_color(body_, frame, LV_PART_MAIN);
    lv_obj_set_style_bg_color(nub_, frame, LV_PART_MAIN);
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  bool night_;
  BatteryValues v_;
  esphelm::battery::Rows rows_;
  lv_obj_t *caption_, *voltage_, *body_, *fill_, *nub_, *percent_, *current_, *power_, *status_, *solar_caption_,
      *solar_;
  lv_obj_t *mark_{nullptr};
  /// Height kept under the % for the history mark (10 px) and a gap.
  static constexpr int32_t MARK_ROOM = 12;
  std::function<void(const std::string &)> open_history_;
  BatteryBox box_;
  std::string shown_[6];
};

std::unique_ptr<Widget> make_battery_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<BatteryWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
