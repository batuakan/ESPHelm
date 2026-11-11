// The mono clock tile (ADR-0024, ADR-0035). Shared helpers: mono_common.h.
#include "mono_common.h"

#include <utility>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

namespace {
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
 * The display's time and/or date in the layout's zone or UTC (esphelm_clock.h), sized and placed
 * like the colour clock tile. "--" until the display knows the time. Redraws only when the text
 * changes. Memory: up to four labels.
 */
class ClockWidget : public Widget {
 public:
  ClockWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), cfg_(tile.clock), utc_now_(env.utc_now),
        tz_(env.time_zone) {
    std::string caption = tile.data.label;
    if (cfg_.utc)
      caption = caption.empty() ? "UTC" : caption + " UTC";
    if (!caption.empty())
      caption_ = label(cell, env.fonts.small, caption);
    if (cfg_.show != esphelm::ClockShow::DATE) {
      time_ = label(cell, env.fonts.value, shown_time_);
      if (cfg_.hour12)
        suffix_ = label(cell, env.fonts.small, "");
    }
    if (cfg_.show != esphelm::ClockShow::TIME)
      date_ = label(cell, env.fonts.small, shown_date_);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {}  // the runtime keeps the clock
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst value, uint32_t now) override {}

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    const char *dsample = date_sample(cfg_.date_format);
    // In a tile too small for everything (e.g. under the alarm banner) the caption goes first,
    // then the date, rather than overlapping the time.
    bool show_caption = caption_ != nullptr, show_date = date_ != nullptr;
    const auto fit = [&](bool cap, bool date) -> const lv_font_t * {
      const bool two = time_ != nullptr && date;
      for (int i = fonts_.count - 1; i >= 0; i--) {
        const lv_font_t *f = fonts_.ladder[i];
        if (fonts_.digits[i] && (time_ == nullptr || !lv_font_get_glyph_dsc(f, &glyph_, ':', 0)))
          continue;
        const lv_font_t *c = companion_font(fonts_, f);
        const int32_t bands = (cap ? line_height(c) : 0) + (two ? line_height(c) : 0);
        const int32_t main_w = time_ != nullptr ? text_width(time_sample(cfg_.seconds), f) +
                                                      (suffix_ != nullptr ? SUFFIX_GAP + text_width("PM", c) : 0)
                                                : text_width(dsample, f);
        const int32_t main_h = time_ != nullptr ? digit_height(f) : line_height(f);
        if (main_w <= w && main_h + bands <= h && (!two || text_width(dsample, c) <= w))
          return f;
      }
      return nullptr;
    };
    main_ = fit(show_caption, show_date);
    if (main_ == nullptr && show_caption) {
      show_caption = false;
      main_ = fit(false, show_date);
    }
    if (main_ == nullptr && show_date && time_ != nullptr) {
      show_date = false;
      main_ = fit(false, false);
    }
    if (main_ == nullptr)
      main_ = smallest_font(fonts_);
    const bool both = time_ != nullptr && show_date;
    for (auto [obj, shown] : {std::pair{caption_, show_caption}, std::pair{date_, show_date}}) {
      if (obj == nullptr)
        continue;
      if (shown)
        lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);
      else
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    }
    companion_ = companion_font(fonts_, main_);
    const int32_t top = show_caption ? line_height(companion_) : 0;
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
  }

 protected:
  void place_time_() {
    if (time_ == nullptr)
      return;
    const int32_t sw = suffix_ != nullptr && !shown_suffix_.empty()
                           ? SUFFIX_GAP + text_width(shown_suffix_.c_str(), companion_)
                           : 0;
    lv_obj_align(time_, LV_ALIGN_CENTER, -sw / 2, offset_y_);
    if (suffix_ != nullptr) {
      lv_obj_update_layout(time_);
      lv_obj_align_to(suffix_, time_, LV_ALIGN_OUT_RIGHT_BOTTOM, SUFFIX_GAP,
                      -(main_->base_line - companion_->base_line));
    }
  }

  std::string id_;
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
  uint32_t last_check_ms_{0};
};

std::unique_ptr<Widget> make_clock(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<ClockWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
