#include "history_popup.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.history";
static const uint32_t DRAW_INTERVAL_MS = 250;  // the value redraws as often as on its tile

/// Time axis text for `seconds` ago, as ageLabel() in packages/schema/src/history.ts.
static std::string age_label(int seconds) {
  if (seconds <= 0)
    return "now";
  char buf[16];
  if (seconds < 7200)
    std::snprintf(buf, sizeof(buf), "-%d m", (seconds + 30) / 60);
  else
    std::snprintf(buf, sizeof(buf), "-%d h", (seconds + 1800) / 3600);
  return buf;
}

std::string HistoryPopup::window_key(int w) {
  const int s = esphelm::sizes::HISTORY_WINDOW_SECONDS[w];
  return s < 3600 ? std::to_string(s / 60) + "m" : std::to_string(s / 3600) + "h";
}

static lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const char *text) {
  lv_obj_t *l = lv_label_create(parent);
  lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(l, color, LV_PART_MAIN);
  lv_label_set_text(l, text);
  return l;
}

static lv_obj_t *button(lv_obj_t *parent, const Colors &c, int32_t w, int32_t h) {
  lv_obj_t *b = lv_button_create(parent);
  lv_obj_set_size(b, w, h);
  lv_obj_set_style_bg_color(b, c.tile, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(b, 10, LV_PART_MAIN);
  lv_obj_set_style_shadow_width(b, 0, LV_PART_MAIN);
  lv_obj_set_style_border_color(b, c.text, LV_PART_MAIN);
  return b;
}

void HistoryPopup::open(const std::string &tile_id, std::vector<HistorySeries> series, size_t selected,
                        esphelm::Theme theme, int32_t top) {
  if (series.empty())
    return;
  this->tile_id_ = tile_id;
  this->series_ = std::move(series);
  this->selected_ = selected < this->series_.size() ? selected : 0;
  this->theme_ = theme;
  this->top_ = top;
  this->window_ = 0;
  this->pending_window_ = -1;
  this->pending_series_ = -1;
  this->pending_close_ = false;
  this->build_();
  ESP_LOGI(TAG, "History of %s opened", this->cur_().key.c_str());
}

void HistoryPopup::close() {
  if (this->root_ == nullptr)
    return;
  lv_obj_delete(this->root_);
  this->root_ = nullptr;
  this->value_ = this->minmax_ = this->plot_ = this->chart_ = this->collecting_ = nullptr;
  this->line_ = nullptr;
  this->series_buttons_.clear();
  this->bands_.clear();
  ESP_LOGI(TAG, "History of %s closed", this->cur_().key.c_str());
}

void HistoryPopup::tap(const std::string &part) {
  if (this->root_ == nullptr)
    return;
  if (part == "close") {
    this->pending_close_ = true;
    return;
  }
  const int windows = this->history_ != nullptr ? this->history_->windows() : 0;
  for (int w = 0; w < windows; w++) {
    if (part == window_key(w)) {
      this->pending_window_ = w;
      return;
    }
  }
  for (size_t i = 0; i < this->series_.size(); i++) {
    if (!this->series_[i].name.empty() && part == this->series_[i].name) {
      this->pending_series_ = static_cast<int>(i);
      return;
    }
  }
  ESP_LOGW(TAG, "tap: no button \"%s\" in the history popup", part.c_str());
}

bool HistoryPopup::tick(uint32_t now, bool points_closed, esphelm::Theme theme, int32_t top) {
  if (this->root_ == nullptr)
    return false;
  if (this->pending_close_) {
    this->close();
    return false;
  }
  bool rebuilt = false;
  if (this->pending_series_ >= 0) {
    // Another value: its caption, unit, decimals and zones differ, so build it anew.
    this->selected_ = static_cast<size_t>(this->pending_series_);
    this->pending_series_ = -1;
    rebuilt = true;
  }
  if (rebuilt || theme != this->theme_ || top != this->top_) {
    this->theme_ = theme;
    this->top_ = top;
    this->build_();
    rebuilt = true;
  }
  if (this->pending_window_ >= 0) {
    this->window_ = this->pending_window_;
    this->pending_window_ = -1;
    this->style_buttons_();
    this->refresh_chart_();
  } else if (points_closed && !rebuilt) {
    this->refresh_chart_();
  }
  if (now - this->last_draw_ms_ >= DRAW_INTERVAL_MS)
    this->refresh_value_(now);
  return rebuilt;
}

std::string HistoryPopup::format_(double v) const {
  char buf[32];
  const int d = this->cur_().data.decimals >= 0 ? this->cur_().data.decimals : 1;
  std::snprintf(buf, sizeof(buf), "%.*f", d, v);
  return buf;
}

std::string HistoryPopup::format_axis_(double v) const {
  const esphelm::units::UnitDef *u = this->cur_().data.unit;
  if (this->circular_ && u != nullptr && u->has_wrap) {
    // Back into the unit's range, rounded first so that 359.96 reads 0, not 360.
    const double scale = std::pow(10.0, this->cur_().data.decimals >= 0 ? this->cur_().data.decimals : 1);
    v = std::round(v * scale) / scale;
    const double span = u->wrap_max - u->wrap_min;
    v -= span * std::floor((v - u->wrap_min) / span);
  }
  return this->format_(v);
}

lv_color_t HistoryPopup::number_color_(bool has, float v) const {
  const Colors c = colors_for(this->theme_);
  if (!has)
    return c.muted;
  esphelm::ZoneState state;
  if (esphelm::value_zone_state(v, this->cur_().zones, state)) {
    if (this->theme_ == esphelm::Theme::NIGHT && state == esphelm::ZoneState::NORMAL)
      return c.text;
    return c.zone[static_cast<int>(state)];
  }
  if (this->cur_().color != esphelm::ValueColor::NONE)
    return c.palette[static_cast<int>(this->cur_().color)];
  return c.text;
}

void HistoryPopup::build_() {
  if (this->root_ != nullptr) {
    lv_obj_delete(this->root_);
    this->bands_.clear();
  }
  const Colors c = colors_for(this->theme_);
  const bool night = this->theme_ == esphelm::Theme::NIGHT;
  const int32_t sw = lv_display_get_horizontal_resolution(nullptr);
  const int32_t sh = lv_display_get_vertical_resolution(nullptr);
  const int32_t pad = sw >= 600 ? 16 : 12;
  const int32_t inner_w = sw - 2 * pad;
  const int32_t inner_h = sh - this->top_ - 2 * pad;
  const lv_font_t *big = this->fonts_.label;
  const lv_font_t *small = this->fonts_.small;
  const int32_t line_big = lv_font_get_line_height(big);
  const int32_t line_small = lv_font_get_line_height(small);
  const int32_t btn_h = std::max<int32_t>(48, line_big + 16);

  // The whole screen below the banner; clickable, so taps beside the controls do nothing.
  this->root_ = lv_obj_create(lv_layer_top());
  lv_obj_remove_style_all(this->root_);
  lv_obj_remove_flag(this->root_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(this->root_, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_style_bg_color(this->root_, c.background, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(this->root_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_pad_all(this->root_, pad, LV_PART_MAIN);
  lv_obj_set_pos(this->root_, 0, this->top_);
  lv_obj_set_size(this->root_, sw, sh - this->top_);

  // Header: caption, and the close button.
  const std::string &name = this->cur_().data.label.empty() ? this->cur_().data.path : this->cur_().data.label;
  lv_obj_t *caption = label(this->root_, big, c.muted, name.c_str());
  lv_label_set_long_mode(caption, LV_LABEL_LONG_MODE_DOTS);
  lv_obj_set_size(caption, inner_w - btn_h - 8, line_big);
  lv_obj_set_pos(caption, 0, (btn_h - line_big) / 2);
  lv_obj_t *close = button(this->root_, c, btn_h, btn_h);
  lv_obj_align(close, LV_ALIGN_TOP_RIGHT, 0, 0);
  lv_obj_center(label(close, big, c.text, "X"));
  lv_obj_add_event_cb(
      close, [](lv_event_t *e) { static_cast<HistoryPopup *>(lv_event_get_user_data(e))->tap("close"); },
      LV_EVENT_CLICKED, this);

  // A wind rose's values: one button each, in rows under the header.
  int32_t row_y = btn_h + 4;
  this->series_buttons_.clear();
  if (this->series_.size() > 1) {
    int32_t x = 0;
    for (size_t i = 0; i < this->series_.size(); i++) {
      const int32_t w = std::max<int32_t>(btn_h, text_width(this->series_[i].title.c_str(), big) + 24);
      if (x > 0 && x + w > inner_w) {
        x = 0;
        row_y += btn_h + 8;
      }
      lv_obj_t *b = button(this->root_, c, std::min(w, inner_w), btn_h);
      lv_obj_set_pos(b, x, row_y);
      lv_obj_t *l = label(b, big, c.muted, this->series_[i].title.c_str());
      lv_label_set_long_mode(l, LV_LABEL_LONG_MODE_DOTS);
      lv_obj_set_width(l, std::min(w, inner_w) - 16);
      lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
      lv_obj_center(l);
      lv_obj_set_user_data(b, reinterpret_cast<void *>(static_cast<intptr_t>(i)));
      lv_obj_add_event_cb(
          b,
          [](lv_event_t *e) {
            auto *self = static_cast<HistoryPopup *>(lv_event_get_user_data(e));
            auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
            self->tap(self->series_[reinterpret_cast<intptr_t>(lv_obj_get_user_data(target))].name);
          },
          LV_EVENT_CLICKED, this);
      this->series_buttons_.push_back(b);
      x += w + 8;
    }
    row_y += btn_h + 8;
  }

  // The live value, and the window's min and max beside it.
  const int d = this->cur_().data.decimals >= 0 ? std::min<int>(this->cur_().data.decimals, 3) : 1;
  const char *unit = this->cur_().data.unit != nullptr ? this->cur_().data.unit->label : "";
  std::string sample = std::string(esphelm::sizes::TEXT_SAMPLE_DIGITS + 1, '8');
  if (d > 0)
    sample += "." + std::string(d, '8');
  const std::string value_sample = sample + (unit[0] != '\0' ? std::string(" ") + unit : "");
  const lv_font_t *value_font = fit_font(this->fonts_, value_sample.c_str(), inner_w * 55 / 100, inner_h / 6);
  const int32_t row_h = std::max(lv_font_get_line_height(value_font), 2 * line_small);
  this->value_ = label(this->root_, value_font, c.muted, "--");
  lv_obj_set_pos(this->value_, 0, row_y + (row_h - lv_font_get_line_height(value_font)) / 2);
  this->minmax_ = label(this->root_, small, c.muted, "");
  lv_obj_set_style_text_align(this->minmax_, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
  lv_obj_align(this->minmax_, LV_ALIGN_TOP_RIGHT, 0, row_y + (row_h - 2 * line_small) / 2);

  // Window buttons at the bottom, the time axis above them, the graph in between.
  const int windows = this->history_ != nullptr ? this->history_->windows() : 1;
  const int32_t bw = (inner_w - (windows - 1) * 8) / windows;
  for (int w = 0; w < esphelm::sizes::HISTORY_WINDOWS; w++)
    this->buttons_[w] = nullptr;
  for (int w = 0; w < windows; w++) {
    lv_obj_t *b = button(this->root_, c, bw, btn_h);
    lv_obj_set_pos(b, w * (bw + 8), inner_h - btn_h);
    lv_obj_center(label(b, big, c.muted, esphelm::sizes::HISTORY_WINDOW_LABELS[w]));
    lv_obj_set_user_data(b, reinterpret_cast<void *>(static_cast<intptr_t>(w)));
    lv_obj_add_event_cb(
        b,
        [](lv_event_t *e) {
          auto *self = static_cast<HistoryPopup *>(lv_event_get_user_data(e));
          auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
          self->tap(window_key(static_cast<int>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(target)))));
        },
        LV_EVENT_CLICKED, this);
    this->buttons_[w] = b;
  }
  const int32_t axis_y = inner_h - btn_h - 6 - line_small;
  std::string widest = std::string(4, '8');
  if (d > 0)
    widest += "." + std::string(d, '8');
  const int32_t yw = text_width(("-" + widest).c_str(), small);
  const int32_t plot_x = yw + 8;
  const int32_t plot_y = row_y + row_h + 8 + line_small / 2;
  const int32_t plot_w = inner_w - plot_x;
  const int32_t plot_h = std::max<int32_t>(40, axis_y - 4 - plot_y);

  this->plot_ = lv_obj_create(this->root_);
  lv_obj_remove_style_all(this->plot_);
  lv_obj_remove_flag(this->plot_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_remove_flag(this->plot_, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_style_bg_color(this->plot_, c.tile, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(this->plot_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_pos(this->plot_, plot_x, plot_y);
  lv_obj_set_size(this->plot_, plot_w, plot_h);
  // Zone bands first, so the line is drawn over them.
  for (size_t z = 0; z < this->cur_().zones.size(); z++) {
    lv_obj_t *band = lv_obj_create(this->plot_);
    lv_obj_remove_style_all(band);
    lv_obj_remove_flag(band, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_color(band, c.zone[static_cast<int>(this->cur_().zones[z].state)], LV_PART_MAIN);
    lv_obj_set_style_bg_opa(band, night ? LV_OPA_30 : LV_OPA_20, LV_PART_MAIN);
    lv_obj_add_flag(band, LV_OBJ_FLAG_HIDDEN);
    this->bands_.push_back(band);
  }
  this->chart_ = lv_chart_create(this->plot_);
  lv_obj_remove_flag(this->chart_, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_size(this->chart_, plot_w, plot_h);
  lv_obj_set_pos(this->chart_, 0, 0);
  lv_obj_set_style_bg_opa(this->chart_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_width(this->chart_, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(this->chart_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(this->chart_, 0, LV_PART_MAIN);
  lv_obj_set_style_line_color(this->chart_, c.muted, LV_PART_MAIN);
  lv_obj_set_style_line_opa(this->chart_, LV_OPA_40, LV_PART_MAIN);
  lv_obj_set_style_line_width(this->chart_, 1, LV_PART_MAIN);
  lv_obj_set_style_line_width(this->chart_, sw >= 600 ? 4 : 3, LV_PART_ITEMS);
  lv_obj_set_style_size(this->chart_, 0, 0, LV_PART_INDICATOR);  // no dots on the points
  lv_chart_set_type(this->chart_, LV_CHART_TYPE_LINE);
  lv_chart_set_div_line_count(this->chart_, 3, 0);
  lv_chart_set_point_count(this->chart_, esphelm::sizes::HISTORY_POINTS);
  this->line_ = lv_chart_add_series(this->chart_, c.accent, LV_CHART_AXIS_PRIMARY_Y);
  lv_chart_set_series_ext_y_array(this->chart_, this->line_, this->chart_y_);
  this->collecting_ = label(this->plot_, small, c.muted, "Collecting...");
  lv_obj_align(this->collecting_, LV_ALIGN_CENTER, 0, -line_small);  // clear of the middle grid line

  // Axis labels: max, middle, min on the left; the window's start, middle and now below.
  for (int k = 0; k < 3; k++) {
    this->y_labels_[k] = label(this->root_, small, c.muted, "");
    lv_obj_set_width(this->y_labels_[k], yw);
    lv_obj_set_style_text_align(this->y_labels_[k], LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
    lv_obj_set_pos(this->y_labels_[k], 0, plot_y + k * plot_h / 2 - line_small / 2);
    this->x_labels_[k] = label(this->root_, small, c.muted, "");
  }
  lv_obj_update_layout(this->root_);  // the time axis is placed from the plot's position
  this->style_buttons_();
  this->refresh_chart_();
  this->shown_.clear();
  this->refresh_value_(millis());
}

void HistoryPopup::style_buttons_() {
  const Colors c = colors_for(this->theme_);
  for (int w = 0; w < esphelm::sizes::HISTORY_WINDOWS; w++) {
    lv_obj_t *b = this->buttons_[w];
    if (b == nullptr)
      continue;
    const bool on = w == this->window_;
    lv_obj_set_style_border_width(b, on ? 2 : 0, LV_PART_MAIN);
    lv_obj_set_style_text_color(lv_obj_get_child(b, 0), on ? c.text : c.muted, LV_PART_MAIN);
  }
  for (size_t i = 0; i < this->series_buttons_.size(); i++) {
    const bool on = i == this->selected_;
    lv_obj_set_style_border_width(this->series_buttons_[i], on ? 2 : 0, LV_PART_MAIN);
    lv_obj_set_style_text_color(lv_obj_get_child(this->series_buttons_[i], 0), on ? c.text : c.muted, LV_PART_MAIN);
  }
  // Time axis of the chosen window.
  if (this->root_ == nullptr || this->plot_ == nullptr)
    return;
  const int seconds = esphelm::sizes::HISTORY_WINDOW_SECONDS[this->window_];
  const int32_t px = lv_obj_get_x(this->plot_);
  const int32_t pw = lv_obj_get_width(this->plot_);
  const int32_t y = lv_obj_get_y(this->plot_) + lv_obj_get_height(this->plot_) + 4;
  const std::string text[3] = {age_label(seconds), age_label(seconds / 2), age_label(0)};
  for (int k = 0; k < 3; k++) {
    lv_label_set_text(this->x_labels_[k], text[k].c_str());
    lv_obj_update_layout(this->x_labels_[k]);
    const int32_t tw = lv_obj_get_width(this->x_labels_[k]);
    const int32_t x = k == 0 ? px : (k == 1 ? px + (pw - tw) / 2 : px + pw - tw);
    lv_obj_set_pos(this->x_labels_[k], x, y);
  }
}

void HistoryPopup::refresh_chart_() {
  if (this->chart_ == nullptr)
    return;
  const int idx = this->history_ != nullptr ? this->history_->find(this->cur_().key) : -1;
  const size_t n = idx >= 0 ? this->history_->series(idx, this->window_, this->points_) : 0;
  // Angles: around the window's mean on the circle, so a line across north doesn't jump.
  this->circular_ = idx >= 0 && this->history_->circular(idx);
  if (this->circular_) {
    const esphelm::units::UnitDef &u = *this->history_->unit(idx);
    double s = 0, c = 0;
    uint32_t count = 0;
    for (size_t k = 0; k < n; k++) {
      if (this->points_[k].gap())
        continue;
      const double turn = esphelm::circular_turn(this->points_[k].mean, u.wrap_min, u.wrap_max);
      s += std::sin(turn);
      c += std::cos(turn);
      count++;
    }
    const double centre = esphelm::circular_from_sums(s, c, count, u.wrap_min, u.wrap_max);
    for (size_t k = 0; centre == centre && k < n; k++) {
      auto &p = this->points_[k];
      if (p.gap())
        continue;
      const float shift =
          static_cast<float>(esphelm::unwrap_around(p.mean, centre, u.wrap_min, u.wrap_max) - p.mean);
      p = {p.mean + shift, p.min + shift, p.max + shift};
    }
  }
  float mn = 0, mx = 0;
  size_t valid = 0;
  for (size_t k = 0; k < n; k++) {
    const auto &p = this->points_[k];
    if (p.gap())
      continue;
    mn = valid == 0 ? p.min : std::min(mn, p.min);
    mx = valid == 0 ? p.max : std::max(mx, p.max);
    valid++;
  }
  const int N = esphelm::sizes::HISTORY_POINTS;
  ESP_LOGD(TAG, "History of %s, %s: %u points, %u with values", this->cur_().key.c_str(),
           esphelm::sizes::HISTORY_WINDOW_LABELS[this->window_], (unsigned) n, (unsigned) valid);
  if (valid < 2) {
    for (int k = 0; k < N; k++)
      this->chart_y_[k] = LV_CHART_POINT_NONE;
    lv_obj_remove_flag(this->collecting_, LV_OBJ_FLAG_HIDDEN);
    for (auto *l : this->y_labels_)
      lv_label_set_text(l, "");
    lv_label_set_text(this->minmax_, "");
    for (auto *b : this->bands_)
      lv_obj_add_flag(b, LV_OBJ_FLAG_HIDDEN);
    lv_chart_refresh(this->chart_);
    return;
  }
  lv_obj_add_flag(this->collecting_, LV_OBJ_FLAG_HIDDEN);
  const double span = static_cast<double>(mx) - mn;
  if (span < 1e-6) {
    this->lo_ = mn - 1.0;
    this->hi_ = mx + 1.0;
  } else {
    this->lo_ = mn - span * 0.1;
    this->hi_ = mx + span * 0.1;
  }
  const int d = this->cur_().data.decimals >= 0 ? std::min<int>(this->cur_().data.decimals, 3) : 1;
  this->scale_ = 1;
  for (int k = 0; k < d; k++)
    this->scale_ *= 10;
  lv_chart_set_axis_range(this->chart_, LV_CHART_AXIS_PRIMARY_Y,
                          static_cast<int32_t>(std::floor(this->lo_ * this->scale_)),
                          static_cast<int32_t>(std::ceil(this->hi_ * this->scale_)));
  const size_t offset = N - n;  // the newest point is on the right; a young window fills from there
  for (int k = 0; k < N; k++) {
    if (static_cast<size_t>(k) < offset) {
      this->chart_y_[k] = LV_CHART_POINT_NONE;
      continue;
    }
    const auto &p = this->points_[k - offset];
    this->chart_y_[k] = p.gap() ? LV_CHART_POINT_NONE : static_cast<int32_t>(std::lround(p.mean * this->scale_));
  }
  lv_chart_refresh(this->chart_);

  lv_label_set_text(this->y_labels_[0], this->format_axis_(this->hi_).c_str());
  lv_label_set_text(this->y_labels_[1], this->format_axis_((this->lo_ + this->hi_) / 2).c_str());
  lv_label_set_text(this->y_labels_[2], this->format_axis_(this->lo_).c_str());
  const std::string mm = "min " + this->format_axis_(mn) + "\nmax " + this->format_axis_(mx);
  lv_label_set_text(this->minmax_, mm.c_str());

  const int32_t ph = lv_obj_get_height(this->plot_);
  const int32_t pw = lv_obj_get_width(this->plot_);
  const double range = this->hi_ - this->lo_;
  for (size_t z = 0; z < this->bands_.size() && z < this->cur_().zones.size(); z++) {
    const auto &zone = this->cur_().zones[z];
    if (this->circular_) {  // zones are in the unit's range; the graph may run past its ends
      lv_obj_add_flag(this->bands_[z], LV_OBJ_FLAG_HIDDEN);
      continue;
    }
    const double from = std::max(zone.from, this->lo_);
    const double to = std::min(zone.to, this->hi_);
    if (!(from < to)) {
      lv_obj_add_flag(this->bands_[z], LV_OBJ_FLAG_HIDDEN);
      continue;
    }
    const int32_t y = static_cast<int32_t>(std::lround((this->hi_ - to) / range * ph));
    const int32_t h = std::max<int32_t>(1, static_cast<int32_t>(std::lround((to - from) / range * ph)));
    lv_obj_set_pos(this->bands_[z], 0, y);
    lv_obj_set_size(this->bands_[z], pw, h);
    lv_obj_remove_flag(this->bands_[z], LV_OBJ_FLAG_HIDDEN);
  }
}

void HistoryPopup::refresh_value_(uint32_t now) {
  if (this->value_ == nullptr)
    return;
  this->last_draw_ms_ = now;
  const int idx = this->history_ != nullptr ? this->history_->find(this->cur_().key) : -1;
  float v = 0;
  uint32_t ms = 0;
  const bool has = idx >= 0 && this->history_->last(idx, v, ms) && now - ms <= this->history_->stale_ms(idx);
  std::string text = has ? this->format_(v) : "--";
  if (this->cur_().data.unit != nullptr && this->cur_().data.unit->label[0] != '\0')
    text += std::string(" ") + this->cur_().data.unit->label;
  if (text != this->shown_) {
    lv_label_set_text(this->value_, text.c_str());
    this->shown_ = text;
  }
  lv_obj_set_style_text_color(this->value_, this->number_color_(has, v), LV_PART_MAIN);
}

}  // namespace esphelm_runtime
}  // namespace esphome
