// The value tile. Shared helpers: widget_common.h.
#include "widget_common.h"

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.widget";

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
    if (env.has_history && env.open_history && env.has_history(tile.id)) {
      // Tap for the history popup (ADR-0018); a small sparkline mark bottom-left says so.
      open_history_ = env.open_history;
      static const lv_point_precise_t MARK[] = {{0, 10}, {6, 4}, {12, 7}, {20, 0}};
      mark_ = lv_line_create(cell);
      lv_line_set_points(mark_, MARK, 4);
      lv_obj_set_style_line_width(mark_, 2, LV_PART_MAIN);
      lv_obj_set_style_line_rounded(mark_, true, LV_PART_MAIN);
      lv_obj_set_style_line_color(mark_, env.colors.muted, LV_PART_MAIN);
      lv_obj_align(mark_, LV_ALIGN_BOTTOM_LEFT, 0, -4);
      lv_obj_add_flag(cell, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_add_event_cb(
          cell, [](lv_event_t *e) { static_cast<ValueWidget *>(lv_event_get_user_data(e))->tap(""); },
          LV_EVENT_CLICKED, this);
    } else {
      lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
    }
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }
  void tap(const std::string &part) override {
    if (open_history_)
      open_history_(id_);
  }

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
  lv_obj_t *mark_{nullptr};
  std::function<void(const std::string &)> open_history_;
  int level_{0};  // index of the number's font in fonts_.ladder
  int32_t width_{0}, offset_y_{0};
  std::string shown_{"--"};
};

std::unique_ptr<Widget> make_value_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<ValueWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
