// The clock tile (ADR-0024). Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {

namespace {
/// The widest text each part can show, to size the fonts once (8 is the widest digit).
const char *time_sample(bool seconds) { return seconds ? "88:88:88" : "88:88"; }
const char *date_sample(esphelm::wallclock::DateFormat f) {
  switch (f) {
    case esphelm::wallclock::DateFormat::DMY:
      return "88.88.8888";
    case esphelm::wallclock::DateFormat::MDY:
      return "88/88/8888";
    case esphelm::wallclock::DateFormat::WEEKDAY:
      return "Wed 88 May";
    default:
      return "8888-88-88";
  }
}
const int32_t SUFFIX_GAP = 6;
}  // namespace

/**
 * The display's time and/or date in the layout's zone or UTC (esphelm_clock.h, the same text as
 * the editor preview). The time takes the largest font whose sample ("88:88") fits, digits-only
 * fonts included when they have ":"; the caption above and the date below (with both) take its
 * companion size, the date alone the largest full font that fits. "--" until the display
 * knows the time. Redraws only when the text changes: once a minute, or a second with seconds.
 * Memory: up to four labels; nothing per update.
 */
class ClockWidget : public Widget {
 public:
  ClockWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), cfg_(tile.clock),
        utc_now_(env.utc_now), tz_(env.time_zone) {
    std::string caption = tile.data.label;
    if (cfg_.utc)
      caption = caption.empty() ? "UTC" : caption + " UTC";
    if (!caption.empty())
      caption_ = make_label(cell, env.fonts.small, env.colors.muted, caption);
    if (cfg_.show != esphelm::ClockShow::DATE) {
      time_ = make_label(cell, env.fonts.value, env.colors.muted, shown_time_);
      if (cfg_.hour12)
        suffix_ = make_label(cell, env.fonts.small, env.colors.muted, "");
    }
    if (cfg_.show != esphelm::ClockShow::TIME)
      date_ = make_label(cell, env.fonts.small, env.colors.muted, shown_date_);
    lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {}  // the runtime keeps the clock
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst value, uint32_t now) override {}

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const bool both = time_ != nullptr && date_ != nullptr;
    const char *dsample = date_sample(cfg_.date_format);
    // The main line's font: the largest that fits with the caption (and the date) in companion size.
    main_ = smallest_font(fonts_);  // when nothing fits
    for (int i = fonts_.count - 1; i >= 0; i--) {
      const lv_font_t *f = fonts_.ladder[i];
      if (fonts_.digits[i] && (time_ == nullptr || !lv_font_get_glyph_dsc(f, &glyph_, ':', 0)))
        continue;  // the date needs letters; the time needs ":" (an older font may lack it)
      const lv_font_t *c = companion_font(fonts_, f);
      const int32_t bands = (caption_ != nullptr ? line_height(c) : 0) + (both ? line_height(c) : 0);
      const int32_t main_w = time_ != nullptr ? text_width(time_sample(cfg_.seconds), f) +
                                                    (suffix_ != nullptr ? SUFFIX_GAP + text_width("PM", c) : 0)
                                              : text_width(dsample, f);
      const int32_t main_h = time_ != nullptr ? digit_height(f) : line_height(f);
      if (main_w <= w && main_h + bands <= h && (!both || text_width(dsample, c) <= w)) {
        main_ = f;
        break;
      }
    }
    companion_ = companion_font(fonts_, main_);
    const int32_t top = caption_ != nullptr ? line_height(companion_) : 0;
    const int32_t bottom = both ? line_height(companion_) : 0;
    offset_y_ = (top - bottom) / 2;
    if (caption_ != nullptr) {
      lv_obj_set_style_text_font(caption_, companion_, LV_PART_MAIN);
      lv_obj_set_width(caption_, w);
      lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
      lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    }
    if (time_ != nullptr)
      lv_obj_set_style_text_font(time_, main_, LV_PART_MAIN);
    if (suffix_ != nullptr)
      lv_obj_set_style_text_font(suffix_, companion_, LV_PART_MAIN);
    if (date_ != nullptr) {
      lv_obj_set_style_text_font(date_, both ? companion_ : main_, LV_PART_MAIN);
      if (both)
        lv_obj_align(date_, LV_ALIGN_BOTTOM_MID, 0, 0);
      else
        lv_obj_align(date_, LV_ALIGN_CENTER, 0, offset_y_);
    }
    place_time_();
    last_check_ms_ = 0;
  }

  void tick(uint32_t now) override {
    if (last_check_ms_ != 0 && now - last_check_ms_ < DRAW_INTERVAL_MS)
      return;
    last_check_ms_ = now;
    int64_t utc;
    const bool known = utc_now_ && utc_now_(utc);
    char time_buf[9] = "--", date_buf[16] = "--";
    const char *suffix = "";
    if (known) {
      const int64_t local = utc + (cfg_.utc ? 0 : esphelm::wallclock::offset(tz_, utc));
      esphelm::wallclock::time_text(local, cfg_.hour12, cfg_.seconds, time_buf, sizeof(time_buf), suffix);
      esphelm::wallclock::date_text(local, cfg_.date_format, date_buf, sizeof(date_buf));
    }
    bool moved = false;
    if (time_ != nullptr)
      moved = set_text(time_, shown_time_, time_buf);
    if (suffix_ != nullptr)
      moved = set_text(suffix_, shown_suffix_, suffix) || moved;
    if (date_ != nullptr)
      set_text(date_, shown_date_, date_buf);
    if (moved)
      place_time_();
    if (known != known_shown_) {
      known_shown_ = known;
      for (lv_obj_t *l : {time_, suffix_, date_}) {
        if (l != nullptr)
          lv_obj_set_style_text_color(l, known ? colors_.text : colors_.muted, LV_PART_MAIN);
      }
    }
  }

 protected:
  /// The time (and AM/PM after it) centred as one group in the band between caption and date.
  void place_time_() {
    if (time_ == nullptr)
      return;
    const int32_t sw = suffix_ != nullptr && !shown_suffix_.empty()
                           ? SUFFIX_GAP + text_width(shown_suffix_.c_str(), companion_)
                           : 0;
    lv_obj_align(time_, LV_ALIGN_CENTER, -sw / 2, offset_y_);
    if (suffix_ != nullptr) {
      lv_obj_update_layout(time_);
      // On the digits' baseline: base_line is how far each font's baseline is above its line's bottom.
      lv_obj_align_to(suffix_, time_, LV_ALIGN_OUT_RIGHT_BOTTOM, SUFFIX_GAP,
                      -(main_->base_line - companion_->base_line));
    }
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  esphelm::ClockConfig cfg_;
  std::function<bool(int64_t &)> utc_now_;
  esphelm::wallclock::Tz tz_;
  lv_font_glyph_dsc_t glyph_{};
  const lv_font_t *main_{nullptr};
  const lv_font_t *companion_{nullptr};
  int32_t offset_y_{0};
  lv_obj_t *caption_{nullptr};
  lv_obj_t *time_{nullptr};
  lv_obj_t *suffix_{nullptr};
  lv_obj_t *date_{nullptr};
  std::string shown_time_{"--"}, shown_suffix_, shown_date_{"--"};
  bool known_shown_{false};
  uint32_t last_check_ms_{0};
};

std::unique_ptr<Widget> make_clock_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<ClockWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
