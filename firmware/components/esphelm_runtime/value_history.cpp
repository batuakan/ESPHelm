#include "value_history.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_heap_caps.h>
#endif

namespace esphelm {

// Without PSRAM, leave this much internal RAM free after a history buffer (Wi-Fi, LVGL, pages).
static const size_t MIN_FREE_INTERNAL = 48 * 1024;

static void free_points(ValueHistory::Point *p) { std::free(p); }

static ValueHistory::Point *alloc_points(size_t count, bool psram) {
  const size_t bytes = count * sizeof(ValueHistory::Point);
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  if (psram)
    return static_cast<ValueHistory::Point *>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM));
  if (heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) < bytes + MIN_FREE_INTERNAL)
    return nullptr;
  return static_cast<ValueHistory::Point *>(heap_caps_malloc(bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
#else
  (void) psram;
  (void) MIN_FREE_INTERNAL;
  return static_cast<ValueHistory::Point *>(std::malloc(bytes));
#endif
}

void ValueHistory::configure(const std::vector<Spec> &specs, uint32_t now, int windows, size_t max_tiles, bool psram,
                             std::vector<std::string> &skipped) {
  if (windows < 1)
    windows = 1;
  if (windows > sizes::HISTORY_WINDOWS)
    windows = sizes::HISTORY_WINDOWS;
  if (windows != this->windows_)
    this->entries_.clear();  // a different ring layout: nothing to keep
  this->windows_ = windows;

  std::vector<Entry> old = std::move(this->entries_);
  this->entries_.clear();
  this->entries_.reserve(std::min(specs.size(), max_tiles));
  for (const Spec &spec : specs) {
    if (this->find(spec.id) >= 0)
      continue;  // ids are unique in a valid layout
    if (this->entries_.size() >= max_tiles) {
      skipped.push_back(spec.id);
      continue;
    }
    Entry *kept = nullptr;
    for (Entry &o : old) {
      if (o.block && o.spec.id == spec.id && o.spec.path == spec.path && o.spec.unit == spec.unit) {
        kept = &o;
        break;
      }
    }
    if (kept != nullptr) {
      this->entries_.push_back(std::move(*kept));
      this->entries_.back().spec.stale_ms = spec.stale_ms;
      continue;
    }
    Point *block = alloc_points(static_cast<size_t>(windows) * sizes::HISTORY_POINTS, psram);
    if (block == nullptr) {
      skipped.push_back(spec.id);
      continue;
    }
    Entry e;
    e.spec = spec;
    e.block = std::unique_ptr<Point[], void (*)(Point *)>(block, free_points);
    for (int w = 0; w < windows; w++) {
      e.win[w].ring = block + static_cast<size_t>(w) * sizes::HISTORY_POINTS;
      e.win[w].start_ms = now;
    }
    this->entries_.push_back(std::move(e));
  }
}

void ValueHistory::clear() { this->entries_.clear(); }

int ValueHistory::find(const std::string &id) const {
  for (size_t i = 0; i < this->entries_.size(); i++) {
    if (this->entries_[i].spec.id == id)
      return static_cast<int>(i);
  }
  return -1;
}

void ValueHistory::record(size_t i, double value, uint32_t now) {
  if (i >= this->entries_.size() || !std::isfinite(value))
    return;
  Entry &e = this->entries_[i];
  const float v = static_cast<float>(value);
  e.has_last = true;
  e.last = v;
  e.last_ms = now;
  if (e.frozen)
    return;
  for (int w = 0; w < this->windows_; w++) {
    Window &win = e.win[w];
    if (win.n == 0) {
      win.min = v;
      win.max = v;
    } else {
      win.min = std::min(win.min, v);
      win.max = std::max(win.max, v);
    }
    win.sum += v;
    win.n++;
  }
}

void ValueHistory::append_(Window &w, const Point &p) {
  w.ring[w.head] = p;
  w.head = static_cast<uint16_t>((w.head + 1) % sizes::HISTORY_POINTS);
  if (w.count < sizes::HISTORY_POINTS)
    w.count++;
}

void ValueHistory::close_(Entry &e, Window &w, uint32_t end_ms) {
  Point p;
  if (w.n > 0) {
    p = {static_cast<float>(w.sum / w.n), w.min, w.max};
  } else if (e.has_last && end_ms - e.last_ms <= e.spec.stale_ms) {
    // No value in this point but the last one is still fresh: SignalK may send only changes.
    p = {e.last, e.last, e.last};
  } else {
    const float nan = std::numeric_limits<float>::quiet_NaN();
    p = {nan, nan, nan};
  }
  append_(w, p);
  w.sum = 0;
  w.n = 0;
}

bool ValueHistory::tick(uint32_t now) {
  bool closed = false;
  for (Entry &e : this->entries_) {
    if (e.frozen)
      continue;
    for (int wi = 0; wi < this->windows_; wi++) {
      Window &w = e.win[wi];
      const uint32_t period = point_ms(wi);
      int guard = 0;
      while (now - w.start_ms >= period) {
        if (guard++ == sizes::HISTORY_POINTS) {
          w.start_ms = now;  // far behind (the loop stalled): the whole ring is fresh already
          break;
        }
        close_(e, w, w.start_ms + period);
        w.start_ms += period;
        closed = true;
      }
    }
  }
  return closed;
}

void ValueHistory::push(size_t i, int window, const Point &p) {
  if (i < this->entries_.size() && window >= 0 && window < this->windows_)
    append_(this->entries_[i].win[window], p);
}

size_t ValueHistory::series(size_t i, int window, Point *out) const {
  if (i >= this->entries_.size() || window < 0 || window >= this->windows_)
    return 0;
  const Window &w = this->entries_[i].win[window];
  const size_t first = (w.head + sizes::HISTORY_POINTS - w.count) % sizes::HISTORY_POINTS;
  for (size_t k = 0; k < w.count; k++)
    out[k] = w.ring[(first + k) % sizes::HISTORY_POINTS];
  return w.count;
}

size_t ValueHistory::bytes() const {
  return this->entries_.size() * static_cast<size_t>(this->windows_) * sizes::HISTORY_POINTS * sizeof(Point);
}

}  // namespace esphelm
