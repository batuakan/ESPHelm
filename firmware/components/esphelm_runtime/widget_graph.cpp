// The graph tile (ADR-0021). Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.widget";

/// Time axis text for `seconds` ago, as ageLabel() in packages/schema/src/history.ts.
static std::string age_text(int seconds) {
  char buf[16];
  if (seconds < 7200)
    std::snprintf(buf, sizeof(buf), "-%d m", (seconds + 30) / 60);
  else
    std::snprintf(buf, sizeof(buf), "-%d h", (seconds + 1800) / 3600);
  return buf;
}

/**
 * A line graph of the tile's recorded value: caption and live value with its unit on top, the
 * window's points below, the newest on the right. It draws what ValueHistory recorded under the
 * tile id, so it is a function of (config, its own recorded series, theme) and knows no other
 * widget. From GRAPH_AXIS_HEIGHT content pixels it also shows its y range and the window's start.
 * It redraws when a point of its window closes, never per value. Memory: about 8 LVGL objects
 * (plus one per zone) and a 480 B point buffer while its page is shown.
 */
class GraphWidget : public Widget {
 public:
  GraphWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell), night_(env.night), dark_(env.dark), zones_(tile.zones),
        has_range_(tile.has_range), min_(tile.min), max_(tile.max), history_(env.history) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    if (this->history_ != nullptr) {
      this->index_ = this->history_->find(tile.id);
      this->window_ = std::min<int>(tile.graph_window, this->history_->windows() - 1);
    }
    if (tile.graph_window != this->window_ && this->index_ >= 0)
      ESP_LOGD(TAG, "Graph %s: window %s not kept on this display, showing %s", id_.c_str(),
               esphelm::GRAPH_WINDOWS[tile.graph_window], esphelm::GRAPH_WINDOWS[this->window_]);
    const int d = tile.data.decimals >= 0 ? std::min<int>(tile.data.decimals, 3) : 1;
    for (int k = 0; k < d; k++)
      this->scale_ *= 10;

    const lv_font_t *small = smallest_font(env.fonts);
    caption_ = make_label(cell, small, env.colors.muted, tile.data.label);
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    value_ = make_label(cell, small, env.colors.muted, "--");
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      unit_text_ = std::string(" ") + tile.data.unit->label;

    plot_ = lv_obj_create(cell);
    lv_obj_remove_style_all(plot_);
    lv_obj_remove_flag(plot_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(plot_, LV_OBJ_FLAG_CLICKABLE);
    // Zone bands first, so the line is drawn over them.
    for (const auto &zone : zones_) {
      lv_obj_t *band = lv_obj_create(plot_);
      lv_obj_remove_style_all(band);
      lv_obj_remove_flag(band, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_set_style_bg_color(band, env.colors.zone[static_cast<int>(zone.state)], LV_PART_MAIN);
      lv_obj_set_style_bg_opa(band, dark_ ? LV_OPA_30 : LV_OPA_20, LV_PART_MAIN);
      lv_obj_add_flag(band, LV_OBJ_FLAG_HIDDEN);
      bands_.push_back(band);
    }
    chart_ = lv_chart_create(plot_);
    lv_obj_remove_flag(chart_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(chart_, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(chart_, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(chart_, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(chart_, 0, LV_PART_MAIN);
    lv_obj_set_style_line_color(chart_, env.colors.muted, LV_PART_MAIN);
    lv_obj_set_style_line_opa(chart_, LV_OPA_40, LV_PART_MAIN);
    lv_obj_set_style_line_width(chart_, 1, LV_PART_MAIN);
    lv_obj_set_style_size(chart_, 0, 0, LV_PART_INDICATOR);  // no dots on the points
    lv_chart_set_type(chart_, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(chart_, esphelm::sizes::HISTORY_POINTS);
    line_ = lv_chart_add_series(chart_, env.colors.accent, LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_series_ext_y_array(chart_, line_, chart_y_);
    note_ = make_label(plot_, small, env.colors.muted, index_ >= 0 ? "Collecting..." : "No history on this display");
    lv_label_set_long_mode(note_, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_set_style_text_align(note_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    for (auto *&l : y_labels_)
      l = make_label(cell, small, env.colors.muted, "");
    for (auto *&l : x_labels_)
      l = make_label(cell, small, env.colors.muted, "");

    if (index_ >= 0 && env.open_history) {
      // A tap opens the history popup on this value (its other windows, min and max).
      open_history_ = env.open_history;
      lv_obj_add_flag(cell, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_add_event_cb(
          cell, [](lv_event_t *e) { static_cast<GraphWidget *>(lv_event_get_user_data(e))->tap(""); },
          LV_EVENT_CLICKED, this);
    } else {
      lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
      if (index_ < 0)
        ESP_LOGW(TAG, "Graph %s: no history on this display", id_.c_str());
    }
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }
  void tap(const std::string &part) override {
    if (open_history_)
      open_history_(id_);
  }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    if (w <= 0 || h <= 0)
      return;
    // Header: caption left, value right, in the largest font whose sample fits half the width
    // and a fifth of the height, so the line keeps most of the tile.
    const std::string sample = value_sample(b_.item.decimals) + unit_text_;
    const lv_font_t *head = fit_font(fonts_, sample.c_str(), w / 2, std::max<int32_t>(h / 5, 1));
    lv_obj_set_style_text_font(caption_, head, LV_PART_MAIN);
    lv_obj_set_style_text_font(value_, head, LV_PART_MAIN);
    lv_obj_set_style_text_align(value_, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
    lv_obj_set_width(value_, w / 2);
    lv_obj_set_width(caption_, w - w / 2 - 4);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_align(value_, LV_ALIGN_TOP_RIGHT, 0, 0);
    const int32_t head_h = line_height(head);

    // Axis labels from GRAPH_AXIS_HEIGHT: the y range on the left, the window's start and now below.
    axis_ = h >= esphelm::sizes::GRAPH_AXIS_HEIGHT;
    const lv_font_t *small = smallest_font(fonts_);
    const int32_t small_h = line_height(small);
    int32_t label_w = 0;
    if (axis_) {
      std::string widest = "-8888";
      if (scale_ > 1)
        widest += "." + std::string(std::to_string(scale_).size() - 1, '8');
      label_w = text_width(widest.c_str(), small) + 6;
    }
    const int32_t plot_y = head_h + 4;
    const int32_t plot_w = std::max<int32_t>(w - label_w, 10);
    const int32_t plot_h = std::max<int32_t>(h - plot_y - (axis_ ? small_h + 2 : 0), 10);
    // Kept for the bands: the objects' sizes only update on LVGL's next layout pass.
    plot_w_ = plot_w;
    plot_h_ = plot_h;
    lv_obj_set_pos(plot_, label_w, plot_y);
    lv_obj_set_size(plot_, plot_w, plot_h);
    lv_obj_set_size(chart_, plot_w, plot_h);
    lv_obj_set_pos(chart_, 0, 0);
    lv_obj_set_style_line_width(chart_, plot_w >= 300 ? 3 : 2, LV_PART_ITEMS);
    lv_chart_set_div_line_count(chart_, axis_ ? 3 : 0, 0);
    lv_obj_set_width(note_, plot_w);
    lv_obj_align(note_, LV_ALIGN_CENTER, 0, 0);
    for (int k = 0; k < 2; k++) {
      lv_obj_set_width(y_labels_[k], label_w - 6);
      lv_obj_set_style_text_align(y_labels_[k], LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
      lv_obj_set_pos(y_labels_[k], 0, k == 0 ? plot_y : plot_y + plot_h - small_h);
    }
    if (axis_) {
      const int seconds = esphelm::sizes::HISTORY_WINDOW_SECONDS[window_];
      lv_label_set_text(x_labels_[0], age_text(seconds).c_str());
      lv_label_set_text(x_labels_[1], "now");
      lv_obj_set_pos(x_labels_[0], label_w, plot_y + plot_h + 2);
      lv_obj_align(x_labels_[1], LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    }
    for (int k = 0; k < 2; k++) {
      if (axis_) {
        lv_obj_remove_flag(y_labels_[k], LV_OBJ_FLAG_HIDDEN);
        lv_obj_remove_flag(x_labels_[k], LV_OBJ_FLAG_HIDDEN);
      } else {
        lv_obj_add_flag(y_labels_[k], LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(x_labels_[k], LV_OBJ_FLAG_HIDDEN);
      }
    }
    refresh_chart_();
    if (!b_.stale_shown)
      b_.dirty = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == b_.item.path)
      b_.set(v, now);
  }
  void tick(uint32_t now) override {
    bool stale;
    if (b_.due(now, stale)) {
      set_text(value_, shown_, (stale ? std::string("--") : b_.text) + unit_text_);
      lv_obj_set_style_text_color(value_, stale ? colors_.muted : number_color_(), LV_PART_MAIN);
    }
    if (index_ >= 0 && history_->appended(index_, window_) != drawn_)
      refresh_chart_();
  }

 protected:
  /// The window's points into the chart, with the y range and the zone bands.
  void refresh_chart_() {
    const int N = esphelm::sizes::HISTORY_POINTS;
    size_t n = 0;
    esphelm::GraphRange r;
    // Angles are drawn around their mean, unless the axis is fixed: then they stay in the
    // unit's range, as its labels are.
    const bool circular = index_ >= 0 && history_->circular(index_) && !has_range_;
    if (index_ >= 0) {
      drawn_ = history_->appended(index_, window_);
      n = history_->series(index_, window_, points_);
      r = esphelm::prepare_graph(points_, n, circular, history_->unit(index_));
    }
    if (r.valid < 2) {
      for (int k = 0; k < N; k++)
        chart_y_[k] = LV_CHART_POINT_NONE;
      lv_obj_remove_flag(note_, LV_OBJ_FLAG_HIDDEN);
      for (auto *l : y_labels_)
        lv_label_set_text(l, "");
      for (auto *b : bands_)
        lv_obj_add_flag(b, LV_OBJ_FLAG_HIDDEN);
      lv_chart_refresh(chart_);
      return;
    }
    lv_obj_add_flag(note_, LV_OBJ_FLAG_HIDDEN);
    if (!drawing_) {  // once per build: a line every point would spam the log
      drawing_ = true;
      ESP_LOGD(TAG, "Graph %s: drawing %u points, %u with values", id_.c_str(), (unsigned) n, (unsigned) r.valid);
    }
    const double lo = has_range_ ? min_ : r.lo;
    const double hi = has_range_ ? max_ : r.hi;
    const int32_t ylo = static_cast<int32_t>(std::floor(lo * scale_));
    const int32_t yhi = static_cast<int32_t>(std::ceil(hi * scale_));
    lv_chart_set_axis_range(chart_, LV_CHART_AXIS_PRIMARY_Y, ylo, yhi);
    const size_t offset = N - n;  // the newest point is on the right; a young window fills from there
    for (int k = 0; k < N; k++) {
      if (static_cast<size_t>(k) < offset) {
        chart_y_[k] = LV_CHART_POINT_NONE;
        continue;
      }
      const auto &p = points_[k - offset];
      // A fixed axis clips the line to its edges rather than drawing past them.
      chart_y_[k] = p.gap() ? LV_CHART_POINT_NONE
                            : std::clamp<int32_t>(static_cast<int32_t>(std::lround(p.mean * scale_)), ylo, yhi);
    }
    lv_chart_refresh(chart_);
    if (axis_) {
      lv_label_set_text(y_labels_[0], format_axis_(hi, circular).c_str());
      lv_label_set_text(y_labels_[1], format_axis_(lo, circular).c_str());
    }
    const int32_t ph = plot_h_;
    const int32_t pw = plot_w_;
    const double range = hi - lo;
    for (size_t z = 0; z < bands_.size(); z++) {
      // Zones are in the unit's range; a graph around north may run past its ends.
      const double from = std::max(zones_[z].from, lo);
      const double to = std::min(zones_[z].to, hi);
      if (circular || !(from < to)) {
        lv_obj_add_flag(bands_[z], LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      const int32_t y = static_cast<int32_t>(std::lround((hi - to) / range * ph));
      const int32_t bh = std::max<int32_t>(1, static_cast<int32_t>(std::lround((to - from) / range * ph)));
      lv_obj_set_pos(bands_[z], 0, y);
      lv_obj_set_size(bands_[z], pw, bh);
      lv_obj_remove_flag(bands_[z], LV_OBJ_FLAG_HIDDEN);
    }
  }

  /// An axis number with the tile's decimals; angles drawn around their mean are shown back in
  /// the unit's range (as the popup does), rounded first so that 359.96 reads 0, not 360.
  std::string format_axis_(double v, bool circular) const {
    const esphelm::units::UnitDef *u = b_.item.unit;
    if (circular && u != nullptr && u->has_wrap) {
      v = std::round(v * scale_) / scale_;
      const double span = u->wrap_max - u->wrap_min;
      v -= span * std::floor((v - u->wrap_min) / span);
    }
    char buf[24];
    const int d = b_.item.decimals >= 0 ? std::min<int>(b_.item.decimals, 3) : 1;
    std::snprintf(buf, sizeof(buf), "%.*f", d, v);
    return buf;
  }

  /// A matching zone, else the theme's text colour (as a value tile without a colour).
  lv_color_t number_color_() const {
    esphelm::ZoneState state;
    if (b_.has_number && esphelm::value_zone_state(b_.number, zones_, state)) {
      if (night_ && state == esphelm::ZoneState::NORMAL)
        return colors_.text;
      return colors_.zone[static_cast<int>(state)];
    }
    return colors_.text;
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  bool night_;
  bool dark_;
  std::vector<esphelm::Zone> zones_;
  bool has_range_;
  double min_, max_;
  const esphelm::ValueHistory *history_;
  int index_{-1};  // this tile's entry in history_, -1 if it records nothing
  int window_{0};
  int32_t scale_{1};  // chart values are display units times this (10^decimals, at most 1000)
  bool axis_{false};
  int32_t plot_w_{0}, plot_h_{0};  // the plot's size, set in layout_done()
  bool drawing_{false};  // has drawn a line since it was built
  uint32_t drawn_{0};  // history_->appended() when last drawn
  Binding b_;
  std::string unit_text_;
  std::string shown_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  lv_obj_t *plot_;
  lv_obj_t *chart_;
  lv_chart_series_t *line_;
  lv_obj_t *note_;
  lv_obj_t *y_labels_[2]{};
  lv_obj_t *x_labels_[2]{};
  std::vector<lv_obj_t *> bands_;
  std::function<void(const std::string &)> open_history_;
  int32_t chart_y_[esphelm::sizes::HISTORY_POINTS]{};
  esphelm::ValueHistory::Point points_[esphelm::sizes::HISTORY_POINTS]{};
};

std::unique_ptr<Widget> make_graph_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<GraphWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
