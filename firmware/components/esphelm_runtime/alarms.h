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
  /// Bring the banner in front of whatever else is on the top layer (the history popup).
  void raise() {
    if (this->banner_ != nullptr)
      lv_obj_move_foreground(this->banner_);
  }
  /// Height the banner takes at the top of the screen (0 when hidden).
  int32_t height() const { return this->height_; }

 protected:
  struct Entry {
    std::string path;     // notifications.<...>, at most MAX_PATH characters
    std::string message;  // printable ASCII, at most MAX_MESSAGE characters
    Severity severity{Severity::NONE};
    bool sound{false};      // method includes "sound" now
    bool had_sound{false};  // ... when this state began; losing it later means acknowledged
    bool acked{false};
  };

  static constexpr size_t MAX_PATH = 96;
  static constexpr size_t MAX_MESSAGE = 64;

  void build_();
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
  bool dropped_logged_{false};
  int32_t height_{0};
  // What was drawn last, to redraw only on change.
  esphelm::Theme drawn_theme_{esphelm::Theme::DAY};
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
