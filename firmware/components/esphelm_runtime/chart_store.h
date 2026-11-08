#pragma once
// Map tiles shared by every chart tile on the display (ADR-0030). Charts are centred on the
// vessel, so charts of the same chart and zoom need the same map tiles: they are fetched once
// and kept once, whatever the number of chart tiles. Each chart says every tick which tiles
// cover its view (want); the store fetches the nearest missing one on the tile worker, keeps up
// to a budget of 256 px RGB565 tiles in PSRAM, and evicts the least recently wanted when full,
// never one a chart wanted in the last second. Main loop only.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "lvgl.h"
#include "layout_client.h"

namespace esphome {
namespace esphelm_runtime {

class ChartTileStore {
 public:
  static constexpr int TILE = 256;
  static constexpr size_t TILE_BYTES = static_cast<size_t>(TILE) * TILE * 2;
  /// GET `path` under the device API on the tile worker, `tag` coming back in the result.
  /// False when the worker is busy or the display isn't authorized yet.
  using Fetch = std::function<bool(const std::string &path, uint32_t tag, size_t max_body)>;

  ~ChartTileStore() { this->clear(); }

  void set_fetch(Fetch fetch) { this->fetch_ = std::move(fetch); }

  /// A small number for a chart id, so wanting tiles every tick allocates nothing.
  uint8_t chart_index(const std::string &chart);

  /// A chart shows tile (z, x, y) of `chart` (from chart_index) now; lower `priority` first.
  void want(uint8_t chart, int z, int x, int y, int priority, uint32_t now);

  /// The tile's image while it is loaded, else nullptr (not there yet, or the chart has none).
  const lv_image_dsc_t *get(uint8_t chart, int z, int x, int y) const;

  /// Once per loop after the widgets ticked: fetch the most wanted missing tile, if any.
  void pump(uint32_t now);

  /// A tile worker result.
  void on_http(const HttpResult &result, uint32_t now);

  /// Bumped whenever a tile arrives, so charts know to redraw.
  uint32_t version() const { return this->version_; }

  /// Forget every tile and free their memory (a layout without charts).
  void clear();

  size_t loaded() const;

 protected:
  struct Key {
    uint8_t chart{0}, z{0};
    int x{0}, y{0};
    bool operator==(const Key &o) const { return chart == o.chart && z == o.z && x == o.x && y == o.y; }
  };
  struct Slot {
    enum State : uint8_t { FREE, LOADED, NONE, FAILED };  // NONE: 404, the chart has no tile there
    Key key;
    State state{FREE};
    uint8_t *data{nullptr};  // TILE_BYTES in PSRAM while LOADED (kept for reuse otherwise)
    lv_image_dsc_t dsc{};
    uint32_t wanted_ms{0};
    uint32_t failed_ms{0};
  };
  struct Wish {
    Key key;
    int priority;
  };

  Slot *find_(const Key &key);
  const Slot *find_(const Key &key) const;
  /// A slot with pixel memory for a new tile: unused, or the least recently wanted unpinned one.
  Slot *room_for_tile_(uint32_t now);
  /// A slot for a 404 or failure (no pixel memory needed).
  Slot *room_for_miss_(uint32_t now);
  size_t budget_();

  Fetch fetch_;
  std::vector<std::string> charts_;
  std::vector<Slot> slots_;
  std::vector<Wish> wishes_;  // this loop's wants; capacity kept
  size_t budget_tiles_{0};    // 0 until the first tile is needed
  size_t buffers_{0};         // slots with pixel memory
  bool in_flight_{false};
  Key in_flight_key_;
  uint32_t tag_{0};
  uint32_t version_{0};
};

}  // namespace esphelm_runtime
}  // namespace esphome
