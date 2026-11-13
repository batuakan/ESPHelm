#pragma once
// Firmware updates from the ESPHelm plugin (ADR-0036).
//
// - The image marker: a string compiled into every image, from which the plugin learns an uploaded
//   image's version, board and tile set.
// - The build id: the running image's app_elf_sha256 (ESP32) or the program's sha256 (host),
//   reported in hello as fw.build. An update is done when the display reports the target build.
// - EsphelmOta (`ota: - platform: esphelm_runtime`): downloads an offered image on a worker task
//   with the device token and writes it through ESPHome's OTA backend, which checks the MD5. The
//   main loop only reads its phase and progress; ESPHome's OTA listeners hear about it deferred.

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>

#include "esphome/core/defines.h"
#ifdef USE_ESPHELM_OTA
#include "esphome/components/ota/ota_backend.h"
#endif

namespace esphome {
namespace esphelm_runtime {

/// "ESPHELM-IMAGE/1 fw=<version> board=<board> kind=<color|mono>", referenced so it stays in the image.
const char *image_marker();

/// The running build's id as 64 lowercase hex characters, or "" when it can't be known.
std::string firmware_build_id();

#ifdef USE_ESPHELM_OTA

class EsphelmOta : public ota::OTAComponent {
 public:
  enum class Phase : uint8_t { IDLE, RUNNING, DONE, FAILED };

  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }

  /// Start downloading `url` (main loop). False while one is running.
  bool start(const std::string &url, const std::string &token, size_t size, const std::string &md5);
  Phase phase() const { return static_cast<Phase>(this->phase_.load()); }
  /// 0..100 while running.
  float progress() const;
  /// Why it failed (FAILED only).
  std::string error() const;
  /// Back to IDLE after a failure was shown and reported.
  void reset();

 protected:
  void run_();
  void fail_(const std::string &why);
  /// Tell ESPHome's OTA listeners; `deferred` from the worker (they run on the main loop).
  void notify_(ota::OTAState state, float progress, bool deferred);

  std::atomic<uint8_t> phase_{static_cast<uint8_t>(Phase::IDLE)};
  std::atomic<uint32_t> written_{0};
  size_t size_{0};
  std::string url_, token_, md5_;
  mutable std::mutex mutex_;
  std::string error_;
};

#endif  // USE_ESPHELM_OTA

}  // namespace esphelm_runtime
}  // namespace esphome
