#pragma once
// Brightness and day/night chosen on the display, in its settings panel (ADR-0025). Saved in
// flash (LayoutStore Slot::PREFS) and kept across reboots, until the layout brings different
// values for what was overridden: a change made in the editor wins. Plain C++ (no ESPHome, no
// LVGL), so firmware/test checks it with g++.

#include <cstdint>
#include <string>

#include "layout_model.h"

namespace esphelm {

struct DisplayPrefs {
  int8_t theme{-1};             // -1: the layout's (with autoTheme), else Theme
  int16_t brightness_day{-1};   // %; -1: the layout's
  int16_t brightness_night{-1};
  // The layout values the overrides were chosen against (kept equal to the current layout's
  // while an override stays; see reconcile_prefs()).
  Theme base_theme{Theme::DAY};
  AutoTheme base_auto{AutoTheme::OFF};
  uint8_t base_day{100};
  uint8_t base_night{30};

  bool empty() const { return this->theme < 0 && this->brightness_day < 0 && this->brightness_night < 0; }
  /// Record the layout the overrides are made against.
  void set_base(const Settings &s, Theme layout_theme);
};

/// Allowed brightness overrides (as settings.brightness in the schema).
static const int PREFS_MIN_DAY = 5;
static const int PREFS_MIN_NIGHT = 1;

/// "v=1;th=-1;bd=-1;bn=20;Bt=0;Ba=0;Bd=100;Bn=30"
std::string encode_prefs(const DisplayPrefs &p);
/// Strict: every field, in range, nothing else; false leaves `out` unchanged.
bool decode_prefs(const std::string &text, DisplayPrefs &out);
/// Drop the overrides made against other values than this layout's; true if any was dropped.
bool reconcile_prefs(DisplayPrefs &p, const Settings &s, Theme layout_theme);

}  // namespace esphelm
