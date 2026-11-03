// The heading tape tile (ADR-0022). Shared helpers: widget_common.h; geometry:
// esphelm_heading_tape.h (shared with the editor's preview).
#include "widget_common.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphome/core/hal.h"
#include "esphelm_heading_tape.h"

namespace esphome {
namespace esphelm_runtime {

namespace tape = esphelm::heading_tape;
using esphelm::HeadingTapeConfig;

/// The letter beside each marker (HEADING_TAPE_MARKERS order: cog, bearing, target).
static const char *const MARKER_LETTERS[HeadingTapeConfig::MARKERS] = {"C", "W", "A"};

/**
 * A compass strip that scrolls with the heading under a fixed centre line, the heading as a
 * number above it, and markers for course over ground (a triangle under the tape), the bearing
 * to the next waypoint (a diamond) and the autopilot target (a notch above), each with a letter;
 * a marker beyond the edge is an arrow at that edge. The tape is drawn in its own draw callback
 * from the shared geometry, so it is a handful of LVGL objects whatever its span, and nothing is
 * allocated per value. It redraws when the heading or a marker moves by half a degree or more,
 * at most every DRAW_INTERVAL_MS. Memory: four LVGL objects.
 */
class HeadingTapeWidget : public Widget {
 public:
  HeadingTapeWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), cell_(cell) {
    static const HeadingTapeConfig DEFAULTS;
    const HeadingTapeConfig &cfg = tile.tape ? *tile.tape : DEFAULTS;
    span_ = cfg.span;
    const esphelm::units::UnitDef *deg = esphelm::units::find_unit("deg");
    const uint32_t stale = stale_ms(tile.data, env);
    heading_.item.path = cfg.heading_path;
    for (int i = 0; i < HeadingTapeConfig::MARKERS; i++) {
      shown_marker_[i] = cfg.markers[i];
      markers_[i].item.path = cfg.paths[i];
    }
    for (Binding *b : {&heading_, &markers_[0], &markers_[1], &markers_[2]}) {
      b->item.unit = deg;
      b->item.decimals = 0;
      b->stale_ms = stale;
      b->last_value_ms = millis();
    }
    // "12°T" for headingTrue, "12°M" for headingMagnetic, as on the wind rose.
    const std::string &hp = cfg.heading_path;
    suffix_ = hp.find("Magnetic") != std::string::npos ? "M" : hp.find("True") != std::string::npos ? "T" : "";

    caption_ = make_label(cell, env.fonts.small, env.colors.muted, tile.data.label);
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    number_ = make_label(cell, env.fonts.value, env.colors.muted, "--");
    lv_obj_set_style_text_align(number_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    tape_ = lv_obj_create(cell);
    lv_obj_remove_style_all(tape_);
    lv_obj_remove_flag(tape_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(tape_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(tape_, env.colors.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(tape_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(tape_, 6, LV_PART_MAIN);
    lv_obj_set_style_clip_corner(tape_, true, LV_PART_MAIN);
    lv_obj_add_event_cb(
        tape_, [](lv_event_t *e) { static_cast<HeadingTapeWidget *>(lv_event_get_user_data(e))->draw_(e); },
        LV_EVENT_DRAW_MAIN, this);
    lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {
    out.push_back(heading_.item.path);
    for (int i = 0; i < HeadingTapeConfig::MARKERS; i++) {
      if (shown_marker_[i])
        out.push_back(markers_[i].item.path);
    }
  }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t h = lv_obj_get_content_height(cell_);
    if (w <= 0 || h <= 0)
      return;
    // The number takes the largest font that fits 60 % of the width and 40 % of the height; the
    // caption sits beside it in a companion size.
    const std::string sample = "888°" + suffix_;
    const lv_font_t *number = fit_font(fonts_, sample.c_str(), w * 3 / 5, std::max<int32_t>(h * 2 / 5, 1));
    lv_obj_set_style_text_font(number_, number, LV_PART_MAIN);
    lv_obj_set_width(number_, w * 3 / 5);
    lv_obj_align(number_, LV_ALIGN_TOP_MID, 0, 0);
    lv_obj_set_style_text_font(caption_, companion_font(fonts_, number), LV_PART_MAIN);
    lv_obj_set_width(caption_, w / 5);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    const int32_t top = line_height(number) + 4;
    tape_w_ = w;
    tape_h_ = std::max<int32_t>(h - top, 16);
    lv_obj_set_pos(tape_, 0, top);
    lv_obj_set_size(tape_, tape_w_, tape_h_);
    // Tick labels: the largest full font no taller than a third of the tape.
    label_font_ = fit_font(fonts_, "330", tape_w_, std::max<int32_t>(tape_h_ / 3, 1));
    letter_font_ = smallest_font(fonts_);
    if (!heading_.stale_shown)
      heading_.dirty = true;
    lv_obj_invalidate(tape_);
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == heading_.item.path)
      heading_.set(v, now);
    for (int i = 0; i < HeadingTapeConfig::MARKERS; i++) {
      if (shown_marker_[i] && path == markers_[i].item.path)
        markers_[i].set(v, now);
    }
  }

  void tick(uint32_t now) override {
    bool redraw = false;
    bool stale;
    if (heading_.due(now, stale)) {
      const bool has = !stale && heading_.has_number;
      set_text(number_, number_text_, has ? heading_.text + "°" + suffix_ : "--");
      lv_obj_set_style_text_color(number_, has ? colors_.text : colors_.muted, LV_PART_MAIN);
      // A stale heading keeps the tape where it was, muted, without markers.
      if (has != !heading_stale_) {
        heading_stale_ = !has;
        redraw = true;
      }
      if (has)
        redraw = moved_(drawn_heading_, true, heading_.number) || redraw;
    }
    for (int i = 0; i < HeadingTapeConfig::MARKERS; i++) {
      if (shown_marker_[i] && markers_[i].due(now, stale))
        redraw = moved_(drawn_marker_[i], !stale && markers_[i].has_number, markers_[i].number) || redraw;
    }
    if (redraw)
      lv_obj_invalidate(tape_);
  }

 protected:
  /// What the tape last drew of a value: NaN when nothing (stale or never set).
  static bool moved_(double &drawn, bool has, double v) {
    if (!has) {
      const bool was = drawn == drawn;
      drawn = std::nan("");
      return was;
    }
    if (drawn == drawn && std::fabs(tape::norm(v - drawn + 180) - 180) < 0.5)
      return false;
    drawn = v;
    return true;
  }

  void rect_(lv_layer_t *layer, int32_t x1, int32_t y1, int32_t x2, int32_t y2, lv_color_t color) {
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = color;
    d.bg_opa = LV_OPA_COVER;
    lv_area_t a{x1, y1, x2, y2};
    lv_draw_rect(layer, &d, &a);
  }
  void triangle_(lv_layer_t *layer, lv_color_t color, float x0, float y0, float x1, float y1, float x2, float y2) {
    lv_draw_triangle_dsc_t t;
    lv_draw_triangle_dsc_init(&t);
    t.color = color;
    t.opa = LV_OPA_COVER;
    // lv_value_precise_t is an integer unless LV_USE_FLOAT is set.
    auto p = [](float x, float y) {
      return lv_point_precise_t{static_cast<lv_value_precise_t>(std::lround(x)),
                                static_cast<lv_value_precise_t>(std::lround(y))};
    };
    t.p[0] = p(x0, y0);
    t.p[1] = p(x1, y1);
    t.p[2] = p(x2, y2);
    lv_draw_triangle(layer, &t);
  }
  void text_(lv_layer_t *layer, const char *text, const lv_font_t *font, lv_color_t color, int32_t cx, int32_t y) {
    lv_draw_label_dsc_t d;
    lv_draw_label_dsc_init(&d);
    d.text = text;
    d.text_local = 1;  // drawn later: LVGL copies it
    d.font = font;
    d.color = color;
    d.align = LV_TEXT_ALIGN_CENTER;
    const int32_t tw = text_width(text, font) + 4;
    lv_area_t a{cx - tw / 2, y, cx + tw / 2, y + line_height(font)};
    lv_draw_label(layer, &d, &a);
  }

  void draw_(lv_event_t *e) {
    if (tape_w_ <= 0)
      return;
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(tape_, &box);
    const int32_t x0 = box.x1, y0 = box.y1, h = tape_h_;
    const bool has_heading = drawn_heading_ == drawn_heading_;
    const bool live = has_heading && !heading_stale_;
    const lv_color_t ink = live ? colors_.text : colors_.muted;
    // Ticks hang from the top edge; labels under the major ones (and the tens when there's room).
    const int32_t label_y = y0 + h * 2 / 5;
    if (has_heading) {
      tape::Tick ticks[tape::MAX_TICKS];
      const size_t n = tape::marks(drawn_heading_, span_, tape_w_, ticks);
      for (size_t i = 0; i < n; i++) {
        const tape::Tick &t = ticks[i];
        const int32_t x = x0 + static_cast<int32_t>(std::lround(t.x));
        const int32_t len = t.kind == tape::Kind::MAJOR ? h * 3 / 10 : t.kind == tape::Kind::MEDIUM ? h / 5 : h / 8;
        const int32_t half = t.kind == tape::Kind::MAJOR ? 1 : 0;
        rect_(layer, x - half, y0, x + half, y0 + len, ink);
        if (t.labelled) {
          char buf[4];
          text_(layer, tape::label(t.deg, buf), label_font_, ink, x, label_y);
        }
      }
    }
    // Markers, under the centre line.
    const float bottom = static_cast<float>(y0 + h - 2);
    const float s = std::max<float>(6, std::min<float>(h / 5.0f, 16));
    const int32_t letter_h = line_height(letter_font_);
    int stacked[2] = {0, 0};  // off-tape arrows so far on the left and on the right
    for (int i = 0; live && i < HeadingTapeConfig::MARKERS; i++) {
      const double v = drawn_marker_[i];
      if (!shown_marker_[i] || v != v)
        continue;
      const tape::Position p = tape::tape_x(v, drawn_heading_, span_, tape_w_);
      const lv_color_t color = marker_color_(i);
      const float x = static_cast<float>(x0 + std::clamp<double>(p.x, s, tape_w_ - s));
      if (p.off != 0) {
        // Beyond the edge: an arrow pointing out of the tape, on the side of the shorter turn, in
        // the bottom row (under the tick labels), the next one above it.
        const float tip = static_cast<float>(p.off < 0 ? x0 + 2 : x0 + tape_w_ - 2);
        const float back = tip - p.off * s * 1.4f;
        const float cy = bottom - s * 0.7f - stacked[p.off < 0 ? 0 : 1]++ * (s * 1.4f + 2);
        triangle_(layer, color, tip, cy, back, cy - s * 0.7f, back, cy + s * 0.7f);
        text_(layer, MARKER_LETTERS[i], letter_font_, color, static_cast<int32_t>(back - p.off * s * 0.8f),
              static_cast<int32_t>(cy) - letter_h / 2);
        continue;
      }
      if (i == HeadingTapeConfig::COG) {
        triangle_(layer, color, x, bottom - s * 1.6f, x - s, bottom, x + s, bottom);
      } else if (i == HeadingTapeConfig::BEARING) {
        const float cy = bottom - s;
        triangle_(layer, color, x, cy - s, x - s * 0.8f, cy, x + s * 0.8f, cy);
        triangle_(layer, color, x, cy + s, x - s * 0.8f, cy, x + s * 0.8f, cy);
      } else {
        triangle_(layer, color, x, static_cast<float>(y0) + s * 1.4f, x - s, static_cast<float>(y0), x + s,
                  static_cast<float>(y0));
      }
      // The letter beside its shape, in the shape's own row: clear of the tick labels.
      const int32_t ly = i == HeadingTapeConfig::TARGET ? y0 : static_cast<int32_t>(bottom) - letter_h;
      text_(layer, MARKER_LETTERS[i], letter_font_, color, static_cast<int32_t>(x + s * 1.6f), ly);
    }
    // The centre (lubber) line, over everything.
    const int32_t cx = x0 + tape_w_ / 2;
    rect_(layer, cx - 1, y0, cx + 1, y0 + h - 1, live ? colors_.accent : colors_.muted);
  }

  /// Marker colours; at night they are all red, and their shapes tell them apart.
  lv_color_t marker_color_(int i) const {
    return i == HeadingTapeConfig::COG ? colors_.second
           : i == HeadingTapeConfig::BEARING
               ? colors_.zone[0]
               : colors_.palette[static_cast<int>(esphelm::ValueColor::ORANGE)];
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *cell_;
  int span_{90};
  bool shown_marker_[HeadingTapeConfig::MARKERS]{};
  Binding heading_;
  Binding markers_[HeadingTapeConfig::MARKERS];
  std::string suffix_;
  std::string number_text_;
  // What the tape draws (degrees); NaN: nothing. A stale heading keeps its last value.
  double drawn_heading_{std::nan("")};
  bool heading_stale_{true};
  double drawn_marker_[HeadingTapeConfig::MARKERS]{std::nan(""), std::nan(""), std::nan("")};
  lv_obj_t *caption_;
  lv_obj_t *number_;
  lv_obj_t *tape_;
  int32_t tape_w_{0}, tape_h_{0};
  const lv_font_t *label_font_{nullptr};
  const lv_font_t *letter_font_{nullptr};
};

std::unique_ptr<Widget> make_heading_tape_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<HeadingTapeWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
