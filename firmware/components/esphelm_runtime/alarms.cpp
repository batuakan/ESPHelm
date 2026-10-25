#include "alarms.h"

#include <algorithm>
#include <cstring>

#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.alarms";

using Severity = AlarmBanner::Severity;

static Severity severity_of(const char *state) {
  if (std::strcmp(state, "alert") == 0)
    return Severity::ALERT;
  if (std::strcmp(state, "warn") == 0)
    return Severity::WARN;
  if (std::strcmp(state, "alarm") == 0)
    return Severity::ALARM;
  if (std::strcmp(state, "emergency") == 0)
    return Severity::EMERGENCY;
  return Severity::NONE;  // normal, nominal, anything else
}

static const char *state_name(Severity s) {
  switch (s) {
    case Severity::ALERT:
      return "ALERT";
    case Severity::WARN:
      return "WARN";
    case Severity::ALARM:
      return "ALARM";
    case Severity::EMERGENCY:
      return "EMERGENCY";
    default:
      return "";
  }
}

/// Banner colour: the theme's zone colours (red shades at night).
static lv_color_t colour_of(Severity s, const Colors &c) {
  switch (s) {
    case Severity::ALERT:
      return c.accent;
    case Severity::WARN:
      return c.zone[1];
    case Severity::ALARM:
      return c.zone[2];
    default:
      return c.zone[3];
  }
}

void AlarmBanner::on_value(const std::string &path, ArduinoJson::JsonVariantConst value) {
  Severity sev = Severity::NONE;
  bool sound = false;
  const char *message = "";
  if (value.is<ArduinoJson::JsonObjectConst>()) {
    const char *state = value["state"] | "";
    sev = severity_of(state);
    for (ArduinoJson::JsonVariantConst m : value["method"].as<ArduinoJson::JsonArrayConst>())
      sound = sound || (m.is<const char *>() && std::strcmp(m.as<const char *>(), "sound") == 0);
    message = value["message"] | "";
  }
  auto it = std::find_if(this->entries_.begin(), this->entries_.end(),
                         [&](const Entry &e) { return e.path.compare(0, MAX_PATH, path, 0, MAX_PATH) == 0; });
  if (sev == Severity::NONE) {
    if (it != this->entries_.end()) {
      ESP_LOGI(TAG, "%s cleared", it->path.c_str());
      if (this->pending_ == it->path)
        this->pending_.clear();
      this->entries_.erase(it);
      this->dirty_ = true;
    }
    return;
  }
  std::string text = printable(message);
  if (text.size() > MAX_MESSAGE)
    text.resize(MAX_MESSAGE);
  if (it == this->entries_.end()) {
    if (this->entries_.size() >= this->capacity_) {
      // Full: the least severe entry makes room for a worse one; otherwise the new one is dropped.
      auto least = std::min_element(this->entries_.begin(), this->entries_.end(),
                                    [](const Entry &a, const Entry &b) { return a.severity < b.severity; });
      if (least->severity >= sev) {
        if (!this->dropped_logged_)
          ESP_LOGW(TAG, "Alarm table full (%u); not showing %s", (unsigned) this->capacity_, path.c_str());
        this->dropped_logged_ = true;
        return;
      }
      this->entries_.erase(least);
    }
    Entry e;
    e.path = path.substr(0, MAX_PATH);
    e.severity = sev;
    e.sound = e.had_sound = sound;
    e.message = std::move(text);
    ESP_LOGW(TAG, "%s %s: %s", state_name(sev), e.path.c_str(), e.message.c_str());
    if (sev >= Severity::ALARM)
      this->wake_ = true;
    this->entries_.push_back(std::move(e));
    this->dirty_ = true;
    return;
  }
  Entry &e = *it;
  if (e.severity != sev) {
    // A new state: escalations (or a change back down) need a new acknowledgement.
    ESP_LOGW(TAG, "%s %s: %s", state_name(sev), e.path.c_str(), text.c_str());
    if (sev > e.severity && sev >= Severity::ALARM)
      this->wake_ = true;
    e.severity = sev;
    e.acked = false;
    e.had_sound = sound;
    this->dirty_ = true;
  } else if (e.had_sound && !sound && !e.acked) {
    // Same state, sound removed: acknowledged by this or another display, or another app.
    ESP_LOGI(TAG, "%s acknowledged", e.path.c_str());
    e.acked = true;
    this->dirty_ = true;
  }
  e.sound = sound;
  if (e.message != text) {
    e.message = std::move(text);
    this->dirty_ = true;
  }
}

void AlarmBanner::ack_result(int status) {
  if (this->pending_.empty())
    return;
  for (auto &e : this->entries_) {
    // 404: the server has no active alarm there any more; nothing left to acknowledge.
    if (e.path == this->pending_ && (status == 200 || status == 404))
      e.acked = true;
  }
  if (status != 200 && status != 404)
    ESP_LOGW(TAG, "Acknowledge of %s failed (HTTP %d)", this->pending_.c_str(), status);
  this->pending_.clear();
  this->dirty_ = true;
}

std::vector<size_t> AlarmBanner::unacked_() const {
  std::vector<size_t> out;
  for (size_t i = 0; i < this->entries_.size(); i++) {
    if (!this->entries_[i].acked)
      out.push_back(i);
  }
  std::stable_sort(out.begin(), out.end(), [this](size_t a, size_t b) {
    return this->entries_[a].severity > this->entries_[b].severity;
  });
  return out;
}

const AlarmBanner::Entry *AlarmBanner::shown_entry_() const {
  std::vector<size_t> open = this->unacked_();
  if (open.empty())
    return nullptr;
  return &this->entries_[open[this->cycle_ % open.size()]];
}

void AlarmBanner::ack_shown_() {
  const Entry *e = this->shown_entry_();
  if (e == nullptr || !this->pending_.empty() || !this->send_)
    return;
  if (this->send_(e->path)) {
    ESP_LOGI(TAG, "Acknowledging %s", e->path.c_str());
    this->pending_ = e->path;
    this->dirty_ = true;
  }
}

void AlarmBanner::tap(const std::string &part) {
  if (part == "ack") {
    this->ack_shown_();
  } else {
    this->cycle_++;
    this->dirty_ = true;
  }
}

void AlarmBanner::build_() {
  lv_obj_t *layer = lv_layer_top();
  this->banner_ = lv_obj_create(layer);
  lv_obj_remove_style_all(this->banner_);
  lv_obj_set_style_bg_opa(this->banner_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(this->banner_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_hor(this->banner_, 12, LV_PART_MAIN);
  lv_obj_set_width(this->banner_, lv_pct(100));
  lv_obj_align(this->banner_, LV_ALIGN_TOP_MID, 0, 0);
  lv_obj_remove_flag(this->banner_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(this->banner_, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(
      this->banner_, [](lv_event_t *ev) { static_cast<AlarmBanner *>(lv_event_get_user_data(ev))->tap(""); },
      LV_EVENT_CLICKED, this);

  this->text_ = lv_label_create(this->banner_);
  lv_label_set_long_mode(this->text_, LV_LABEL_LONG_MODE_DOTS);
  lv_obj_align(this->text_, LV_ALIGN_LEFT_MID, 0, 0);

  this->count_ = lv_label_create(this->banner_);

  this->ack_ = lv_button_create(this->banner_);
  lv_obj_set_style_radius(this->ack_, 8, LV_PART_MAIN);
  lv_obj_set_style_shadow_width(this->ack_, 0, LV_PART_MAIN);
  // Keep our colours when disabled (the default theme greys disabled buttons out).
  lv_obj_set_style_recolor_opa(this->ack_, LV_OPA_TRANSP, LV_STATE_DISABLED);
  lv_obj_align(this->ack_, LV_ALIGN_RIGHT_MID, 0, 0);
  this->ack_label_ = lv_label_create(this->ack_);
  lv_label_set_text(this->ack_label_, "ACK");
  lv_obj_center(this->ack_label_);
  lv_obj_add_event_cb(
      this->ack_, [](lv_event_t *ev) { static_cast<AlarmBanner *>(lv_event_get_user_data(ev))->ack_shown_(); },
      LV_EVENT_CLICKED, this);
}

void AlarmBanner::tick(esphelm::Theme theme, bool online, bool can_ack) {
  if (theme != this->drawn_theme_ || online != this->drawn_online_ || can_ack != this->drawn_can_ack_)
    this->dirty_ = true;
  if (!this->dirty_)
    return;
  this->dirty_ = false;
  this->drawn_theme_ = theme;
  this->drawn_online_ = online;
  this->drawn_can_ack_ = can_ack;

  if (this->entries_.empty()) {
    if (this->banner_ != nullptr)
      lv_obj_add_flag(this->banner_, LV_OBJ_FLAG_HIDDEN);
    this->height_ = 0;
    return;
  }
  if (this->banner_ == nullptr)
    this->build_();
  lv_obj_remove_flag(this->banner_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(this->banner_);

  const Colors colors = colors_for(theme);
  const bool night = theme == esphelm::Theme::NIGHT;
  // Red-on-black at night keeps night vision: dark band, coloured text.
  const lv_color_t ink = night ? lv_color_hex(0x000000) : lv_color_hex(0xFFFFFF);
  const std::vector<size_t> open = this->unacked_();
  const char *offline = online ? "" : "  (offline)";
  char buf[MAX_MESSAGE + MAX_PATH + 48];

  if (open.empty()) {
    // Everything acknowledged: a thin strip in the worst state's colour.
    Severity worst = Severity::NONE;
    for (const auto &e : this->entries_)
      worst = std::max(worst, e.severity);
    const lv_font_t *font = this->fonts_.small;
    this->height_ = lv_font_get_line_height(font) + 8;
    lv_obj_set_height(this->banner_, this->height_);
    lv_obj_set_style_bg_color(this->banner_, night ? lv_color_hex(0x000000) : colour_of(worst, colors),
                              LV_PART_MAIN);
    lv_obj_set_style_border_side(this->banner_, LV_BORDER_SIDE_BOTTOM, LV_PART_MAIN);
    lv_obj_set_style_border_width(this->banner_, night ? 1 : 0, LV_PART_MAIN);
    lv_obj_set_style_border_color(this->banner_, colour_of(worst, colors), LV_PART_MAIN);
    lv_obj_set_style_text_font(this->text_, font, LV_PART_MAIN);
    lv_obj_set_style_text_color(this->text_, night ? colour_of(worst, colors) : ink, LV_PART_MAIN);
    if (this->entries_.size() == 1) {
      const Entry &e = this->entries_.front();
      std::snprintf(buf, sizeof(buf), "%s (ack): %s%s", state_name(e.severity),
                    e.message.empty() ? e.path.c_str() + std::strlen("notifications.") : e.message.c_str(), offline);
    } else {
      std::snprintf(buf, sizeof(buf), "%u alarms acknowledged%s", (unsigned) this->entries_.size(), offline);
    }
    lv_label_set_text(this->text_, buf);
    lv_obj_set_size(this->text_, lv_pct(100), lv_font_get_line_height(font));
    lv_obj_add_flag(this->count_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(this->ack_, LV_OBJ_FLAG_HIDDEN);
    return;
  }

  const Entry &e = this->entries_[open[this->cycle_ % open.size()]];
  const lv_font_t *font = this->fonts_.label;
  const int32_t line = lv_font_get_line_height(font);
  this->height_ = line + 28;
  lv_obj_set_height(this->banner_, this->height_);
  const lv_color_t band = night ? lv_color_hex(0x000000) : colour_of(e.severity, colors);
  const lv_color_t text = night ? colour_of(e.severity, colors) : ink;
  lv_obj_set_style_bg_color(this->banner_, band, LV_PART_MAIN);
  lv_obj_set_style_border_side(this->banner_, LV_BORDER_SIDE_BOTTOM, LV_PART_MAIN);
  lv_obj_set_style_border_width(this->banner_, night ? 2 : 0, LV_PART_MAIN);
  lv_obj_set_style_border_color(this->banner_, text, LV_PART_MAIN);

  lv_obj_set_style_text_font(this->text_, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(this->text_, text, LV_PART_MAIN);
  std::snprintf(buf, sizeof(buf), "%s  %s%s", state_name(e.severity),
                e.message.empty() ? e.path.c_str() + std::strlen("notifications.") : e.message.c_str(), offline);
  lv_label_set_text(this->text_, buf);

  // ACK button, then the "+N" count left of it; the text gets the rest.
  lv_obj_remove_flag(this->ack_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_set_size(this->ack_, LV_SIZE_CONTENT, line + 12);
  lv_obj_set_style_pad_hor(this->ack_, 14, LV_PART_MAIN);
  lv_obj_set_style_bg_color(this->ack_, text, LV_PART_MAIN);
  lv_obj_set_style_text_font(this->ack_label_, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(this->ack_label_, band, LV_PART_MAIN);
  const bool waiting = !this->pending_.empty();
  lv_label_set_text(this->ack_label_, waiting ? "..." : "ACK");
  if (can_ack && !waiting) {
    lv_obj_remove_state(this->ack_, LV_STATE_DISABLED);
    lv_obj_set_style_bg_opa(this->ack_, LV_OPA_COVER, LV_PART_MAIN);
  } else {
    lv_obj_add_state(this->ack_, LV_STATE_DISABLED);
    lv_obj_set_style_bg_opa(this->ack_, LV_OPA_50, LV_PART_MAIN);
  }
  lv_obj_update_layout(this->banner_);
  const int32_t ack_w = lv_obj_get_width(this->ack_);

  int32_t count_w = 0;
  if (open.size() > 1) {
    std::snprintf(buf, sizeof(buf), "+%u", (unsigned) (open.size() - 1));
    lv_label_set_text(this->count_, buf);
    lv_obj_set_style_text_font(this->count_, font, LV_PART_MAIN);
    lv_obj_set_style_text_color(this->count_, text, LV_PART_MAIN);
    lv_obj_remove_flag(this->count_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(this->count_, LV_ALIGN_RIGHT_MID, -(ack_w + 12), 0);
    lv_obj_update_layout(this->count_);
    count_w = lv_obj_get_width(this->count_) + 12;
  } else {
    lv_obj_add_flag(this->count_, LV_OBJ_FLAG_HIDDEN);
  }
  const int32_t inner = lv_obj_get_content_width(this->banner_);
  // One line, cut with "..." (dots need a fixed height).
  lv_obj_set_size(this->text_, std::max<int32_t>(40, inner - ack_w - count_w - 12), line);
}

}  // namespace esphelm_runtime
}  // namespace esphome
