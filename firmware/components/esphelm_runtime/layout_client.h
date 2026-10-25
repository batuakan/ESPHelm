#pragma once
// Blocking HTTP calls (hello, layout fetch; chart tiles on a second instance) run on a worker so
// the main loop and LVGL never stall. The main loop submits requests and polls for responses; nothing else is shared.
// ESP-IDF: a FreeRTOS task with esp_http_client. Host (SDL): a std::thread with ix::HttpClient.

#include <cstddef>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>

namespace esphome {
namespace esphelm_runtime {

enum class RequestKind : uint8_t { HELLO, LAYOUT, TILE };

struct HttpRequest {
  RequestKind kind;
  std::string url;
  std::string token;      // bearer token; empty when SignalK security is off
  std::string body;       // POST body (hello); empty for GET
  std::string if_none_match;
  size_t max_body{16 * 1024};
  uint32_t tag{0};        // echoed in the result (chart tiles: which tile it was)
};

struct HttpResult {
  RequestKind kind;
  int status{0};          // HTTP status; 0 when the request failed before a response
  std::string etag;
  std::string body;
  bool truncated{false};  // body exceeded max_body and was cut (must not be parsed)
  std::string error;      // transport error, if status == 0
  uint32_t tag{0};
};

class LayoutClient {
 public:
  /// Start the worker. Safe to call once from setup().
  void start();

  /// Queue a request (main loop). A pending request of the same kind is replaced.
  void submit(HttpRequest &&request);

  /// Next finished request (main loop); false if none.
  bool poll(HttpResult &out);

  bool busy() const;

 protected:
  void run_();
  HttpResult perform_(const HttpRequest &request);

  mutable std::mutex mutex_;
  std::deque<HttpRequest> pending_;
  std::deque<HttpResult> done_;
  bool in_flight_{false};
  bool started_{false};
};

}  // namespace esphelm_runtime
}  // namespace esphome
