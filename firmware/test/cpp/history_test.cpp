// Host test of ValueHistory (value_history.cpp): bucketing, gaps, carry-forward, ring wrap and
// keeping history across a reconfigure. Prints "N failures"; run by history.cpp.test.ts.
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "value_history.h"

using esphelm::ValueHistory;
namespace sizes = esphelm::sizes;

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
      failures++;                                                \
    }                                                            \
  } while (0)

static bool near(float a, float b) { return std::fabs(a - b) < 1e-4f; }

int main() {
  std::vector<ValueHistory::Point> out(sizes::HISTORY_POINTS);
  const uint32_t p0 = ValueHistory::point_ms(0);  // 5 s
  CHECK(p0 == 5000);
  CHECK(ValueHistory::point_ms(2) == 180000);

  // Two tiles, one over the limit.
  ValueHistory h;
  std::vector<std::string> skipped;
  std::vector<ValueHistory::Spec> specs = {
      {"sog", "navigation.speedOverGround", nullptr, 10000},
      {"depth", "environment.depth.belowTransducer", nullptr, 10000},
      {"stw", "navigation.speedThroughWater", nullptr, 10000},
  };
  h.configure(specs, 0, 3, 2, false, skipped);
  CHECK(h.size() == 2);
  CHECK(skipped.size() == 1 && skipped[0] == "stw");
  CHECK(h.find("sog") == 0 && h.find("stw") == -1);
  CHECK(h.bytes() == 2 * 3 * sizes::HISTORY_POINTS * sizeof(ValueHistory::Point));

  // Mean, min and max of one point.
  h.record(0, 4.0, 1000);
  h.record(0, 6.0, 2000);
  h.record(0, 8.0, 3000);
  CHECK(!h.tick(4999));
  CHECK(h.tick(5000));
  CHECK(h.series(0, 0, out.data()) == 1);
  CHECK(near(out[0].mean, 6.0f) && near(out[0].min, 4.0f) && near(out[0].max, 8.0f));
  CHECK(h.series(0, 1, out.data()) == 0);  // the 1 h window's first point closes after 30 s

  // No value in the next point, but the last one is fresh: carried forward.
  h.tick(10000);
  CHECK(h.series(0, 0, out.data()) == 2);
  CHECK(near(out[1].mean, 8.0f));
  // Then stale: gaps.
  h.tick(20000);
  CHECK(h.series(0, 0, out.data()) == 4);
  CHECK(out[2].gap() && out[3].gap());  // the value (3 s) is stale from 13 s
  // Non-finite values are ignored.
  h.record(0, std::nan(""), 21000);
  h.tick(25000);
  h.series(0, 0, out.data());
  CHECK(out[4].gap());

  // The ring wraps: the oldest points drop off.
  for (int k = 0; k < sizes::HISTORY_POINTS + 10; k++) {
    h.record(0, k, 25000 + k * p0 + 1);
    h.tick(25000 + (k + 1) * p0);
  }
  CHECK(h.series(0, 0, out.data()) == static_cast<size_t>(sizes::HISTORY_POINTS));
  CHECK(near(out[0].mean, 10.0f));
  CHECK(near(out[sizes::HISTORY_POINTS - 1].mean, sizes::HISTORY_POINTS + 9.0f));

  // A long stall closes at most one ring of points, then starts afresh.
  const uint32_t later = 25000 + (sizes::HISTORY_POINTS + 10) * p0 + 100u * 60u * 60u * 1000u;
  h.tick(later);
  CHECK(h.series(0, 0, out.data()) == static_cast<size_t>(sizes::HISTORY_POINTS));
  CHECK(out[sizes::HISTORY_POINTS - 1].gap());
  CHECK(!h.tick(later + p0 - 1));
  CHECK(h.tick(later + p0));

  // Reconfigure: same id, path and unit keeps the history; a changed path starts afresh.
  skipped.clear();
  std::vector<ValueHistory::Spec> next = {
      {"depth", "environment.depth.belowKeel", nullptr, 10000},
      {"sog", "navigation.speedOverGround", nullptr, 20000},
  };
  h.configure(next, later + p0, 3, 2, false, skipped);
  CHECK(skipped.empty());
  CHECK(h.find("sog") == 1 && h.find("depth") == 0);
  CHECK(h.series(1, 0, out.data()) == static_cast<size_t>(sizes::HISTORY_POINTS));
  CHECK(h.series(0, 0, out.data()) == 0);

  // Fewer windows (no PSRAM): the 6 h window doesn't exist; history can't be kept.
  skipped.clear();
  h.configure(next, 0, sizes::HISTORY_NO_PSRAM_WINDOWS, 6, false, skipped);
  CHECK(h.windows() == sizes::HISTORY_NO_PSRAM_WINDOWS);
  CHECK(h.series(1, 0, out.data()) == 0);
  CHECK(h.series(1, 2, out.data()) == 0);
  h.push(1, 2, {1, 1, 1});  // ignored
  h.push(1, 1, {1, 1, 1});
  CHECK(h.series(1, 1, out.data()) == 1);

  // Frozen (the host test hook): no new points, but the last value still updates.
  h.freeze(1);
  h.record(1, 5.0, 100);
  float last = 0;
  uint32_t last_ms = 0;
  CHECK(h.last(1, last, last_ms) && near(last, 5.0f) && last_ms == 100);
  CHECK(h.stale_ms(1) == 20000);
  h.tick(100000);
  CHECK(h.series(1, 1, out.data()) == 1);

  h.clear();
  CHECK(h.size() == 0 && h.find("sog") == -1);
  std::printf("%d failures\n", failures);
  return failures == 0 ? 0 : 1;
}
