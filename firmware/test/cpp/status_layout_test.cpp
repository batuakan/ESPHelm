// Host test of the status page's layout choice (esphelm_status_layout.h).
// Prints "N failures"; run by status_layout.cpp.test.ts.
#include <cstdint>
#include <cstdio>

#include "esphelm_status_layout.h"

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
      failures++;                                                \
    }                                                            \
  } while (0)

int main() {
  using esphelm::status_layout::plan;

  // Square displays keep the code on top, a size of 4/10 of the edge as before.
  CHECK(!plan(480, 480, true).side_by_side);
  CHECK(plan(480, 480, true).qr_size == 192);
  CHECK(!plan(720, 720, true).side_by_side);
  CHECK(plan(720, 720, true).qr_size == 288);

  // Tall (a wide screen turned to portrait) as well.
  CHECK(!plan(800, 1280, true).side_by_side);
  CHECK(plan(800, 1280, true).qr_size == 320);

  // The 400x300 reflective LCD and the 320x240 screen: code on the left.
  CHECK(plan(400, 300, true).side_by_side);
  CHECK(plan(400, 300, true).qr_size == 140);
  CHECK(plan(320, 240, true).side_by_side);
  CHECK(plan(320, 240, true).qr_size == 112);

  // 5:4 is the boundary: 500x400 is wide, 499x400 is not.
  CHECK(plan(500, 400, true).side_by_side);
  CHECK(!plan(499, 400, true).side_by_side);

  // A wide screen: the code stays within 35 % of the width.
  CHECK(plan(1280, 800, true).side_by_side);
  CHECK(plan(1280, 800, true).qr_size == 400);

  // Never taller than half the height, never wider than 35 % of the width, with room for a column.
  for (int32_t w = 200; w <= 1600; w += 20) {
    for (int32_t h = 120; h <= 1600; h += 20) {
      const auto p = plan(w, h, true);
      if (!p.side_by_side)
        continue;
      CHECK(p.qr_size <= h / 2);
      CHECK(p.qr_size <= w * 35 / 100);
      CHECK(w - 2 * 16 - p.qr_size - 16 >= w * 30 / 100);  // the text column beside it is not squeezed
      if (failures > 0)
        break;
    }
    if (failures > 0)
      break;
  }

  // Without a code, or on nonsense sizes: nothing special.
  CHECK(!plan(400, 300, false).side_by_side);
  CHECK(plan(400, 300, false).qr_size == 0);
  CHECK(!plan(0, 300, true).side_by_side);
  CHECK(!plan(400, 0, true).side_by_side);

  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
