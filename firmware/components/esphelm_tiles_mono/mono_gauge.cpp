// The mono gauge tile (ADR-0042). Shared helpers: mono_common.h, mono_draw.h.
#include "mono_common.h"
#include "mono_draw.h"

#include <algorithm>
#include <cmath>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

namespace {

constexpr double START_DEG = 135;  // the scale's minimum, at about 7:30
constexpr double SWEEP_DEG = 270;
constexpr int32_t SMALL = 160;     // below this the tick labels and the unit go, as on the colour gauge

/**
 * A 270 degree scale like the colour gauge's (same ticks, tick labels, centre zero and small size),
 * drawn in one LV_EVENT_DRAW_MAIN callback in the ink only: zones as bands along the scale (a thin
 * line normal, dashes warn, a solid heavy band alarm and emergency, as on the mono engine), the
 * needle a black wedge, centre zero a solid band from zero to the value. The live value's zone also
 * shows on the frame (warn heavy, alarm inverted), as on a value tile. Stale: "--", no needle and
 * no fill, as there is no grey to dim them. Memory: a canvas object and up to four labels.
 */
class GaugeWidget : public Widget {
 public:
  GaugeWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), frame_(cell, env.colors), min_(tile.min), max_(tile.max),
        zones_(tile.zones), center_zero_(tile.center_zero), sides_(tile.sides),
        sample_(value_sample(tile.data.decimals)) {
    lo_ = min_;
    hi_ = max_;
    if (center_zero_) {
      const double m = esphelm::center_zero::span(min_, max_);
      lo_ = -m;
      hi_ = m;
    }
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    const double span = hi_ - lo_;
    for (int i = 0; i < 5; i++) {
      const double v = lo_ + span * i / 4.0;
      if (center_zero_) {
        tick_text_[i] = esphelm::center_zero::tick(v, hi_, sides_);
        continue;
      }
      char buf[16];
      label_number(buf, sizeof(buf), v, span);
      tick_text_[i] = buf;
    }

    caption_ = label(cell, env.fonts.small, tile.data.label);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    canvas_ = lv_obj_create(cell);
    lv_obj_remove_style_all(canvas_);
    lv_obj_remove_flag(canvas_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(
        canvas_, [](lv_event_t *e) { static_cast<GaugeWidget *>(lv_event_get_user_data(e))->draw_(e); },
        LV_EVENT_DRAW_MAIN, this);
    if (center_zero_ && sides_ == esphelm::center_zero::Sides::PORT_STARBOARD) {
      sides_labels_[0] = label(cell, env.fonts.small, "P");
      sides_labels_[1] = label(cell, env.fonts.small, "S");
    }
    value_ = label(cell, env.fonts.label, "--");
    if (tile.data.unit != nullptr && tile.data.unit->label[0] != '\0')
      unit_suffix_ = std::string(" ") + tile.data.unit->label;
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }

  void layout_done() override {
    // The caption takes the top line; the scale gets the largest square below it.
    const int32_t caption_h = b_.item.label.empty() ? 0 : line_height(fonts_.small);
    const int32_t h = lv_obj_get_content_height(cell_) - caption_h;
    d_ = std::max<int32_t>(16, std::min(lv_obj_get_content_width(cell_), h));
    lv_obj_set_size(canvas_, d_, d_);
    lv_obj_align(canvas_, LV_ALIGN_BOTTOM_MID, 0, 0);
    // Runs again when the page is laid out anew (alarm banner), so every choice is made afresh.
    small_ = d_ < SMALL;
    suffix_ = small_ ? "" : unit_suffix_;
    const std::string sample = sample_ + suffix_;
    lv_obj_set_style_text_font(value_, fit_font(fonts_, sample.c_str(), d_ * 7 / 10, d_ / 4), LV_PART_MAIN);
    set_text(value_, shown_, "--" + suffix_);
    lv_obj_update_layout(value_);
    lv_obj_align_to(value_, canvas_, LV_ALIGN_BOTTOM_MID, 0, 0);
    for (int i = 0; i < 2; i++) {
      if (sides_labels_[i] == nullptr)
        continue;
      if (small_) {
        lv_obj_add_flag(sides_labels_[i], LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      lv_obj_remove_flag(sides_labels_[i], LV_OBJ_FLAG_HIDDEN);
      lv_obj_align_to(sides_labels_[i], canvas_, i == 0 ? LV_ALIGN_TOP_LEFT : LV_ALIGN_TOP_RIGHT, 0, 0);
    }
    if (!b_.stale_shown)
      b_.dirty = true;
    lv_obj_invalidate(canvas_);
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == b_.item.path)
      b_.set(v, now);
  }

  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    live_ = !stale && b_.has_number;
    std::string text = (stale ? "--" : b_.text) + suffix_;
    if (center_zero_ && live_)
      text = center_zero_label(b_.number, b_.item.decimals, sides_, suffix_);
    if (set_text(value_, shown_, text))
      lv_obj_align_to(value_, canvas_, LV_ALIGN_BOTTOM_MID, 0, 0);
    esphelm::ZoneState state = esphelm::ZoneState::NORMAL;
    const bool zoned = live_ && esphelm::value_zone_state(b_.number, zones_, state);
    frame_.show(zoned, state);
    lv_obj_invalidate(canvas_);  // the needle, and the ink when the tile was inverted
  }

 private:
  double angle_(double v) const { return START_DEG + SWEEP_DEG * to_steps(v, lo_, hi_) / SCALE_STEPS; }

  void draw_(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(canvas_, &box);
    const lv_color_t ink = frame_.ink();
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const double r = d_ / 2.0;
    const double band = small_ ? 5 : 8;  // the colour gauge's zone sections are 8 px
    const double end = START_DEG + SWEEP_DEG;
    // The scale's line, then the zones on it.
    draw::arc(layer, ink, cx, cy, r, 2, START_DEG, end);
    for (const auto &z : zones_)
      draw::zone_band(layer, ink, cx, cy, r, band, angle_(z.from), angle_(z.to), z.state);
    const bool live = live_ && b_.has_number;
    if (center_zero_ && live)
      draw::arc(layer, ink, cx, cy, r, band, angle_(0), angle_(std::clamp(b_.number, min_, max_)));
    // Ticks inside the widest band, so a solid alarm band doesn't swallow them.
    const double outer = r - std::round(band * 1.5) - 2;
    const int ticks = small_ ? 11 : 21;
    const int major_every = small_ ? 2 : 5;
    const double minor_len = small_ ? 4 : 6, major_len = small_ ? 8 : 12;
    for (int i = 0; i < ticks; i++) {
      const double a = START_DEG + SWEEP_DEG * i / (ticks - 1);
      const bool major = i % major_every == 0;
      draw::line(layer, ink, draw::at(cx, cy, outer, a), draw::at(cx, cy, outer - (major ? major_len : minor_len), a),
                 major ? 2 : 1);
    }
    if (!small_) {
      const lv_font_t *font = fonts_.small;
      const double lr = outer - major_len - 4 - line_height(font) * 0.8;
      for (int i = 0; i < 5; i++) {
        const lv_point_precise_t p = draw::at(cx, cy, lr, START_DEG + SWEEP_DEG * i / 4.0);
        draw::text(layer, ink, tick_text_[i].c_str(), font, static_cast<int32_t>(p.x), static_cast<int32_t>(p.y));
      }
    }
    if (live) {
      const double v = std::clamp(b_.number, min_, max_);
      draw::wedge(layer, ink, cx, cy, angle_(v), -r * 0.08, outer - d_ / 14.0, std::max(2.0, r * 0.05));
    }
  }

  std::string id_;
  Fonts fonts_;
  lv_obj_t *cell_;
  Frame frame_;
  double min_, max_;
  double lo_, hi_;  // the drawn scale: min..max, or -M..M centred on zero
  std::vector<esphelm::Zone> zones_;
  bool center_zero_;
  esphelm::center_zero::Sides sides_;
  std::string sample_;
  Binding b_;
  bool live_{false};
  int32_t d_{16};
  bool small_{false};
  lv_obj_t *caption_;
  lv_obj_t *canvas_;
  lv_obj_t *sides_labels_[2]{};
  lv_obj_t *value_;
  std::string unit_suffix_;
  std::string suffix_;
  std::string shown_{"--"};
  std::string tick_text_[5];
};

}  // namespace

std::unique_ptr<Widget> make_gauge(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<GaugeWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
