// The mono heading tape tile (ADR-0042). Shared helpers: mono_common.h, mono_draw.h; geometry:
// esphelm_heading_tape.h (shared with the colour tile and the editor's preview).
#include "mono_common.h"
#include "mono_draw.h"

#include <algorithm>
#include <cmath>

#include "esphome/components/esphelm_runtime/esphelm_heading_tape.h"
#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

namespace {

namespace tape = esphelm::heading_tape;
using esphelm::HeadingTapeConfig;

/// The letter beside each marker (HEADING_TAPE_MARKERS order: cog, bearing, target).
const char *const MARKER_LETTERS[HeadingTapeConfig::MARKERS] = {"C", "W", "A"};
constexpr int32_t OUTLINE = FRAME;  // the tape's own outline, px

/**
 * The colour heading tape's layout and geometry in the ink only: the heading as a number above a
 * compass strip that scrolls under a fixed centre line, in an outline of its own (on the colour
 * tile it has a background of its own). The markers already differ by shape and letter (COG a
 * triangle under the tape, the waypoint bearing a diamond, the autopilot target a notch above;
 * beyond an edge an arrow), so they need no colour, and their letters are left out on a tape too
 * short to give them a row of their own. A stale heading empties the tape (the colour
 * tile keeps it, muted), a stale marker goes. It redraws when the heading or a marker moves by half
 * a degree or more, at most every DRAW_INTERVAL_MS. Memory: three LVGL objects.
 */
class HeadingTapeWidget : public Widget {
 public:
  HeadingTapeWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), ink_(env.colors.text), fonts_(env.fonts), cell_(cell) {
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
    // "12°T" for headingTrue, "12°M" for headingMagnetic, as on the colour tile.
    const std::string &hp = cfg.heading_path;
    suffix_ = hp.find("Magnetic") != std::string::npos ? "M" : hp.find("True") != std::string::npos ? "T" : "";

    caption_ = label(cell, env.fonts.small, tile.data.label);
    lv_label_set_long_mode(caption_, LV_LABEL_LONG_MODE_DOTS);
    number_ = label(cell, env.fonts.value, "--");
    lv_obj_set_style_text_align(number_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    tape_ = lv_obj_create(cell);
    lv_obj_remove_style_all(tape_);
    lv_obj_remove_flag(tape_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(tape_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(
        tape_, [](lv_event_t *e) { static_cast<HeadingTapeWidget *>(lv_event_get_user_data(e))->draw_(e); },
        LV_EVENT_DRAW_MAIN, this);
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
    // As the colour tile: the number in the largest font that fits 60 % of the width and 40 % of
    // the height, the caption beside it in a companion size.
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
    label_font_ = fit_font(fonts_, "330", tape_w_, std::max<int32_t>(tape_h_ / 3, 1));
    letter_font_ = smallest_font(fonts_);
    // The marker letters only where they have a row of their own below the tick numbers: in one
    // colour a letter over a number reads as neither, and the shapes already tell the markers apart.
    letters_ = tape_h_ * 2 / 5 + line_height(label_font_) <= tape_h_ - 2 - OUTLINE - line_height(letter_font_);
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

 private:
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

  /// `text` centred on `cx`, its top at `y`.
  void text_(lv_layer_t *layer, const char *text, const lv_font_t *font, int32_t cx, int32_t y) {
    draw::text(layer, ink_, text, font, cx, y + line_height(font) / 2);
  }

  void draw_(lv_event_t *e) {
    if (tape_w_ <= 0)
      return;
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(tape_, &box);
    const int32_t x0 = box.x1, y0 = box.y1, x1 = box.x2, y1 = box.y2, h = tape_h_;
    // The outline.
    draw::rect(layer, ink_, x0, y0, x1, y0 + OUTLINE - 1);
    draw::rect(layer, ink_, x0, y1 - OUTLINE + 1, x1, y1);
    draw::rect(layer, ink_, x0, y0, x0 + OUTLINE - 1, y1);
    draw::rect(layer, ink_, x1 - OUTLINE + 1, y0, x1, y1);
    const bool live = drawn_heading_ == drawn_heading_ && !heading_stale_;
    if (!live)
      return;  // a stale heading: an empty tape under "--"
    const int32_t label_y = y0 + h * 2 / 5;
    tape::Tick ticks[tape::MAX_TICKS];
    const size_t n = tape::marks(drawn_heading_, span_, tape_w_, ticks);
    for (size_t i = 0; i < n; i++) {
      const tape::Tick &t = ticks[i];
      const int32_t x = x0 + static_cast<int32_t>(std::lround(t.x));
      const int32_t len = t.kind == tape::Kind::MAJOR ? h * 3 / 10 : t.kind == tape::Kind::MEDIUM ? h / 5 : h / 8;
      const int32_t half = t.kind == tape::Kind::MAJOR ? 1 : 0;
      draw::rect(layer, ink_, x - half, y0, x + half, y0 + len);
      if (t.labelled) {
        char buf[4];
        text_(layer, tape::label(t.deg, buf), label_font_, x, label_y);
      }
    }
    // Markers, under the centre line.
    const float bottom = static_cast<float>(y0 + h - 2 - OUTLINE);
    const float top = static_cast<float>(y0 + OUTLINE);
    const float s = std::max<float>(6, std::min<float>(h / 5.0f, 16));
    const int32_t letter_h = line_height(letter_font_);
    int stacked[2] = {0, 0};  // off-tape arrows so far on the left and on the right
    for (int i = 0; i < HeadingTapeConfig::MARKERS; i++) {
      const double v = drawn_marker_[i];
      if (!shown_marker_[i] || v != v)
        continue;
      const tape::Position p = tape::tape_x(v, drawn_heading_, span_, tape_w_);
      const float x = static_cast<float>(x0 + std::clamp<double>(p.x, s, tape_w_ - s));
      if (p.off != 0) {
        const float tip = static_cast<float>(p.off < 0 ? x0 + OUTLINE + 2 : x0 + tape_w_ - OUTLINE - 2);
        const float back = tip - p.off * s * 1.4f;
        const float cy = bottom - s * 0.7f - stacked[p.off < 0 ? 0 : 1]++ * (s * 1.4f + 2);
        draw::triangle(layer, ink_, tip, cy, back, cy - s * 0.7f, back, cy + s * 0.7f);
        if (letters_)
          text_(layer, MARKER_LETTERS[i], letter_font_, static_cast<int32_t>(back - p.off * s * 0.8f),
              static_cast<int32_t>(cy) - letter_h / 2);
        continue;
      }
      if (i == HeadingTapeConfig::COG) {
        draw::triangle(layer, ink_, x, bottom - s * 1.6f, x - s, bottom, x + s, bottom);
      } else if (i == HeadingTapeConfig::BEARING) {
        const float cy = bottom - s;
        draw::triangle(layer, ink_, x, cy - s, x - s * 0.8f, cy, x + s * 0.8f, cy);
        draw::triangle(layer, ink_, x, cy + s, x - s * 0.8f, cy, x + s * 0.8f, cy);
      } else {
        draw::triangle(layer, ink_, x, top + s * 1.4f, x - s, top, x + s, top);
      }
      if (!letters_)
        continue;
      const int32_t ly = i == HeadingTapeConfig::TARGET ? static_cast<int32_t>(top) : static_cast<int32_t>(bottom) - letter_h;
      text_(layer, MARKER_LETTERS[i], letter_font_, static_cast<int32_t>(x + s * 1.6f), ly);
    }
    // The centre (lubber) line, over everything.
    const int32_t cx = x0 + tape_w_ / 2;
    draw::rect(layer, ink_, cx - 1, y0, cx + 1, y1);
  }

  std::string id_;
  lv_color_t ink_;
  Fonts fonts_;
  lv_obj_t *cell_;
  int span_{90};
  bool shown_marker_[HeadingTapeConfig::MARKERS]{};
  Binding heading_;
  Binding markers_[HeadingTapeConfig::MARKERS];
  std::string suffix_;
  std::string number_text_;
  double drawn_heading_{std::nan("")};
  bool heading_stale_{true};
  double drawn_marker_[HeadingTapeConfig::MARKERS]{std::nan(""), std::nan(""), std::nan("")};
  lv_obj_t *caption_;
  lv_obj_t *number_;
  lv_obj_t *tape_;
  int32_t tape_w_{0}, tape_h_{0};
  const lv_font_t *label_font_{nullptr};
  const lv_font_t *letter_font_{nullptr};
  bool letters_{true};
};

}  // namespace

std::unique_ptr<Widget> make_heading_tape(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<HeadingTapeWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
