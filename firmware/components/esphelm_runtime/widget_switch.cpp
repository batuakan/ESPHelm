// The switch tile. Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.widget";

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

std::unique_ptr<Widget> make_switch_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<SwitchWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
