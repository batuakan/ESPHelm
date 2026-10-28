// The wind rose tile (ADR-0010). Shared helpers: widget_common.h.
#include "widget_common.h"

#include <algorithm>
#include <cmath>

#include "esphome/core/hal.h"
#include "esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {

// Compass card letters, one per major tick (17 ticks from 0 to 360; the last one sits on N).
static const char *CARD_POINTS[] = {"N",  "NNE", "NE", "ENE", "E",  "ESE", "SE", "SSE", "S",
                                    "SSW", "SW", "WSW", "W",  "WNW", "NW", "NNW", "", nullptr};
static const char *CARD_CARDINALS[] = {"N", "", "", "", "E", "", "", "", "S",
                                       "", "", "", "W", "", "", "", "", nullptr};

/// Arc style for the close-hauled sectors (static: LVGL keeps the pointer). One per side.
static lv_style_t *sector_style(int side, lv_color_t color, int32_t width) {
  static lv_style_t styles[2];
  static bool init = false;
  if (!init) {
    for (auto &s : styles)
      lv_style_init(&s);
    init = true;
  }
  lv_style_t *s = &styles[side];
  lv_style_set_arc_color(s, color);
  lv_style_set_arc_opa(s, LV_OPA_COVER);
  lv_style_set_arc_width(s, width);
  lv_style_set_arc_rounded(s, false);
  return s;
}

/**
 * The legacy wind page as a tile: a fixed ring relative to the bow (ticks every 5 and 30
 * degrees, wide red/green close-hauled sectors), a compass card inside it turning with the
 * heading, triangle markers for apparent (A) and true (T) wind on the ring, the heading at the
 * top and up to three big values in the middle. Everything is drawn to the tile's size.
 */
class WindRoseWidget : public Widget {
 public:
  WindRoseWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), area_(cell) {
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

    // Outer ring, fixed to the bow (0 at the top). Ticks are drawn over the sectors.
    ring_ = lv_scale_create(cell);
    lv_scale_set_mode(ring_, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_angle_range(ring_, 360);
    lv_scale_set_rotation(ring_, 270);
    lv_scale_set_range(ring_, 0, 360);
    lv_scale_set_label_show(ring_, false);
    lv_scale_set_draw_ticks_on_top(ring_, true);
    lv_obj_set_style_arc_opa(ring_, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_line_color(ring_, colors_.ring, LV_PART_ITEMS);
    lv_obj_set_style_line_color(ring_, colors_.ring, LV_PART_INDICATOR);
    sections_[0] = lv_scale_add_section(ring_);
    lv_scale_set_section_range(ring_, sections_[0], 20, 60);  // starboard
    sections_[1] = lv_scale_add_section(ring_);
    lv_scale_set_section_range(ring_, sections_[1], 300, 340);  // port

    // Compass card: a dark band with the compass points along it, turned by the heading.
    card_ = lv_scale_create(cell);
    lv_scale_set_mode(card_, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_angle_range(card_, 360);
    lv_scale_set_rotation(card_, 270);
    lv_scale_set_range(card_, 0, 360);
    lv_scale_set_total_tick_count(card_, 17);
    lv_scale_set_major_tick_every(card_, 1);
    lv_scale_set_label_show(card_, true);
    lv_scale_set_text_src(card_, CARD_POINTS);
    lv_obj_set_style_length(card_, 0, LV_PART_ITEMS);
    lv_obj_set_style_length(card_, 0, LV_PART_INDICATOR);
    lv_obj_set_style_line_width(card_, 0, LV_PART_ITEMS);
    lv_obj_set_style_line_width(card_, 0, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(card_, colors_.card, LV_PART_MAIN);
    lv_scale_set_draw_ticks_on_top(card_, true);  // letters over the band
    lv_obj_set_style_text_font(card_, env.fonts.small, LV_PART_INDICATOR);
    lv_obj_set_style_text_color(card_, colors_.card_text, LV_PART_INDICATOR);
    // Letters along the ring (a quarter turn from the tick direction), as on the legacy card.
    lv_obj_set_style_transform_rotation(card_, LV_SCALE_LABEL_ROTATE_MATCH_TICKS | 900, LV_PART_INDICATOR);

    // Markers are drawn on a transparent overlay covering the rose.
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
    heading_label_ = make_label(center_, env.fonts.small, colors_.text, "--\xC2\xB0" + heading_suffix_);
    lv_obj_set_style_pad_bottom(heading_label_, 4, LV_PART_MAIN);
    for (int i = 0; i < esphelm::RoseConfig::MAX_SLOTS; i++) {
      if (!cfg.has_slot[i])
        continue;
      const esphelm::DataItem &item = cfg.slots[i];
      Slot s;
      s.b.item = item;
      s.b.stale_ms = stale_ms(item, env);
      s.b.last_value_ms = millis();
      std::string caption = item.label;
      if (item.unit != nullptr && item.unit->label[0] != '\0')
        caption += caption.empty() ? item.unit->label : std::string(" ") + item.unit->label;
      if (i < esphelm::RoseConfig::CENTER_SLOTS) {
        s.value = make_label(center_, env.fonts.value, colors_.muted, "--");
        s.caption = make_label(center_, env.fonts.small, colors_.text, caption);
        slots_.push_back(std::move(s));
        continue;
      }
      // Corner: a value over its caption, pushed into the tile's corner.
      s.corner = i - esphelm::RoseConfig::CENTER_SLOTS;  // 0 TL, 1 TR, 2 BL, 3 BR
      s.box = lv_obj_create(cell);
      lv_obj_remove_style_all(s.box);
      lv_obj_remove_flag(s.box, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_set_size(s.box, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
      lv_obj_set_flex_flow(s.box, LV_FLEX_FLOW_COLUMN);
      const bool right = s.corner % 2 == 1;
      lv_obj_set_flex_align(s.box, LV_FLEX_ALIGN_START, right ? LV_FLEX_ALIGN_END : LV_FLEX_ALIGN_START,
                            LV_FLEX_ALIGN_START);
      s.value = make_label(s.box, env.fonts.label, colors_.muted, "--");
      s.caption = make_label(s.box, env.fonts.small, colors_.text, caption);
      corners_.push_back(std::move(s));
    }
  }

  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {
    out.push_back(apparent_.item.path);
    out.push_back(heading_.item.path);
    if (show_true_)
      out.push_back(true_dir_.item.path);
    for (const auto &s : slots_)
      out.push_back(s.b.item.path);
    for (const auto &s : corners_)
      out.push_back(s.b.item.path);
  }

  void layout_done() override {
    const int32_t d = std::min(lv_obj_get_content_width(area_), lv_obj_get_content_height(area_));
    layout_corners_(d);
    // Size tiers (esphelm_sizes.h, shared with the editor's size hint).
    full_ = d >= esphelm::sizes::WIND_ROSE_FULL;
    const bool compact = !full_ && d >= esphelm::sizes::WIND_ROSE_COMPACT;
    const int32_t ring_w = std::max<int32_t>(6, d / (full_ ? 15 : 13));  // legacy: size / 15

    lv_obj_set_size(ring_, d, d);
    lv_obj_center(ring_);
    lv_scale_set_total_tick_count(ring_, full_ ? 73 : 13);  // every 5 degrees, or every 30
    lv_scale_set_major_tick_every(ring_, full_ ? 6 : 1);
    lv_obj_set_style_length(ring_, ring_w, LV_PART_INDICATOR);
    lv_obj_set_style_length(ring_, ring_w * 3 / 4, LV_PART_ITEMS);
    lv_obj_set_style_line_width(ring_, std::max<int32_t>(2, d / 90), LV_PART_INDICATOR);
    lv_obj_set_style_line_width(ring_, std::max<int32_t>(1, d / 360), LV_PART_ITEMS);
    lv_scale_set_section_style_main(ring_, sections_[0], sector_style(0, colors_.starboard, ring_w));
    lv_scale_set_section_style_main(ring_, sections_[1], sector_style(1, colors_.port, ring_w));

    // The card sits inside the ring with a small gap; its letters are centred in the band.
    const int32_t gap = std::max<int32_t>(2, d / 60);
    const int32_t card_d = d - 2 * (ring_w + gap);
    const int32_t band = std::max<int32_t>(4, ring_w * 9 / 10);
    lv_obj_set_size(card_, card_d, card_d);
    lv_obj_center(card_);
    lv_obj_set_style_arc_width(card_, band, LV_PART_MAIN);
    lv_scale_set_text_src(card_, full_ ? CARD_POINTS : CARD_CARDINALS);
    const int32_t text_h = lv_font_get_line_height(fonts_.small);
    // Label centres sit at edge - (15 + pad_radial): put them in the middle of the band.
    lv_obj_set_style_pad_radial(card_, band / 2 - 15, LV_PART_INDICATOR);
    lv_scale_set_label_show(card_, full_ || compact);
    if (!(full_ || compact))
      lv_obj_add_flag(card_, LV_OBJ_FLAG_HIDDEN);

    lv_obj_set_size(markers_, d, d);
    lv_obj_center(markers_);
    marker_ = std::max<int32_t>(8, ring_w * 6 / 5);
    ring_r_ = d / 2;

    // The values go inside the card band; the font steps down until every slot fits.
    const int32_t inner = card_d / 2 - band;
    // The stack is narrow, so it can use most of the disc's height (as the legacy page does).
    const int32_t room_h = inner * 19 / 10;
    const int32_t room_w = inner * 3 / 2;
    const int32_t small_h = text_h;
    const int32_t head_h = full_ ? small_h + 4 : 0;
    const lv_font_t *fonts[] = {fonts_.value, fonts_.label, fonts_.small};
    const lv_font_t *font = fonts_.small;
    size_t fit = 0;
    // Values are digits only, so their lines are tightened by a quarter (negative margins).
    const auto tight = [](int32_t fh) { return fh * 3 / 4; };
    for (const lv_font_t *f : fonts) {
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
    for (auto *list : {&slots_, &corners_}) {
      for (auto &s : *list) {
        if (path == s.b.item.path)
          s.b.set(v, now);
      }
    }
  }

  void tick(uint32_t now) override {
    bool stale;
    bool markers = false;
    if (apparent_.due(now, stale)) {
      markers = true;
      apparent_stale_ = stale;
    }
    if (true_dir_.due(now, stale)) {
      markers = true;
      true_stale_ = stale;
    }
    if (heading_.due(now, stale)) {
      markers = true;
      heading_stale_ = stale;
      const bool known = !stale && heading_.has_number;
      set_text(heading_label_, heading_shown_, (known ? heading_.text : "--") + "\xC2\xB0" + heading_suffix_);
      // The card turns so that the boat's heading is at the top.
      if (known) {
        const int32_t h = static_cast<int32_t>(std::lround(heading_.number)) % 360;
        lv_scale_set_rotation(card_, (270 - h + 360) % 360);
      }
    }
    if (markers)
      lv_obj_invalidate(markers_);
    for (auto *list : {&slots_, &corners_}) {
      for (auto &s : *list) {
        if (!s.b.due(now, stale))
          continue;
        set_text(s.value, s.shown, stale ? "--" : s.b.text);
        lv_obj_set_style_text_color(s.value, stale ? colors_.muted : colors_.text, LV_PART_MAIN);
      }
    }
  }

 protected:
  struct Slot {
    Binding b;
    lv_obj_t *value{nullptr};
    lv_obj_t *caption{nullptr};
    std::string shown{"--"};
    int corner{-1};          // corner slots: 0 top left, 1 top right, 2 bottom left, 3 bottom right
    lv_obj_t *box{nullptr};  // corner slots: the value and caption container
  };

  /// Corner values sit outside the ring, in the tile's corners. Each shows only in the full tier
  /// and when its box (value in the label or small font, over its caption) clears the ring.
  void layout_corners_(int32_t d) {
    if (corners_.empty())
      return;
    const int32_t w = lv_obj_get_content_width(area_), h = lv_obj_get_content_height(area_);
    const double r = d / 2.0 + 2;
    const bool full = d >= esphelm::sizes::WIND_ROSE_FULL;
    const int32_t small_h = lv_font_get_line_height(fonts_.small);
    for (auto &s : corners_) {
      lv_obj_update_layout(s.caption);
      const int32_t caption_w = lv_obj_get_width(s.caption);
      bool shown = false;
      for (const lv_font_t *f : {fonts_.label, fonts_.small}) {
        const int32_t fh = lv_font_get_line_height(f);
        const int32_t bw = std::max<int32_t>(fh * 12 / 5, caption_w);  // "12.5" or the caption
        const int32_t bh = fh + small_h;
        // The box's inner corner, relative to the rose's centre, must be outside the ring.
        const double x = w / 2.0 - bw, y = h / 2.0 - bh;
        if (full && x >= 0 && y >= 0 && std::hypot(x, y) >= r) {
          lv_obj_set_style_text_font(s.value, f, LV_PART_MAIN);
          shown = true;
          break;
        }
      }
      if (!shown) {
        lv_obj_add_flag(s.box, LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      lv_obj_remove_flag(s.box, LV_OBJ_FLAG_HIDDEN);
      static const lv_align_t ALIGN[] = {LV_ALIGN_TOP_LEFT, LV_ALIGN_TOP_RIGHT, LV_ALIGN_BOTTOM_LEFT,
                                         LV_ALIGN_BOTTOM_RIGHT};
      lv_obj_align(s.box, ALIGN[s.corner], 0, 0);
      const lv_text_align_t ta = s.corner % 2 == 1 ? LV_TEXT_ALIGN_RIGHT : LV_TEXT_ALIGN_LEFT;
      lv_obj_set_style_text_align(s.value, ta, LV_PART_MAIN);
      lv_obj_set_style_text_align(s.caption, ta, LV_PART_MAIN);
    }
  }

  /// A triangle on the ring pointing at the centre, at `deg` clockwise from the bow, with a letter.
  void draw_marker_(lv_layer_t *layer, const lv_area_t &box, double deg, lv_color_t color, const char *letter) {
    const double a = deg * M_PI / 180.0;
    const double ux = std::sin(a), uy = -std::cos(a);  // outwards
    const double px = -uy, py = ux;                    // along the ring
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const double outer = ring_r_ - 1, tip = outer - marker_ * 1.3, half = marker_ * 0.62;
    lv_draw_triangle_dsc_t tri;
    lv_draw_triangle_dsc_init(&tri);
    tri.color = color;
    tri.opa = LV_OPA_COVER;
    tri.p[0] = {static_cast<lv_value_precise_t>(cx + ux * outer + px * half),
                static_cast<lv_value_precise_t>(cy + uy * outer + py * half)};
    tri.p[1] = {static_cast<lv_value_precise_t>(cx + ux * outer - px * half),
                static_cast<lv_value_precise_t>(cy + uy * outer - py * half)};
    tri.p[2] = {static_cast<lv_value_precise_t>(cx + ux * tip), static_cast<lv_value_precise_t>(cy + uy * tip)};
    lv_draw_triangle(layer, &tri);
    if (!full_)
      return;
    // The letter sits in the wide part of the triangle.
    const double lr = outer - marker_ * 0.5;
    const int32_t lx = static_cast<int32_t>(cx + ux * lr), ly = static_cast<int32_t>(cy + uy * lr);
    const int32_t fh = lv_font_get_line_height(fonts_.small);
    lv_draw_label_dsc_t label;
    lv_draw_label_dsc_init(&label);
    label.text = letter;
    label.font = fonts_.small;
    label.color = colors_.background;
    label.align = LV_TEXT_ALIGN_CENTER;
    lv_area_t area{lx - fh, ly - fh / 2, lx + fh, ly + fh / 2};
    lv_draw_label(layer, &label, &area);
  }

  void draw_markers_(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(markers_, &box);
    if (show_true_ && true_dir_.has_number && heading_.has_number) {
      // True wind relative to the bow: direction minus heading.
      const double rel = std::fmod(true_dir_.number - heading_.number + 720.0, 360.0);
      draw_marker_(layer, box, rel, true_stale_ || heading_stale_ ? colors_.muted : colors_.true_wind, "T");
    }
    if (apparent_.has_number)
      draw_marker_(layer, box, apparent_.number, apparent_stale_ ? colors_.muted : colors_.apparent, "A");
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *area_;
  bool show_true_{true};
  Binding apparent_, true_dir_, heading_;
  bool apparent_stale_{true}, true_stale_{true}, heading_stale_{true};
  std::string heading_suffix_;
  lv_obj_t *ring_, *card_, *markers_, *center_, *heading_label_;
  lv_scale_section_t *sections_[2]{};
  std::string heading_shown_;
  bool full_{false};
  int32_t marker_{12}, ring_r_{0};
  std::vector<Slot> slots_;    // the centre stack
  std::vector<Slot> corners_;  // corner values
};

std::unique_ptr<Widget> make_wind_rose_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<WindRoseWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
