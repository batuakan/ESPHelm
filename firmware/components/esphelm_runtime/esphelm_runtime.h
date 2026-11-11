#pragma once
// esphelm_runtime: renders layouts served by the signalk-esphelm plugin (docs/firmware-runtime.md).
//
// Boot: show the cached layout (current, else last-known-good), else a status page; a layout
// that crashed the display is skipped (boot guard, ADR-0013).
// Online: hello -> learn state -> fetch the layout with If-None-Match when its version
// (plugins.esphelm.<id>.version) differs -> validate -> render -> persist.
// All LVGL work happens in loop(); HTTP runs on LayoutClient's worker.

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "esphome/components/font/font.h"
#include "esphome/components/signalk/signalk.h"
#include "esphome/core/component.h"
#include "esphome/core/defines.h"
#ifdef USE_ESPHELM_BACKLIGHT
#include "esphome/components/light/light_state.h"
#endif
#ifdef USE_ESPHELM_TIME
#include "esphome/components/time/real_time_clock.h"
#endif
#ifdef USE_ESPHELM_ROTATION
#include "esphome/components/lvgl/lvgl_esphome.h"
#endif
#ifdef USE_WIFI
#include "esphome/components/wifi/wifi_component.h"
#endif
#ifdef USE_NETWORK
#include "esphome/components/network/util.h"
#endif

#include "alarms.h"
#include "chart_store.h"
#include "display_prefs.h"
#include "esphelm_mono.h"
#include "esphelm_server_zones.h"
#include "history_popup.h"
#include "layout_client.h"
#include "layout_model.h"
#include "layout_parser.h"
#include "layout_store.h"
#include "renderer.h"
#include "settings_panel.h"
#include "sound.h"
#include "value_history.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const FIRMWARE_VERSION = "0.4.0";

class EsphelmRuntime : public Component {
 public:
  void set_signalk(signalk::SignalK *signalk) { this->signalk_ = signalk; }
  void set_container(lv_obj_t *container) { this->renderer_.set_container(container); }
  void set_fonts(font::Font *value, font::Font *label, font::Font *small) {
    this->fonts_.value = value->get_lv_font();
    this->fonts_.label = label->get_lv_font();
    this->fonts_.small = small->get_lv_font();
    for (font::Font *f : {value, label, small})
      this->fonts_.add(f->get_lv_font());
  }
  /// One more size for tile text to pick from (fonts.extra).
  void add_font(font::Font *extra) { this->fonts_.add(extra->get_lv_font()); }
  /// A size with only the digits, "." and "-" (fonts.digits), for value tile numbers.
  void add_digit_font(font::Font *digits) { this->fonts_.add(digits->get_lv_font(), true); }
  void set_board(const std::string &board) { this->board_ = board; }
  void set_touch(bool touch) { this->touch_ = touch; }
  void set_stale_after(uint32_t ms) { this->stale_after_ms_ = ms; }
  void set_max_layout_bytes(size_t bytes) { this->max_layout_bytes_ = bytes; }
  void set_store_dir(const std::string &dir) { this->store_.set_dir(dir); }
#ifdef USE_ESPHELM_BACKLIGHT
  void set_backlight(light::LightState *backlight) { this->backlight_ = backlight; }
#endif
#ifdef USE_ESPHELM_TIME
  void set_time(time::RealTimeClock *time) { this->time_ = time; }
#endif
#ifdef USE_ESPHELM_SOUND
  /// Alarm tones and touch clicks (ADR-0033).
  void set_sound_rtttl(rtttl::Rtttl *rtttl) { this->sound_.set_rtttl(rtttl); }
#ifdef USE_SPEAKER
  void set_sound_speaker(speaker::Speaker *speaker) { this->sound_.set_speaker(speaker); }
#endif
  /// 0: the touch click, 1..4: alert, warn, alarm, emergency.
  void set_sound_tune(int index, const std::string &tune) {
    this->sound_.set_tune(static_cast<esphelm::sound::Level>(index), tune);
  }
#endif
#ifdef USE_ESPHELM_ROTATION
  /// ESPHome's LVGL, which turns the picture (and touch) at runtime (`lvgl: rotation:` set).
  void set_lvgl(lvgl::LvglComponent *lvgl) { this->lvgl_ = lvgl; }
#endif

  void setup() override;
  void loop() override;

  /// Show page `index` of the current layout (also the footer buttons' target and a test hook).
  void show_page(size_t index);
  /// Act as if the tile with this id (and its button `part`, if any) was tapped (test hook). Also
  /// for hardware buttons on displays without touch: "@next" (the next page, round), "@theme"
  /// (day/night), "@alarm" "ack" (acknowledge the alarm shown).
  void tap(const std::string &tile_id, const std::string &part = "");
  /// Host build: the process is exiting normally, so a pending boot attempt was no crash.
  void clean_exit();
  void dump_config() override;
  // After LVGL (setup_priority::PROCESSOR) has created the display and our container.
  float get_setup_priority() const override { return setup_priority::PROCESSOR - 10; }

 protected:
  enum class ServerState : uint8_t { UNKNOWN, PENDING, NO_LAYOUT, ADOPTED };

  void handle_result_(HttpResult &result);
  void handle_hello_(const HttpResult &result);
  void handle_layout_(const HttpResult &result);
  bool apply_(const std::string &body, const std::string &etag, bool persist, const char *origin);
  void clear_layout_();
  bool build_page_(size_t index);
  void subscribe_page_();
  void on_value_(const std::string &path, ArduinoJson::JsonVariantConst value);
  void configure_history_();
  /// Open the popup for a tile's recorded values, on `key` if it is one of them; false if none.
  bool open_history_(const std::string &tile_id, const std::string &key = "");
  const esphelm::Tile *find_tile_(const std::string &id) const;
  // Zones from the server's metadata (ADR-0020)
  void on_meta_changed_(const std::string &path);
  bool on_visible_page_(const std::string &path) const;
  void queue_meta_reads_();
  void pump_meta_(uint32_t now, bool ready);
  void handle_meta_(const HttpResult &result);
  bool apply_server_zones_();
  void update_status_();
  void show_status_(const std::string &headline, const std::string &detail, const std::string &qr = "");
  void send_hello_();
  void send_fetch_();
  std::string base_url_() const;
  void compute_capacity_();
  void check_boot_record_(const std::string &cached_etag);
  void save_boot_record_();
  // Display settings (ADR-0015)
  esphelm::Theme effective_theme_() const;
  /// What "auto" shows: the layout's theme; with autoTheme, night by environment.sun and the
  /// day-side theme otherwise (ADR-0034). `day_side` as DisplayPrefs::day_side.
  esphelm::Theme automatic_theme_(int8_t day_side) const;
  esphelm::Theme automatic_theme_() const { return this->automatic_theme_(this->prefs_.day_side); }
  /// The theme shown when it isn't night: day or dark as last picked here, else the layout's.
  esphelm::Theme day_side_theme_(int8_t day_side) const;
  /// The footer's theme button: night, or back to the day-side theme.
  void toggle_theme_();
  /// -1: the layout's theme (autoTheme), else a Theme chosen on the display (saved). Day or dark
  /// also becomes the day-side theme. `prefer_auto`: back to -1 when auto shows that theme anyway.
  void set_theme_choice_(int8_t choice, bool prefer_auto = false);
  void show_theme_();
  int brightness_percent_() const;
  void watch_sun_();
  void on_sun_(ArduinoJson::JsonVariantConst value);
  void apply_brightness_();
  void set_backlight_(bool on, int percent);
  void sleep_();
  void wake_(const char *why);
  void check_sleep_(uint32_t now);
  bool has_backlight_() const;
  // Clock and screen saver (ADR-0024)
  bool clock_wanted_() const;
  void watch_clock_();
  void on_clock_(ArduinoJson::JsonVariantConst value);
  void set_clock_(int64_t utc, const char *source);
  bool utc_now_(int64_t &utc) const;
  void tick_clock_(uint32_t now);
  void show_saver_(uint32_t now);
  // Settings panel and the display's own choices (ADR-0025)
  SettingsPanel::State panel_state_() const;
  void tick_panel_(uint32_t now);
  // Sound (ADR-0033): what the layout and the display's choices make of it, and the clicks.
  bool has_sound_() const;
  int sound_volume_() const;
  bool sound_touch_() const;
  void apply_sound_();
  void tick_sound_(uint32_t now, bool online);
  void attach_click_();
  void fill_info_(std::vector<InfoRow> &rows, bool network) const;
  void save_prefs_();
  // Setup without configuration (ADR-0026): the setup network, Wi-Fi and the SignalK server.
  void setup_ap_();
  void tick_network_();
  void factory_reset_();
  /// Turn the picture to the layout's settings.rotation (ADR-0028) before its page is built; a new
  /// size is told to the plugin. Ignored (logged) on a board that can't turn.
  void rotate_(int degrees);
  int rotation_() const;
  bool ap_active_() const;
  std::string ap_ssid_() const;
  bool wifi_connected_() const;
  /// The servers the panel lists (the last search; made up under ESPHELM_TEST_SERVERS).
  const std::vector<signalk::ServerCandidate> &servers_() const;

  signalk::SignalK *signalk_{nullptr};
  Renderer renderer_;
  AlarmBanner alarms_;
  // Value history (ADR-0018): recorded for every value tile of the layout, shown in the popup.
  esphelm::ValueHistory history_;
  HistoryPopup popup_;
  std::string history_wanted_;  // a tile with history was tapped: open its popup in loop()
  // Zones from the server's metadata (ADR-0020), in SI, by path; in RAM only. The visible page's
  // paths are read one at a time, on the HTTP worker.
  std::map<std::string, std::vector<esphelm::ServerZone>> server_zones_;
  std::vector<std::string> meta_queue_;
  std::string meta_path_;      // being read
  bool meta_in_flight_{false};
  uint32_t meta_generation_{0};  // a new layout: answers to older reads no longer count
  uint32_t meta_not_before_ms_{0};
  uint32_t next_meta_read_ms_{0};
  bool zones_dirty_{false};  // the visible page's zones changed: rebuild it in loop()
  Fonts fonts_;
  LayoutStore store_;
  LayoutClient client_;
#ifdef USE_ESPHELM_CHARTS
  LayoutClient tiles_;  // chart tiles, so they never delay hellos and layout fetches
  ChartTileStore charts_;  // the map tiles every chart tile shares (ADR-0030)
#endif

#ifdef USE_ESPHELM_MONO
  /// Black and white before every flush (ADR-0035).
  static void mono_flush_cb_(lv_event_t *e);
  bool mono_hooked_{false};
#endif
  std::string board_;
  bool touch_{true};
  uint32_t stale_after_ms_{15000};
  size_t max_layout_bytes_{0};  // 0 = derive from the device's memory
  bool psram_{false};
  esphelm::ParserLimits limits_;

  std::string device_id_;
  std::string version_path_;

  // What is shown
  bool has_layout_{false};
  esphelm::Layout layout_;
  size_t page_{0};
  bool next_page_wanted_{false};  // "@next": a hardware button, applied in loop()
  int pending_step_{0};  // footer button presses, applied in loop() (never inside LVGL events)
  bool theme_toggle_wanted_{false};  // test hook @theme: switch day/night in loop()
  bool menu_wanted_{false};          // the footer's menu button: open the settings in loop()
  SettingsPanel panel_;
  const char *layout_origin_{""};  // where the shown layout came from: fetched, cached, ...
  bool info_fixed_{false};  // test hook ESPHELM_TEST_INFO=fixed: values that change by themselves read "test"
  // Setup (ADR-0026). The setup network's password, made once per display and saved.
  std::string ap_password_;
  bool wifi_seen_{false};  // Wi-Fi connected since boot: the setup network stays off from then on
  // Test hooks: ESPHELM_TEST_SERVERS=fixed lists two made-up servers instead of searching the LAN
  // (choosing or forgetting one is only logged); ESPHELM_TEST_SETUP=ap|joining shows that setup
  // screen on the host build, which has no Wi-Fi.
  bool test_servers_{false};
  std::vector<signalk::ServerCandidate> test_server_list_;
  std::string test_setup_;
  std::vector<std::unique_ptr<Widget>> widgets_;
  esphelm::Theme theme_{esphelm::Theme::NIGHT};
  std::string etag_;
  std::string body_;
  uint32_t shown_at_{0};
  bool lkg_saved_{false};
  std::string lkg_etag_;
  std::vector<uint32_t> listeners_;
  std::string status_key_;  // last status page shown, to avoid rebuilding it every loop

  // Boot guard (ADR-0013): the layout being tried and how often it was shown when the display
  // crashed; a layout that keeps crashing it is skipped (and refused when fetched) by its etag.
  std::string boot_etag_;
  unsigned boot_attempts_{0};
  std::string bad_etag_;

  // Display settings (ADR-0015): the layout's own theme, what environment.sun says, the
  // brightness last applied, and the screen timeout's state.
  esphelm::Theme base_theme_{esphelm::Theme::DAY};
  int8_t sun_night_{-1};  // -1 unknown, 0 not night, 1 dusk or night
  // Brightness and day/night chosen on the display (ADR-0025), saved. A day/night choice is
  // dropped when the sun changes (autoTheme); any override when the layout brings other values.
  esphelm::DisplayPrefs prefs_;
  std::string sun_path_;
  uint32_t sun_listener_{0};
  int applied_brightness_{-1};
  bool asleep_{false};
  bool wake_wanted_{false};  // set by a touch on the sleep cover (inside an LVGL event)
  lv_obj_t *sleep_cover_{nullptr};
#ifdef USE_ESPHELM_SOUND
  SoundPlayer sound_;
  bool click_attached_{false};
#endif
  uint32_t next_sleep_check_ms_{0};
#ifdef USE_ESPHELM_BACKLIGHT
  light::LightState *backlight_{nullptr};
#endif

  // Clock (ADR-0024): Unix seconds at clock_ms_ (millis), set from SignalK's clockPath or the
  // board's time; it runs on millis() in between, so it keeps time offline.
  bool clock_set_{false};
  int64_t clock_utc_{0};
  uint32_t clock_ms_{0};
  uint32_t clock_signalk_ms_{0};  // when SignalK last set it; 0: never
  bool clock_frozen_{false};      // test hook ESPHELM_TEST_CLOCK=frozen: it never advances
  bool clock_old_logged_{false};
  std::string clock_path_;
  std::string clock_source_;  // what set it last, for the settings panel
  uint32_t clock_listener_{0};
  uint32_t next_clock_check_ms_{0};
#ifdef USE_ESPHELM_ROTATION
  lvgl::LvglComponent *lvgl_{nullptr};
#endif
  bool rotation_ignored_logged_{false};
#ifdef USE_ESPHELM_TIME
  time::RealTimeClock *time_{nullptr};
#endif
  // Screen saver: the time and/or date on the sleep cover, with the backlight dimmed.
  bool saver_on_{false};
  esphelm::ClockConfig saver_clock_;  // how it writes the time and date
  lv_obj_t *saver_time_{nullptr};
  lv_obj_t *saver_date_{nullptr};
  std::string saver_shown_time_, saver_shown_date_;
  uint32_t next_saver_ms_{0};

  // Protocol state
  ServerState server_state_{ServerState::UNKNOWN};
  std::string layout_error_;
  std::string transport_error_;
  bool was_connected_{false};
  bool hello_due_{true};
  bool fetch_wanted_{false};
  uint32_t next_hello_ms_{0};
  uint32_t hello_backoff_ms_{2000};
  uint32_t next_poll_ms_{0};
};

}  // namespace esphelm_runtime
}  // namespace esphome
