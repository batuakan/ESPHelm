// Host test of the setup access point's password and QR text (esphelm_wifi_setup.h, ADR-0026).
// Prints "N failures"; run by wifi_setup.cpp.test.ts.
#include <cstdint>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

#include "esphelm_wifi_setup.h"

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
      failures++;                                                \
    }                                                            \
  } while (0)

int main() {
  // Deterministic generator (xorshift32) for the shape of the passwords.
  uint32_t state = 2463534242u;
  auto xorshift = [&state]() {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
  };
  std::set<std::string> seen;
  std::set<char> symbols;
  for (int i = 0; i < 2000; i++) {
    const std::string p = esphelm::make_ap_password(xorshift);
    CHECK(p.size() == esphelm::AP_PASSWORD_LENGTH);
    CHECK(esphelm::valid_ap_password(p));
    seen.insert(p);
    symbols.insert(p.begin(), p.end());
  }
  CHECK(seen.size() == 2000);                                      // no repeats
  CHECK(symbols.size() == esphelm::AP_PASSWORD_ALPHABET_SIZE);     // every symbol is used
  for (char c : std::string("0Oo1lI"))
    CHECK(symbols.count(c) == 0);

  // Values above the last whole multiple of the alphabet are drawn again, not folded in.
  std::vector<uint32_t> values = {UINT32_MAX, UINT32_MAX - 1};
  for (int i = 0; i < 10; i++)
    values.push_back(static_cast<uint32_t>(i));
  size_t at = 0;
  const std::string biased = esphelm::make_ap_password([&]() { return values[at++]; });
  CHECK(biased == "23456789ab");
  CHECK(at == values.size());

  // Saved passwords are checked before use.
  CHECK(!esphelm::valid_ap_password(""));
  CHECK(!esphelm::valid_ap_password("23456789a"));     // too short
  CHECK(!esphelm::valid_ap_password("23456789abc"));   // too long
  CHECK(!esphelm::valid_ap_password("23456789a0"));    // not in the alphabet
  CHECK(!esphelm::valid_ap_password("23456789a "));
  CHECK(!esphelm::valid_ap_password(std::string("23456789a\0", 10)));

  // QR text: WPA, with the special characters escaped.
  CHECK(esphelm::wifi_qr_text("esphelm-p4-a1b2c3", "Xk7pQ2mZ9t") == "WIFI:T:WPA;S:esphelm-p4-a1b2c3;P:Xk7pQ2mZ9t;;");
  CHECK(esphelm::wifi_qr_text("a;b,c:d\"e\\f", "p;w") == "WIFI:T:WPA;S:a\\;b\\,c\\:d\\\"e\\\\f;P:p\\;w;;");

  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
