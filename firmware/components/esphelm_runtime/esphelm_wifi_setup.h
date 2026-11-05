#pragma once
// Wi-Fi setup (ADR-0026): the password of the display's own setup access point and the text of the
// QR code that joins it. Pure functions, host-tested (firmware/test/cpp/wifi_setup_test.cpp).

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>

namespace esphelm {

/// Letters and digits that can't be mistaken for each other on the screen (no 0/O/o, 1/l/I).
static const char AP_PASSWORD_ALPHABET[] = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
static const size_t AP_PASSWORD_ALPHABET_SIZE = sizeof(AP_PASSWORD_ALPHABET) - 1;
/// 10 of 56 symbols: about 58 bits, and short enough to type from the screen.
static const size_t AP_PASSWORD_LENGTH = 10;

/// A new setup password from `random` (uniform 32-bit values; the hardware RNG on the device).
/// Values that would favour some symbols are drawn again.
inline std::string make_ap_password(const std::function<uint32_t()> &random) {
  const uint32_t limit = UINT32_MAX - UINT32_MAX % AP_PASSWORD_ALPHABET_SIZE;
  std::string out;
  while (out.size() < AP_PASSWORD_LENGTH) {
    const uint32_t r = random();
    if (r >= limit)
      continue;
    out += AP_PASSWORD_ALPHABET[r % AP_PASSWORD_ALPHABET_SIZE];
  }
  return out;
}

/// True for a password make_ap_password could have made (a saved one is checked before use).
inline bool valid_ap_password(const std::string &password) {
  if (password.size() != AP_PASSWORD_LENGTH)
    return false;
  for (char c : password) {
    if (c == '\0' || std::strchr(AP_PASSWORD_ALPHABET, c) == nullptr)
      return false;
  }
  return true;
}

/// The QR code text phone cameras read as "join this Wi-Fi network" (WPA, `\` escapes ; , : " \).
inline std::string wifi_qr_text(const std::string &ssid, const std::string &password) {
  const auto escape = [](const std::string &s) {
    std::string out;
    for (char c : s) {
      if (c == '\\' || c == ';' || c == ',' || c == ':' || c == '"')
        out += '\\';
      out += c;
    }
    return out;
  };
  return "WIFI:T:WPA;S:" + escape(ssid) + ";P:" + escape(password) + ";;";
}

}  // namespace esphelm
