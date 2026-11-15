// The alarms panel tile (ADR-0038). Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/esphelm_runtime/alarms.h"
#include "esphome/components/esphelm_runtime/esphelm_alarm_age.h"
#include "esphome/components/esphelm_runtime/esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {

namespace {
const char *const TAG = "esphelm.alarms_tile";
constexpr size_t MAX_ROWS = 8;           // made once, reused
constexpr uint32_t AGE_REFRESH_MS = 30000;  // the ages count in minutes
constexpr int32_t BAR_W = 6, GAP = 8;
}  // namespace

/**
 * Every active notification the alarm banner keeps (ADR-0014), under the tile's prefix: worst
 * first (unacknowledged before acknowledged, then by state, then newest), each row with a bar in
 * its state's colour, its message (or the end of its path), how long it has been in that state
 * (esphelm_alarm_age.h) and an ACK while unacknowledged and the tile is ALARMS_ACK_WIDTH wide.
 * Rows are ALARMS_ROW_HEIGHT tall, as many as fit under the title; "+N more" when they don't.
 * Follows no paths: it reads the banner's table and redraws when its version changes (or for
 * the ages). Memory: up to MAX_ROWS rows of five LVGL objects, made once; nothing per update.
 */
class AlarmsWidget : public Widget {
 public:
  AlarmsWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), cfg_(tile.alarms),
        alarms_(env.alarms), ack_(env.ack_alarm), night_(env.night),
        title_text_(tile.data.label.empty() ? std::string("Alarms") : tile.data.label) {
    lv_obj_remove_flag(cell, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
    title_ = make_label(cell, env.fonts.small, env.colors.muted, title_text_);
    lv_label_set_long_mode(title_, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_align(title_, LV_ALIGN_TOP_LEFT, 0, 0);
    empty_ = make_label(cell, env.fonts.label, env.colors.zone[0], "No alarms");
    more_ = make_label(cell, env.fonts.small, env.colors.muted, "");
    for (size_t i = 0; i < MAX_ROWS; i++)
      rows_[i] = make_row_(i);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {}  // the runtime keeps the table
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst value, uint32_t now) override {}

  void layout_done() override {
    w_ = lv_obj_get_content_width(cell_);
    h_ = lv_obj_get_content_height(cell_);
    const int32_t top = line_height(fonts_.small) + 4;
    with_ack_ = w_ >= esphelm::sizes::ALARMS_ACK_WIDTH;
    // A narrow panel (no ACK buttons) writes its messages small, so more of them fits.
    text_font_ = with_ack_ ? fonts_.label : fonts_.small;
    const int32_t row_h = std::max<int32_t>(esphelm::sizes::ALARMS_ROW_HEIGHT, line_height(text_font_) + 12);
    fit_ = std::min(MAX_ROWS, static_cast<size_t>(std::max<int32_t>(0, (h_ - top) / (row_h + 4))));
    lv_obj_set_width(title_, w_ - text_width_("+8 more", fonts_.small) - GAP);
    lv_obj_align(empty_, LV_ALIGN_CENTER, 0, top / 2);
    const int32_t ack_w = with_ack_ ? std::max<int32_t>(64, row_h + 16) : 0;
    const int32_t age_w = text_width_("23 h 59", fonts_.small) + GAP;
    for (size_t i = 0; i < MAX_ROWS; i++) {
      Row &r = rows_[i];
      lv_obj_set_size(r.box, w_, row_h);
      lv_obj_set_pos(r.box, 0, top + static_cast<int32_t>(i) * (row_h + 4));
      lv_obj_set_size(r.bar, BAR_W, row_h - 8);
      lv_obj_align(r.bar, LV_ALIGN_LEFT_MID, 4, 0);
      lv_obj_set_size(r.ack, ack_w, row_h - 8);
      lv_obj_align(r.ack, LV_ALIGN_RIGHT_MID, -4, 0);
      lv_obj_set_size(r.age, age_w, line_height(fonts_.small));
      lv_obj_align(r.age, LV_ALIGN_RIGHT_MID, -(ack_w + (with_ack_ ? GAP : 4)), 0);
      // One line, cut with "..." (a label without a height wraps).
      lv_obj_set_style_text_font(r.text, text_font_, LV_PART_MAIN);
      lv_obj_set_size(r.text, std::max<int32_t>(10, w_ - BAR_W - 4 - GAP - age_w - ack_w - (with_ack_ ? GAP : 4)),
                      line_height(text_font_));
      lv_obj_align(r.text, LV_ALIGN_LEFT_MID, 4 + BAR_W + GAP, 0);
    }
    // "+N more" at the end of the title line.
    lv_obj_align(more_, LV_ALIGN_TOP_RIGHT, 0, 0);
    lv_obj_move_foreground(more_);
    drawn_version_ = UINT32_MAX;  // redraw
  }

  void tick(uint32_t now) override {
    if (alarms_ == nullptr)
      return;
    if (alarms_->version() == drawn_version_ && now - drawn_ms_ < AGE_REFRESH_MS)
      return;
    drawn_version_ = alarms_->version();
    drawn_ms_ = now;
    redraw_(now);
  }

  /// Test hook: "ack:<row>" acknowledges the alarm shown in that row, as its button does.
  void tap(const std::string &part) override {
    if (part.compare(0, 4, "ack:") == 0) {
      const size_t row = static_cast<size_t>(std::atoi(part.c_str() + 4));
      if (row < shown_.size())
        ack_row_(row);
      return;
    }
    ESP_LOGW(TAG, "Alarms %s: no part \"%s\"", id_.c_str(), part.c_str());
  }

 protected:
  struct Row {
    lv_obj_t *box{nullptr}, *bar{nullptr}, *text{nullptr}, *age{nullptr}, *ack{nullptr}, *ack_label{nullptr};
    std::string shown_text, shown_age;
  };

  static int32_t text_width_(const char *t, const lv_font_t *f) {
    lv_point_t size;
    lv_text_get_size(&size, t, f, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    return size.x;
  }

  Row make_row_(size_t i) {
    Row r;
    r.box = lv_obj_create(cell_);
    lv_obj_remove_style_all(r.box);
    lv_obj_remove_flag(r.box, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(r.box, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(r.box, 8, LV_PART_MAIN);
    lv_obj_set_style_bg_color(r.box, colors_.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(r.box, LV_OPA_50, LV_PART_MAIN);
    r.bar = lv_obj_create(r.box);
    lv_obj_remove_style_all(r.bar);
    lv_obj_set_style_radius(r.bar, 3, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(r.bar, LV_OPA_COVER, LV_PART_MAIN);
    r.text = make_label(r.box, fonts_.label, colors_.text, "");
    lv_label_set_long_mode(r.text, LV_LABEL_LONG_MODE_DOTS);
    r.age = make_label(r.box, fonts_.small, colors_.muted, "");
    lv_obj_set_style_text_align(r.age, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
    r.ack = lv_button_create(r.box);
    lv_obj_set_style_radius(r.ack, 8, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(r.ack, 0, LV_PART_MAIN);
    lv_obj_set_style_recolor_opa(r.ack, LV_OPA_TRANSP, LV_STATE_DISABLED);
    r.ack_label = make_label(r.ack, fonts_.small, colors_.background, "ACK");
    lv_obj_center(r.ack_label);
    lv_obj_set_user_data(r.ack, reinterpret_cast<void *>(i));
    lv_obj_add_event_cb(
        r.ack,
        [](lv_event_t *e) {
          auto *self = static_cast<AlarmsWidget *>(lv_event_get_user_data(e));
          auto *btn = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
          self->ack_row_(reinterpret_cast<size_t>(lv_obj_get_user_data(btn)));
        },
        LV_EVENT_CLICKED, this);
    lv_obj_add_flag(r.box, LV_OBJ_FLAG_HIDDEN);
    return r;
  }

  void ack_row_(size_t row) {
    if (row >= shown_.size() || !ack_ || alarms_ == nullptr || !alarms_->can_ack())
      return;
    const auto &entries = alarms_->entries();
    if (shown_[row] >= entries.size() || entries[shown_[row]].acked)
      return;
    ack_(entries[shown_[row]].path);
  }

  void redraw_(uint32_t now) {
    const auto &entries = alarms_->entries();
    // The tile's alarms, worst first.
    shown_.clear();
    for (size_t i = 0; i < entries.size(); i++) {
      const auto &e = entries[i];
      if (!esphelm::alarm_age::under_prefix(e.path.c_str(), cfg_.prefix.c_str()))
        continue;
      if (e.acked && !cfg_.show_acknowledged)
        continue;
      shown_.push_back(i);
    }
    std::stable_sort(shown_.begin(), shown_.end(), [&](size_t a, size_t b) {
      const auto &x = entries[a], &y = entries[b];
      if (x.acked != y.acked)
        return !x.acked;
      if (x.severity != y.severity)
        return x.severity > y.severity;
      return x.since_ms > y.since_ms;  // newest first
    });
    const bool online = alarms_->online();
    const bool can_ack = alarms_->can_ack();
    std::string title = title_text_;
    if (!online)
      title += "  (offline)";
    set_text(title_, shown_title_, title);

    if (shown_.empty())
      lv_obj_remove_flag(empty_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(empty_, LV_OBJ_FLAG_HIDDEN);
    // With more alarms than rows, the last row makes room for "+N more".
    const size_t rows = std::min(shown_.size(), fit_);
    if (shown_.size() > rows && rows > 0) {
      char buf[16];
      std::snprintf(buf, sizeof(buf), "+%u more", (unsigned) (shown_.size() - rows));
      set_text(more_, shown_more_, buf);
      lv_obj_remove_flag(more_, LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_add_flag(more_, LV_OBJ_FLAG_HIDDEN);
    }
    for (size_t i = 0; i < MAX_ROWS; i++) {
      Row &r = rows_[i];
      if (i >= rows) {
        lv_obj_add_flag(r.box, LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      lv_obj_remove_flag(r.box, LV_OBJ_FLAG_HIDDEN);
      const auto &e = entries[shown_[i]];
      const lv_color_t c = AlarmBanner::colour(e.severity, colors_);
      lv_obj_set_style_bg_color(r.bar, c, LV_PART_MAIN);
      lv_obj_set_style_bg_opa(r.bar, e.acked ? LV_OPA_40 : LV_OPA_COVER, LV_PART_MAIN);
      // Unacknowledged rows framed in their colour, acknowledged ones plain and dimmed.
      lv_obj_set_style_border_color(r.box, c, LV_PART_MAIN);
      lv_obj_set_style_border_width(r.box, e.acked ? 0 : 2, LV_PART_MAIN);
      const char *what = e.message.empty() ? e.path.c_str() + std::strlen("notifications.") : e.message.c_str();
      set_text(r.text, r.shown_text, what);
      lv_obj_set_style_text_color(r.text, e.acked ? colors_.muted : colors_.text, LV_PART_MAIN);
      char age[16];
      esphelm::alarm_age::format((now - e.since_ms) / 1000, age, sizeof(age));
      set_text(r.age, r.shown_age, age);
      const bool show_ack = with_ack_ && !e.acked;
      if (show_ack) {
        lv_obj_remove_flag(r.ack, LV_OBJ_FLAG_HIDDEN);
        const bool pending = alarms_->pending() == e.path;
        const bool enabled = can_ack && !pending;
        lv_obj_set_style_bg_color(r.ack, night_ ? colors_.background : c, LV_PART_MAIN);
        lv_obj_set_style_border_color(r.ack, c, LV_PART_MAIN);
        lv_obj_set_style_border_width(r.ack, night_ ? 2 : 0, LV_PART_MAIN);
        lv_obj_set_style_text_color(r.ack_label, night_ ? c : colors_.background, LV_PART_MAIN);
        lv_label_set_text(r.ack_label, pending ? "..." : "ACK");
        lv_obj_set_style_opa(r.ack, enabled || pending ? LV_OPA_COVER : LV_OPA_40, LV_PART_MAIN);
        if (enabled)
          lv_obj_remove_state(r.ack, LV_STATE_DISABLED);
        else
          lv_obj_add_state(r.ack, LV_STATE_DISABLED);
      } else {
        lv_obj_add_flag(r.ack, LV_OBJ_FLAG_HIDDEN);
      }
    }
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  esphelm::AlarmsConfig cfg_;
  const AlarmBanner *alarms_;
  std::function<bool(const std::string &)> ack_;
  bool night_;
  std::string title_text_, shown_title_, shown_more_;
  lv_obj_t *title_{nullptr}, *empty_{nullptr}, *more_{nullptr};
  Row rows_[MAX_ROWS];
  std::vector<size_t> shown_;  // indices into the table, in the order drawn
  int32_t w_{0}, h_{0};
  size_t fit_{0};
  const lv_font_t *text_font_{nullptr};
  bool with_ack_{false};
  uint32_t drawn_version_{UINT32_MAX};
  uint32_t drawn_ms_{0};
};

std::unique_ptr<Widget> make_alarms_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<AlarmsWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
