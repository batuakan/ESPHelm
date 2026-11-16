#pragma once
// How the status page (headline, text, footer) is arranged when it carries a QR code, e.g. the
// Wi-Fi setup screen. Pure C++: no ESPHome or LVGL dependencies (firmware/test checks it with g++).
//
// On a square or tall display the code goes on top and the text below it, which needs about the
// code's height plus the text's. A display that is at least 5:4 wide has less height than that
// (the 400x300 reflective LCD: code, headline, four lines of text and a two line footer need
// roughly 40 px more than there are), so the code goes on the left and the text beside it.

#include <algorithm>
#include <cstdint>

namespace esphelm {
namespace status_layout {

struct Plan {
  bool side_by_side;  ///< QR code on the left, headline and text in a column beside it
  int32_t qr_size;    ///< QR code edge in px; 0 without a code
};

/// `width` x `height` is the display's resolution as LVGL sees it (after any rotation).
inline Plan plan(int32_t width, int32_t height, bool has_qr) {
  Plan p{false, 0};
  if (!has_qr || width <= 0 || height <= 0)
    return p;
  p.side_by_side = width * 4 >= height * 5;
  p.qr_size = p.side_by_side ? std::min(height * 5 / 10, width * 35 / 100) : std::min(width, height) * 4 / 10;
  return p;
}

}  // namespace status_layout
}  // namespace esphelm
