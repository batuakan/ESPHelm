#pragma once
// History popup (ADR-0018): a value tile's recent values as a line graph, over the page and
// below the alarm banner, on LVGL's top layer. Opened by a tap on the tile, closed only by its
// close button (a wet thumb elsewhere does nothing). Not a widget: it belongs to the runtime,
// reads ValueHistory, and outlives page changes underneath it. Main loop only.
// Memory: about 25 LVGL objects while open, none when closed, plus a fixed point buffer.

#include <cstdint>
#include <string>
#include <vector>

#include "lvgl.h"
#include "esphelm_sizes.h"
#include "layout_model.h"
#include "value_history.h"
#include "widgets.h"

namespace esphome {
namespace esphelm_runtime {

class HistoryPopup {
 public:
  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }
  void set_history(const esphelm::ValueHistory *history) { this->history_ = history; }

  /// Show the history of `tile` (a value tile that records). `top`: pixels left free for the
  /// alarm banner. Replaces a popup that is already open.
  void open(const esphelm::Tile &tile, esphelm::Theme theme, int32_t top);
  void close();
  bool is_open() const { return this->root_ != nullptr; }
  const std::string &tile_id() const { return this->tile_.id; }

  /// Test hook and buttons: "close", or a window ("10m", "1h", "6h"). Applied in tick().
  void tap(const std::string &part);
  /// Apply taps, follow the theme and the banner, redraw the graph when `points_closed`, and the
  /// value at most every 250 ms. True if the popup was built anew (the banner must go in front).
  bool tick(uint32_t now, bool points_closed, esphelm::Theme theme, int32_t top);

  /// Test hook name of window `w`: "10m", "1h", "6h".
  static std::string window_key(int w);

 protected:
  void build_();
  void refresh_chart_();
  void refresh_value_(uint32_t now);
  void style_buttons_();
  lv_color_t number_color_(bool has, float v) const;
  std::string format_(double v) const;

  Fonts fonts_;
  const esphelm::ValueHistory *history_{nullptr};
  esphelm::Tile tile_;
  esphelm::Theme theme_{esphelm::Theme::DAY};
  int32_t top_{0};
  int window_{0};
  int pending_window_{-1};
  bool pending_close_{false};
  uint32_t last_draw_ms_{0};
  std::string shown_;
  // Graph range in display units, and the scale of the chart's integer values.
  double lo_{0}, hi_{1};
  int32_t scale_{10};

  lv_obj_t *root_{nullptr};
  lv_obj_t *value_{nullptr};
  lv_obj_t *minmax_{nullptr};
  lv_obj_t *plot_{nullptr};
  lv_obj_t *chart_{nullptr};
  lv_chart_series_t *series_{nullptr};
  lv_obj_t *collecting_{nullptr};
  lv_obj_t *y_labels_[3]{};
  lv_obj_t *x_labels_[3]{};
  lv_obj_t *buttons_[esphelm::sizes::HISTORY_WINDOWS]{};
  std::vector<lv_obj_t *> bands_;  // one per zone, behind the line
  int32_t chart_y_[esphelm::sizes::HISTORY_POINTS]{};
  esphelm::ValueHistory::Point points_[esphelm::sizes::HISTORY_POINTS]{};
};

}  // namespace esphelm_runtime
}  // namespace esphome
