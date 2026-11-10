#pragma once
// Settings and information panel (ADR-0025), opened by the footer's menu button, in three tabs:
// Settings (brightness, day/night/auto, sound on displays with a speaker, and "screen off"), Network (Wi-Fi and the SignalK server:
// forget them, choose another server; ADR-0026) and Info (what the display knows about itself,
// SignalK, its layout and its clock). Only the shown tab is built. Over the page and below the
// alarm banner, on LVGL's top layer, like the history popup; closed only by its close button. Not a
// widget: it belongs to the runtime and outlives page changes underneath it. Main loop only; its
// LVGL events only record what was pressed, the runtime applies it after tick().
// Memory: about 20 LVGL objects while the Settings tab is open, about 30 for Network (with the
// setup network's QR code: one image of a few KB) and for Info (each section is four), none when
// closed.

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
    // Sound (ADR-0033): shown only on displays with a speaker.
    bool sound{false};
    int volume{60};  // %
    bool touch_sounds{true};
    // Network tab (ADR-0026)
    bool wifi{false};          // the board has Wi-Fi (not the host build)
    bool ap_active{false};     // the setup network is up
    std::string ap_ssid;
    std::string ap_password;
    bool server_choice{false};  // the server is found with mDNS, not set in the firmware
    bool scanning{false};       // a search for servers is running
    std::vector<std::string> servers;  // what the last search found, as shown
  };

  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }
  /// Fills the rows of the Info tab, or of the Network tab (`network`); called when the tab is
  /// built and once a second while it shows. A tab always gets as many rows.
  void set_info(std::function<void(std::vector<InfoRow> &, bool network)> fill) { this->fill_ = std::move(fill); }

  void open(const State &state, int32_t top);
  void close();
  bool is_open() const { return this->root_ != nullptr; }

  /// Test hook and the buttons: "close", "tab-settings", "tab-network", "tab-info", "day",
  /// "night", "auto", "sleep", "brightness=<1-100>" (the slider let go there), "volume=<10-100>",
  /// "touch-sounds" (switch them over), "factory-reset",
  /// "forget-server", "change-server", "server=<n>" (in the list), "confirm" and "cancel".
  /// Applied in tick().
  void tap(const std::string &part);
  /// Follow the state (rebuilt for another theme) and the banner, refresh the information once a
  /// second. True if the panel was built anew (the banner must go in front).
  bool tick(uint32_t now, const State &state, int32_t top);

  // What was pressed, for the runtime to apply after tick(); each is reported once.
  bool take_close() { return take(this->closed_); }
  bool take_choice(int8_t &choice);
  /// The slider moved (live) or was let go there (`done`: save it).
  bool take_brightness(int &percent, bool &done);
  /// The volume slider moved (live) or was let go there (`done`: save it, play a click).
  bool take_volume(int &percent, bool &done);
  /// Touch sounds switched on or off.
  bool take_touch_sounds(bool &on);
  bool take_sleep() { return take(this->sleep_wanted_); }
  /// Confirmed: a factory reset (ESPHome's, then a restart), or forget the SignalK server.
  bool take_factory_reset() { return take(this->factory_reset_); }
  bool take_forget_server() { return take(this->forget_server_); }
  /// "Change server" was pressed: search for servers.
  bool take_scan() { return take(this->scan_wanted_); }
  /// A server of the list was picked (its index in State::servers).
  bool take_server(int &index);

 protected:
  static bool take(bool &flag) {
    const bool was = flag;
    flag = false;
    return was;
  }
  void build_();
  void build_settings_(lv_obj_t *body, int32_t w, int32_t btn_h);
  void build_network_(lv_obj_t *body, int32_t w, int32_t btn_h, int32_t line_small);
  void build_info_(lv_obj_t *body, int32_t w, int32_t line_small);
  /// The rows of the shown tab, a block per section; `after` adds controls below a section.
  void build_rows_(lv_obj_t *body, int32_t w, int32_t line_small,
                   const std::function<void(const char *section)> &after);
  void build_setup_network_(lv_obj_t *body, int32_t w);
  /// The question and a Yes / Cancel row; returns the row.
  lv_obj_t *build_confirm_(lv_obj_t *body, int32_t w, int32_t btn_h, const char *question);
  void refresh_info_();
  void style_choices_();

  enum class Tab : uint8_t { SETTINGS, NETWORK, INFO };
  /// A forget waiting for "Yes".
  enum class Confirm : uint8_t { NONE, FACTORY_RESET, SERVER };

  Fonts fonts_;
  Tab tab_{Tab::SETTINGS};  // shown; only its objects exist
  int8_t pending_tab_{-1};
  std::function<void(std::vector<InfoRow> &, bool)> fill_;
  State state_;
  int32_t top_{0};
  uint32_t next_info_ms_{0};

  bool pending_close_{false};
  bool closed_{false};
  int8_t pending_choice_{-2};  // -2: none
  int pending_brightness_{-1};
  bool brightness_done_{false};
  int pending_volume_{-1};
  bool volume_done_{false};
  int8_t pending_touch_{-1};
  bool sleep_wanted_{false};
  // Network tab: what it shows (changed in tap(), rebuilt in tick()) and what was confirmed.
  Confirm confirm_{Confirm::NONE};
  bool listing_{false};  // the server list instead of the server buttons
  bool network_dirty_{false};
  bool factory_reset_{false};
  bool forget_server_{false};
  bool scan_wanted_{false};
  int chosen_server_{-1};

  lv_obj_t *root_{nullptr};
  lv_obj_t *brightness_value_{nullptr};
  lv_obj_t *slider_{nullptr};
  lv_obj_t *volume_value_{nullptr};
  lv_obj_t *volume_slider_{nullptr};
  lv_obj_t *choices_[4]{};  // day, dark, night, auto
  lv_obj_t *tabs_[3]{};     // settings, network, info
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
