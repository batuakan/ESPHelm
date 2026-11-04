#include "settings_panel.h"

#include <algorithm>
#include <cstdlib>

#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.settings";
static const uint32_t INFO_INTERVAL_MS = 1000;
static const char *const CHOICE_PARTS[3] = {"day", "night", "auto"};
static const char *const CHOICE_TEXT[3] = {"Day", "Night", "Auto"};

/// Choice button index of a choice (-1 auto, else Theme).
static int choice_index(int8_t choice) { return choice < 0 ? 2 : choice; }

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

/// A container that only lays out its children.
static lv_obj_t *box(lv_obj_t *parent, int32_t w) {
  lv_obj_t *o = lv_obj_create(parent);
  lv_obj_remove_style_all(o);
  lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_size(o, w, LV_SIZE_CONTENT);
  return o;
}

/// The button's tap() part rides along as its user data.
static void on_part(lv_obj_t *obj, SettingsPanel *panel, const char *part) {
  lv_obj_set_user_data(obj, const_cast<char *>(part));
  lv_obj_add_event_cb(
      obj,
      [](lv_event_t *e) {
        auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
        static_cast<SettingsPanel *>(lv_event_get_user_data(e))
            ->tap(static_cast<const char *>(lv_obj_get_user_data(target)));
      },
      LV_EVENT_CLICKED, panel);
}

void SettingsPanel::open(const State &state, int32_t top) {
  this->state_ = state;
  this->top_ = top;
  this->pending_close_ = this->closed_ = this->sleep_wanted_ = this->brightness_done_ = false;
  this->pending_choice_ = -2;
  this->pending_brightness_ = -1;
  this->build_();
  ESP_LOGI(TAG, "Settings opened");
}

void SettingsPanel::close() {
  if (this->root_ == nullptr)
    return;
  lv_obj_delete(this->root_);
  this->root_ = this->brightness_value_ = this->slider_ = nullptr;
  for (lv_obj_t *&b : this->choices_)
    b = nullptr;
  this->sections_.clear();
  this->rows_.clear();
  this->rows_.shrink_to_fit();
  ESP_LOGI(TAG, "Settings closed");
}

void SettingsPanel::tap(const std::string &part) {
  if (this->root_ == nullptr)
    return;
  if (part == "close") {
    this->pending_close_ = true;
  } else if (part == "sleep") {
    if (this->state_.can_sleep)
      this->sleep_wanted_ = true;
  } else if (part.compare(0, 11, "brightness=") == 0) {
    const int v = std::atoi(part.c_str() + 11);
    if (v >= this->state_.min_brightness && v <= 100) {
      this->pending_brightness_ = v;
      this->brightness_done_ = true;
    }
  } else {
    for (int i = 0; i < 3; i++) {
      if (part == CHOICE_PARTS[i])
        this->pending_choice_ = static_cast<int8_t>(i == 2 ? -1 : i);
    }
  }
}

bool SettingsPanel::take_choice(int8_t &choice) {
  if (this->pending_choice_ == -2)
    return false;
  choice = this->pending_choice_;
  this->pending_choice_ = -2;
  return true;
}

bool SettingsPanel::take_brightness(int &percent, bool &done) {
  if (this->pending_brightness_ < 0)
    return false;
  percent = this->pending_brightness_;
  done = this->brightness_done_;
  this->pending_brightness_ = -1;
  this->brightness_done_ = false;
  return true;
}

bool SettingsPanel::tick(uint32_t now, const State &state, int32_t top) {
  if (this->root_ == nullptr)
    return false;
  if (this->pending_close_) {
    this->pending_close_ = false;
    this->closed_ = true;
    this->close();
    return false;
  }
  const bool rebuild = state.theme != this->state_.theme ||
                       state.can_sleep != this->state_.can_sleep || state.min_brightness != this->state_.min_brightness ||
                       top != this->top_;
  const State before = this->state_;
  this->state_ = state;
  this->top_ = top;
  if (rebuild) {
    lv_obj_delete(this->root_);
    this->root_ = nullptr;
    this->build_();
    return true;
  }
  if (state.choice != before.choice)
    this->style_choices_();
  if (this->slider_ != nullptr && state.brightness != before.brightness) {
    lv_label_set_text_fmt(this->brightness_value_, "%d %%", state.brightness);
    if (!lv_obj_has_state(this->slider_, LV_STATE_PRESSED))
      lv_slider_set_value(this->slider_, state.brightness, LV_ANIM_OFF);
  }
  if (now >= this->next_info_ms_) {
    this->next_info_ms_ = now + INFO_INTERVAL_MS;
    this->refresh_info_();
  }
  return false;
}

void SettingsPanel::style_choices_() {
  const Colors c = colors_for(this->state_.theme);
  const int selected = choice_index(this->state_.choice);
  for (int i = 0; i < 3; i++) {
    if (this->choices_[i] == nullptr)
      continue;
    const bool on = i == selected;
    lv_obj_set_style_bg_color(this->choices_[i], on ? c.accent : c.tile, LV_PART_MAIN);
    lv_obj_t *text = lv_obj_get_child(this->choices_[i], 0);
    lv_obj_set_style_text_color(text, on ? c.background : c.text, LV_PART_MAIN);
  }
}

void SettingsPanel::build_() {
  const Colors c = colors_for(this->state_.theme);
  lv_display_t *disp = lv_display_get_default();
  const int32_t sw = lv_display_get_horizontal_resolution(disp);
  const int32_t sh = lv_display_get_vertical_resolution(disp);
  const int32_t pad = sw >= 600 ? 16 : 12;
  const int32_t gap = sw >= 600 ? 24 : 12;
  const int32_t inner_w = sw - 2 * pad;
  const lv_font_t *big = this->fonts_.label;
  const lv_font_t *small = this->fonts_.small;
  const int32_t line_big = lv_font_get_line_height(big);
  const int32_t line_small = lv_font_get_line_height(small);
  const int32_t btn_h = std::max<int32_t>(48, line_big + 16);
  // Two columns side by side on a large screen, else one under the other (scrolling).
  const bool wide = sw >= 640;
  const int32_t col_w = wide ? (inner_w - gap) / 2 : inner_w;

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

  // Header: title, and the close button.
  lv_obj_t *title = label(this->root_, big, c.text, "Settings");
  lv_obj_set_pos(title, 0, (btn_h - line_big) / 2);
  lv_obj_t *close = button(this->root_, c, btn_h, btn_h);
  lv_obj_align(close, LV_ALIGN_TOP_RIGHT, 0, 0);
  lv_obj_center(label(close, big, c.text, "X"));
  on_part(close, this, "close");

  // The rest scrolls when it doesn't fit.
  lv_obj_t *body = lv_obj_create(this->root_);
  lv_obj_remove_style_all(body);
  lv_obj_set_pos(body, 0, btn_h + 8);
  lv_obj_set_size(body, inner_w, sh - this->top_ - 2 * pad - btn_h - 8);
  lv_obj_set_scroll_dir(body, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(body, LV_SCROLLBAR_MODE_OFF);
  lv_obj_set_flex_flow(body, wide ? LV_FLEX_FLOW_ROW : LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_column(body, gap, LV_PART_MAIN);
  lv_obj_set_style_pad_row(body, gap, LV_PART_MAIN);

  // Controls
  lv_obj_t *controls = box(body, col_w);
  lv_obj_set_flex_flow(controls, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(controls, 8, LV_PART_MAIN);
  lv_obj_t *row = box(controls, col_w);
  lv_obj_t *name = label(row, big, c.muted, "Brightness");
  {
    // Shown on every board; without a backlight the value is only logged (as ADR-0015's).
    this->brightness_value_ = label(row, big, c.text, "");
    lv_label_set_text_fmt(this->brightness_value_, "%d %%", this->state_.brightness);
    lv_obj_align(this->brightness_value_, LV_ALIGN_RIGHT_MID, 0, 0);
    lv_obj_t *track = box(controls, col_w);
    lv_obj_set_height(track, btn_h);
    this->slider_ = lv_slider_create(track);
    const int32_t knob = btn_h / 2;
    lv_obj_set_size(this->slider_, col_w - 2 * knob, btn_h / 4);
    lv_obj_center(this->slider_);
    lv_obj_set_ext_click_area(this->slider_, btn_h / 2);
    lv_slider_set_range(this->slider_, this->state_.min_brightness, 100);
    lv_slider_set_value(this->slider_, this->state_.brightness, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(this->slider_, c.tile, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(this->slider_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(this->slider_, c.accent, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(this->slider_, c.text, LV_PART_KNOB);
    lv_obj_set_style_pad_all(this->slider_, knob / 3, LV_PART_KNOB);
    lv_obj_set_style_shadow_width(this->slider_, 0, LV_PART_KNOB);
    // Live while dragged, saved when let go.
    lv_obj_add_event_cb(
        this->slider_,
        [](lv_event_t *e) {
          auto *self = static_cast<SettingsPanel *>(lv_event_get_user_data(e));
          self->pending_brightness_ = lv_slider_get_value(self->slider_);
        },
        LV_EVENT_VALUE_CHANGED, this);
    lv_obj_add_event_cb(
        this->slider_,
        [](lv_event_t *e) {
          auto *self = static_cast<SettingsPanel *>(lv_event_get_user_data(e));
          self->pending_brightness_ = lv_slider_get_value(self->slider_);
          self->brightness_done_ = true;
        },
        LV_EVENT_RELEASED, this);
  }
  lv_obj_set_height(row, line_big);
  lv_obj_align(name, LV_ALIGN_LEFT_MID, 0, 0);

  label(controls, big, c.muted, "Theme");
  lv_obj_t *choices = box(controls, col_w);
  lv_obj_set_height(choices, btn_h);
  const int32_t choice_w = (col_w - 2 * 8) / 3;
  for (int i = 0; i < 3; i++) {
    this->choices_[i] = button(choices, c, choice_w, btn_h);
    lv_obj_set_pos(this->choices_[i], i * (choice_w + 8), 0);
    lv_obj_center(label(this->choices_[i], big, c.text, CHOICE_TEXT[i]));
    on_part(this->choices_[i], this, CHOICE_PARTS[i]);
  }
  this->style_choices_();
  if (this->state_.can_sleep) {
    lv_obj_t *sleep = button(controls, c, col_w, btn_h);
    lv_obj_set_style_margin_top(sleep, 8, LV_PART_MAIN);
    lv_obj_center(label(sleep, big, c.text, "Screen off"));
    on_part(sleep, this, "sleep");
  }

  // Information: per section a heading, the names and the values (one label each, line by line).
  lv_obj_t *info = box(body, col_w);
  lv_obj_set_flex_flow(info, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(info, 4, LV_PART_MAIN);
  this->rows_.clear();
  if (this->fill_)
    this->fill_(this->rows_);
  this->sections_.clear();
  std::string names;
  lv_obj_t *block = nullptr;
  const auto finish = [&]() {
    if (block == nullptr)
      return;
    label(block, small, c.muted, names.c_str());
    lv_obj_t *values = label(block, small, c.text, "");
    lv_obj_set_style_text_align(values, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
    lv_obj_align(values, LV_ALIGN_TOP_RIGHT, 0, 0);
    this->sections_.back().values = values;
  };
  for (const InfoRow &r : this->rows_) {
    if (r.section != nullptr || block == nullptr) {
      finish();
      lv_obj_t *heading = label(info, small, c.accent, r.section != nullptr ? r.section : "");
      lv_obj_set_style_margin_top(heading, block == nullptr ? 0 : line_small / 2, LV_PART_MAIN);
      block = box(info, col_w);
      names.clear();
      this->sections_.push_back({nullptr, "", 0});
    }
    if (!names.empty())
      names += '\n';
    names += r.name;
    this->sections_.back().rows++;
  }
  finish();
  this->next_info_ms_ = 0;
  this->refresh_info_();
}

void SettingsPanel::refresh_info_() {
  if (!this->fill_ || this->sections_.empty())
    return;
  this->rows_.clear();
  this->fill_(this->rows_);
  const lv_font_t *small = this->fonts_.small;
  const int32_t width = lv_obj_get_width(lv_obj_get_parent(this->sections_.front().values));
  size_t r = 0;
  for (Section &s : this->sections_) {
    // The names are as wide as their widest line; a value gets the rest, shortened to fit.
    lv_obj_t *names = lv_obj_get_child(lv_obj_get_parent(s.values), 0);
    lv_obj_update_layout(names);
    const int32_t avail = width - lv_obj_get_width(names) - 16;
    std::string text;
    for (size_t i = 0; i < s.rows && r < this->rows_.size(); i++, r++) {
      std::string v = this->rows_[r].value;
      if (text_width(v.c_str(), small) > avail) {
        while (!v.empty() && text_width((v + "..").c_str(), small) > avail)
          v.pop_back();
        v += "..";
      }
      if (i > 0)
        text += '\n';
      text += v;
    }
    if (text != s.shown) {
      s.shown = text;
      lv_label_set_text(s.values, text.c_str());
    }
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
