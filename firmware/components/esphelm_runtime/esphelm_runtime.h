#pragma once
// esphelm_runtime: renders layouts served by the signalk-esphelm plugin (docs/firmware-runtime.md).
//
// Boot: show the cached layout (current, else last-known-good), else a status page.
// Online: hello -> learn state -> fetch the layout with If-None-Match when its version
// (plugins.esphelm.<id>.version) differs -> validate -> render -> persist.
// All LVGL work happens in loop(); HTTP runs on LayoutClient's worker.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "esphome/components/font/font.h"
#include "esphome/components/signalk/signalk.h"
#include "esphome/core/component.h"

#include "layout_client.h"
#include "layout_model.h"
#include "layout_parser.h"
#include "layout_store.h"
#include "renderer.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const FIRMWARE_VERSION = "0.4.0";

class EsphelmRuntime : public Component {
 public:
  void set_signalk(signalk::SignalK *signalk) { this->signalk_ = signalk; }
  void set_container(lv_obj_t *container) { this->renderer_.set_container(container); }
  void set_fonts(font::Font *value, font::Font *label, font::Font *small) {
    this->fonts_ = Fonts{value->get_lv_font(), label->get_lv_font(), small->get_lv_font()};
  }
  void set_board(const std::string &board) { this->board_ = board; }
  void set_touch(bool touch) { this->touch_ = touch; }
  void set_stale_after(uint32_t ms) { this->stale_after_ms_ = ms; }
  void set_max_layout_bytes(size_t bytes) { this->max_layout_bytes_ = bytes; }
  void set_store_dir(const std::string &dir) { this->store_.set_dir(dir); }

  void setup() override;
  void loop() override;

  /// Show page `index` of the current layout (also the footer buttons' target and a test hook).
  void show_page(size_t index);
  /// Act as if the tile with this id (and its button `part`, if any) was tapped (test hook).
  void tap(const std::string &tile_id, const std::string &part = "");
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
  void update_status_();
  void show_status_(const std::string &headline, const std::string &detail);
  void send_hello_();
  void send_fetch_();
  std::string base_url_() const;
  void compute_capacity_();

  signalk::SignalK *signalk_{nullptr};
  Renderer renderer_;
  Fonts fonts_;
  LayoutStore store_;
  LayoutClient client_;
  LayoutClient tiles_;  // chart tiles, so they never delay hellos and layout fetches

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
  int pending_step_{0};  // footer button presses, applied in loop() (never inside LVGL events)
  std::vector<std::unique_ptr<Widget>> widgets_;
  esphelm::Theme theme_{esphelm::Theme::NIGHT};
  std::string etag_;
  std::string body_;
  uint32_t shown_at_{0};
  bool lkg_saved_{false};
  std::string lkg_etag_;
  std::vector<uint32_t> listeners_;
  std::string status_key_;  // last status page shown, to avoid rebuilding it every loop

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
