#include "layout_client.h"

#include "esphome/core/log.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_http_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

#ifdef USE_HOST
#include <chrono>
#include <thread>
#include <ixwebsocket/IXHttpClient.h>
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.http";
static const int TIMEOUT_MS = 5000;

void LayoutClient::start() {
  std::lock_guard<std::mutex> lock(this->mutex_);
  if (this->started_)
    return;
  this->started_ = true;
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  // esp_http_client needs a few KB of stack; 8 KB leaves room for TLS-free HTTP and logging.
  xTaskCreate([](void *self) { static_cast<LayoutClient *>(self)->run_(); }, "esphelm_http", 8192, this, 5,
              nullptr);
#else
  std::thread([this]() { this->run_(); }).detach();
#endif
}

void LayoutClient::submit(HttpRequest &&request) {
  std::lock_guard<std::mutex> lock(this->mutex_);
  for (auto &p : this->pending_) {
    if (p.kind == request.kind) {
      p = std::move(request);
      return;
    }
  }
  this->pending_.push_back(std::move(request));
}

bool LayoutClient::poll(HttpResult &out) {
  std::lock_guard<std::mutex> lock(this->mutex_);
  if (this->done_.empty())
    return false;
  out = std::move(this->done_.front());
  this->done_.pop_front();
  return true;
}

bool LayoutClient::busy() const {
  std::lock_guard<std::mutex> lock(this->mutex_);
  return this->in_flight_ || !this->pending_.empty();
}

void LayoutClient::run_() {
  for (;;) {
    HttpRequest request;
    bool have = false;
    {
      std::lock_guard<std::mutex> lock(this->mutex_);
      if (!this->pending_.empty()) {
        request = std::move(this->pending_.front());
        this->pending_.pop_front();
        this->in_flight_ = true;
        have = true;
      }
    }
    if (!have) {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
      vTaskDelay(pdMS_TO_TICKS(50));
#else
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
#endif
      continue;
    }
    HttpResult result = this->perform_(request);
    std::lock_guard<std::mutex> lock(this->mutex_);
    this->done_.push_back(std::move(result));
    this->in_flight_ = false;
  }
}

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF

namespace {
struct Capture {
  std::string etag;
};

esp_err_t on_http_event(esp_http_client_event_t *evt) {
  if (evt->event_id == HTTP_EVENT_ON_HEADER && evt->user_data != nullptr &&
      strcasecmp(evt->header_key, "ETag") == 0) {
    static_cast<Capture *>(evt->user_data)->etag = evt->header_value;
  }
  return ESP_OK;
}
}  // namespace

HttpResult LayoutClient::perform_(const HttpRequest &request) {
  HttpResult result;
  result.kind = request.kind;
  Capture capture;
  esp_http_client_config_t config = {};
  config.url = request.url.c_str();
  config.method = request.body.empty() ? HTTP_METHOD_GET : HTTP_METHOD_POST;
  config.timeout_ms = TIMEOUT_MS;
  config.event_handler = on_http_event;
  config.user_data = &capture;
  config.disable_auto_redirect = true;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == nullptr) {
    result.error = "esp_http_client_init failed";
    return result;
  }
  std::string auth;
  if (!request.token.empty()) {
    auth = "Bearer " + request.token;
    esp_http_client_set_header(client, "Authorization", auth.c_str());
  }
  if (!request.if_none_match.empty())
    esp_http_client_set_header(client, "If-None-Match", request.if_none_match.c_str());
  if (!request.body.empty())
    esp_http_client_set_header(client, "Content-Type", "application/json");

  esp_err_t err = esp_http_client_open(client, request.body.size());
  if (err == ESP_OK && !request.body.empty() &&
      esp_http_client_write(client, request.body.data(), request.body.size()) < 0) {
    err = ESP_FAIL;
  }
  if (err != ESP_OK) {
    result.error = esp_err_to_name(err);
    esp_http_client_cleanup(client);
    return result;
  }
  const int64_t content_length = esp_http_client_fetch_headers(client);
  result.status = esp_http_client_get_status_code(client);
  if (content_length > 0 && static_cast<size_t>(content_length) > request.max_body) {
    result.truncated = true;  // refuse before reading a body the device cannot hold
  } else {
    char buf[1024];
    int n;
    while ((n = esp_http_client_read(client, buf, sizeof(buf))) > 0) {
      if (result.body.size() + n > request.max_body) {
        result.truncated = true;
        break;
      }
      result.body.append(buf, n);
    }
  }
  result.etag = capture.etag;
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
  return result;
}

#else  // host (SDL) build

HttpResult LayoutClient::perform_(const HttpRequest &request) {
  HttpResult result;
  result.kind = request.kind;
  ix::HttpClient http;
  ix::HttpRequestArgsPtr args = http.createRequest();
  args->connectTimeout = TIMEOUT_MS / 1000;
  args->transferTimeout = TIMEOUT_MS / 1000;
  ix::WebSocketHttpHeaders headers;
  if (!request.token.empty())
    headers["Authorization"] = "Bearer " + request.token;
  if (!request.if_none_match.empty())
    headers["If-None-Match"] = request.if_none_match;
  if (!request.body.empty())
    headers["Content-Type"] = "application/json";
  args->extraHeaders = headers;
  ix::HttpResponsePtr response =
      request.body.empty() ? http.get(request.url, args) : http.post(request.url, request.body, args);
  if (!response || response->statusCode == 0) {
    result.error = response ? response->errorMsg : "no response";
    return result;
  }
  result.status = response->statusCode;
  auto it = response->headers.find("ETag");
  if (it != response->headers.end())
    result.etag = it->second;
  if (response->body.size() > request.max_body) {
    result.truncated = true;
  } else {
    result.body = response->body;
  }
  return result;
}

#endif

}  // namespace esphelm_runtime
}  // namespace esphome
