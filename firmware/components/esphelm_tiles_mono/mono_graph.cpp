// The mono graph tile (ADR-0042). Shared helpers: mono_common.h, mono_draw.h.
#include "mono_common.h"
#include "mono_draw.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

namespace {

const char *const TAG = "esphelm.widget";
constexpr int32_t RULER_W = 6;    // the zone ruler beside the plot, px
constexpr int32_t RULER_GAP = 3;  // between the plot and the ruler
constexpr int32_t DASH = 4;       // a warn zone's dash and gap on the ruler, px

/// Time axis text for `seconds` ago, as ageLabel() in packages/schema/src/history.ts.
std::string age_text(int seconds) {
  char buf[16];
  if (seconds < 7200)
    std::snprintf(buf, sizeof(buf), "-%d m", (seconds + 30) / 60);
  else
    std::snprintf(buf, sizeof(buf), "-%d h", (seconds + 1800) / 3600);
  return buf;
}

/**
 * The colour graph tile's line of the tile's recorded value (ValueHistory, recorded by the core),
 * in the ink: caption and live value on top, the window's points below, the newest on the right,
 * the y range and the window's start from GRAPH_AXIS_HEIGHT, dashed grid lines. The zone bands of
 * the colour tile are translucent, which a 1-bit panel can't show; here the zones are a ruler on
 * the plot's right edge (nothing for normal, dashes for warn, solid for alarm and emergency), and
 * the live value's zone shows on the frame (warn heavy, alarm inverted), as on a value tile. No
 * history popup (no touch, ADR-0039). It redraws when a point of its window closes, never per
 * value. Memory: about 8 LVGL objects and a 480 B point buffer while its page is shown.
 */
class GraphWidget : public Widget {
 public:
  GraphWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), frame_(cell, env.colors), zones_(tile.zones),
        has_range_(tile.has_range), min_(tile.min), max_(tile.max), history_(env.history) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    if (history_ != nullptr) {
      index_ = history_->find(tile.id);
      window_ = std::min<int>(tile.graph_window, history_->windows() - 1);
    }
    const int d = tile.data.decimals >= 0 ? std::min<int>(tile.data.decimals, 3) : 1;
    for (int k = 0; k < d; k++)
      scale_ *= 10;
    for (const auto &z : zones_) {
      if (z.state != esphelm::ZoneState::NORMAL)
        ruler_ = true;
    }

    const lv_font_t *small = smallest_font(env.fonts);
    caption_ = label(cell, small, tile.data.label);
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    value_ = label(cell, small, "--");
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      unit_text_ = std::string(" ") + tile.data.unit->label;

    plot_ = lv_obj_create(cell);
    lv_obj_remove_style_all(plot_);
    lv_obj_remove_flag(plot_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(plot_, LV_OBJ_FLAG_CLICKABLE);
    chart_ = lv_chart_create(plot_);
    lv_obj_remove_flag(chart_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(chart_, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(chart_, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(chart_, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(chart_, 0, LV_PART_MAIN);
    lv_obj_set_style_line_opa(chart_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_line_width(chart_, 1, LV_PART_MAIN);
    lv_obj_set_style_line_dash_width(chart_, 2, LV_PART_MAIN);  // grid lines dashed: no grey here
    lv_obj_set_style_line_dash_gap(chart_, 4, LV_PART_MAIN);
    lv_obj_set_style_size(chart_, 0, 0, LV_PART_INDICATOR);  // no dots on the points
    lv_chart_set_type(chart_, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(chart_, esphelm::sizes::HISTORY_POINTS);
    line_ = lv_chart_add_series(chart_, env.colors.text, LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_series_ext_y_array(chart_, line_, chart_y_);
    note_ = label(plot_, small, index_ >= 0 ? "Collecting..." : "No history on this display");
    lv_label_set_long_mode(note_, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_set_style_text_align(note_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    if (ruler_) {
      ruler_obj_ = lv_obj_create(cell);
      lv_obj_remove_style_all(ruler_obj_);
      lv_obj_remove_flag(ruler_obj_, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_add_event_cb(
          ruler_obj_, [](lv_event_t *e) { static_cast<GraphWidget *>(lv_event_get_user_data(e))->draw_ruler_(e); },
          LV_EVENT_DRAW_MAIN, this);
    }
    for (auto *&l : y_labels_)
      l = label(cell, small, "");
    for (auto *&l : x_labels_)
      l = label(cell, small, "");
    recolour_();
    if (index_ < 0)
      ESP_LOGW(TAG, "Graph %s: no history on this display", id_.c_str());
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    if (w <= 0 || h <= 0)
      return;
    // As the colour tile: caption left, value right, in the largest font whose sample fits half
    // the width and a fifth of the height.
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
    const int32_t ruler_w = ruler_ ? RULER_W + RULER_GAP : 0;
    const int32_t plot_y = head_h + 4;
    const int32_t plot_w = std::max<int32_t>(w - label_w - ruler_w, 10);
    const int32_t plot_h = std::max<int32_t>(h - plot_y - (axis_ ? small_h + 2 : 0), 10);
    plot_h_ = plot_h;
    lv_obj_set_pos(plot_, label_w, plot_y);
    lv_obj_set_size(plot_, plot_w, plot_h);
    lv_obj_set_size(chart_, plot_w, plot_h);
    lv_obj_set_pos(chart_, 0, 0);
    lv_obj_set_style_line_width(chart_, plot_w >= 300 ? 3 : 2, LV_PART_ITEMS);
    lv_chart_set_div_line_count(chart_, axis_ ? 3 : 0, 0);
    lv_obj_set_width(note_, plot_w);
    lv_obj_align(note_, LV_ALIGN_CENTER, 0, 0);
    if (ruler_obj_ != nullptr) {
      lv_obj_set_pos(ruler_obj_, label_w + plot_w + RULER_GAP, plot_y);
      lv_obj_set_size(ruler_obj_, RULER_W, plot_h);
    }
    for (int k = 0; k < 2; k++) {
      lv_obj_set_width(y_labels_[k], std::max<int32_t>(label_w - 6, 1));
      lv_obj_set_style_text_align(y_labels_[k], LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
      lv_obj_set_pos(y_labels_[k], 0, k == 0 ? plot_y : plot_y + plot_h - small_h);
    }
    if (axis_) {
      lv_label_set_text(x_labels_[0], age_text(esphelm::sizes::HISTORY_WINDOW_SECONDS[window_]).c_str());
      lv_label_set_text(x_labels_[1], "now");
      lv_obj_set_pos(x_labels_[0], label_w, plot_y + plot_h + 2);
      lv_obj_align(x_labels_[1], LV_ALIGN_BOTTOM_RIGHT, -ruler_w, 0);
    }
    for (int k = 0; k < 2; k++) {
      for (lv_obj_t *l : {y_labels_[k], x_labels_[k]}) {
        if (axis_)
          lv_obj_remove_flag(l, LV_OBJ_FLAG_HIDDEN);
        else
          lv_obj_add_flag(l, LV_OBJ_FLAG_HIDDEN);
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
      esphelm::ZoneState state = esphelm::ZoneState::NORMAL;
      const bool zoned = !stale && b_.has_number && esphelm::value_zone_state(b_.number, zones_, state);
      if (frame_.show(zoned, state))
        recolour_();
    }
    if (index_ >= 0 && history_->appended(index_, window_) != drawn_)
      refresh_chart_();
  }

 private:
  /// The line and grid in the tile's ink (it changes when the tile is inverted).
  void recolour_() {
    lv_obj_set_style_line_color(chart_, frame_.ink(), LV_PART_MAIN);
    lv_chart_set_series_color(chart_, line_, frame_.ink());
    lv_chart_refresh(chart_);
    if (ruler_obj_ != nullptr)
      lv_obj_invalidate(ruler_obj_);
  }

  void refresh_chart_() {
    const int N = esphelm::sizes::HISTORY_POINTS;
    size_t n = 0;
    esphelm::GraphRange r;
    const bool circular = index_ >= 0 && history_->circular(index_) && !has_range_;
    if (index_ >= 0) {
      drawn_ = history_->appended(index_, window_);
      n = history_->series(index_, window_, points_);
      r = esphelm::prepare_graph(points_, n, circular, history_->unit(index_));
    }
    circular_ = circular;
    if (r.valid < 2) {
      for (int k = 0; k < N; k++)
        chart_y_[k] = LV_CHART_POINT_NONE;
      lv_obj_remove_flag(note_, LV_OBJ_FLAG_HIDDEN);
      for (auto *l : y_labels_)
        lv_label_set_text(l, "");
      drawn_range_ = false;
      lv_chart_refresh(chart_);
      if (ruler_obj_ != nullptr)
        lv_obj_invalidate(ruler_obj_);
      return;
    }
    lv_obj_add_flag(note_, LV_OBJ_FLAG_HIDDEN);
    if (!drawing_) {  // once per build: a line every point would spam the log
      drawing_ = true;
      ESP_LOGD(TAG, "Graph %s: drawing %u points, %u with values", id_.c_str(), (unsigned) n, (unsigned) r.valid);
    }
    lo_ = has_range_ ? min_ : r.lo;
    hi_ = has_range_ ? max_ : r.hi;
    drawn_range_ = true;
    const int32_t ylo = static_cast<int32_t>(std::floor(lo_ * scale_));
    const int32_t yhi = static_cast<int32_t>(std::ceil(hi_ * scale_));
    lv_chart_set_axis_range(chart_, LV_CHART_AXIS_PRIMARY_Y, ylo, yhi);
    const size_t offset = N - n;
    for (int k = 0; k < N; k++) {
      if (static_cast<size_t>(k) < offset) {
        chart_y_[k] = LV_CHART_POINT_NONE;
        continue;
      }
      const auto &p = points_[k - offset];
      chart_y_[k] = p.gap() ? LV_CHART_POINT_NONE
                            : std::clamp<int32_t>(static_cast<int32_t>(std::lround(p.mean * scale_)), ylo, yhi);
    }
    lv_chart_refresh(chart_);
    if (axis_) {
      lv_label_set_text(y_labels_[0], format_axis_(hi_, circular).c_str());
      lv_label_set_text(y_labels_[1], format_axis_(lo_, circular).c_str());
    }
    if (ruler_obj_ != nullptr)
      lv_obj_invalidate(ruler_obj_);
  }

  /// The zones of the drawn range beside the plot: dashes for warn, solid for alarm and emergency.
  void draw_ruler_(lv_event_t *e) {
    // Zones are in the unit's range; a graph around north may run past its ends, so none then.
    if (!drawn_range_ || circular_ || !(hi_ > lo_))
      return;
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(ruler_obj_, &box);
    const lv_color_t ink = frame_.ink();
    const double range = hi_ - lo_;
    for (const auto &z : zones_) {
      if (z.state == esphelm::ZoneState::NORMAL)
        continue;
      const double from = std::max(z.from, lo_), to = std::min(z.to, hi_);
      if (!(from < to))
        continue;
      const int32_t y1 = box.y1 + static_cast<int32_t>(std::lround((hi_ - to) / range * plot_h_));
      const int32_t y2 = std::max(y1, box.y1 + static_cast<int32_t>(std::lround((hi_ - from) / range * plot_h_)) - 1);
      if (draw::is_alarm(z.state)) {
        draw::rect(layer, ink, box.x1, y1, box.x2, y2);
        continue;
      }
      for (int32_t y = y1; y <= y2; y += 2 * DASH)
        draw::rect(layer, ink, box.x1, y, box.x2, std::min(y + DASH - 1, y2));
    }
  }

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

  std::string id_;
  Fonts fonts_;
  lv_obj_t *cell_;
  Frame frame_;
  std::vector<esphelm::Zone> zones_;
  bool has_range_;
  double min_, max_;
  const esphelm::ValueHistory *history_;
  int index_{-1};
  int window_{0};
  int32_t scale_{1};
  bool axis_{false};
  bool ruler_{false};  // a warn or alarm zone to show beside the plot
  int32_t plot_h_{0};
  double lo_{0}, hi_{0};  // the plotted range, for the ruler
  bool drawn_range_{false};
  bool circular_{false};
  bool drawing_{false};
  uint32_t drawn_{0};
  Binding b_;
  std::string unit_text_;
  std::string shown_;
  lv_obj_t *caption_;
  lv_obj_t *value_;
  lv_obj_t *plot_;
  lv_obj_t *chart_;
  lv_chart_series_t *line_;
  lv_obj_t *note_;
  lv_obj_t *ruler_obj_{nullptr};
  lv_obj_t *y_labels_[2]{};
  lv_obj_t *x_labels_[2]{};
  int32_t chart_y_[esphelm::sizes::HISTORY_POINTS]{};
  esphelm::ValueHistory::Point points_[esphelm::sizes::HISTORY_POINTS]{};
};

}  // namespace

std::unique_ptr<Widget> make_graph(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<GraphWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
