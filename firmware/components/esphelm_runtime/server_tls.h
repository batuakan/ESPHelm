#pragma once
// HTTPS to the SignalK server from the runtime's own clients (layout, hello, firmware, meta): the same pinned
// certificate as ESPHomeSignalK's stream (ADR-0043). Plain http:// URLs are left as they are.

#include <string>

#include "esphome/components/signalk/signalk.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_http_client.h>
#else
#include <ixwebsocket/IXHttpClient.h>
#endif

namespace esphome {
namespace esphelm_runtime {

inline bool is_https(const std::string &url) { return url.rfind("https://", 0) == 0; }

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
/// Verifies the server against the pin (signalk::tls_attach) when `url` is https.
inline void apply_server_tls(esp_http_client_config_t &config, const std::string &url) {
  if (is_https(url))
    config.crt_bundle_attach = signalk::tls_attach;
}
#else
/// Trusts only the pinned certificate when `url` is https. Before ESPHomeSignalK has fetched it there is
/// nothing to trust, and the request fails.
inline void apply_server_tls(ix::HttpClient &http, const std::string &url) {
  if (!is_https(url))
    return;
  ix::SocketTLSOptions options;
  options.caFile = signalk::tls_trust().ca_pem();
  options.disable_hostname_validation = true;  // signalk-server's certificate is named "localhost"
  http.setTLSOptions(options);
}
#endif

}  // namespace esphelm_runtime
}  // namespace esphome
