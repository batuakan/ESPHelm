#include "esphelm_runtime.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_heap_caps.h>
#include <esp_system.h>
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
  this->compute_capacity_();
  this->renderer_.set_fonts(this->fonts_);
  this->renderer_.set_navigation([this](int step) { this->pending_step_ += step; });
  this->device_id_ = this->signalk_->get_device_id();
  this->version_path_ = "plugins.esphelm." + this->device_id_ + ".version";
  this->client_.start();
  this->tiles_.start();

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

  if (this->has_layout_) {
    if (this->pending_step_ != 0) {
      const int target = static_cast<int>(this->page_) + this->pending_step_;
      this->pending_step_ = 0;
      if (target >= 0)
        this->show_page(static_cast<size_t>(target));
    }
    for (auto &w : this->widgets_)
      w->tick(now);
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
  this->check_sleep_(now);
  this->alarms_.tick(this->theme_, connected,
                     authorized && connected && this->server_state_ != ServerState::UNKNOWN);
  // The banner pushes the page down instead of covering it, so no control hides under it.
  if (this->renderer_.set_top_inset(this->alarms_.height())) {
    for (auto &w : this->widgets_)
      w->layout_done();
  }
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
  for (const char *w : {"value", "gauge", "bar", "switch", "wind_rose", "autopilot"})
    doc["widgets"].add(w);
  if (this->psram_)
    doc["widgets"].add("chart");
  ArduinoJson::JsonArray fonts = doc["fonts"].to<ArduinoJson::JsonArray>();
  fonts.add("value");
  fonts.add("label");
  fonts.add("small");
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
  // The theme the page is built with: the layout's, or night by environment.sun (autoTheme).
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
  if (this->asleep_)
    this->wake_("new layout");
  this->apply_brightness_();
  this->status_key_.clear();
  this->etag_ = etag;
  this->body_ = body;
  this->shown_at_ = millis();
  this->lkg_saved_ = false;
  if (persist && !this->store_.save(Slot::CURRENT, {etag, body}))
    ESP_LOGW(TAG, "Could not cache the layout; it will not survive a reboot");
  ESP_LOGI(TAG, "Showing %s layout \"%s\" (%u pages, %u bytes, ETag %s)", origin, this->layout_.id.c_str(),
           (unsigned) this->layout_.pages.size(), (unsigned) body.size(), etag.c_str());
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
  this->sun_night_ = night;
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

void EsphelmRuntime::apply_brightness_() {
  if (this->asleep_)
    return;
  const esphelm::Settings &s = this->layout_.settings;
  const int percent = this->theme_ == esphelm::Theme::NIGHT ? s.brightness_night : s.brightness_day;
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
  if (this->asleep_ && this->backlight_ != nullptr && this->backlight_->remote_values.is_on()) {
    this->wake_("touch");
    return;
  }
#endif
  const uint32_t timeout = this->layout_.settings.screen_timeout;
  if (this->asleep_ || !this->has_layout_ || timeout == 0)
    return;
  const uint32_t after_ms = std::max<uint32_t>(timeout, 10) * 1000;
  if (lv_display_get_inactive_time(nullptr) >= after_ms)
    this->sleep_();
}

void EsphelmRuntime::sleep_() {
  ESP_LOGI(TAG, "Screen off after %u s without a touch", (unsigned) std::max<uint32_t>(this->layout_.settings.screen_timeout, 10));
  this->asleep_ = true;
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
  this->set_backlight_(false, 0);
}

void EsphelmRuntime::wake_(const char *why) {
  lv_display_trigger_activity(nullptr);
  if (!this->asleep_)
    return;
  ESP_LOGI(TAG, "Screen on (%s)", why);
  this->asleep_ = false;
  if (this->sleep_cover_ != nullptr)
    lv_obj_add_flag(this->sleep_cover_, LV_OBJ_FLAG_HIDDEN);
  this->applied_brightness_ = -1;
  this->apply_brightness_();
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
}

void EsphelmRuntime::tap(const std::string &tile_id, const std::string &part) {
  if (tile_id == "@alarm") {  // not a tile id (ids can't contain "@"): the alarm banner
    this->alarms_.tap(part);
    return;
  }
  if (tile_id == "@screen") {  // a touch on the switched-off screen
    if (this->asleep_)
      this->wake_wanted_ = true;
    else
      lv_display_trigger_activity(nullptr);
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
  if (this->asleep_)
    this->wake_("no layout");
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
}

// ---- Status page ----

void EsphelmRuntime::show_status_(const std::string &headline, const std::string &detail) {
  const std::string key = headline + "\n" + detail;
  if (key == this->status_key_)
    return;
  this->status_key_ = key;
  this->renderer_.show_status(headline, detail, "ESPHelm " + std::string(FIRMWARE_VERSION) + "\n" + this->device_id_,
                              this->theme_);
}

void EsphelmRuntime::update_status_() {
  using signalk::SignalKAccessState;
  const SignalKAccessState access = this->signalk_->access_state();
  if (!this->layout_error_.empty()) {
    this->show_status_("Layout rejected", this->layout_error_);
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
