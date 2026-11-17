// The mono wind rose tile (ADR-0039). Shared helpers: mono_common.h. The values, their units, the
// redraw throttle and the stale tracking work as in the colour wind rose (ADR-0010); what differs
// is the drawing, in the ink and the page colour only: a ring of ticks, a solid starboard and an
// outlined port sector in place of green and red, a compass card with white letters on a black
// band, and the markers A (a solid triangle) and T (an outline), each with its letter drawn as
// strokes so it turns with the marker.
#include "mono_common.h"
#include "mono_corner_values.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <utility>

#include "esphome/core/hal.h"
#include "esphome/components/esphelm_runtime/esphelm_rose_geometry.h"
#include "esphome/components/esphelm_runtime/esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

namespace {

// The compass points of the card, 45 degrees apart from N. The eight from DETAIL_FROM px up, else
// the four cardinals (every second one): a 1-bit display has no room for sixteen.
const char *POINTS[8] = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};

// From this rose size (px) on, the ticks come every 10 degrees, the card has eight points and the
// markers carry their letters. The colour rose waits for its full tier (260 px) for these, but on
// a 400x300 display a rose beside the page footer is only about 215 px.
constexpr int32_t DETAIL_FROM = 180;

// The card turns in steps of this many degrees (at 215 px a degree moves its letters under a pixel),
// so a heading that jitters by a degree does not redraw it.
constexpr int32_t HEADING_STEP = 2;

class WindRoseWidget : public Widget {
 public:
  WindRoseWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), ink_(env.colors.text), paper_(env.colors.background), fonts_(env.fonts), area_(cell) {
    static const esphelm::RoseConfig DEFAULTS;
    const esphelm::RoseConfig &cfg = tile.rose ? *tile.rose : DEFAULTS;
    show_true_ = cfg.show_true_wind;
    const esphelm::units::UnitDef *deg = esphelm::units::find_unit("deg");
    apparent_.item.path = cfg.apparent_angle;
    true_dir_.item.path = cfg.true_direction;
    heading_.item.path = cfg.heading;
    for (Binding *b : {&apparent_, &true_dir_, &heading_}) {
      b->item.unit = deg;
      b->item.decimals = 0;
      b->stale_ms = env.default_stale_ms;
      b->last_value_ms = millis();
    }
    // "12°T" for headingTrue, "12°M" for headingMagnetic.
    const std::string &hp = cfg.heading;
    heading_suffix_ = hp.find("Magnetic") != std::string::npos ? "M" : hp.find("True") != std::string::npos ? "T" : "";

    // The ring (ticks and the two sectors), fixed to the bow (0 at the top), drawn first.
    ring_ = lv_obj_create(cell);
    lv_obj_remove_style_all(ring_);
    lv_obj_remove_flag(ring_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(
        ring_, [](lv_event_t *e) { static_cast<WindRoseWidget *>(lv_event_get_user_data(e))->draw_ring_(e); },
        LV_EVENT_DRAW_MAIN, this);

    // The compass card: an ink band with the compass points in the page colour, turned by the
    // heading. The points are drawn as strokes (esphelm_rose_geometry.h, label()), as LVGL turns a
    // 1-bit font by an arbitrary angle into broken streaks.
    card_ = lv_obj_create(cell);
    lv_obj_remove_style_all(card_);
    lv_obj_remove_flag(card_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(
        card_, [](lv_event_t *e) { static_cast<WindRoseWidget *>(lv_event_get_user_data(e))->draw_card_(e); },
        LV_EVENT_DRAW_MAIN, this);

    // The markers are drawn on a transparent overlay covering the rose, over the card.
    markers_ = lv_obj_create(cell);
    lv_obj_remove_style_all(markers_);
    lv_obj_remove_flag(markers_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(
        markers_, [](lv_event_t *e) { static_cast<WindRoseWidget *>(lv_event_get_user_data(e))->draw_markers_(e); },
        LV_EVENT_DRAW_MAIN, this);

    center_ = lv_obj_create(cell);
    lv_obj_remove_style_all(center_);
    lv_obj_set_flex_flow(center_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(center_, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(center_, 0, LV_PART_MAIN);
    lv_obj_set_size(center_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    heading_label_ = make_label(center_, env.fonts.small, ink_, "--\xC2\xB0" + heading_suffix_);
    lv_obj_set_style_pad_bottom(heading_label_, 4, LV_PART_MAIN);
    for (int i = 0; i < esphelm::RoseConfig::MAX_SLOTS; i++) {
      if (!cfg.has_slot[i])
        continue;
      const esphelm::DataItem &item = cfg.slots[i];
      if (i >= esphelm::RoseConfig::CENTER_SLOTS) {
        // Corner: a value over its caption, pushed into the tile's corner.
        corners_.add(cell, i - esphelm::RoseConfig::CENTER_SLOTS, item, env);
        continue;
      }
      Slot s;
      s.b.item = item;
      s.b.stale_ms = stale_ms(item, env);
      s.b.last_value_ms = millis();
      std::string caption = item.label;
      if (item.unit != nullptr && item.unit->label[0] != '\0')
        caption += caption.empty() ? item.unit->label : std::string(" ") + item.unit->label;
      s.value = make_label(center_, env.fonts.value, ink_, "--");
      s.caption = make_label(center_, env.fonts.small, ink_, caption);
      slots_.push_back(std::move(s));
    }
    for (lv_obj_t *o : {ring_, card_, center_})
      lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE);
  }

  const std::string &id() const override { return id_; }

  void paths(std::vector<std::string> &out) const override {
    out.push_back(apparent_.item.path);
    out.push_back(heading_.item.path);
    if (show_true_)
      out.push_back(true_dir_.item.path);
    for (const auto &s : slots_)
      out.push_back(s.b.item.path);
    corners_.paths(out);
  }

  void layout_done() override {
    const int32_t d = std::min(lv_obj_get_content_width(area_), lv_obj_get_content_height(area_));
    d_ = d;
    radii_ = esphelm::rose_geometry::radii(d);
    // Size tiers (esphelm_sizes.h, shared with the editor's size hint): the heading in the middle
    // is the full tier's. The corner values come from the compact tier on, each where it clears
    // the ring; the finer ticks, the eight points and the marker letters from DETAIL_FROM px.
    full_ = d >= esphelm::sizes::WIND_ROSE_FULL;
    const bool compact = !full_ && d >= esphelm::sizes::WIND_ROSE_COMPACT;
    detail_ = d >= DETAIL_FROM;
    corners_.layout(lv_obj_get_content_width(area_), lv_obj_get_content_height(area_), d / 2.0 + 2,
                    full_ || compact);

    for (lv_obj_t *o : {ring_, markers_}) {
      lv_obj_set_size(o, d, d);
      lv_obj_center(o);
    }
    // The card is as big as its band, not the rose: redrawing it then leaves the outer ring alone.
    const int32_t card_d = 2 * radii_.band_out + 2;
    lv_obj_set_size(card_, card_d, card_d);
    lv_obj_center(card_);
    // The card (the band and its points) only from the compact tier; below it the rose is the ring
    // and the pointers.
    if (full_ || compact)
      lv_obj_remove_flag(card_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(card_, LV_OBJ_FLAG_HIDDEN);

    // The values go inside the card band; the font steps down until every slot fits.
    const int32_t inner = radii_.band_in;
    // The stack is narrow, so it can use most of the disc's height (as the colour rose does).
    const int32_t room_h = inner * 19 / 10;
    const int32_t room_w = inner * 3 / 2;
    const int32_t small_h = line_height(fonts_.small);
    const int32_t head_h = full_ ? small_h + 4 : 0;
    // Candidate fonts, largest first: every full font of the ladder (ADR-0017) up to the value
    // font. Digits-only fonts are left out: a slot can show text.
    const lv_font_t *fonts[Fonts::MAX_LADDER + 3];
    size_t font_count = 0;
    const int32_t value_h = lv_font_get_line_height(fonts_.value);
    for (int i = static_cast<int>(fonts_.count) - 1; i >= 0; i--) {
      if (!fonts_.digits[i] && lv_font_get_line_height(fonts_.ladder[i]) <= value_h)
        fonts[font_count++] = fonts_.ladder[i];
    }
    if (font_count == 0) {
      for (const lv_font_t *f : {fonts_.value, fonts_.label, fonts_.small})
        fonts[font_count++] = f;
    }
    const lv_font_t *font = fonts_.small;
    size_t fit = 0;
    // Values are digits only, so their lines are tightened by a quarter (negative margins).
    const auto tight = [](int32_t fh) { return fh * 3 / 4; };
    for (size_t k = 0; k < font_count; k++) {
      const lv_font_t *f = fonts[k];
      const int32_t fh = lv_font_get_line_height(f);
      const size_t n = static_cast<size_t>(std::max<int32_t>(0, room_h - head_h) / (tight(fh) + small_h));
      // "13.6" is about 2.4 line heights wide in these fonts.
      if (fh * 12 / 5 > room_w)
        continue;
      font = f;
      fit = n;
      if (n >= slots_.size())
        break;
    }
    if (!(full_ || compact))
      fit = 0;
    if (full_)
      lv_obj_remove_flag(heading_label_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(heading_label_, LV_OBJ_FLAG_HIDDEN);
    const int32_t fh = lv_font_get_line_height(font);
    for (size_t i = 0; i < slots_.size(); i++) {
      lv_obj_set_style_text_font(slots_[i].value, font, LV_PART_MAIN);
      lv_obj_set_style_margin_top(slots_[i].value, -(fh - tight(fh)) / 2, LV_PART_MAIN);
      lv_obj_set_style_margin_bottom(slots_[i].value, -(fh - tight(fh)) / 2, LV_PART_MAIN);
      for (lv_obj_t *o : {slots_[i].value, slots_[i].caption}) {
        if (i < fit)
          lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
        else
          lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
      }
    }
    lv_obj_center(center_);
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    for (Binding *b : {&apparent_, &true_dir_, &heading_}) {
      if (path == b->item.path)
        b->set(v, now);
    }
    for (auto &s : slots_) {
      if (path == s.b.item.path)
        s.b.set(v, now);
    }
    corners_.on_value(path, v, now);
  }

  void tick(uint32_t now) override {
    bool stale;
    if (apparent_.due(now, stale))
      apparent_stale_ = stale;
    if (true_dir_.due(now, stale))
      true_stale_ = stale;
    if (heading_.due(now, stale)) {
      heading_stale_ = stale;
      const bool known = !stale && heading_.has_number;
      set_text(heading_label_, heading_shown_, (known ? heading_.text : "--") + "\xC2\xB0" + heading_suffix_);
      // The card turns so that the boat's heading is at the top.
      if (known) {
        const int32_t h = static_cast<int32_t>(std::lround(heading_.number)) % 360;
        int32_t step = std::abs(h - heading_deg_) % 360;
        step = std::min(step, 360 - step);
        if (step >= HEADING_STEP) {
          heading_deg_ = h;
          lv_obj_invalidate(card_);
        }
      }
    }
    // A marker redraws only its own box, the old one and the new one, and only when it moved a
    // whole degree or came or went; the whole rose is much more to draw than that.
    const MarkerState a = apparent_marker_(), t = true_marker_();
    if (!(a == shown_a_)) {
      invalidate_marker_(shown_a_);
      invalidate_marker_(a);
      shown_a_ = a;
    }
    if (!(t == shown_t_)) {
      invalidate_marker_(shown_t_);
      invalidate_marker_(t);
      shown_t_ = t;
    }
    for (auto &s : slots_) {
      if (s.b.due(now, stale))
        set_text(s.value, s.shown, stale ? "--" : s.b.text);
    }
    corners_.tick(now);
  }

 protected:
  struct Slot {
    Binding b;
    lv_obj_t *value{nullptr};
    lv_obj_t *caption{nullptr};
    std::string shown{"--"};
  };

  using Point = esphelm::rose_geometry::Point;

  static lv_point_precise_t precise(const Point &p) {
    return {static_cast<lv_value_precise_t>(p.x), static_cast<lv_value_precise_t>(p.y)};
  }

  void line_(lv_layer_t *layer, const Point &a, const Point &b, int32_t width, lv_color_t color) {
    lv_draw_line_dsc_t line;
    lv_draw_line_dsc_init(&line);
    line.color = color;
    line.opa = LV_OPA_COVER;
    line.width = width;
    line.p1 = precise(a);
    line.p2 = precise(b);
    lv_draw_line(layer, &line);
  }

  void triangle_(lv_layer_t *layer, const Point p[3], lv_color_t color) {
    lv_draw_triangle_dsc_t tri;
    lv_draw_triangle_dsc_init(&tri);
    tri.color = color;
    tri.opa = LV_OPA_COVER;
    for (int i = 0; i < 3; i++)
      tri.p[i] = precise(p[i]);
    lv_draw_triangle(layer, &tri);
  }

  /// An arc of the ring from `a1` to `a2` degrees clockwise from the bow, `radius` being its
  /// outer edge. The arcs here run through no more than a few degrees and never across the bow.
  void arc_(lv_layer_t *layer, double cx, double cy, int32_t radius, int32_t width, int a1, int a2) {
    lv_draw_arc_dsc_t arc;
    lv_draw_arc_dsc_init(&arc);
    arc.color = ink_;
    arc.opa = LV_OPA_COVER;
    arc.width = width;
    arc.radius = static_cast<uint16_t>(std::max<int32_t>(1, radius));
    arc.center = {static_cast<int32_t>(std::lround(cx)), static_cast<int32_t>(std::lround(cy))};
    arc.start_angle = static_cast<lv_value_precise_t>((a1 - 90 + 360) % 360);
    arc.end_angle = static_cast<lv_value_precise_t>((a1 - 90 + 360) % 360 + (a2 - a1));
    lv_draw_arc(layer, &arc);
  }

  /// The card: the ink band and in it the compass points, in the page colour and turned so that
  /// the heading is at the top. The eight points from DETAIL_FROM px, else the four cardinals.
  void draw_card_(lv_event_t *e) {
    if (d_ <= 0)
      return;
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(card_, &box);
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const int32_t band = radii_.band_out - radii_.band_in;
    // The band: four quarter rings, each running a degree into the next so no seam is left (one
    // arc of 360 degrees may be taken for none).
    arc_(layer, cx, cy, radii_.band_out, band, 0, 90);
    arc_(layer, cx, cy, radii_.band_out, band, 90, 181);
    arc_(layer, cx, cy, radii_.band_out, band, 180, 271);
    arc_(layer, cx, cy, radii_.band_out, band, 270, 361);
    // The points, centred in the band, as high as most of it.
    using namespace esphelm::rose_geometry;
    const double centre = (radii_.band_out + radii_.band_in) / 2.0;
    const double h = std::max<double>(6.0, band * 0.7);
    // Two px strokes from a letter about 9 px high: a single white pixel line on the black band is
    // faint on this panel, most of all where it runs across the pixel rows.
    const int32_t w = h >= 9 ? 2 : 1;
    for (int i = 0; i < 8; i += detail_ ? 1 : 2) {
      const double rel = std::fmod(i * 45.0 - heading_deg_ + 720.0, 360.0);
      Stroke strokes[MAX_STROKES];
      const int n = esphelm::rose_geometry::label(POINTS[i], strokes);
      for (int k = 0; k < n; k++) {
        line_(layer, letter_point(strokes[k].x1, strokes[k].y1, cx, cy, centre, rel, h),
              letter_point(strokes[k].x2, strokes[k].y2, cx, cy, centre, rel, h), w, paper_);
      }
    }
  }

  /// The ticks and the two close-hauled sectors: starboard (20 to 60 degrees) in solid blocks,
  /// port (300 to 340) as outlined ones, a block of 4 degrees and a gap of 1.
  void draw_ring_(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(ring_, &box);
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const int32_t w = std::max<int32_t>(1, d_ / 280);  // a thin line; 2 px on the 400x300 display's rose
    const int step = detail_ ? 10 : 30;
    for (int deg = 0; deg < 360; deg += step) {
      if ((deg >= 20 && deg <= 60) || (deg >= 300 && deg <= 340))
        continue;  // the sectors are there
      const bool major = deg % 90 == 0;
      line_(layer, esphelm::rose_geometry::polar(cx, cy, major ? radii_.tick_in_long : radii_.tick_in, deg),
            esphelm::rose_geometry::polar(cx, cy, radii_.tick_out, deg), major ? w * 2 : w, ink_);
    }
    const int32_t thick = radii_.sector_out - radii_.sector_in;
    for (int a = 20; a < 60; a += 5)
      arc_(layer, cx, cy, radii_.sector_out, thick, a, a + 4);
    for (int a = 300; a < 340; a += 5) {
      arc_(layer, cx, cy, radii_.sector_out, w, a, a + 4);             // outer edge
      arc_(layer, cx, cy, radii_.sector_in + w, w, a, a + 4);          // inner edge
      for (int edge : {a, a + 4})                                      // the two ends
        line_(layer, esphelm::rose_geometry::polar(cx, cy, radii_.sector_in, edge),
              esphelm::rose_geometry::polar(cx, cy, radii_.sector_out, edge), w, ink_);
    }
  }

  /// A marker as the next frame draws it: shown or not, and its angle in whole degrees.
  struct MarkerState {
    bool shown{false};
    int deg{0};
    bool operator==(const MarkerState &o) const { return shown == o.shown && (!shown || deg == o.deg); }
  };

  MarkerState apparent_marker_() const {
    const bool shown = apparent_.has_number && !apparent_stale_;
    return {shown, shown ? static_cast<int>(std::lround(apparent_.number)) : 0};
  }

  /// The true wind relative to the bow: its direction minus the heading.
  MarkerState true_marker_() const {
    const bool shown = show_true_ && true_dir_.has_number && !true_stale_ && heading_.has_number && !heading_stale_;
    const double rel = shown ? std::fmod(true_dir_.number - heading_.number + 720.0, 360.0) : 0.0;
    return {shown, static_cast<int>(std::lround(rel))};
  }

  /// Mark the box around a marker (its triangle with the halo) for redrawing, if it is shown.
  void invalidate_marker_(const MarkerState &m) {
    if (!m.shown || d_ <= 0)
      return;
    lv_area_t box;
    lv_obj_get_coords(markers_, &box);
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    esphelm::rose_geometry::Point corners[3];
    esphelm::rose_geometry::marker_corners(cx, cy, d_ / 2.0, radii_.marker_tip - 2.0, radii_.marker_half + 3.0, m.deg,
                                           corners);
    double x1 = corners[0].x, x2 = x1, y1 = corners[0].y, y2 = y1;
    for (int i = 1; i < 3; i++) {
      x1 = std::min(x1, corners[i].x);
      x2 = std::max(x2, corners[i].x);
      y1 = std::min(y1, corners[i].y);
      y2 = std::max(y2, corners[i].y);
    }
    lv_area_t area{static_cast<int32_t>(std::floor(x1)) - 2, static_cast<int32_t>(std::floor(y1)) - 2,
                   static_cast<int32_t>(std::ceil(x2)) + 2, static_cast<int32_t>(std::ceil(y2)) + 2};
    lv_obj_invalidate_area(markers_, &area);
  }

  /// A triangle on the ring pointing at the centre, at `deg` clockwise from the bow: solid for
  /// the apparent wind, an outline for the true wind. In the full tier its letter, drawn as
  /// strokes, sits in the wide part and turns with the marker.
  void draw_marker_(lv_layer_t *layer, double cx, double cy, double deg, char letter, bool solid) {
    using namespace esphelm::rose_geometry;
    const double outer = d_ / 2.0 - 1;
    const double tip = radii_.marker_tip, half = radii_.marker_half;
    const int32_t w = std::max<int32_t>(2, d_ / 140);
    // A page-coloured halo a little larger than the marker, so it stands out from band and sector.
    Point halo[3], body[3];
    marker_corners(cx, cy, outer + 1, tip - 2, half + 3, deg, halo);
    triangle_(layer, halo, paper_);
    marker_corners(cx, cy, outer, tip, half, deg, body);
    if (solid) {
      triangle_(layer, body, ink_);
    } else {
      triangle_(layer, body, paper_);
      line_(layer, body[0], body[1], w, ink_);
      line_(layer, body[1], body[2], w, ink_);
      line_(layer, body[2], body[0], w, ink_);
    }
    if (!detail_)
      return;
    const double centre = tip + (outer - tip) * 0.62;
    const int32_t stroke_w = half >= 12 ? 2 : 1;  // the letter is as high as half the base is wide
    Stroke strokes[MAX_STROKES];
    const int n = esphelm::rose_geometry::letter(letter, strokes);
    for (int i = 0; i < n; i++) {
      line_(layer, letter_point(strokes[i].x1, strokes[i].y1, cx, cy, centre, deg, half),
            letter_point(strokes[i].x2, strokes[i].y2, cx, cy, centre, deg, half), stroke_w, solid ? paper_ : ink_);
    }
  }

  /// The markers: the true wind (T) first, so the apparent one (A) stays on top. A marker whose
  /// value has gone stale is left out, as grey is not there to dim it.
  void draw_markers_(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(markers_, &box);
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const MarkerState t = true_marker_(), a = apparent_marker_();
    if (t.shown)
      draw_marker_(layer, cx, cy, t.deg, 'T', false);
    if (a.shown)
      draw_marker_(layer, cx, cy, a.deg, 'A', true);
  }

  std::string id_;
  lv_color_t ink_, paper_;
  Fonts fonts_;
  lv_obj_t *area_;
  bool show_true_{true};
  Binding apparent_, true_dir_, heading_;
  bool apparent_stale_{true}, true_stale_{true}, heading_stale_{true};
  std::string heading_suffix_;
  lv_obj_t *ring_, *card_, *markers_, *center_, *heading_label_;
  std::string heading_shown_;
  int32_t heading_deg_{0};  // the card's turn, whole degrees
  MarkerState shown_a_, shown_t_;  // the markers as last marked for redrawing
  bool full_{false};    // the heading in the middle (the colour rose's full tier)
  bool detail_{false};  // ticks every 10 degrees, eight points, marker letters (DETAIL_FROM)
  int32_t d_{0};
  esphelm::rose_geometry::Radii radii_{};
  std::vector<Slot> slots_;  // the centre stack
  CornerValues corners_;
};

}  // namespace

std::unique_ptr<Widget> make_wind_rose(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  // The rose is the picture: no frame around it (the other mono tiles are frames).
  lv_obj_set_style_border_width(cell, 0, LV_PART_MAIN);
  return std::make_unique<WindRoseWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
