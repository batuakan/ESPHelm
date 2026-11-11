#pragma once
// Black and white for 1-bit panels (ADR-0035). LVGL's software renderer anti-aliases rounded
// corners, arcs and lines whatever the display's antialiasing flag says, so a mono firmware turns
// every pixel it flushes into pure black or white by its brightness, just before the flush.
// Pure C++: no ESPHome or LVGL dependencies (firmware/test checks it with g++).

#include <cstddef>
#include <cstdint>

namespace esphelm {
namespace mono {

/// White (0xFFFF) if the RGB565 pixel is at least half bright, else black (0x0000). Brightness by
/// the usual weights (0.299 R + 0.587 G + 0.114 B), each channel scaled to 0..255.
/// `ink_on`: the other way round, for ESPHome binary displays, where a pixel that is "on" (any
/// colour but black) is drawn in ink: dark pixels become 0xFFFF and light ones 0x0000.
inline uint16_t threshold_rgb565(uint16_t px, bool ink_on = false) {
  const uint32_t r = ((px >> 11) & 0x1F) * 255 / 31;
  const uint32_t g = ((px >> 5) & 0x3F) * 255 / 63;
  const uint32_t b = (px & 0x1F) * 255 / 31;
  const bool light = (r * 299 + g * 587 + b * 114) >= 128 * 1000;
  return light != ink_on ? 0xFFFF : 0x0000;
}

/// Threshold a w x h block of RGB565 pixels in place; `stride` is the bytes from one row to the
/// next (at least w * 2).
inline void threshold_block(uint8_t *data, int32_t w, int32_t h, size_t stride, bool ink_on = false) {
  if (data == nullptr || w <= 0 || h <= 0 || stride < static_cast<size_t>(w) * 2)
    return;
  for (int32_t y = 0; y < h; y++) {
    auto *row = reinterpret_cast<uint16_t *>(data + static_cast<size_t>(y) * stride);
    for (int32_t x = 0; x < w; x++)
      row[x] = threshold_rgb565(row[x], ink_on);
  }
}

}  // namespace mono
}  // namespace esphelm
