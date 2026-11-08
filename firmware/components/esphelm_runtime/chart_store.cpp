#include "chart_store.h"

#include <cstdio>
#include <cstring>
#include <new>

#include "esphome/core/log.h"
// Not in lvgl.h: dropping a cached image after its pixels changed.
#include "src/misc/cache/instance/lv_image_cache.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_heap_caps.h>
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.chart";

static constexpr uint32_t PIN_MS = 1000;     // a tile wanted this recently is never evicted
static constexpr uint32_t RETRY_MS = 30000;  // failed tiles are retried at most this often
static constexpr size_t MIN_TILES = 16, MAX_TILES = 48;
static constexpr size_t MISSES = 32;  // slots for 404s and failures, without pixel memory

static uint8_t *alloc_tile() {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  return static_cast<uint8_t *>(heap_caps_malloc(ChartTileStore::TILE_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
#else
  return new (std::nothrow) uint8_t[ChartTileStore::TILE_BYTES];
#endif
}

static void free_tile(uint8_t *p) {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  heap_caps_free(p);
#else
  delete[] p;
#endif
}

uint8_t ChartTileStore::chart_index(const std::string &chart) {
  for (size_t i = 0; i < this->charts_.size(); i++) {
    if (this->charts_[i] == chart)
      return static_cast<uint8_t>(i);
  }
  if (this->charts_.size() >= 255)
    return 255;  // absurd; shares the last index
  this->charts_.push_back(chart);
  return static_cast<uint8_t>(this->charts_.size() - 1);
}

ChartTileStore::Slot *ChartTileStore::find_(const Key &key) {
  for (auto &s : this->slots_) {
    if (s.state != Slot::FREE && s.key == key)
      return &s;
  }
  return nullptr;
}

const ChartTileStore::Slot *ChartTileStore::find_(const Key &key) const {
  for (const auto &s : this->slots_) {
    if (s.state != Slot::FREE && s.key == key)
      return &s;
  }
  return nullptr;
}

size_t ChartTileStore::budget_() {
  if (this->budget_tiles_ != 0)
    return this->budget_tiles_;
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  const size_t n = heap_caps_get_free_size(MALLOC_CAP_SPIRAM) * 4 / 10 / TILE_BYTES;
  this->budget_tiles_ = n < MIN_TILES ? MIN_TILES : n > MAX_TILES ? MAX_TILES : n;
#else
  this->budget_tiles_ = MAX_TILES;
#endif
  // Fixed capacity: LVGL keeps pointers to the slots' image descriptors, so they never move.
  this->slots_.reserve(this->budget_tiles_ + MISSES);
  ESP_LOGI(TAG, "Chart tiles: up to %u (%.1f MB)", (unsigned) this->budget_tiles_,
           this->budget_tiles_ * TILE_BYTES / 1048576.0);
  return this->budget_tiles_;
}

void ChartTileStore::want(uint8_t chart, int z, int x, int y, int priority, uint32_t now) {
  const Key key{chart, static_cast<uint8_t>(z), x, y};
  if (Slot *s = this->find_(key)) {
    s->wanted_ms = now;
    if (s->state != Slot::FAILED || now - s->failed_ms < RETRY_MS)
      return;
  }
  if (this->in_flight_ && this->in_flight_key_ == key)
    return;
  this->wishes_.push_back({key, priority});
}

const lv_image_dsc_t *ChartTileStore::get(uint8_t chart, int z, int x, int y) const {
  const Slot *s = this->find_(Key{chart, static_cast<uint8_t>(z), x, y});
  return s != nullptr && s->state == Slot::LOADED ? &s->dsc : nullptr;
}

ChartTileStore::Slot *ChartTileStore::room_for_tile_(uint32_t now) {
  const size_t budget = this->budget_();
  // A free slot that still has pixel memory.
  for (auto &s : this->slots_) {
    if (s.state == Slot::FREE && s.data != nullptr)
      return &s;
  }
  // New pixel memory while within the budget.
  if (this->buffers_ < budget) {
    Slot *slot = nullptr;
    for (auto &s : this->slots_) {
      if (s.state == Slot::FREE) {
        slot = &s;
        break;
      }
    }
    if (slot == nullptr && this->slots_.size() < this->slots_.capacity()) {
      this->slots_.emplace_back();
      slot = &this->slots_.back();
      slot->state = Slot::FREE;
    }
    if (slot != nullptr) {
      slot->data = alloc_tile();
      if (slot->data != nullptr) {
        this->buffers_++;
        return slot;
      }
      ESP_LOGW(TAG, "No memory for more chart tiles: keeping %u", (unsigned) this->buffers_);
      this->budget_tiles_ = this->buffers_ > 0 ? this->buffers_ : 1;
    }
  }
  // The least recently wanted tile no chart showed in the last second.
  Slot *oldest = nullptr;
  for (auto &s : this->slots_) {
    if (s.state == Slot::LOADED && now - s.wanted_ms >= PIN_MS &&
        (oldest == nullptr || static_cast<int32_t>(s.wanted_ms - oldest->wanted_ms) < 0))
      oldest = &s;
  }
  if (oldest != nullptr)
    lv_image_cache_drop(&oldest->dsc);
  return oldest;
}

ChartTileStore::Slot *ChartTileStore::room_for_miss_(uint32_t now) {
  this->budget_();
  for (auto &s : this->slots_) {
    if (s.state == Slot::FREE && s.data == nullptr)
      return &s;
  }
  if (this->slots_.size() < this->slots_.capacity()) {
    this->slots_.emplace_back();
    return &this->slots_.back();
  }
  Slot *oldest = nullptr;
  for (auto &s : this->slots_) {
    if ((s.state == Slot::NONE || s.state == Slot::FAILED) &&
        (oldest == nullptr || static_cast<int32_t>(s.failed_ms - oldest->failed_ms) < 0))
      oldest = &s;
  }
  return oldest;
}

void ChartTileStore::pump(uint32_t now) {
  if (!this->in_flight_ && this->fetch_ && !this->wishes_.empty()) {
    const Wish *best = &this->wishes_[0];
    for (const auto &w : this->wishes_) {
      if (w.priority < best->priority)
        best = &w;
    }
    // Only fetch what can be kept: memory left, or a tile no chart is showing.
    bool room = this->buffers_ < this->budget_();
    for (size_t i = 0; !room && i < this->slots_.size(); i++) {
      const Slot &s = this->slots_[i];
      room = (s.state == Slot::FREE && s.data != nullptr) || (s.state == Slot::LOADED && now - s.wanted_ms >= PIN_MS);
    }
    if (room) {
      char path[160];
      std::snprintf(path, sizeof(path), "/tiles/%s/%d/%d/%d", this->charts_[best->key.chart].c_str(), best->key.z,
                    best->key.x, best->key.y);
      if (this->fetch_(path, this->tag_ + 1, TILE_BYTES + 1024)) {
        this->tag_++;
        this->in_flight_ = true;
        this->in_flight_key_ = best->key;
      }
    }
  }
  this->wishes_.clear();
}

void ChartTileStore::on_http(const HttpResult &r, uint32_t now) {
  if (r.kind != RequestKind::TILE || !this->in_flight_ || r.tag != this->tag_)
    return;
  this->in_flight_ = false;
  const Key key = this->in_flight_key_;
  const std::string &chart = this->charts_[key.chart];
  if (r.status == 200 && !r.truncated && r.body.size() == TILE_BYTES) {
    if (Slot *miss = this->find_(key))
      miss->state = Slot::FREE;  // it failed before; keep the slot for later misses
    Slot *s = this->room_for_tile_(now);
    if (s == nullptr) {
      ESP_LOGD(TAG, "Chart tile %s/%d/%d/%d dropped: every tile is on screen", chart.c_str(), key.z, key.x, key.y);
      return;
    }
    std::memcpy(s->data, r.body.data(), TILE_BYTES);
    s->key = key;
    s->state = Slot::LOADED;
    s->wanted_ms = now;
    std::memset(&s->dsc, 0, sizeof(s->dsc));
    s->dsc.header.magic = LV_IMAGE_HEADER_MAGIC;
    s->dsc.header.cf = LV_COLOR_FORMAT_RGB565;
    s->dsc.header.w = TILE;
    s->dsc.header.h = TILE;
    s->dsc.header.stride = TILE * 2;
    s->dsc.data_size = TILE_BYTES;
    s->dsc.data = s->data;
    lv_image_cache_drop(&s->dsc);
    this->version_++;
    ESP_LOGD(TAG, "Chart tile %s/%d/%d/%d loaded (%u in memory)", chart.c_str(), key.z, key.x, key.y,
             (unsigned) this->loaded());
    return;
  }
  // 404: the chart has no tile there; anything else: retry later. Neither is drawn.
  Slot *s = this->find_(key);
  if (s == nullptr)
    s = this->room_for_miss_(now);
  if (s != nullptr) {
    s->key = key;
    s->state = r.status == 404 ? Slot::NONE : Slot::FAILED;
    s->failed_ms = now;
  }
  if (r.status != 404)
    ESP_LOGW(TAG, "Chart tile %s/%d/%d/%d failed (HTTP %d%s)", chart.c_str(), key.z, key.x, key.y, r.status,
             r.truncated || (r.status == 200 && r.body.size() != TILE_BYTES) ? ", wrong size" : "");
}

void ChartTileStore::clear() {
  for (auto &s : this->slots_) {
    if (s.state == Slot::LOADED)
      lv_image_cache_drop(&s.dsc);
    if (s.data != nullptr)
      free_tile(s.data);
  }
  if (!this->slots_.empty())
    ESP_LOGI(TAG, "Chart tiles freed (%u)", (unsigned) this->buffers_);
  this->slots_.clear();
  this->slots_.shrink_to_fit();
  this->charts_.clear();
  this->wishes_.clear();
  this->budget_tiles_ = 0;
  this->buffers_ = 0;
  this->in_flight_ = false;  // a late result no longer matches
}

size_t ChartTileStore::loaded() const {
  size_t n = 0;
  for (const auto &s : this->slots_)
    n += s.state == Slot::LOADED ? 1 : 0;
  return n;
}

}  // namespace esphelm_runtime
}  // namespace esphome
