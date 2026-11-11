// Host test of the black-and-white threshold of mono builds (esphelm_mono.h, ADR-0035).
// Prints "N failures"; run by mono.cpp.test.ts.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "esphelm_mono.h"

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
      failures++;                                                \
    }                                                            \
  } while (0)

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

int main() {
  using esphelm::mono::threshold_block;
  using esphelm::mono::threshold_rgb565;
  // Pure colours stay; every result is black or white.
  CHECK(threshold_rgb565(0x0000) == 0x0000);
  CHECK(threshold_rgb565(0xFFFF) == 0xFFFF);
  for (uint32_t px = 0; px <= 0xFFFF; px++) {
    const uint16_t out = threshold_rgb565(static_cast<uint16_t>(px));
    CHECK(out == 0x0000 || out == 0xFFFF);
    if (failures > 0)
      break;
  }
  // By brightness, not by any channel: an anti-aliased grey edge goes either way.
  CHECK(threshold_rgb565(rgb565(0x30, 0x30, 0x30)) == 0x0000);
  CHECK(threshold_rgb565(rgb565(0xC8, 0xC8, 0xC8)) == 0xFFFF);
  CHECK(threshold_rgb565(rgb565(0x7E, 0x7E, 0x7E)) == 0x0000);
  CHECK(threshold_rgb565(rgb565(0x84, 0x84, 0x84)) == 0xFFFF);
  CHECK(threshold_rgb565(rgb565(0xFF, 0x00, 0x00)) == 0x0000);  // red: 30 % bright
  CHECK(threshold_rgb565(rgb565(0x00, 0xFF, 0x00)) == 0xFFFF);  // green: 59 %
  CHECK(threshold_rgb565(rgb565(0xFF, 0xFF, 0x00)) == 0xFFFF);  // yellow

  // ink_on (ESPHome binary displays): the same split, the other way round.
  CHECK(threshold_rgb565(0x0000, true) == 0xFFFF);
  CHECK(threshold_rgb565(0xFFFF, true) == 0x0000);
  CHECK(threshold_rgb565(rgb565(0x30, 0x30, 0x30), true) == 0xFFFF);
  CHECK(threshold_rgb565(rgb565(0xC8, 0xC8, 0xC8), true) == 0x0000);
  std::vector<uint16_t> flip(2, 0x0000);
  flip[1] = 0xFFFF;
  threshold_block(reinterpret_cast<uint8_t *>(flip.data()), 2, 1, 4, true);
  CHECK(flip[0] == 0xFFFF && flip[1] == 0x0000);

  // A block with a stride wider than its rows: only w pixels of each row change.
  const int32_t w = 3, h = 2;
  const size_t stride = 5 * 2;
  std::vector<uint16_t> buf(5 * h, 0x8410);  // mid grey everywhere
  threshold_block(reinterpret_cast<uint8_t *>(buf.data()), w, h, stride);
  for (int32_t y = 0; y < h; y++) {
    for (int32_t x = 0; x < 5; x++) {
      const uint16_t px = buf[y * 5 + x];
      if (x < w)
        CHECK(px == 0x0000 || px == 0xFFFF);
      else
        CHECK(px == 0x8410);
    }
  }
  // Refused: no data, empty sizes, a stride shorter than a row.
  std::vector<uint16_t> one(4, 0x8410);
  threshold_block(nullptr, 2, 2, 4);
  threshold_block(reinterpret_cast<uint8_t *>(one.data()), 0, 2, 4);
  threshold_block(reinterpret_cast<uint8_t *>(one.data()), 2, 2, 2);
  CHECK(one[0] == 0x8410 && one[3] == 0x8410);

  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
