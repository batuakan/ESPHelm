#pragma once
// Value history (ADR-0018): the recent values of every value tile with history on, recorded from
// boot on every page of the layout, for the history popup. One ring of HISTORY_POINTS points per
// window (10 min, 1 h, 6 h; boards without PSRAM keep the first HISTORY_NO_PSRAM_WINDOWS), each
// point the mean, min and max of the values in it. Buffers are allocated when a layout is
// applied, never per value. Pure C++ (no ESPHome, LVGL or JSON), so g++ tests it on the host.
// Main loop only.

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "esphelm_sizes.h"
#include "esphelm_units.h"

namespace esphelm {

class ValueHistory {
 public:
  /// One point: mean, min and max of the values in it, in display units. NaN mean: a gap.
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
  static void close_(Entry &e, Window &w, uint32_t end_ms);
  static void append_(Window &w, const Point &p);

  std::vector<Entry> entries_;
  int windows_{0};
};

}  // namespace esphelm
