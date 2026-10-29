#pragma once
// Value history (ADR-0018): the recent values of every value tile with history on, recorded from
// boot on every page of the layout, for the history popup. One ring of HISTORY_POINTS points per
// window (10 min, 1 h, 6 h; boards without PSRAM keep the first HISTORY_NO_PSRAM_WINDOWS), each
// point the mean, min and max of the values in it. Buffers are allocated when a layout is
// applied, never per value. Pure C++ (no ESPHome, LVGL or JSON), so g++ tests it on the host.
// Main loop only.

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "esphelm_sizes.h"
#include "esphelm_units.h"

namespace esphelm {

/// Mean angle, in [wmin, wmax), from the sums of sin and cos of n values taken as turns of the
/// range (circularMean in packages/schema/src/history.ts; fixtures/history.cases.json). NaN when
/// there are none or they cancel out.
inline double circular_from_sums(double s, double c, uint32_t n, double wmin, double wmax) {
  const double span = wmax - wmin;
  if (n == 0 || std::hypot(s, c) < 1e-9 * n)
    return std::nan("");
  const double a = std::atan2(s, c) * span / (2 * M_PI);  // -span/2 .. span/2
  const double m = a < 0 ? a + span + wmin : a + wmin;
  return wmax - m < units::WRAP_EPSILON * span ? wmin : m;  // as to_display: just below the top is the bottom
}

/// Turn of angle `v` (display units) in a range: what circular_from_sums() sums.
inline double circular_turn(double v, double wmin, double wmax) { return (v - wmin) * 2 * M_PI / (wmax - wmin); }

inline double circular_mean(const double *v, size_t n, double wmin, double wmax) {
  double s = 0, c = 0;
  for (size_t i = 0; i < n; i++) {
    s += std::sin(circular_turn(v[i], wmin, wmax));
    c += std::cos(circular_turn(v[i], wmin, wmax));
  }
  return circular_from_sums(s, c, static_cast<uint32_t>(n), wmin, wmax);
}

/// `v` moved by whole turns to within half a turn of `centre`, [centre - span/2, centre + span/2)
/// (unwrapAround in history.ts), so a graph across north runs 350..370 instead of jumping.
inline double unwrap_around(double v, double centre, double wmin, double wmax) {
  const double span = wmax - wmin;
  return v - span * std::floor((v - centre) / span + 0.5);
}

class ValueHistory {
 public:
  /// One point: mean, min and max of the values in it, in display units. NaN mean: a gap.
  /// Angles (a unit with a wrap range): the mean on the circle, inside the range; min and max
  /// are as far from it as the values went, so they may lie outside the range.
  struct Point {
    float mean, min, max;
    bool gap() const { return this->mean != this->mean; }
  };
  /// A tile to record.
  struct Spec {
    std::string id;
    std::string path;
    const units::UnitDef *unit{nullptr};
    uint32_t stale_ms{0};
  };

  ValueHistory() = default;
  ValueHistory(const ValueHistory &) = delete;
  ValueHistory &operator=(const ValueHistory &) = delete;

  /// Record these tiles from now on (at most `max_tiles`, `windows` windows each, in PSRAM when
  /// `psram`). Tiles kept from the last call (same id, path and unit) keep their history. Ids
  /// that got no history (over the limit, or out of memory) are returned in `skipped`.
  void configure(const std::vector<Spec> &specs, uint32_t now, int windows, size_t max_tiles, bool psram,
                 std::vector<std::string> &skipped);
  /// Forget everything (no layout).
  void clear();

  size_t size() const { return this->entries_.size(); }
  int windows() const { return this->windows_; }
  /// Index of the tile with this id, or -1 if it records nothing.
  int find(const std::string &id) const;
  const std::string &path(size_t i) const { return this->entries_[i].spec.path; }
  const units::UnitDef *unit(size_t i) const { return this->entries_[i].spec.unit; }
  /// Whether entry `i` holds angles (its unit wraps).
  bool circular(size_t i) const { return circular_(this->entries_[i].spec); }

  /// A value of entry `i` in display units.
  void record(size_t i, double value, uint32_t now);
  /// Close every point whose time is up. Returns true if any point closed.
  bool tick(uint32_t now);
  /// Append a closed point (the host test hook seeds a fixed curve with it).
  void push(size_t i, int window, const Point &p);
  /// Stop recording points for entry `i` (its last value still updates): the host test hook
  /// keeps a seeded curve fixed for golden screenshots.
  void freeze(size_t i) {
    if (i < this->entries_.size())
      this->entries_[i].frozen = true;
  }
  /// The latest value of entry `i` and when it came; false if none yet.
  bool last(size_t i, float &value, uint32_t &ms) const {
    if (i >= this->entries_.size() || !this->entries_[i].has_last)
      return false;
    value = this->entries_[i].last;
    ms = this->entries_[i].last_ms;
    return true;
  }
  uint32_t stale_ms(size_t i) const { return i < this->entries_.size() ? this->entries_[i].spec.stale_ms : 0; }

  /// Points of window `window` of entry `i`, oldest first, into `out` (HISTORY_POINTS long).
  /// Returns how many there are; fewer than HISTORY_POINTS until the window has filled.
  size_t series(size_t i, int window, Point *out) const;
  /// Bytes the buffers take.
  size_t bytes() const;

  static uint32_t point_ms(int window) {
    return static_cast<uint32_t>(sizes::HISTORY_WINDOW_SECONDS[window]) * 1000u / sizes::HISTORY_POINTS;
  }

 protected:
  struct Window {
    Point *ring{nullptr};
    uint16_t head{0};   // next slot to write
    uint16_t count{0};  // points written, up to HISTORY_POINTS
    uint32_t start_ms{0};  // when the open point began
    double sum{0};
    uint32_t n{0};
    float min{0}, max{0};
    // Angles: sums of sin and cos, and how far below and above the point's first value they went.
    double sum_sin{0}, sum_cos{0};
    float first{0};
  };
  struct Entry {
    Spec spec;
    std::unique_ptr<Point[], void (*)(Point *)> block{nullptr, nullptr};
    Window win[sizes::HISTORY_WINDOWS];
    bool has_last{false};
    bool frozen{false};
    float last{0};
    uint32_t last_ms{0};
  };
  static bool circular_(const Spec &s) { return s.unit != nullptr && s.unit->has_wrap; }
  static void close_(Entry &e, Window &w, uint32_t end_ms);
  static void append_(Window &w, const Point &p);

  std::vector<Entry> entries_;
  int windows_{0};
};

}  // namespace esphelm
