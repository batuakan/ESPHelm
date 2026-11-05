#include "esphelm_runtime.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "esphome/core/application.h"
#include "esphome/core/hal.h"
#include "esphome/core/helpers.h"
#include "esphome/core/log.h"
#include "esphelm_wifi_setup.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <bootloader_random.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <esp_system.h>
#include <nvs.h>
#else
#include <cstdlib>
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm";

static const uint32_t DRAW_INTERVAL_MS = 250;       // at most 4 redraws per tile per second
static const uint32_t POLL_INTERVAL_MS = 5 * 60 * 1000;  // fallback when a version delta is missed
static const uint32_t LKG_AFTER_MS = 30 * 1000;      // rendered this long without trouble -> last known good
static const uint32_t MAX_HELLO_BACKOFF_MS = 60 * 1000;
static const unsigned MAX_BOOT_ATTEMPTS = 2;         // crashes while a cached layout was shown -> skip it
// Zones from the server's metadata (ADR-0020). The server's throttle drops some meta deltas, so
// the visible page's metadata is also read again at this interval.
static const uint32_t META_READ_INTERVAL_MS = 60 * 1000;
static const uint32_t META_DEBOUNCE_MS = 1000;
static const size_t META_MAX_BODY = 4 * 1024;

/// Did the previous boot end in a crash (rather than a power cut, OTA or a requested restart)?
static bool crash_reset() {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  switch (esp_reset_reason()) {
    case ESP_RST_PANIC:
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:
      return true;
    default:
      return false;
  }
#else
  return true;  // host: a clean exit clears the record (atexit), so anything left is a crash
#endif
}

#ifndef USE_ESP32_FRAMEWORK_ESP_IDF
static EsphelmRuntime *exit_instance = nullptr;
#endif

void EsphelmRuntime::compute_capacity_() {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  this->psram_ = heap_caps_get_total_size(MALLOC_CAP_SPIRAM) > 0;
  size_t derived = this->psram_ ? 256 * 1024
                                : std::min<size_t>(16 * 1024, heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) / 4);
#else
  this->psram_ = true;  // host build: plenty of memory
  size_t derived = 256 * 1024;
#endif
  this->limits_.max_bytes = this->max_layout_bytes_ != 0 ? this->max_layout_bytes_ : derived;
}

void EsphelmRuntime::setup() {
  // Before Wi-Fi starts (its setup runs after ours): the setup network gets this display's password.
  this->setup_ap_();
  this->compute_capacity_();
  this->renderer_.set_fonts(this->fonts_);
  this->renderer_.set_navigation([this](int step) { this->pending_step_ += step; });
  this->renderer_.set_menu([this]() { this->menu_wanted_ = true; });
  this->device_id_ = this->signalk_->get_device_id();
  this->version_path_ = "plugins.esphelm." + this->device_id_ + ".version";
  this->client_.start();
  this->tiles_.start();
  const char *clock_test = std::getenv("ESPHELM_TEST_CLOCK");
  this->clock_frozen_ = clock_test != nullptr && std::strcmp(clock_test, "frozen") == 0;
  const char *info_test = std::getenv("ESPHELM_TEST_INFO");
  this->info_fixed_ = info_test != nullptr && std::strcmp(info_test, "fixed") == 0;
  const char *servers_test = std::getenv("ESPHELM_TEST_SERVERS");
  this->test_servers_ = servers_test != nullptr && std::strcmp(servers_test, "fixed") == 0;
  if (this->test_servers_) {
    signalk::ServerCandidate a, b;
    a.hostname = "boat-pc";
    a.address = "192.168.1.20";
    a.port = 3000;
    b.hostname = "navstation";
    b.address = "192.168.1.31";
    b.port = 3443;
    this->test_server_list_ = {a, b};
  }
  const char *setup_test = std::getenv("ESPHELM_TEST_SETUP");
  this->test_setup_ = setup_test != nullptr ? setup_test : "";

  this->popup_.set_fonts(this->fonts_);
  this->popup_.set_history(&this->history_);
  this->panel_.set_fonts(this->fonts_);
  this->panel_.set_info([this](std::vector<InfoRow> &rows, bool network) { this->fill_info_(rows, network); });

  // Alarms (ADR-0014): every notification, whatever the layout shows.
  this->alarms_.set_fonts(this->fonts_);
  this->alarms_.set_capacity(this->psram_ ? 16 : 8);
  this->alarms_.set_ack_sender([this](const std::string &path) {
    if (this->signalk_->access_state() != signalk::SignalKAccessState::AUTHORIZED)
      return false;
    ArduinoJson::JsonDocument doc;
    doc["path"] = path;
    HttpRequest req;
    req.kind = RequestKind::ACK;
    req.url = this->base_url_() + "/notifications/ack";
    req.token = this->signalk_->get_token();
    serializeJson(doc, req.body);
    req.max_body = 1024;
    this->client_.submit(std::move(req));
    return true;
  });
  this->signalk_->add_listener("notifications.*", [this](const std::string &path, ArduinoJson::JsonVariantConst v) {
    this->alarms_.on_value(path, v);
  });

  this->signalk_->add_listener(this->version_path_, [this](const std::string &, ArduinoJson::JsonVariantConst v) {
    if (v.is<const char *>()) {
      if (this->etag_ != v.as<const char *>()) {
        ESP_LOGI(TAG, "Layout version changed to %s", v.as<const char *>());
        this->fetch_wanted_ = true;
      }
    } else {
      // null: the plugin serves nothing to this device any more; ask why.
      this->hello_due_ = true;
      this->next_hello_ms_ = 0;
    }
  });

  // A hint that a path's metadata changed; it can be missed, so it is read again now and then too.
  this->signalk_->add_meta_listener([this](const std::string &path) { this->on_meta_changed_(path); });

  // Brightness and theme chosen on the display (ADR-0025), before the first layout is shown.
  StoredLayout prefs;
  if (this->store_.load(Slot::PREFS, prefs)) {
    if (prefs.etag == "prefs" && esphelm::decode_prefs(prefs.body, this->prefs_))
      ESP_LOGI(TAG, "Display choices: %s", prefs.body.c_str());
    else
      ESP_LOGW(TAG, "Saved display choices are not valid; ignoring them");
  }

  // Offline first: show what we had before any network traffic. The boot guard first decides
  // whether the cached layout is the one that keeps crashing the display (ADR-0013).
  StoredLayout stored;
  const bool cached = this->store_.load(Slot::CURRENT, stored);
  this->check_boot_record_(cached ? stored.etag : "");
#ifndef USE_ESP32_FRAMEWORK_ESP_IDF
  exit_instance = this;
  std::atexit([] { exit_instance->clean_exit(); });
#endif
  if (cached && this->apply_(stored.body, stored.etag, false, "cached")) {
    // shown
  } else if (this->store_.load(Slot::LAST_KNOWN_GOOD, stored) &&
             this->apply_(stored.body, stored.etag, false, "last known good")) {
    this->lkg_etag_ = stored.etag;
  } else {
    this->update_status_();
  }
  StoredLayout lkg;
  if (this->store_.load(Slot::LAST_KNOWN_GOOD, lkg))
    this->lkg_etag_ = lkg.etag;
}

void EsphelmRuntime::dump_config() {
  ESP_LOGCONFIG(TAG, "ESPHelm runtime %s", FIRMWARE_VERSION);
  ESP_LOGCONFIG(TAG, "  Device id: %s", this->device_id_.c_str());
  ESP_LOGCONFIG(TAG, "  Board: %s", this->board_.c_str());
  ESP_LOGCONFIG(TAG, "  Max layout: %u bytes (PSRAM: %s)", (unsigned) this->limits_.max_bytes,
                YESNO(this->psram_));
  ESP_LOGCONFIG(TAG, "  Stale after: %u ms", (unsigned) this->stale_after_ms_);
}

void EsphelmRuntime::loop() {
  const uint32_t now = millis();

  HttpResult result;
  while (this->client_.poll(result))
    this->handle_result_(result);
  // Chart tiles go back to the widgets of the visible page.
  while (this->tiles_.poll(result)) {
    for (auto &w : this->widgets_)
      w->on_http(result);
  }

  const bool connected = this->signalk_->is_stream_connected();
  if (connected && !this->was_connected_) {
    // (Re)connected: re-announce and re-check the layout.
    this->hello_due_ = true;
    this->next_hello_ms_ = 0;
    this->next_meta_read_ms_ = 0;
  }
  this->was_connected_ = connected;

  const bool authorized = this->signalk_->access_state() == signalk::SignalKAccessState::AUTHORIZED;
  if (authorized && this->hello_due_ && now >= this->next_hello_ms_ && !this->client_.busy())
    this->send_hello_();
  if (authorized && this->fetch_wanted_ && !this->hello_due_ && !this->client_.busy())
    this->send_fetch_();
  if (this->server_state_ == ServerState::ADOPTED && now >= this->next_poll_ms_) {
    this->fetch_wanted_ = true;
    this->next_poll_ms_ = now + POLL_INTERVAL_MS;
  }
  this->pump_meta_(now, authorized && connected);

  this->tick_network_();
  // The menu is in the footer, and on the status page before there is a layout.
  if (this->menu_wanted_) {
    this->menu_wanted_ = false;
    if (!this->panel_.is_open() && !this->asleep_) {
      this->panel_.open(this->panel_state_(), this->alarms_.height());
      this->alarms_.raise();
    }
  }
  bool history_closed = false;
  if (this->has_layout_) {
    if (this->theme_toggle_wanted_) {
      this->theme_toggle_wanted_ = false;
      this->toggle_theme_();
    }
    if (this->pending_step_ != 0) {
      const int target = static_cast<int>(this->page_) + this->pending_step_;
      this->pending_step_ = 0;
      if (target >= 0)
        this->show_page(static_cast<size_t>(target));
    }
    for (auto &w : this->widgets_)
      w->tick(now);
    history_closed = this->history_.tick(now);
    if (!this->history_wanted_.empty()) {
      this->open_history_(this->history_wanted_);
      this->history_wanted_.clear();
    }
    if (!this->lkg_saved_ && now - this->shown_at_ >= LKG_AFTER_MS) {
      if (this->boot_attempts_ != 0) {
        this->boot_attempts_ = 0;  // survived: no longer a suspect
        this->save_boot_record_();
      }
      if (this->etag_ != this->lkg_etag_ && this->store_.save(Slot::LAST_KNOWN_GOOD, {this->etag_, this->body_}))
        this->lkg_etag_ = this->etag_;
      this->lkg_saved_ = true;
    }
  } else {
    this->update_status_();
  }
  if (this->alarms_.take_wake())
    this->wake_("alarm");
  if (this->wake_wanted_) {
    this->wake_wanted_ = false;
    this->wake_("touch");
  }
  this->tick_clock_(now);
  this->check_sleep_(now);
  if (this->asleep_ && this->saver_on_)
    this->show_saver_(now);
  this->alarms_.tick(this->theme_, connected,
                     authorized && connected && this->server_state_ != ServerState::UNKNOWN);
  // The banner pushes the page down instead of covering it, so no control hides under it.
  if (this->renderer_.set_top_inset(this->alarms_.height())) {
    for (auto &w : this->widgets_)
      w->layout_done();
  }
  // The popup sits below the banner too, and the banner stays in front of it.
  if (this->popup_.tick(now, history_closed, this->theme_, this->alarms_.height()))
    this->alarms_.raise();
  this->tick_panel_(now);
}

// ---- Network ----

std::string EsphelmRuntime::base_url_() const {
  return "http://" + this->signalk_->get_host() + ":" + std::to_string(this->signalk_->get_port()) +
         "/signalk/v1/api/esphelm";
}

void EsphelmRuntime::send_hello_() {
  ArduinoJson::JsonDocument doc;
  doc["deviceId"] = this->device_id_;
  doc["fw"]["version"] = FIRMWARE_VERSION;
  doc["schema"]["major"] = 1;
  doc["board"] = this->board_;
  lv_display_t *disp = lv_display_get_default();
  doc["display"]["width"] = disp != nullptr ? lv_display_get_horizontal_resolution(disp) : 0;
  doc["display"]["height"] = disp != nullptr ? lv_display_get_vertical_resolution(disp) : 0;
  doc["display"]["rotation"] = 0;
  // Renderable tile types and page kinds; the plugin refuses layouts using others. Chart pages
  // need PSRAM for their tile buffer.
  for (const char *w : {"value", "gauge", "bar", "switch", "position", "wind_rose", "autopilot", "graph", "heading_tape", "clock"})
    doc["widgets"].add(w);
  if (this->psram_)
    doc["widgets"].add("chart");
  ArduinoJson::JsonArray fonts = doc["fonts"].to<ArduinoJson::JsonArray>();
  fonts.add("value");
  fonts.add("label");
  fonts.add("small");
  ArduinoJson::JsonArray lines = doc["fontLineHeights"].to<ArduinoJson::JsonArray>();
  ArduinoJson::JsonArray digit_lines = doc["digitFontLineHeights"].to<ArduinoJson::JsonArray>();
  for (uint8_t i = 0; i < this->fonts_.count; i++)
    (this->fonts_.digits[i] ? digit_lines : lines).add(lv_font_get_line_height(this->fonts_.ladder[i]));
  doc["capacity"]["psram"] = this->psram_;
  doc["capacity"]["maxLayoutBytes"] = this->limits_.max_bytes;
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  doc["capacity"]["freeHeapBytes"] = heap_caps_get_free_size(MALLOC_CAP_8BIT);
#endif
  doc["capabilities"]["touch"] = this->touch_;
  doc["capabilities"]["put"] = true;
  doc["capabilities"]["backlight"] = this->has_backlight_();
  if (!this->etag_.empty())
    doc["layoutEtag"] = this->etag_;
  if (!this->bad_etag_.empty())
    doc["recovery"]["skippedLayoutEtag"] = this->bad_etag_;

  HttpRequest req;
  req.kind = RequestKind::HELLO;
  req.url = this->base_url_() + "/devices/hello";
  req.token = this->signalk_->get_token();
  serializeJson(doc, req.body);
  req.max_body = 4096;
  ESP_LOGD(TAG, "Sending hello");
  this->client_.submit(std::move(req));
  this->hello_due_ = false;
}

void EsphelmRuntime::send_fetch_() {
  HttpRequest req;
  req.kind = RequestKind::LAYOUT;
  req.url = this->base_url_() + "/devices/" + this->device_id_ + "/layout";
  req.token = this->signalk_->get_token();
  req.if_none_match = this->etag_;
  req.max_body = this->limits_.max_bytes;
  ESP_LOGD(TAG, "Fetching layout (If-None-Match: %s)", this->etag_.empty() ? "-" : this->etag_.c_str());
  this->client_.submit(std::move(req));
  this->fetch_wanted_ = false;
}

void EsphelmRuntime::handle_result_(HttpResult &result) {
  if (result.kind == RequestKind::META) {  // best effort: says nothing about the layout's connection
    this->handle_meta_(result);
    return;
  }
  if (result.status == 0) {
    this->transport_error_ = result.error;
    ESP_LOGW(TAG, "%s request failed: %s",
             result.kind == RequestKind::HELLO ? "hello" : result.kind == RequestKind::ACK ? "acknowledge" : "layout",
             result.error.c_str());
  } else {
    this->transport_error_.clear();
  }
  if (result.kind == RequestKind::HELLO)
    this->handle_hello_(result);
  else if (result.kind == RequestKind::ACK)
    this->alarms_.ack_result(result.status);
  else
    this->handle_layout_(result);
}

void EsphelmRuntime::handle_hello_(const HttpResult &result) {
  const uint32_t now = millis();
  if (result.status != 200) {
    this->hello_due_ = true;
    this->next_hello_ms_ = now + this->hello_backoff_ms_;
    this->hello_backoff_ms_ = std::min(this->hello_backoff_ms_ * 2, MAX_HELLO_BACKOFF_MS);
    if (result.status != 0) {
      this->transport_error_ = "ESPHelm plugin answered HTTP " + std::to_string(result.status);
      ESP_LOGW(TAG, "hello: HTTP %d %s", result.status, result.body.c_str());
    }
    return;
  }
  this->hello_backoff_ms_ = 2000;
  ArduinoJson::JsonDocument doc;
  if (deserializeJson(doc, result.body)) {
    ESP_LOGW(TAG, "hello: unparsable response");
    return;
  }
  const char *state = doc["state"] | "";
  ArduinoJson::JsonVariantConst etag = doc["layoutEtag"];
  if (std::strcmp(state, "adopted") != 0) {
    ESP_LOGI(TAG, "Device is pending adoption in the ESPHelm editor");
    this->server_state_ = ServerState::PENDING;
    this->clear_layout_();
  } else if (!etag.is<const char *>()) {
    ESP_LOGI(TAG, "Device is adopted but has no layout assigned");
    this->server_state_ = ServerState::NO_LAYOUT;
    this->clear_layout_();
  } else {
    this->server_state_ = ServerState::ADOPTED;
    this->next_poll_ms_ = now + POLL_INTERVAL_MS;
    if (this->etag_ != etag.as<const char *>())
      this->fetch_wanted_ = true;
  }
}

void EsphelmRuntime::handle_layout_(const HttpResult &result) {
  switch (result.status) {
    case 304:
      return;  // unchanged
    case 200: {
      if (result.truncated) {
        this->layout_error_ = "CAPACITY_EXCEEDED (layout larger than " + std::to_string(this->limits_.max_bytes) + " bytes)";
        ESP_LOGE(TAG, "Layout rejected: %s", this->layout_error_.c_str());
        return;
      }
      this->apply_(result.body, result.etag, true, "fetched");
      return;
    }
    case 404: {
      ArduinoJson::JsonDocument doc;
      deserializeJson(doc, result.body);
      const char *reason = doc["error"] | "";
      if (std::strcmp(reason, "NOT_ADOPTED") == 0) {
        this->server_state_ = ServerState::PENDING;
      } else if (std::strcmp(reason, "NO_LAYOUT") == 0) {
        this->server_state_ = ServerState::NO_LAYOUT;
      } else {
        this->hello_due_ = true;  // NOT_REGISTERED (or unknown): introduce ourselves again
        return;
      }
      this->clear_layout_();
      return;
    }
    default:
      if (result.status != 0)
        ESP_LOGW(TAG, "layout: HTTP %d", result.status);
      this->next_poll_ms_ = millis() + 30 * 1000;  // retry soon
      return;
  }
}

// ---- Layout ----

bool EsphelmRuntime::apply_(const std::string &body, const std::string &etag, bool persist, const char *origin) {
  if (!this->bad_etag_.empty() && etag == this->bad_etag_) {
    this->layout_error_ = "This layout crashed the display; change it in the editor and send it again";
    ESP_LOGE(TAG, "%s layout %s skipped: it crashed the display before", origin, etag.c_str());
    return false;
  }
  esphelm::ParseResult parsed = esphelm::parse_layout(body.data(), body.size(), this->limits_);
  if (!parsed.ok) {
    const esphelm::ParseError &e = parsed.errors.front();
    this->layout_error_ = std::string(e.code) + (e.pointer.empty() ? "" : " at " + e.pointer);
    ESP_LOGE(TAG, "%s layout rejected (%u errors), first: %s", origin, (unsigned) parsed.errors.size(),
             this->layout_error_.c_str());
    return false;  // keep whatever is shown
  }
  // Stay on the same page when the same layout is updated (with the same start page) and the
  // page still exists; otherwise start at the start page (settings.startPage, else the first).
  const bool same_layout = this->has_layout_ && parsed.layout.id == this->layout_.id &&
                           parsed.layout.settings.start_page == this->layout_.settings.start_page;
  size_t page = 0;
  if (same_layout && this->page_ < parsed.layout.pages.size()) {
    page = this->page_;
  } else {
    for (size_t i = 0; i < parsed.layout.pages.size(); i++) {
      if (parsed.layout.pages[i].id == parsed.layout.settings.start_page)
        page = i;
    }
  }
  this->layout_ = std::move(parsed.layout);
  // Zones the server is known to have apply at once; what the layout no longer shows is forgotten.
  this->meta_generation_++;
  this->meta_queue_.clear();
  std::map<std::string, std::vector<esphelm::ServerZone>> kept;
  for (auto &p : this->layout_.pages) {
    for (auto &t : p.tiles) {
      t.own_zones = t.zones;
      auto it = this->server_zones_.find(t.data.path);
      if (it != this->server_zones_.end())
        kept.insert(*it);
    }
  }
  this->server_zones_ = std::move(kept);
  this->apply_server_zones_();
  this->zones_dirty_ = false;  // the page is built next
  this->configure_history_();
  // The theme the page is built with: the layout's, or night by environment.sun (autoTheme),
  // or what was chosen on the display, unless this layout brings other values for it (ADR-0025).
  if (esphelm::reconcile_prefs(this->prefs_, this->layout_.settings, this->layout_.theme)) {
    ESP_LOGI(TAG, "The layout's display settings changed; dropping what was chosen on the display");
    this->save_prefs_();
  }
  this->base_theme_ = this->layout_.theme;
  if (this->layout_.settings.auto_theme_path != this->sun_path_)
    this->sun_night_ = -1;  // a different source: unknown until its value arrives
  this->layout_.theme = this->effective_theme_();
  // Count the attempt before building: if building or showing it crashes the display, the next
  // boot knows which layout it was.
  this->boot_attempts_ = etag == this->boot_etag_ ? this->boot_attempts_ + 1 : 1;
  this->boot_etag_ = etag;
  this->save_boot_record_();
  if (!this->build_page_(page)) {
    this->boot_attempts_ = 0;  // refused cleanly, not a crash
    this->save_boot_record_();
    this->layout_error_ = "CAPACITY_EXCEEDED (out of memory while building)";
    this->has_layout_ = false;
    this->status_key_.clear();
    return false;
  }
  this->layout_error_.clear();
  this->theme_ = this->layout_.theme;
  this->has_layout_ = true;
  this->watch_sun_();
  this->watch_clock_();
  if (this->asleep_)
    this->wake_("new layout");
  this->apply_brightness_();
  this->status_key_.clear();
  this->etag_ = etag;
  this->body_ = body;
  this->layout_origin_ = origin;
  this->shown_at_ = millis();
  this->lkg_saved_ = false;
  if (persist && !this->store_.save(Slot::CURRENT, {etag, body}))
    ESP_LOGW(TAG, "Could not cache the layout; it will not survive a reboot");
  ESP_LOGI(TAG, "Showing %s layout \"%s\" (%u pages, %u bytes, ETag %s)", origin, this->layout_.id.c_str(),
           (unsigned) this->layout_.pages.size(), (unsigned) body.size(), etag.c_str());
  this->queue_meta_reads_();
  return true;
}

// ---- Display settings (ADR-0015) ----

bool EsphelmRuntime::has_backlight_() const {
#ifdef USE_ESPHELM_BACKLIGHT
  return this->backlight_ != nullptr;
#else
  return false;
#endif
}

esphelm::Theme EsphelmRuntime::effective_theme_() const {
  if (this->prefs_.theme >= 0)
    return static_cast<esphelm::Theme>(this->prefs_.theme);
  return this->automatic_theme_();
}

esphelm::Theme EsphelmRuntime::automatic_theme_() const {
  if (this->layout_.settings.auto_theme == esphelm::AutoTheme::SUN && this->sun_night_ == 1)
    return esphelm::Theme::NIGHT;
  return this->base_theme_;
}

void EsphelmRuntime::watch_sun_() {
  const bool wanted = this->layout_.settings.auto_theme == esphelm::AutoTheme::SUN;
  const std::string &path = this->layout_.settings.auto_theme_path;
  if (wanted && path == this->sun_path_)
    return;
  if (!this->sun_path_.empty())
    this->signalk_->remove_listener(this->sun_listener_);
  this->sun_path_.clear();
  if (!wanted)
    return;
  this->sun_path_ = path;
  this->sun_listener_ = this->signalk_->add_listener(
      path, [this](const std::string &, ArduinoJson::JsonVariantConst v) { this->on_sun_(v); });
}

void EsphelmRuntime::on_sun_(ArduinoJson::JsonVariantConst value) {
  if (!value.is<const char *>())
    return;
  const char *sun = value.as<const char *>();
  const int8_t night = std::strcmp(sun, "dusk") == 0 || std::strcmp(sun, "night") == 0 ? 1 : 0;
  if (night == this->sun_night_)
    return;
  // The first value after a boot or a new source is no change: a saved choice stays.
  const bool changed = this->sun_night_ >= 0;
  this->sun_night_ = night;
  if (changed && this->prefs_.theme >= 0) {
    ESP_LOGI(TAG, "Sun: %s, back to the automatic theme", sun);
    this->prefs_.theme = -1;
    this->save_prefs_();
  }
  if (!this->has_layout_)
    return;
  const esphelm::Theme theme = this->effective_theme_();
  if (theme == this->layout_.theme)
    return;
  ESP_LOGI(TAG, "Sun: %s, switching to the %s theme", sun, theme == esphelm::Theme::NIGHT ? "night" : "day");
  this->layout_.theme = theme;
  this->theme_ = theme;
  this->build_page_(this->page_);  // a theme change rebuilds the page (twice a day)
  this->apply_brightness_();
}

void EsphelmRuntime::toggle_theme_() {
  // The other theme; back to automatic when that is what the layout would show anyway.
  const esphelm::Theme theme =
      this->layout_.theme == esphelm::Theme::NIGHT ? esphelm::Theme::DAY : esphelm::Theme::NIGHT;
  this->set_theme_choice_(theme == this->automatic_theme_() ? -1 : static_cast<int8_t>(theme));
}

void EsphelmRuntime::set_theme_choice_(int8_t choice) {
  if (choice == this->prefs_.theme)
    return;
  this->prefs_.theme = choice;
  this->prefs_.set_base(this->layout_.settings, this->base_theme_);
  this->save_prefs_();
  const esphelm::Theme theme = this->effective_theme_();
  if (choice < 0)
    ESP_LOGI(TAG, "Theme on the display: automatic (%s)", theme == esphelm::Theme::NIGHT ? "night" : "day");
  else
    ESP_LOGI(TAG, "Theme switched on the display: %s", theme == esphelm::Theme::NIGHT ? "night" : "day");
  this->show_theme_();
}

void EsphelmRuntime::show_theme_() {
  const esphelm::Theme theme = this->effective_theme_();
  if (!this->has_layout_ || theme == this->layout_.theme)
    return;
  this->layout_.theme = theme;
  this->theme_ = theme;
  this->build_page_(this->page_);
  this->apply_brightness_();
}

int EsphelmRuntime::brightness_percent_() const {
  const esphelm::Settings &s = this->layout_.settings;
  if (this->theme_ == esphelm::Theme::NIGHT)
    return this->prefs_.brightness_night >= 0 ? this->prefs_.brightness_night : s.brightness_night;
  return this->prefs_.brightness_day >= 0 ? this->prefs_.brightness_day : s.brightness_day;
}

void EsphelmRuntime::save_prefs_() {
  if (!this->store_.save(Slot::PREFS, {"prefs", esphelm::encode_prefs(this->prefs_)}))
    ESP_LOGW(TAG, "Could not save the display choices; they will not survive a reboot");
}

void EsphelmRuntime::apply_brightness_() {
  if (this->asleep_)
    return;
  const int percent = this->brightness_percent_();
  if (percent == this->applied_brightness_)
    return;
  this->applied_brightness_ = percent;
  if (this->has_backlight_())
    ESP_LOGI(TAG, "Brightness %d %%", percent);
  else
    ESP_LOGD(TAG, "Brightness %d %% (no backlight configured)", percent);
  this->set_backlight_(true, percent);
}

void EsphelmRuntime::set_backlight_(bool on, int percent) {
#ifdef USE_ESPHELM_BACKLIGHT
  if (this->backlight_ == nullptr)
    return;
  if (on) {
    auto call = this->backlight_->turn_on();
    call.set_brightness(percent / 100.0f);
    call.set_transition_length(400);
    call.perform();
  } else {
    this->backlight_->turn_off().perform();
  }
#endif
}

void EsphelmRuntime::check_sleep_(uint32_t now) {
  if (now < this->next_sleep_check_ms_)
    return;
  this->next_sleep_check_ms_ = now + 500;
#ifdef USE_ESPHELM_BACKLIGHT
  // A touch while asleep may be handled by the board's YAML (it resumes LVGL and turns the light
  // on); that touch never reached LVGL, so nothing on the page was pressed.
  // (Not while the screen saver shows: then the light is on, dimmed, and LVGL isn't paused.)
  if (this->asleep_ && !this->saver_on_ && this->backlight_ != nullptr && this->backlight_->remote_values.is_on()) {
    this->wake_("touch");
    return;
  }
#endif
  const uint32_t timeout = this->layout_.settings.screen_timeout;
  if (this->asleep_ || !this->has_layout_ || timeout == 0)
    return;
  const uint32_t after_ms = std::max<uint32_t>(timeout, 10) * 1000;
  if (lv_display_get_inactive_time(nullptr) >= after_ms) {
    ESP_LOGI(TAG, "Screen off after %u s without a touch", (unsigned) (after_ms / 1000));
    this->sleep_();
  }
}

void EsphelmRuntime::sleep_() {
  this->asleep_ = true;
  this->panel_.close();  // waking shows the page
  // A black cover on the system layer (above the alarm banner) catches the first touch, so
  // waking the screen never presses a button underneath.
  if (this->sleep_cover_ == nullptr) {
    this->sleep_cover_ = lv_obj_create(lv_layer_sys());
    lv_obj_remove_style_all(this->sleep_cover_);
    lv_obj_set_size(this->sleep_cover_, lv_pct(100), lv_pct(100));
    lv_obj_set_style_bg_color(this->sleep_cover_, lv_color_hex(0x000000), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(this->sleep_cover_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_add_flag(this->sleep_cover_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(
        this->sleep_cover_,
        [](lv_event_t *e) { static_cast<EsphelmRuntime *>(lv_event_get_user_data(e))->wake_wanted_ = true; },
        LV_EVENT_PRESSED, this);
  }
  lv_obj_remove_flag(this->sleep_cover_, LV_OBJ_FLAG_HIDDEN);
  // The screen saver (ADR-0024): a faint clock on the cover and a dimmed backlight, once the
  // display knows the time; else dark, as without it.
  this->saver_on_ = this->layout_.settings.screen_saver != esphelm::ClockShow::OFF && this->clock_set_;
  if (!this->saver_on_) {
    for (lv_obj_t *l : {this->saver_time_, this->saver_date_}) {
      if (l != nullptr)
        lv_obj_add_flag(l, LV_OBJ_FLAG_HIDDEN);
    }
    this->set_backlight_(false, 0);
    return;
  }
  const esphelm::ClockShow show = this->layout_.settings.screen_saver;
  // Written like the layout's first clock tile; without one 24 h, and the weekday date.
  this->saver_clock_ = esphelm::ClockConfig{};
  this->saver_clock_.date_format = esphelm::wallclock::DateFormat::WEEKDAY;
  bool found = false;
  for (const auto &page : this->layout_.pages) {
    for (const auto &tile : page.tiles) {
      if (!found && tile.type == esphelm::TileType::CLOCK) {
        this->saver_clock_.hour12 = tile.clock.hour12;
        this->saver_clock_.date_format = tile.clock.date_format;
        found = true;
      }
    }
  }
  lv_obj_update_layout(this->sleep_cover_);
  const int32_t w = lv_obj_get_width(this->sleep_cover_);
  const int32_t h = lv_obj_get_height(this->sleep_cover_);
  const lv_color_t faint = colors_for(this->theme_).muted;
  // The time as wide as half the screen; digits-only fonts when they have ":" and no AM/PM follows.
  const char *sample = this->saver_clock_.hour12 ? "88:88 PM" : "88:88";
  const lv_font_t *time_font = this->fonts_.small;  // when nothing larger fits
  lv_font_glyph_dsc_t glyph;
  for (int i = this->fonts_.count - 1; i >= 0; i--) {
    const lv_font_t *f = this->fonts_.ladder[i];
    if (this->fonts_.digits[i] && (this->saver_clock_.hour12 || !lv_font_get_glyph_dsc(f, &glyph, ':', 0)))
      continue;
    if (text_width(sample, f) <= w / 2 && lv_font_get_line_height(f) <= h / 2) {
      time_font = f;
      break;
    }
  }
  const lv_font_t *date_font = companion_font(this->fonts_, time_font);
  if (show == esphelm::ClockShow::DATE)
    date_font = fit_font(this->fonts_, "88/88/8888", w / 2, h / 2);
  lv_obj_t **labels[] = {&this->saver_time_, &this->saver_date_};
  for (lv_obj_t **l : labels) {
    if (*l == nullptr)
      *l = lv_label_create(this->sleep_cover_);
    lv_obj_set_style_text_color(*l, faint, LV_PART_MAIN);
  }
  lv_obj_set_style_text_font(this->saver_time_, time_font, LV_PART_MAIN);
  lv_obj_set_style_text_font(this->saver_date_, date_font, LV_PART_MAIN);
  const bool with_time = show != esphelm::ClockShow::DATE, with_date = show != esphelm::ClockShow::TIME;
  if (with_time)
    lv_obj_remove_flag(this->saver_time_, LV_OBJ_FLAG_HIDDEN);
  else
    lv_obj_add_flag(this->saver_time_, LV_OBJ_FLAG_HIDDEN);
  if (with_date)
    lv_obj_remove_flag(this->saver_date_, LV_OBJ_FLAG_HIDDEN);
  else
    lv_obj_add_flag(this->saver_date_, LV_OBJ_FLAG_HIDDEN);
  // Centred as a pair: the date under the time.
  const int32_t pair = with_time && with_date ? lv_font_get_line_height(date_font) / 2 : 0;
  lv_obj_align(this->saver_time_, LV_ALIGN_CENTER, 0, -pair);
  lv_obj_align(this->saver_date_, LV_ALIGN_CENTER, 0,
               with_time ? lv_font_get_line_height(time_font) / 2 : 0);
  this->saver_shown_time_.clear();
  this->saver_shown_date_.clear();
  this->next_saver_ms_ = 0;
  this->show_saver_(millis());
  ESP_LOGI(TAG, "Screen saver: the clock, backlight %d %%", this->layout_.settings.screen_saver_brightness);
  this->set_backlight_(true, this->layout_.settings.screen_saver_brightness);
}

void EsphelmRuntime::show_saver_(uint32_t now) {
  if (now < this->next_saver_ms_)
    return;
  this->next_saver_ms_ = now + 1000;  // the text changes once a minute; checking each second is cheap
  int64_t utc;
  if (!this->utc_now_(utc))
    return;
  const int64_t local = utc + esphelm::wallclock::offset(this->layout_.settings.time_zone, utc);
  char time_buf[9], date_buf[16];
  const char *suffix;
  esphelm::wallclock::time_text(local, this->saver_clock_.hour12, false, time_buf, sizeof(time_buf), suffix);
  esphelm::wallclock::date_text(local, this->saver_clock_.date_format, date_buf, sizeof(date_buf));
  const std::string time_text = suffix[0] != '\0' ? std::string(time_buf) + " " + suffix : std::string(time_buf);
  if (this->saver_shown_time_ != time_text) {
    this->saver_shown_time_ = time_text;
    lv_label_set_text(this->saver_time_, time_text.c_str());
  }
  if (this->saver_shown_date_ != date_buf) {
    this->saver_shown_date_ = date_buf;
    lv_label_set_text(this->saver_date_, date_buf);
  }
}

// ---- Clock (ADR-0024) ----

bool EsphelmRuntime::clock_wanted_() const {
  if (!this->has_layout_)
    return false;
  if (this->layout_.settings.screen_saver != esphelm::ClockShow::OFF)
    return true;
  for (const auto &page : this->layout_.pages) {
    for (const auto &tile : page.tiles) {
      if (tile.type == esphelm::TileType::CLOCK)
        return true;
    }
  }
  return false;
}

void EsphelmRuntime::watch_clock_() {
  const bool wanted = this->clock_wanted_();
  const std::string &path = this->layout_.settings.clock_path;
  if (wanted && path == this->clock_path_)
    return;
  if (!this->clock_path_.empty())
    this->signalk_->remove_listener(this->clock_listener_);
  this->clock_path_.clear();
  if (!wanted)
    return;
  this->clock_path_ = path;
  this->clock_listener_ = this->signalk_->add_listener(
      path, [this](const std::string &, ArduinoJson::JsonVariantConst v) { this->on_clock_(v); });
}

void EsphelmRuntime::on_clock_(ArduinoJson::JsonVariantConst value) {
  int64_t utc;
  // Untrusted: an ISO date-time string, else ignored.
  if (!value.is<const char *>() || !esphelm::wallclock::parse_iso_utc(value.as<const char *>(), utc))
    return;
  // A GPS without a fix (or replayed old data) can send a date long past; keep the board's time.
  static const int64_t EARLIEST = 1577836800;  // 2020-01-01
  if (utc < EARLIEST) {
    if (!this->clock_old_logged_)
      ESP_LOGW(TAG, "Clock: ignoring %s from %s (before 2020)", value.as<const char *>(), this->clock_path_.c_str());
    this->clock_old_logged_ = true;
    return;
  }
  this->clock_signalk_ms_ = millis() | 1;
  this->set_clock_(utc, this->clock_path_.c_str());
}

void EsphelmRuntime::set_clock_(int64_t utc, const char *source) {
  int64_t before;
  const bool had = this->utc_now_(before);
  this->clock_utc_ = utc;
  this->clock_ms_ = millis();
  this->clock_set_ = true;
  if (this->clock_source_ != source)
    this->clock_source_ = source;
  if (had && std::llabs(before - utc) <= 2)
    return;  // a routine update
  char time_buf[9], date_buf[16];
  const char *suffix;
  esphelm::wallclock::time_text(utc, false, true, time_buf, sizeof(time_buf), suffix);
  esphelm::wallclock::date_text(utc, esphelm::wallclock::DateFormat::YMD, date_buf, sizeof(date_buf));
  ESP_LOGI(TAG, "Clock set from %s: %s %s UTC", source, date_buf, time_buf);
}

bool EsphelmRuntime::utc_now_(int64_t &utc) const {
  if (!this->clock_set_)
    return false;
  utc = this->clock_utc_ + (this->clock_frozen_ ? 0 : (millis() - this->clock_ms_) / 1000);
  return true;
}

void EsphelmRuntime::tick_clock_(uint32_t now) {
  if (now < this->next_clock_check_ms_)
    return;
  this->next_clock_check_ms_ = now + 10000;
  // Move the anchor forward now and then, so millis() wrapping (49 days) never matters.
  const uint32_t elapsed = (now - this->clock_ms_) / 1000;
  if (this->clock_set_ && !this->clock_frozen_ && elapsed >= 3600) {
    this->clock_utc_ += elapsed;
    this->clock_ms_ += elapsed * 1000;
  }
#ifdef USE_ESPHELM_TIME
  // The board's time (SNTP, HomeAssistant) when SignalK hasn't sent one for ten minutes.
  if (this->time_ != nullptr && this->clock_wanted_() &&
      (this->clock_signalk_ms_ == 0 || now - this->clock_signalk_ms_ > 600000)) {
    const ESPTime t = this->time_->utcnow();
    if (t.is_valid())
      this->set_clock_(t.timestamp, "the board's time");
  }
#endif
}

void EsphelmRuntime::wake_(const char *why) {
  lv_display_trigger_activity(nullptr);
  if (!this->asleep_)
    return;
  ESP_LOGI(TAG, "Screen on (%s)", why);
  this->asleep_ = false;
  this->saver_on_ = false;
  if (this->sleep_cover_ != nullptr)
    lv_obj_add_flag(this->sleep_cover_, LV_OBJ_FLAG_HIDDEN);
  this->applied_brightness_ = -1;
  this->apply_brightness_();
}

// ---- Settings panel (ADR-0025) ----

SettingsPanel::State EsphelmRuntime::panel_state_() const {
  SettingsPanel::State s;
  s.theme = this->theme_;
  s.choice = this->prefs_.theme;
  s.brightness = this->brightness_percent_();
  s.min_brightness = this->theme_ == esphelm::Theme::NIGHT ? esphelm::PREFS_MIN_NIGHT : esphelm::PREFS_MIN_DAY;
  s.can_sleep = this->layout_.settings.screen_timeout > 0;
#ifdef USE_ESPHELM_WIFI_SETUP
  s.wifi = true;
#endif
  s.ap_active = this->ap_active_();
  if (s.ap_active) {
    s.ap_ssid = this->ap_ssid_();
    s.ap_password = this->ap_password_;
  }
  s.server_choice = this->test_servers_ || !this->signalk_->server_configured();
  s.scanning = !this->test_servers_ && this->signalk_->scanning();
  for (const signalk::ServerCandidate &server : this->servers_()) {
    // "name  address:port"; the fonts only have ASCII.
    std::string text = server.hostname.empty() ? server.address : server.hostname;
    for (char &ch : text) {
      if (static_cast<unsigned char>(ch) < 0x20 || static_cast<unsigned char>(ch) > 0x7e)
        ch = '?';
    }
    s.servers.push_back(text + "  " + server.connect_host() + ":" + std::to_string(server.port));
  }
  return s;
}

// ---- Setup without configuration (ADR-0026) ----

void EsphelmRuntime::setup_ap_() {
  if (std::getenv("ESPHELM_TEST_SETUP") != nullptr) {
    this->ap_password_ = "Xk7pQ2mZ9t";  // the host build's setup screens: always the same
    return;
  }
#ifdef USE_WIFI_AP
  if (wifi::global_wifi_component == nullptr || !wifi::global_wifi_component->has_ap())
    return;
  StoredLayout saved;
  if (this->store_.load(Slot::AP, saved) && saved.etag == "ap" && esphelm::valid_ap_password(saved.body)) {
    this->ap_password_ = saved.body;
  } else {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
    // The RNG is only truly random while the radio or this entropy source runs, and the radio isn't
    // on yet (on the P4 it is on the network coprocessor). Made once per display.
    bootloader_random_enable();
    this->ap_password_ = esphelm::make_ap_password([]() { return esp_random(); });
    bootloader_random_disable();
#else
    this->ap_password_ = esphelm::make_ap_password([]() { return random_uint32(); });
#endif
    // Not saved: still a random password, only another one after every restart.
    if (!this->store_.save(Slot::AP, {"ap", this->ap_password_}))
      ESP_LOGW(TAG, "The setup network's password could not be saved");
  }
  wifi::WiFiAP ap = wifi::global_wifi_component->get_ap();
  ap.set_password(this->ap_password_);
  wifi::global_wifi_component->set_ap(ap);
#endif
}

void EsphelmRuntime::tick_network_() {
#ifdef USE_WIFI_AP
  if (!this->wifi_seen_ && this->wifi_connected_()) {
    this->wifi_seen_ = true;
    // From the first connection on, losing the network (the boat's router switched off) never
    // brings the setup network up: only a power-up without Wi-Fi, or "Forget Wi-Fi", does.
    wifi::global_wifi_component->set_ap_timeout(0);
    ESP_LOGD(TAG, "Wi-Fi connected; the setup network stays off until the next power-up");
  }
#endif
}

bool EsphelmRuntime::ap_active_() const {
  if (!this->test_setup_.empty())
    return this->test_setup_ == "ap";
#ifdef USE_WIFI_AP
  return wifi::global_wifi_component != nullptr && wifi::global_wifi_component->is_ap_active();
#else
  return false;
#endif
}

std::string EsphelmRuntime::ap_ssid_() const {
  if (!this->test_setup_.empty())
    return "esphelm-sdl-a1b2c3";
#ifdef USE_WIFI_AP
  // No SSID in the YAML: ESPHome names the network after the device (with its MAC suffix).
  if (wifi::global_wifi_component != nullptr) {
    const std::string ssid(wifi::global_wifi_component->get_ap().get_ssid().c_str());
    if (!ssid.empty())
      return ssid;
  }
#endif
  return App.get_name().substr(0, 32);
}

bool EsphelmRuntime::wifi_connected_() const {
  if (!this->test_setup_.empty())
    return this->test_setup_ != "ap" && this->test_setup_ != "joining";
#ifdef USE_WIFI
  return wifi::global_wifi_component != nullptr && wifi::global_wifi_component->is_connected();
#else
  return true;  // the host build is always on the network
#endif
}

const std::vector<signalk::ServerCandidate> &EsphelmRuntime::servers_() const {
  return this->test_servers_ ? this->test_server_list_ : this->signalk_->servers_found();
}

void EsphelmRuntime::forget_wifi_() {
#if defined(USE_ESPHELM_WIFI_SETUP) && defined(USE_ESP32_FRAMEWORK_ESP_IDF)
  // ESPHome can save a network but not forget one (an empty one still counts as set), so its
  // record is erased: the key of a build without a compiled-in network (wifi_component.cpp,
  // 88491487) and the fast-connect record after it. The layout, the token and the display's
  // choices stay. After the restart the setup network comes up at once.
  nvs_handle_t handle;
  if (nvs_open("esphome", NVS_READWRITE, &handle) == ESP_OK) {
    for (uint32_t key : {88491487u, 88491488u}) {
      char name[12];
      std::snprintf(name, sizeof(name), "%u", static_cast<unsigned>(key));
      nvs_erase_key(handle, name);
    }
    nvs_commit(handle);
    nvs_close(handle);
  }
  ESP_LOGW(TAG, "Wi-Fi network forgotten; restarting into the setup network");
  App.safe_reboot();
#else
  ESP_LOGW(TAG, "Forget Wi-Fi: this build has no saved network to forget");
#endif
}

void EsphelmRuntime::tick_panel_(uint32_t now) {
  if (!this->panel_.is_open())
    return;
  if (this->panel_.tick(now, this->panel_state_(), this->alarms_.height()))
    this->alarms_.raise();
  int8_t choice;
  if (this->panel_.take_choice(choice))
    this->set_theme_choice_(choice);
  int percent;
  bool done;
  if (this->panel_.take_brightness(percent, done)) {
    const bool night = this->theme_ == esphelm::Theme::NIGHT;
    (night ? this->prefs_.brightness_night : this->prefs_.brightness_day) = static_cast<int16_t>(percent);
    this->prefs_.set_base(this->layout_.settings, this->base_theme_);
    this->apply_brightness_();
    if (done) {
      ESP_LOGI(TAG, "Brightness chosen on the display: %d %% (%s)", percent, night ? "night" : "day");
      this->save_prefs_();
    }
  }
  if (this->panel_.take_sleep()) {
    ESP_LOGI(TAG, "Screen off from the settings");
    this->panel_.close();
    this->sleep_();
  }
  if (this->panel_.take_forget_wifi())
    this->forget_wifi_();
  if (this->panel_.take_forget_server()) {
    ESP_LOGI(TAG, "Forget server from the settings");
    if (!this->test_servers_)
      this->signalk_->forget_server();
  }
  if (this->panel_.take_scan() && !this->test_servers_)
    this->signalk_->scan_servers();
  int index;
  if (this->panel_.take_server(index) && index < static_cast<int>(this->servers_().size())) {
    const signalk::ServerCandidate server = this->servers_()[index];
    ESP_LOGI(TAG, "Server chosen in the settings: %s:%u", server.connect_host().c_str(), server.port);
    if (!this->test_servers_)
      this->signalk_->choose_server(server);
  }
  this->panel_.take_close();
}

/// "3 d 04:05:06", or "04:05:06" under a day.
static std::string uptime_text(uint64_t seconds) {
  char buf[32];
  const unsigned d = static_cast<unsigned>(seconds / 86400);
  const unsigned hms = static_cast<unsigned>(seconds % 86400);
  if (d > 0)
    std::snprintf(buf, sizeof(buf), "%u d %02u:%02u:%02u", d, hms / 3600, hms / 60 % 60, hms % 60);
  else
    std::snprintf(buf, sizeof(buf), "%02u:%02u:%02u", hms / 3600, hms / 60 % 60, hms % 60);
  return buf;
}

void EsphelmRuntime::fill_info_(std::vector<InfoRow> &rows, bool network) const {
  char buf[48];
  const uint32_t now = millis();
  lv_display_t *disp = lv_display_get_default();
  // Values that change by themselves read "test" under ESPHELM_TEST_INFO=fixed, for screenshots.
  static const char *const CHANGING[] = {"Up", "Free memory", "Signal", "Deltas", "Dropped", "Last delta", "UTC"};
  const auto fix = [&]() {
    if (!this->info_fixed_)
      return;
    for (InfoRow &row : rows) {
      for (const char *n : CHANGING) {
        if (std::strcmp(row.name, n) == 0)
          row.value = "test";
      }
    }
  };

  const std::string &host = this->signalk_->get_host();
  const std::string server =
      host.empty() ? std::string("searching") : host + ":" + std::to_string(this->signalk_->get_port());
  const char *stream;
  switch (this->signalk_->access_state()) {
    case signalk::SignalKAccessState::PENDING_APPROVAL:
      stream = "waiting for approval";
      break;
    case signalk::SignalKAccessState::DENIED:
      stream = "access denied";
      break;
    default:
      stream = this->signalk_->is_stream_connected() ? "connected" : "not connected";
  }

  if (network) {
    // As many rows on every build: the panel builds its labels once.
    rows.push_back({"Wi-Fi", "Network", "-"});
    rows.push_back({nullptr, "Signal", "-"});
#ifdef USE_WIFI
    if (wifi::global_wifi_component != nullptr && wifi::global_wifi_component->is_connected()) {
      char ssid[wifi::SSID_BUFFER_SIZE];
      rows[0].value = wifi::global_wifi_component->wifi_ssid_to(ssid);
      std::snprintf(buf, sizeof(buf), "%d dBm", wifi::global_wifi_component->wifi_rssi());
      rows[1].value = buf;
    } else {
      rows[0].value = "not connected";
    }
#endif
    std::string ip = "-";
#ifdef USE_NETWORK
    for (const auto &addr : network::get_ip_addresses()) {
      char ip_buf[network::IP_ADDRESS_BUFFER_SIZE];
      if (addr.is_ip4() && std::strcmp(addr.str_to(ip_buf), "0.0.0.0") != 0) {
        ip = ip_buf;
        break;
      }
    }
#endif
    rows.push_back({nullptr, "IP", ip});
    rows.push_back({nullptr, "Setup network", this->ap_active_() ? std::string("on") : std::string("off")});
    const signalk::ServerCandidate &bound = this->signalk_->current_server();
    rows.push_back({"SignalK server", "Address", server});
    rows.push_back({nullptr, "Name", this->signalk_->server_configured() || bound.hostname.empty()
                                         ? std::string("-")
                                         : bound.hostname});
    rows.push_back({nullptr, "Stream", stream});
    fix();
    return;
  }

  rows.push_back({"Display", "Id", this->device_id_});
  rows.push_back({nullptr, "Board", this->board_});
  rows.push_back({nullptr, "Firmware", FIRMWARE_VERSION});
  std::snprintf(buf, sizeof(buf), "%d x %d", (int) lv_display_get_horizontal_resolution(disp),
                (int) lv_display_get_vertical_resolution(disp));
  rows.push_back({nullptr, "Screen", buf});
  rows.push_back({nullptr, "Up", uptime_text(millis_64() / 1000)});
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  const unsigned internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024;
  if (this->psram_)
    std::snprintf(buf, sizeof(buf), "%u KB, PSRAM %u KB", internal,
                  (unsigned) (heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
  else
    std::snprintf(buf, sizeof(buf), "%u KB", internal);
  rows.push_back({nullptr, "Free memory", buf});
#endif

  rows.push_back({"SignalK", "Server", server});
  rows.push_back({nullptr, "Stream", stream});
  rows.push_back({nullptr, "Deltas", std::to_string(this->signalk_->deltas_received())});
  rows.push_back({nullptr, "Dropped", std::to_string(this->signalk_->messages_dropped())});
  const uint32_t last = this->signalk_->last_delta_ms();
  if (last == 0)
    rows.push_back({nullptr, "Last delta", "-"});
  else
    rows.push_back({nullptr, "Last delta", uptime_text((now - last) / 1000) + " ago"});
  rows.push_back({nullptr, "Paths", std::to_string(this->signalk_->subscribed_paths())});

  static const char *const STATES[] = {"unknown", "not adopted", "no layout", "adopted"};
  rows.push_back({"Layout", "Name", this->has_layout_ ? this->layout_.id : std::string("-")});
  std::string version = this->etag_;
  version.erase(std::remove(version.begin(), version.end(), '"'), version.end());
  rows.push_back({nullptr, "Version", version.empty() ? std::string("-") : version});
  rows.push_back({nullptr, "From", this->has_layout_ ? this->layout_origin_ : "-"});
  rows.push_back({nullptr, "Pages", std::to_string(this->has_layout_ ? this->layout_.pages.size() : 0)});
  rows.push_back({nullptr, "Plugin", STATES[static_cast<int>(this->server_state_)]});

  int64_t utc;
  if (this->utc_now_(utc)) {
    char time_buf[9], date_buf[16];
    const char *suffix;
    esphelm::wallclock::time_text(utc, false, true, time_buf, sizeof(time_buf), suffix);
    esphelm::wallclock::date_text(utc, esphelm::wallclock::DateFormat::YMD, date_buf, sizeof(date_buf));
    std::snprintf(buf, sizeof(buf), "%s %s", date_buf, time_buf);
    rows.push_back({"Clock", "UTC", buf});
    rows.push_back({nullptr, "From", this->clock_source_});
  } else {
    // As many rows either way: the panel builds its labels once.
    rows.push_back({"Clock", "UTC", "not set"});
    rows.push_back({nullptr, "From", "-"});
  }
  const std::string &zone = this->layout_.settings.time_zone_name;
  rows.push_back({nullptr, "Time zone", zone.empty() ? std::string("UTC") : zone});
  fix();
}

// ---- Boot guard (ADR-0013) ----

void EsphelmRuntime::check_boot_record_(const std::string &cached_etag) {
  StoredLayout rec;
  if (!this->store_.load(Slot::BOOT, rec))
    return;
  const unsigned attempts = std::strtoul(rec.body.c_str(), nullptr, 10);
  const size_t nl = rec.body.find('\n');
  if (nl != std::string::npos)
    this->bad_etag_ = rec.body.substr(nl + 1);
  if (attempts == 0 || rec.etag.empty() || !crash_reset())
    return;  // the last boot survived its layout, or ended by power cut / restart
  // A fetched layout that crashed before it was cached, or a cached one that crashed repeatedly.
  if (rec.etag != cached_etag || attempts >= MAX_BOOT_ATTEMPTS) {
    ESP_LOGE(TAG, "Layout %s crashed the display (%u attempt%s); skipping it", rec.etag.c_str(), attempts,
             attempts == 1 ? "" : "s");
    this->bad_etag_ = rec.etag;
    this->save_boot_record_();
  } else {
    ESP_LOGW(TAG, "The display crashed while showing layout %s; trying it once more", rec.etag.c_str());
    this->boot_etag_ = rec.etag;
    this->boot_attempts_ = attempts;
  }
}

void EsphelmRuntime::save_boot_record_() {
  this->store_.save(Slot::BOOT, {this->boot_etag_, std::to_string(this->boot_attempts_) + "\n" + this->bad_etag_});
}

void EsphelmRuntime::clean_exit() {
  if (this->boot_attempts_ != 0) {
    this->boot_attempts_ = 0;
    this->save_boot_record_();
  }
}

bool EsphelmRuntime::build_page_(size_t index) {
  WidgetEnv env;
  env.fonts = this->fonts_;
  env.colors = colors_for(this->layout_.theme);
  env.default_stale_ms = this->stale_after_ms_;
  env.put = [this](const std::string &path, const PutValue &value) { this->signalk_->put_request(path, value); };
  env.can_put = [this]() { return this->signalk_->is_connected(); };
  env.psram = this->psram_;
  env.night = this->layout_.theme == esphelm::Theme::NIGHT;
  env.has_history = [this](const std::string &key) { return this->history_.find(key) >= 0; };
  env.history = &this->history_;
  env.utc_now = [this](int64_t &utc) { return this->utc_now_(utc); };
  env.time_zone = this->layout_.settings.time_zone;
  env.open_history = [this](const std::string &id) { this->history_wanted_ = id; };
  env.fetch = [this](const std::string &path, uint32_t tag, size_t max_body) {
    if (this->tiles_.busy() || this->signalk_->access_state() != signalk::SignalKAccessState::AUTHORIZED)
      return false;
    HttpRequest req;
    req.kind = RequestKind::TILE;
    req.url = this->base_url_() + path;
    req.token = this->signalk_->get_token();
    req.max_body = max_body;
    req.tag = tag;
    this->tiles_.submit(std::move(req));
    return true;
  };
  if (!this->renderer_.show_page(this->layout_, index, env, this->widgets_))
    return false;
  this->page_ = index;
  this->subscribe_page_();
  const esphelm::Page &p = this->layout_.pages[index];
  ESP_LOGI(TAG, "Page %u/%u \"%s\"", (unsigned) index + 1, (unsigned) this->layout_.pages.size(),
           (p.title.empty() ? p.id : p.title).c_str());
  return true;
}

void EsphelmRuntime::show_page(size_t index) {
  if (!this->has_layout_ || index >= this->layout_.pages.size() || index == this->page_)
    return;
  if (!this->build_page_(index)) {
    // Out of memory on that page: go back to the one that worked.
    this->build_page_(this->page_);
  }
  this->queue_meta_reads_();
}

void EsphelmRuntime::tap(const std::string &tile_id, const std::string &part) {
  if (tile_id == "@alarm") {  // not a tile id (ids can't contain "@"): the alarm banner
    this->alarms_.tap(part);
    return;
  }
  if (tile_id == "@history") {  // the history popup's buttons: close, 10m, 1h, 6h
    this->popup_.tap(part);
    return;
  }
  if (tile_id == "@theme") {  // day/night, as the panel's buttons would
    this->theme_toggle_wanted_ = true;
    return;
  }
  if (tile_id == "@menu") {  // the footer's menu button
    lv_display_trigger_activity(nullptr);  // as a touch would
    this->menu_wanted_ = true;
    return;
  }
  if (tile_id == "@settings") {  // the settings panel's controls (SettingsPanel::tap)
    lv_display_trigger_activity(nullptr);
    this->panel_.tap(part);
    return;
  }
  if (tile_id == "@screen") {  // a touch on the switched-off screen
    if (this->asleep_)
      this->wake_wanted_ = true;
    else
      lv_display_trigger_activity(nullptr);
    return;
  }
  if (this->popup_.is_open() || this->panel_.is_open()) {
    ESP_LOGW(TAG, "tap: %s is under the %s", tile_id.c_str(), this->popup_.is_open() ? "history popup" : "settings");
    return;
  }
  for (auto &w : this->widgets_) {
    if (w->id() == tile_id) {
      w->tap(part);
      return;
    }
  }
  ESP_LOGW(TAG, "tap: no tile \"%s\" on this page", tile_id.c_str());
}

void EsphelmRuntime::clear_layout_() {
  for (uint32_t id : this->listeners_)
    this->signalk_->remove_listener(id);
  this->listeners_.clear();
  if (!this->sun_path_.empty()) {
    this->signalk_->remove_listener(this->sun_listener_);
    this->sun_path_.clear();
  }
  if (!this->clock_path_.empty()) {
    this->signalk_->remove_listener(this->clock_listener_);
    this->clock_path_.clear();
  }
  if (this->asleep_)
    this->wake_("no layout");
  this->popup_.close();
  this->panel_.close();
  this->history_.clear();
  this->widgets_.clear();
  this->has_layout_ = false;
  this->etag_.clear();
  this->body_.clear();
}

void EsphelmRuntime::subscribe_page_() {
  // Listeners derive from the visible page: one per unique path. SignalK batches the change
  // (incremental subscribe, or unsubscribe-all + resubscribe) and replays cached values.
  for (uint32_t id : this->listeners_)
    this->signalk_->remove_listener(id);
  this->listeners_.clear();
  std::vector<std::string> paths;
  for (const auto &w : this->widgets_)
    w->paths(paths);
  // History records on every page, so it also listens to the value tiles it can't see.
  for (size_t i = 0; i < this->history_.size(); i++)
    paths.push_back(this->history_.path(i));
  std::sort(paths.begin(), paths.end());
  paths.erase(std::unique(paths.begin(), paths.end()), paths.end());
  for (const auto &path : paths) {
    if (path.empty())
      continue;
    this->listeners_.push_back(this->signalk_->add_listener(
        path, [this](const std::string &p, ArduinoJson::JsonVariantConst v) { this->on_value_(p, v); }));
  }
}

void EsphelmRuntime::on_value_(const std::string &path, ArduinoJson::JsonVariantConst value) {
  const uint32_t now = millis();
  for (auto &w : this->widgets_)
    w->on_value(path, value, now);
  for (size_t i = 0; i < this->history_.size(); i++) {
    double v;
    if (this->history_.path(i) == path && display_number(value, this->history_.unit(i), v))
      this->history_.record(i, v, now);
  }
}

// ---- Zones from the server's metadata (ADR-0020) ----

static bool has_zones(const esphelm::Tile &tile) {
  return tile.type == esphelm::TileType::VALUE || tile.type == esphelm::TileType::GAUGE ||
         tile.type == esphelm::TileType::BAR || tile.type == esphelm::TileType::GRAPH;
}

bool EsphelmRuntime::on_visible_page_(const std::string &path) const {
  if (!this->has_layout_ || this->page_ >= this->layout_.pages.size())
    return false;
  for (const auto &t : this->layout_.pages[this->page_].tiles) {
    if (has_zones(t) && t.data.path == path)
      return true;
  }
  return false;
}

void EsphelmRuntime::on_meta_changed_(const std::string &path) {
  if (!this->on_visible_page_(path))
    return;
  ESP_LOGD(TAG, "Metadata of %s changed", path.c_str());
  if (std::find(this->meta_queue_.begin(), this->meta_queue_.end(), path) == this->meta_queue_.end())
    this->meta_queue_.push_back(path);
  // The server may still be storing it, and a change often comes as several deltas.
  this->meta_not_before_ms_ = millis() + META_DEBOUNCE_MS;
}

void EsphelmRuntime::queue_meta_reads_() {
  this->meta_queue_.clear();
  if (this->page_ >= this->layout_.pages.size())
    return;
  for (const auto &t : this->layout_.pages[this->page_].tiles) {
    if (has_zones(t) && !t.data.path.empty() &&
        std::find(this->meta_queue_.begin(), this->meta_queue_.end(), t.data.path) == this->meta_queue_.end())
      this->meta_queue_.push_back(t.data.path);
  }
}

void EsphelmRuntime::pump_meta_(uint32_t now, bool ready) {
  if (!this->has_layout_)
    return;
  if (ready && now >= this->next_meta_read_ms_) {
    this->next_meta_read_ms_ = now + META_READ_INTERVAL_MS;
    this->queue_meta_reads_();
  }
  if (ready && !this->meta_in_flight_ && !this->meta_queue_.empty() && now >= this->meta_not_before_ms_) {
    this->meta_path_ = this->meta_queue_.front();
    this->meta_queue_.erase(this->meta_queue_.begin());
    std::string url = this->meta_path_;
    std::replace(url.begin(), url.end(), '.', '/');
    HttpRequest req;
    req.kind = RequestKind::META;
    req.url = "http://" + this->signalk_->get_host() + ":" + std::to_string(this->signalk_->get_port()) +
              "/signalk/v1/api/vessels/self/" + url + "/meta";
    req.token = this->signalk_->get_token();
    req.max_body = META_MAX_BODY;
    req.tag = this->meta_generation_;
    this->client_.submit(std::move(req));
    this->meta_in_flight_ = true;
  }
  // Not under the popup or while asleep: they stay as they are, and the page catches up after.
  if (this->zones_dirty_ && !this->popup_.is_open() && !this->asleep_) {
    this->zones_dirty_ = false;
    if (!this->build_page_(this->page_))
      ESP_LOGW(TAG, "Out of memory rebuilding the page with new zones");
  }
}

void EsphelmRuntime::handle_meta_(const HttpResult &result) {
  this->meta_in_flight_ = false;
  if (result.tag != this->meta_generation_)
    return;  // read for an older layout
  if (result.status == 200 && !result.truncated) {
    std::vector<esphelm::ServerZone> zones;
    if (esphelm::parse_meta_zones(result.body, zones)) {
      if (zones.empty())
        this->server_zones_.erase(this->meta_path_);
      else
        this->server_zones_[this->meta_path_] = std::move(zones);
    } else {
      ESP_LOGW(TAG, "Unreadable metadata for %s; keeping its zones", this->meta_path_.c_str());
    }
  } else if (result.status == 200) {
    ESP_LOGW(TAG, "Metadata of %s is over %u bytes; keeping its zones", this->meta_path_.c_str(),
             (unsigned) META_MAX_BODY);
  } else if (result.status == 404) {
    this->server_zones_.erase(this->meta_path_);  // the server has no metadata for it
  } else {
    // Transport error, 401, 5xx: says nothing about the zones. The next read tries again.
    ESP_LOGD(TAG, "Metadata of %s not read (HTTP %d)", this->meta_path_.c_str(), result.status);
  }
  if (this->meta_queue_.empty() && this->apply_server_zones_())
    this->zones_dirty_ = true;
}

bool EsphelmRuntime::apply_server_zones_() {
  bool visible_changed = false;
  for (size_t p = 0; p < this->layout_.pages.size(); p++) {
    for (auto &t : this->layout_.pages[p].tiles) {
      if (!has_zones(t))
        continue;
      std::vector<esphelm::Zone> zones;
      auto it = this->server_zones_.find(t.data.path);
      if (it != this->server_zones_.end()) {
        // A graph takes them as a value tile does: open ends; its bands are cut to the axis it draws.
        const bool scale = t.type == esphelm::TileType::GAUGE || t.type == esphelm::TileType::BAR;
        esphelm::server_zones_to_display(it->second, t.data.unit, scale ? &t.min : nullptr, scale ? &t.max : nullptr,
                                         zones);
      }
      const bool from_server = !zones.empty();
      if (!from_server)
        zones = t.own_zones;
      const bool same = zones.size() == t.zones.size() &&
                        std::equal(zones.begin(), zones.end(), t.zones.begin(),
                                   [](const esphelm::Zone &a, const esphelm::Zone &b) {
                                     return a.from == b.from && a.to == b.to && a.state == b.state;
                                   });
      if (same)
        continue;
      ESP_LOGI(TAG, "Tile %s: %u zones, %s", t.id.c_str(), (unsigned) zones.size(),
               from_server ? "from the server" : "its own");
      t.zones = std::move(zones);
      if (p == this->page_)
        visible_changed = true;
    }
  }
  return visible_changed;
}

// ---- Value history (ADR-0018, ADR-0019) ----

// Button text of a wind rose value without a label (ROSE_HISTORY_TITLES in packages/schema).
static const char *const ROSE_HISTORY_TITLES[esphelm::RoseConfig::HISTORY_KEYS] = {
    "Centre 1", "Centre 2", "Centre 3", "Top left", "Top right", "Bottom left", "Bottom right", "AWA", "TWD", "HDG"};

/// The values of `tile` that ask to record, in the order of historySeries() in packages/schema:
/// a value tile with history on, a graph tile (it always records, ADR-0021), or a wind rose's
/// `history` names whose slot is filled.
static void tile_series(const esphelm::Tile &tile, std::vector<HistorySeries> &out) {
  if (tile.type == esphelm::TileType::VALUE || tile.type == esphelm::TileType::GRAPH) {
    if (tile.history || tile.type == esphelm::TileType::GRAPH)
      out.push_back({tile.id, "", tile.data.label, tile.data, tile.zones, tile.color});
    return;
  }
  if (tile.type != esphelm::TileType::WIND_ROSE || !tile.rose)
    return;
  const esphelm::RoseConfig &rose = *tile.rose;
  for (int i = 0; i < esphelm::RoseConfig::HISTORY_KEYS; i++) {
    if (!rose.history[i])
      continue;
    HistorySeries s;
    s.key = tile.id + "/" + esphelm::ROSE_HISTORY_NAMES[i];
    s.name = esphelm::ROSE_HISTORY_NAMES[i];
    if (i < esphelm::RoseConfig::MAX_SLOTS) {
      if (!rose.has_slot[i])
        continue;
      s.data = rose.slots[i];
      s.title = s.data.label.empty() ? ROSE_HISTORY_TITLES[i] : s.data.label;
    } else {
      // The angles the rose draws, in degrees like its markers.
      s.data.path = i == esphelm::RoseConfig::HISTORY_APPARENT ? rose.apparent_angle
                    : i == esphelm::RoseConfig::HISTORY_TRUE   ? rose.true_direction
                                                                 : rose.heading;
      s.data.unit = esphelm::units::find_unit("deg");
      s.data.decimals = 0;
      s.title = ROSE_HISTORY_TITLES[i];
    }
    if (s.data.label.empty())
      s.data.label = s.title;
    out.push_back(std::move(s));
  }
}

const esphelm::Tile *EsphelmRuntime::find_tile_(const std::string &id) const {
  for (const auto &page : this->layout_.pages) {
    for (const auto &tile : page.tiles) {
      if (tile.id == id)
        return &tile;
    }
  }
  return nullptr;
}

void EsphelmRuntime::configure_history_() {
  std::vector<esphelm::ValueHistory::Spec> specs;
  std::vector<HistorySeries> series;
  for (const auto &page : this->layout_.pages) {
    for (const auto &tile : page.tiles)
      tile_series(tile, series);
  }
  for (const auto &s : series) {
    const uint32_t stale =
        s.data.stale_after > 0 ? static_cast<uint32_t>(s.data.stale_after * 1000) : this->stale_after_ms_;
    specs.push_back({s.key, s.data.path, s.data.unit, stale});
  }
  std::vector<std::string> skipped;
  const int windows = this->psram_ ? esphelm::sizes::HISTORY_WINDOWS : esphelm::sizes::HISTORY_NO_PSRAM_WINDOWS;
  const size_t max_values =
      this->psram_ ? esphelm::sizes::HISTORY_MAX_VALUES_PSRAM : esphelm::sizes::HISTORY_MAX_VALUES_NO_PSRAM;
  this->history_.configure(specs, millis(), windows, max_values, this->psram_, skipped);
  if (!skipped.empty()) {
    std::string ids;
    for (const auto &id : skipped)
      ids += (ids.empty() ? "" : ", ") + id;
    ESP_LOGW(TAG, "No history for %u values (limit %u on this display): %s", (unsigned) skipped.size(),
             (unsigned) max_values, ids.c_str());
  }
  ESP_LOGD(TAG, "History: %u values, %u windows, %u bytes", (unsigned) this->history_.size(), (unsigned) windows,
           (unsigned) this->history_.bytes());
#ifdef USE_HOST
  // Test hook (SDL e2e goldens): a fixed curve with a gap for these values (comma separated keys),
  // kept still. Angles cross north (350..10), plain values wave around 6.
  const char *seed = std::getenv("ESPHELM_TEST_HISTORY");
  std::string keys = seed != nullptr ? seed : "";
  while (!keys.empty()) {
    const size_t comma = keys.find(',');
    const std::string key = keys.substr(0, comma);
    keys = comma == std::string::npos ? "" : keys.substr(comma + 1);
    const int idx = this->history_.find(key);
    if (idx < 0)
      continue;
    const bool angle = this->history_.circular(idx);
    for (int w = 0; w < this->history_.windows(); w++) {
      for (int k = 0; k < esphelm::sizes::HISTORY_POINTS; k++) {
        const float wave = std::sin(k / (12.0f + 8.0f * w)) + 0.2f * std::sin(k / 2.5f);
        float v = angle ? std::fmod(360.0f + 8.0f * wave, 360.0f) : 6.0f + 1.5f * wave;
        const float spread = angle ? 2.0f : 0.2f;
        if (k >= 70 && k < 78)
          v = std::nanf("");
        this->history_.push(idx, w, {v, v - spread, v + spread});
      }
    }
    this->history_.freeze(idx);
    ESP_LOGI(TAG, "ESPHELM_TEST_HISTORY: seeded %s", key.c_str());
  }
#endif
  // An open popup follows its tile into the new layout (on the same value if it still records),
  // or closes if nothing of it records any more.
  if (this->popup_.is_open()) {
    const std::string key = this->popup_.key();
    const std::string tile_id = this->popup_.tile_id();
    if (!this->open_history_(tile_id, key))
      this->popup_.close();
  }
}

bool EsphelmRuntime::open_history_(const std::string &tile_id, const std::string &key) {
  const esphelm::Tile *tile = this->find_tile_(tile_id);
  if (tile == nullptr)
    return false;
  std::vector<HistorySeries> all, series;
  tile_series(*tile, all);
  size_t selected = 0;
  for (auto &s : all) {
    if (this->history_.find(s.key) < 0)
      continue;  // over this display's limit
    if (s.key == key)
      selected = series.size();
    series.push_back(std::move(s));
  }
  if (series.empty())
    return false;
  this->popup_.open(tile_id, std::move(series), selected, this->theme_, this->alarms_.height());
  this->alarms_.raise();
  return true;
}

// ---- Status page ----

void EsphelmRuntime::show_status_(const std::string &headline, const std::string &detail, const std::string &qr) {
  const std::string key = headline + "\n" + detail + "\n" + qr;
  if (key == this->status_key_)
    return;
  this->status_key_ = key;
  ESP_LOGI(TAG, "Status: %s", headline.c_str());
  this->renderer_.show_status(headline, detail, "ESPHelm " + std::string(FIRMWARE_VERSION) + "\n" + this->device_id_,
                              this->theme_, this->touch_, qr);
}

void EsphelmRuntime::update_status_() {
  using signalk::SignalKAccessState;
  const SignalKAccessState access = this->signalk_->access_state();
  if (!this->layout_error_.empty()) {
    this->show_status_("Layout rejected", this->layout_error_);
  } else if (this->ap_active_()) {
    // Setup (ADR-0026): join the display's own network, then pick the boat's in the page it opens.
    const std::string ssid = this->ap_ssid_();
    this->show_status_("Set up Wi-Fi",
                       "Join the network " + ssid + "\nPassword " + this->ap_password_ +
                           "\nthen choose the boat's network on the page that opens (or http://192.168.4.1)",
                       esphelm::wifi_qr_text(ssid, this->ap_password_));
  } else if (!this->wifi_connected_()) {
    this->show_status_("Joining Wi-Fi", "Without Wi-Fi after a power-up, the setup network opens in 2 minutes");
  } else if (this->signalk_->get_host().empty()) {
    this->show_status_("Looking for a SignalK server", "Searching the network (mDNS)");
  } else if (access == SignalKAccessState::PENDING_APPROVAL) {
    this->show_status_("Approve this display in SignalK",
                       "Security > Access Requests: grant read/write");
  } else if (access == SignalKAccessState::DENIED) {
    this->show_status_("SignalK denied access", "Remove the request in SignalK and restart the display");
  } else if (access != SignalKAccessState::AUTHORIZED) {
    this->show_status_("Connecting to SignalK",
                       this->signalk_->get_host() + ":" + std::to_string(this->signalk_->get_port()));
  } else if (this->server_state_ == ServerState::PENDING) {
    this->show_status_("Adopt this display in ESPHelm", "Device " + this->device_id_);
  } else if (this->server_state_ == ServerState::NO_LAYOUT) {
    this->show_status_("No layout assigned", "Assign a layout to this display in the ESPHelm editor");
  } else if (!this->transport_error_.empty()) {
    this->show_status_("ESPHelm plugin unreachable", this->transport_error_);
  } else {
    this->show_status_("Waiting for layout", "");
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
