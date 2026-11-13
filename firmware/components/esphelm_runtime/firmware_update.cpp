#include "firmware_update.h"

#include <cstdio>
#include <memory>

#include "esphome/core/log.h"
#include "esphelm_runtime.h"

#ifdef USE_ESP32
#include <esp_app_desc.h>
#endif
#ifdef USE_ESPHELM_OTA
#include "esphome/components/ota/ota_backend_factory.h"
#endif
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_http_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif
#ifdef USE_HOST
#include <fstream>
#include <thread>
#include <vector>
#include <ixwebsocket/IXHttpClient.h>
#ifdef USE_ESPHELM_OTA
#include "esphome/components/sha256/sha256.h"
#endif
#endif

#ifndef ESPHELM_BOARD
#define ESPHELM_BOARD ""
#endif
#ifdef USE_ESPHELM_MONO
#define ESPHELM_KIND "mono"
#else
#define ESPHELM_KIND "color"
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.ota";

// FIRMWARE_VERSION is a variable, so the marker is joined from the same literal the header keeps
// in sync (a static_assert in firmware_update_test would catch drift; the plugin checks the format).
static const char IMAGE_MARKER[] = "ESPHELM-IMAGE/1 fw=" ESPHELM_FIRMWARE_VERSION " board=" ESPHELM_BOARD
                                   " kind=" ESPHELM_KIND;

const char *image_marker() { return IMAGE_MARKER; }

static std::string to_hex(const uint8_t *bytes, size_t n) {
  static const char *const DIGITS = "0123456789abcdef";
  std::string out;
  out.reserve(n * 2);
  for (size_t i = 0; i < n; i++) {
    out += DIGITS[bytes[i] >> 4];
    out += DIGITS[bytes[i] & 0x0F];
  }
  return out;
}

std::string firmware_build_id() {
#if defined(USE_ESP32)
  // The sha256 of the app's ELF, in the image's app descriptor: free to read, and the plugin reads
  // the same 32 bytes from an uploaded image.
  return to_hex(esp_app_get_description()->app_elf_sha256, 32);
#elif defined(USE_HOST) && defined(USE_ESPHELM_OTA)
  // The program itself, once: an update replaces it, and the restarted program hashes the new one.
  static const std::string id = [] {
    std::ifstream in("/proc/self/exe", std::ios::binary);
    if (!in)
      return std::string();
    sha256::SHA256 hash;
    hash.init();
    std::vector<char> buf(64 * 1024);
    while (in.read(buf.data(), buf.size()) || in.gcount() > 0)
      hash.add(reinterpret_cast<const uint8_t *>(buf.data()), static_cast<size_t>(in.gcount()));
    hash.calculate();
    uint8_t digest[32];
    hash.get_bytes(digest);
    return to_hex(digest, 32);
  }();
  return id;
#else
  return "";
#endif
}

#ifdef USE_ESPHELM_OTA

static const int TIMEOUT_MS = 10000;
static const size_t CHUNK = 4096;

void EsphelmOta::dump_config() {
  ESP_LOGCONFIG(TAG, "Firmware updates from the ESPHelm plugin\n  %s\n  Build: %s", image_marker(),
                firmware_build_id().c_str());
}

bool EsphelmOta::start(const std::string &url, const std::string &token, size_t size, const std::string &md5) {
  if (this->phase() == Phase::RUNNING)
    return false;
  this->url_ = url;
  this->token_ = token;
  this->size_ = size;
  this->md5_ = md5;
  this->written_ = 0;
  {
    std::lock_guard<std::mutex> lock(this->mutex_);
    this->error_.clear();
  }
  this->phase_ = static_cast<uint8_t>(Phase::RUNNING);
  this->notify_(ota::OTA_STARTED, 0.0f, false);
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  // esp_http_client and the flash writes need a few KB of stack; the task ends when it's done.
  if (xTaskCreate(
          [](void *self) {
            static_cast<EsphelmOta *>(self)->run_();
            vTaskDelete(nullptr);
          },
          "esphelm_ota", 8192, this, 5, nullptr) != pdPASS) {
    this->fail_("no memory for the update task");
    return false;
  }
#else
  std::thread([this]() { this->run_(); }).detach();
#endif
  return true;
}

void EsphelmOta::notify_(ota::OTAState state, float progress, bool deferred) {
  // ESPHome's OTA listeners (on_begin, on_progress, ...) exist only when something asked for them.
#ifdef USE_OTA_STATE_LISTENER
  if (deferred)
    this->notify_state_deferred_(state, progress, 0);
  else
    this->notify_state_(state, progress, 0);
#endif
}

float EsphelmOta::progress() const {
  if (this->size_ == 0)
    return 0.0f;
  return 100.0f * static_cast<float>(this->written_.load()) / static_cast<float>(this->size_);
}

std::string EsphelmOta::error() const {
  std::lock_guard<std::mutex> lock(this->mutex_);
  return this->error_;
}

void EsphelmOta::reset() {
  if (this->phase() != Phase::RUNNING)
    this->phase_ = static_cast<uint8_t>(Phase::IDLE);
}

void EsphelmOta::fail_(const std::string &why) {
  {
    std::lock_guard<std::mutex> lock(this->mutex_);
    this->error_ = why;
  }
  ESP_LOGE(TAG, "Firmware update failed: %s", why.c_str());
  this->notify_(ota::OTA_ERROR, this->progress(), true);
  this->phase_ = static_cast<uint8_t>(Phase::FAILED);
}

static std::string backend_error(ota::OTAResponseTypes r) {
  switch (r) {
    case ota::OTA_RESPONSE_ERROR_MD5_MISMATCH:
      return "the image is damaged (MD5 mismatch)";
    case ota::OTA_RESPONSE_ERROR_ESP32_NOT_ENOUGH_SPACE:
      return "the image is too large for this display";
    case ota::OTA_RESPONSE_ERROR_NO_UPDATE_PARTITION:
      return "no partition to update";
    case ota::OTA_RESPONSE_ERROR_WRITING_FLASH:
      return "writing the flash failed";
    default:
      return "the image was refused (error " + std::to_string(static_cast<int>(r)) + ")";
  }
}

void EsphelmOta::run_() {
  // Worker task: nothing here touches LVGL; listeners are told on the main loop (deferred).
  auto backend = ota::make_ota_backend();
  ota::OTAResponseTypes r = backend->begin(this->size_);
  if (r != ota::OTA_RESPONSE_OK) {
    backend->abort();
    this->fail_(backend_error(r));
    return;
  }
  backend->set_update_md5(this->md5_.c_str());
  uint32_t last_percent = 0;
  auto wrote = [&](size_t n) {
    this->written_ += n;
    const uint32_t percent = static_cast<uint32_t>(this->progress());
    if (percent >= last_percent + 5) {
      last_percent = percent;
      this->notify_(ota::OTA_IN_PROGRESS, this->progress(), true);
    }
  };
  std::string why;

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  esp_http_client_config_t config = {};
  config.url = this->url_.c_str();
  config.method = HTTP_METHOD_GET;
  config.timeout_ms = TIMEOUT_MS;
  config.disable_auto_redirect = true;
  config.buffer_size = 2048;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == nullptr) {
    backend->abort();
    this->fail_("esp_http_client_init failed");
    return;
  }
  std::string auth;
  if (!this->token_.empty()) {
    auth = "Bearer " + this->token_;
    esp_http_client_set_header(client, "Authorization", auth.c_str());
  }
  std::unique_ptr<uint8_t[]> buf(new (std::nothrow) uint8_t[CHUNK]);
  esp_err_t err = buf ? esp_http_client_open(client, 0) : ESP_ERR_NO_MEM;
  if (err != ESP_OK) {
    why = std::string("download failed: ") + esp_err_to_name(err);
  } else {
    const int64_t length = esp_http_client_fetch_headers(client);
    const int status = esp_http_client_get_status_code(client);
    if (status != 200) {
      why = "the plugin answered HTTP " + std::to_string(status);
    } else if (length != static_cast<int64_t>(this->size_)) {
      why = "the download has the wrong size";
    } else {
      size_t total = 0;
      while (total < this->size_) {
        const int n = esp_http_client_read(client, reinterpret_cast<char *>(buf.get()), CHUNK);
        if (n <= 0) {
          why = "the download broke off";
          break;
        }
        r = backend->write(buf.get(), static_cast<size_t>(n));
        if (r != ota::OTA_RESPONSE_OK) {
          why = backend_error(r);
          break;
        }
        total += static_cast<size_t>(n);
        wrote(static_cast<size_t>(n));
      }
    }
  }
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
#else  // host (SDL): ix::HttpClient reads the whole body; fine on a desktop
  ix::HttpClient http;
  ix::HttpRequestArgsPtr args = http.createRequest();
  args->connectTimeout = TIMEOUT_MS / 1000;
  args->transferTimeout = 120;
  ix::WebSocketHttpHeaders headers;
  if (!this->token_.empty())
    headers["Authorization"] = "Bearer " + this->token_;
  args->extraHeaders = headers;
  ix::HttpResponsePtr response = http.get(this->url_, args);
  if (!response || response->statusCode == 0) {
    why = "download failed: " + (response ? response->errorMsg : std::string("no response"));
  } else if (response->statusCode != 200) {
    why = "the plugin answered HTTP " + std::to_string(response->statusCode);
  } else if (response->body.size() != this->size_) {
    why = "the download has the wrong size";
  } else {
    auto *data = reinterpret_cast<uint8_t *>(const_cast<char *>(response->body.data()));
    for (size_t off = 0; off < this->size_ && why.empty(); off += CHUNK) {
      const size_t n = std::min(CHUNK, this->size_ - off);
      r = backend->write(data + off, n);
      if (r != ota::OTA_RESPONSE_OK)
        why = backend_error(r);
      else
        wrote(n);
    }
  }
#endif

  if (why.empty()) {
    r = backend->end();  // checks the MD5 and marks the image bootable
    if (r != ota::OTA_RESPONSE_OK)
      why = backend_error(r);
  }
  if (!why.empty()) {
    backend->abort();
    this->fail_(why);
    return;
  }
  ESP_LOGI(TAG, "Firmware update written (%u bytes); restarting", static_cast<unsigned>(this->size_));
  this->notify_(ota::OTA_COMPLETED, 100.0f, true);
  this->phase_ = static_cast<uint8_t>(Phase::DONE);
}

#endif  // USE_ESPHELM_OTA

}  // namespace esphelm_runtime
}  // namespace esphome
