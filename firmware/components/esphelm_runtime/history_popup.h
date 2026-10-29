#pragma once
// History popup (ADR-0018, ADR-0019): a tile's recorded values as a line graph, over the page and
// below the alarm banner, on LVGL's top layer. Opened by a tap on the tile, closed only by its
// close button (a wet thumb elsewhere does nothing). A wind rose that records several values gets
// a row of buttons, one per value. Not a widget: it belongs to the runtime,
// reads ValueHistory, and outlives page changes underneath it. Main loop only.
// Memory: about 25 LVGL objects while open (plus one button per value of a wind rose), none when
// closed, plus a fixed point buffer.

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

/// One recorded value the popup can show.
struct HistorySeries {
  std::string key;   // ValueHistory id: the tile id, or "<tile id>/<name>" for a wind rose value
  std::string name;  // wind rose value name (its button's test hook part); empty for a value tile
  std::string title;  // button text
  esphelm::DataItem data;  // caption (label, else path), unit and decimals
  std::vector<esphelm::Zone> zones;
  esphelm::ValueColor color{esphelm::ValueColor::NONE};
};

class HistoryPopup {
 public:
  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }
  void set_history(const esphelm::ValueHistory *history) { this->history_ = history; }

  /// Show the values of tile `tile_id` that record (at least one), starting with `selected`.
  /// `top`: pixels left free for the alarm banner. Replaces a popup that is already open.
  void open(const std::string &tile_id, std::vector<HistorySeries> series, size_t selected, esphelm::Theme theme,
            int32_t top);
  void close();
  bool is_open() const { return this->root_ != nullptr; }
  const std::string &tile_id() const { return this->tile_id_; }
  /// The key of the value shown.
  const std::string &key() const { return this->cur_().key; }

  /// Test hook and buttons: "close", a window ("10m", "1h", "6h"), or a wind rose value's name
  /// ("apparentAngle"). Applied in tick().
  void tap(const std::string &part);
  /// Apply taps, follow the theme and the banner, redraw the graph when `points_closed`, and the
  /// value at most every 250 ms. True if the popup was built anew (the banner must go in front).
  bool tick(uint32_t now, bool points_closed, esphelm::Theme theme, int32_t top);

  /// Test hook name of window `w`: "10m", "1h", "6h".
  static std::string window_key(int w);

 protected:
  const HistorySeries &cur_() const { return this->series_[this->selected_]; }
  void build_();
  void refresh_chart_();
  void refresh_value_(uint32_t now);
  void style_buttons_();
  lv_color_t number_color_(bool has, float v) const;
  std::string format_(double v) const;
  /// An axis or min/max number: angles are shown back in the unit's range.
  std::string format_axis_(double v) const;

  Fonts fonts_;
  const esphelm::ValueHistory *history_{nullptr};
  std::string tile_id_;
  std::vector<HistorySeries> series_;
  size_t selected_{0};
  int pending_series_{-1};
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
  bool circular_{false};  // the shown series holds angles

  lv_obj_t *root_{nullptr};
  lv_obj_t *value_{nullptr};
  lv_obj_t *minmax_{nullptr};
  lv_obj_t *plot_{nullptr};
  lv_obj_t *chart_{nullptr};
  lv_chart_series_t *line_{nullptr};
  lv_obj_t *collecting_{nullptr};
  lv_obj_t *y_labels_[3]{};
  lv_obj_t *x_labels_[3]{};
  lv_obj_t *buttons_[esphelm::sizes::HISTORY_WINDOWS]{};
  std::vector<lv_obj_t *> series_buttons_;
  std::vector<lv_obj_t *> bands_;  // one per zone, behind the line
  int32_t chart_y_[esphelm::sizes::HISTORY_POINTS]{};
  esphelm::ValueHistory::Point points_[esphelm::sizes::HISTORY_POINTS]{};
};

}  // namespace esphelm_runtime
}  // namespace esphome
