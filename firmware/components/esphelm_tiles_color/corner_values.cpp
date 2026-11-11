// Values in a tile's corners, outside its round drawing: the wind rose's and the engine tile's
// corner slots (ADR-0010, ADR-0032). Declared in widget_common.h.
#include "widget_common.h"

#include <algorithm>
#include <cmath>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {

void CornerValues::add(lv_obj_t *cell, int corner, const esphelm::DataItem &item, const WidgetEnv &env) {
  colors_ = env.colors;
  fonts_ = env.fonts;
  Corner s;
  s.corner = corner;
  s.b.item = item;
  s.b.stale_ms = stale_ms(item, env);
  s.b.last_value_ms = millis();
  std::string caption = item.label;
  if (item.unit != nullptr && item.unit->label[0] != '\0')
    caption += caption.empty() ? item.unit->label : std::string(" ") + item.unit->label;
  // A value over its caption, pushed into the tile's corner.
  s.box = lv_obj_create(cell);
  lv_obj_remove_style_all(s.box);
  lv_obj_remove_flag(s.box, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_size(s.box, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(s.box, LV_FLEX_FLOW_COLUMN);
  const bool right = corner % 2 == 1;
  lv_obj_set_flex_align(s.box, LV_FLEX_ALIGN_START, right ? LV_FLEX_ALIGN_END : LV_FLEX_ALIGN_START,
                        LV_FLEX_ALIGN_START);
  s.value = make_label(s.box, env.fonts.label, colors_.muted, "--");
  s.caption = make_label(s.box, env.fonts.small, colors_.text, caption);
  corners_.push_back(std::move(s));
}

void CornerValues::paths(std::vector<std::string> &out) const {
  for (const auto &s : corners_)
    out.push_back(s.b.item.path);
}

void CornerValues::on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) {
  for (auto &s : corners_) {
    if (path == s.b.item.path)
      s.b.set(v, now);
  }
}

void CornerValues::tick(uint32_t now) {
  bool stale;
  for (auto &s : corners_) {
    if (!s.b.due(now, stale))
      continue;
    set_text(s.value, s.shown, stale ? "--" : s.b.text);
    lv_obj_set_style_text_color(s.value, stale ? colors_.muted : colors_.text, LV_PART_MAIN);
  }
}

void CornerValues::layout(int32_t w, int32_t h, double r, bool allowed, double open_below, double open_r) {
  if (corners_.empty())
    return;
  const int32_t small_h = lv_font_get_line_height(fonts_.small);
  for (auto &s : corners_) {
    lv_obj_update_layout(s.caption);
    const int32_t caption_w = lv_obj_get_width(s.caption);
    bool shown = false;
    for (const lv_font_t *f : {fonts_.label, fonts_.small}) {
      const int32_t fh = lv_font_get_line_height(f);
      const int32_t bw = std::max<int32_t>(fh * 12 / 5, caption_w);  // "12.5" or the caption
      const int32_t bh = fh + small_h;
      // The box's inner corner, relative to the drawing's centre, must be outside the circle.
      const double x = w / 2.0 - bw, y = h / 2.0 - bh;
      const double dist = std::hypot(x, y);
      const bool clear = dist >= r || (s.corner >= 2 && open_below >= 0 && y >= open_below && dist >= open_r);
      if (allowed && x >= 0 && y >= 0 && clear) {
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

bool CornerValues::shown(int corner) const {
  for (const auto &s : corners_) {
    if (s.corner == corner && !lv_obj_has_flag(s.box, LV_OBJ_FLAG_HIDDEN))
      return true;
  }
  return false;
}

}  // namespace esphelm_runtime
}  // namespace esphome
