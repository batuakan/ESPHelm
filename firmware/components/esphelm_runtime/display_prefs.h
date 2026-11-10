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
  /// Day or Dark last picked on the display: the theme shown when it isn't night (ADR-0034).
  int8_t day_side{-1};  // -1: the layout's
  int16_t brightness_day{-1};   // %; -1: the layout's
  int16_t brightness_night{-1};
  int16_t volume{-1};  // %; -1: the layout's (ADR-0033)
  int8_t touch{-1};    // touch clicks 0/1; -1: the layout's
  // The layout values the overrides were chosen against (kept equal to the current layout's
  // while an override stays; see reconcile_prefs()).
  Theme base_theme{Theme::DAY};
  AutoTheme base_auto{AutoTheme::OFF};
  uint8_t base_day{100};
  uint8_t base_night{30};
  uint8_t base_volume{60};
  bool base_touch{true};

  bool empty() const {
    return this->theme < 0 && this->day_side < 0 && this->brightness_day < 0 && this->brightness_night < 0 &&
           this->volume < 0 && this->touch < 0;
  }
  /// Record the layout the overrides are made against.
  void set_base(const Settings &s, Theme layout_theme);
};

/// Allowed brightness overrides (as settings.brightness in the schema).
static const int PREFS_MIN_DAY = 5;
static const int PREFS_MIN_NIGHT = 1;
/// Allowed volume overrides (as settings.sound.volume).
static const int PREFS_MIN_VOLUME = 10;

/// "v=3;th=-1;ds=-1;bd=-1;bn=20;vo=-1;to=-1;Bt=0;Ba=0;Bd=100;Bn=30;Bv=60;Bo=1"
std::string encode_prefs(const DisplayPrefs &p);
/// Strict: every field, in range, nothing else; false leaves `out` unchanged. Also reads the
/// version 2 record written before the dark theme (no ds, themes day and night only) and the
/// version 1 record written before sound (no vo, to, Bv, Bo either), with no such overrides.
bool decode_prefs(const std::string &text, DisplayPrefs &out);
/// Drop the overrides made against other values than this layout's; true if any was dropped.
bool reconcile_prefs(DisplayPrefs &p, const Settings &s, Theme layout_theme);

}  // namespace esphelm
