#pragma once
// Settings and information panel (ADR-0025), opened by the footer's menu button, in two tabs:
// Settings (brightness, day/night/auto and "screen off") and Info (what the display knows about
// itself, the network, SignalK, its layout and its clock). Only the shown tab is built. Over the page and below the alarm banner, on
// LVGL's top layer, like the history popup; closed only by its close button. Not a widget: it
// belongs to the runtime and outlives page changes underneath it. Main loop only; its LVGL events
// only record what was pressed, the runtime applies it after tick().
// Memory: about 20 LVGL objects while the Settings tab is open, about 30 for Info (each section
// is four), none when closed.

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "lvgl.h"
#include "layout_model.h"
#include "widgets.h"

namespace esphome {
namespace esphelm_runtime {

/// One line of the information side; `section` starts a new block with that heading.
struct InfoRow {
  const char *section;  // nullptr: same block as the row before
  const char *name;
  std::string value;
};

class SettingsPanel {
 public:
  /// What the controls show.
  struct State {
    esphelm::Theme theme{esphelm::Theme::DAY};  // shown
    int8_t choice{-1};                          // -1 auto, else Theme
    int brightness{100};                        // % of the shown theme
    int min_brightness{1};
    bool can_sleep{false};  // the layout has a screen timeout
  };

  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }
  /// Fills the information rows; called when the panel opens and once a second while it is open.
  void set_info(std::function<void(std::vector<InfoRow> &)> fill) { this->fill_ = std::move(fill); }

  void open(const State &state, int32_t top);
  void close();
  bool is_open() const { return this->root_ != nullptr; }

  /// Test hook and the buttons: "close", "tab-settings", "tab-info", "day", "night", "auto",
  /// "sleep", or "brightness=<1-100>" (the slider let go there). Applied in tick().
  void tap(const std::string &part);
  /// Follow the state (rebuilt for another theme) and the banner, refresh the information once a
  /// second. True if the panel was built anew (the banner must go in front).
  bool tick(uint32_t now, const State &state, int32_t top);

  // What was pressed, for the runtime to apply after tick(); each is reported once.
  bool take_close() { return take(this->closed_); }
  bool take_choice(int8_t &choice);
  /// The slider moved (live) or was let go there (`done`: save it).
  bool take_brightness(int &percent, bool &done);
  bool take_sleep() { return take(this->sleep_wanted_); }

 protected:
  static bool take(bool &flag) {
    const bool was = flag;
    flag = false;
    return was;
  }
  void build_();
  void build_settings_(lv_obj_t *body, int32_t w, int32_t btn_h);
  void build_info_(lv_obj_t *body, int32_t w, int32_t line_small);
  void refresh_info_();
  void style_choices_();

  enum class Tab : uint8_t { SETTINGS, INFO };

  Fonts fonts_;
  Tab tab_{Tab::SETTINGS};  // shown; only its objects exist
  int8_t pending_tab_{-1};
  std::function<void(std::vector<InfoRow> &)> fill_;
  State state_;
  int32_t top_{0};
  uint32_t next_info_ms_{0};

  bool pending_close_{false};
  bool closed_{false};
  int8_t pending_choice_{-2};  // -2: none
  int pending_brightness_{-1};
  bool brightness_done_{false};
  bool sleep_wanted_{false};

  lv_obj_t *root_{nullptr};
  lv_obj_t *brightness_value_{nullptr};
  lv_obj_t *slider_{nullptr};
  lv_obj_t *choices_[3]{};  // day, night, auto
  lv_obj_t *tabs_[2]{};     // settings, info
  struct Section {
    lv_obj_t *values;
    std::string shown;
    size_t rows;
  };
  std::vector<Section> sections_;
  std::vector<InfoRow> rows_;
};

}  // namespace esphelm_runtime
}  // namespace esphome
