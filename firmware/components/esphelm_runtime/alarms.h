#pragma once
// Alarm banner (Phase 6, ADR-0014): active SignalK notifications (notifications.*) shown on
// LVGL's top layer, above every page, with an ACK button that asks the plugin to silence the
// alarm. Not a widget: it belongs to the runtime and works with any layout, or none.
// Main loop only. Memory: a fixed table of entries (16 with PSRAM, 8 without; under 200 bytes
// each) and six LVGL objects created on the first alarm.

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include <ArduinoJson.h>

#include "lvgl.h"
#include "layout_model.h"
#include "widgets.h"

namespace esphome {
namespace esphelm_runtime {

class AlarmBanner {
 public:
  /// SignalK alarm states above normal, in rising severity.
  enum class Severity : uint8_t { NONE, ALERT, WARN, ALARM, EMERGENCY };

  /// An active notification, as alarms tiles read it (ADR-0038).
  struct Entry {
    std::string path;     // notifications.<...>, at most MAX_PATH characters
    std::string message;  // printable ASCII, at most MAX_MESSAGE characters
    Severity severity{Severity::NONE};
    bool sound{false};      // method includes "sound" now
    bool had_sound{false};  // ... when this state began; losing it later means acknowledged
    bool acked{false};
    uint32_t since_ms{0};   // millis() when this state began
  };

  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }
  void set_capacity(size_t entries) { this->capacity_ = entries; }
  /// Sends the acknowledge for a notification path; false when it can't be sent now.
  void set_ack_sender(std::function<bool(const std::string &path)> send) { this->send_ = std::move(send); }

  /// A value of some notifications.* path.
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst value);
  /// The plugin's answer to the last acknowledge (HTTP status, 0 = no answer).
  void ack_result(int status);
  /// Test hook and touch: "" cycles through the alarms, "ack" acknowledges the one shown.
  void tap(const std::string &part);
  /// Redraws when something changed. `online`: values are live; `can_ack`: the plugin is reachable.
  void tick(esphelm::Theme theme, bool online, bool can_ack);

  /// True once after an alarm or emergency appeared or escalated (wakes the screen).
  bool take_wake() {
    bool w = this->wake_;
    this->wake_ = false;
    return w;
  }
  size_t active() const { return this->entries_.size(); }
  /// The worst state among notifications asking for sound (method "sound") that are not yet
  /// acknowledged; NONE when there is none (ADR-0033).
  Severity sound_level() const;
  /// Counts up whenever a notification starts asking for sound: new, in a new state, or sound
  /// added again. A new count plays its tune again.
  uint32_t sound_generation() const { return this->sound_generation_; }
  /// Bring the banner in front of whatever else is on the top layer (the history popup).
  void raise() {
    if (this->banner_ != nullptr)
      lv_obj_move_foreground(this->banner_);
  }
  /// Height the banner takes at the top of the screen (0 when hidden).
  int32_t height() const { return this->height_; }

  // For alarms tiles (ADR-0038): the table, read-only, and acknowledging one of its alarms.
  const std::vector<Entry> &entries() const { return this->entries_; }
  /// Counts up whenever the table changes (an alarm comes, goes, changes, is acknowledged).
  uint32_t version() const { return this->version_; }
  /// The path whose acknowledge is in flight; empty when none.
  const std::string &pending() const { return this->pending_; }
  /// Values are live, and the plugin can take an acknowledge now (as of the last tick).
  bool online() const { return this->online_; }
  bool can_ack() const { return this->can_ack_ && this->pending_.empty(); }
  /// Acknowledges the alarm at `path`, as the banner's ACK does; false when it can't be sent now.
  bool ack(const std::string &path);
  /// A state's colour (the theme's zone colours, red shades at night) and its name ("WARN").
  static lv_color_t colour(Severity s, const Colors &c);
  static const char *name(Severity s);

 protected:
  static constexpr size_t MAX_PATH = 96;
  static constexpr size_t MAX_MESSAGE = 64;

  void build_();
  void changed_() {
    this->dirty_ = true;
    this->version_++;
  }
  void ack_shown_();
  /// Unacknowledged entries, worst first (indices into entries_).
  std::vector<size_t> unacked_() const;
  const Entry *shown_entry_() const;

  Fonts fonts_;
  size_t capacity_{8};
  std::function<bool(const std::string &)> send_;
  std::vector<Entry> entries_;
  size_t cycle_{0};          // which unacknowledged alarm is shown
  std::string pending_;      // path of the acknowledge in flight
  bool dirty_{true};
  bool wake_{false};
  uint32_t sound_generation_{0};
  uint32_t version_{0};
  bool online_{true};
  bool can_ack_{false};
  bool dropped_logged_{false};
  int32_t height_{0};
  // What was drawn last, to redraw only on change.
  esphelm::Theme drawn_theme_{esphelm::Theme::DAY};
  int32_t drawn_width_{0};
  bool drawn_online_{true};
  bool drawn_can_ack_{true};

  lv_obj_t *banner_{nullptr};
  lv_obj_t *text_{nullptr};
  lv_obj_t *count_{nullptr};
  lv_obj_t *ack_{nullptr};
  lv_obj_t *ack_label_{nullptr};
};

}  // namespace esphelm_runtime
}  // namespace esphome
