// The mono engine tile (ADR-0040): a large RPM arc with three small gauges inside it, drawn in one
// LV_EVENT_DRAW_MAIN callback from the shared geometry (esphelm_engine.h, esphelm_engine_shapes.h,
// mirrored by packages/schema/src/engine.ts and the editor's preview). Shared helpers:
// mono_common.h. The values, their units, zones, the redraw throttle and the stale tracking work as
// in the colour engine tile (ADR-0032); what differs is the drawing, in the ink only: a zone is a
// thin line (normal), a dashed band (warn) or a solid heavy band (alarm and emergency), the needles
// are black wedges, and a stale gauge loses its needle, as grey is not there to dim it.
#include "mono_common.h"
#include "mono_corner_values.h"
#include "mono_draw.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "esphome/components/esphelm_runtime/esphelm_engine.h"
#include "esphome/components/esphelm_runtime/esphelm_icon_raster.h"
#include "esphome/core/hal.h"
#include "src/misc/cache/instance/lv_image_cache.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

namespace {

namespace es = esphelm::engine_shapes;
using esphelm::engine::Gauge;

// The small gauges from this drawing size (px) on. The colour tile waits for 260 px (ENGINE_SLOTS),
// but on a 400x300 display the tile beside the page footer is only about 215 px.
constexpr int32_t SLOTS_FROM = 180;
// An icon is at least this many px a side: at the colour tile's 17 % of the radius it would be
// about 18 px on that display, too small to tell a pump from a can at 1 bit.
constexpr int32_t ICON_MIN_PX = 24;
/// How far (fraction of R) the left and right slots' icons move towards the centre.
constexpr float SIDE_ICON_INSET = 0.03f;

class EngineWidget : public Widget {
 public:
  EngineWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), ink_(env.colors.text), fonts_(env.fonts), cell_(cell), engine_(tile.engine) {
    gauges_[0] = {tile.data, tile.min, tile.max, tile.zones, esphelm::EngineIcon::NONE, Gauge::RPM, true};
    for (int i = 0; engine_ && i < esphelm::EngineConfig::SLOTS; i++) {
      const esphelm::EngineSlot &s = engine_->slots[i];
      gauges_[i + 1] = {s.data, s.min, s.max, s.zones, s.icon, static_cast<Gauge>(i + 1), engine_->has_slot[i]};
    }
    const uint32_t now = millis();
    for (auto &g : gauges_) {
      if (!g.on)
        continue;
      g.b.item = g.item;
      g.b.stale_ms = stale_ms(g.item, env);
      g.b.last_value_ms = now;
    }
    // "RPM" (the label, else the unit) in the centre; the multiplier below it when the labels are
    // divided by 100.
    title_ = !tile.data.label.empty() ? tile.data.label
             : tile.data.unit != nullptr ? std::string(tile.data.unit->label)
                                         : std::string();
    canvas_ = lv_obj_create(cell);
    lv_obj_remove_style_all(canvas_);
    lv_obj_remove_flag(canvas_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(canvas_, LV_PCT(100), LV_PCT(100));
    lv_obj_add_event_cb(
        canvas_, [](lv_event_t *e) { static_cast<EngineWidget *>(lv_event_get_user_data(e))->draw_(e); },
        LV_EVENT_DRAW_MAIN, this);
    // Corner values over the drawing, outside the RPM arc, as on a wind rose.
    for (int i = 0; engine_ && i < esphelm::EngineConfig::CORNERS; i++) {
      if (engine_->has_corner[i])
        corners_.add(cell, i, engine_->corners[i], env);
    }
  }
  ~EngineWidget() override {
    for (auto &g : gauges_)
      drop_mask_(g);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {
    for (const auto &g : gauges_) {
      if (g.on)
        out.push_back(g.item.path);
    }
    corners_.paths(out);
  }
  void layout_done() override {
    lv_obj_update_layout(canvas_);
    const int32_t w = lv_obj_get_width(canvas_), h = lv_obj_get_height(canvas_);
    const int32_t d = std::max<int32_t>(16, std::min(w, h));
    r_ = d / 2.0;
    // Runs again when the page is laid out anew (alarm banner), so every choice is made afresh.
    slots_ = d >= SLOTS_FROM;
    labels_ = d >= esphelm::sizes::ENGINE_LABELS;
    esphelm::engine::scale(gauges_[0].min, gauges_[0].max, r_, scale_);
    // The tick numbers and the unit: the largest font up to a fifth of the radius, which is the
    // smallest font on the 400x300 display (the colour tile asks for 14 % and would find none).
    label_font_ = font_up_to(r_ * 0.2);
    slot_font_ = font_up_to(r_ * 0.18);
    labels_ = labels_ && label_font_ != nullptr;
    // Corner values only with the slots, and each only where it clears the RPM arc (or, at the
    // bottom, below the arc's ends, the bottom gauge).
    corners_.layout(w, h, r_ + 2, slots_, r_ * es::CORNERS_OPEN_BELOW, r_ * es::CORNERS_BOTTOM_RADIUS + 2);
    // Each icon filled once at the size it is shown (side^2 bytes, A8); drawn in the ink.
    for (int i = 1; i < 4; i++) {
      GaugeState &g = gauges_[i];
      const int side = slots_ && g.on && g.icon != esphelm::EngineIcon::NONE
                           ? std::max<int>(ICON_MIN_PX, static_cast<int>(std::lround(r_ * box_(g.gauge).size)))
                           : 0;
      if (side == g.mask_side)
        continue;
      drop_mask_(g);
      if (side <= 0)
        continue;
      esphelm::icon::rasterize(es::ICONS[static_cast<int>(g.icon)], side, g.mask);
      g.mask_side = side;
      g.dsc.header.magic = LV_IMAGE_HEADER_MAGIC;
      g.dsc.header.cf = LV_COLOR_FORMAT_A8;
      g.dsc.header.w = side;
      g.dsc.header.h = side;
      g.dsc.header.stride = side;
      g.dsc.data_size = g.mask.size();
      g.dsc.data = g.mask.data();
    }
    lv_obj_invalidate(canvas_);
  }
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    for (auto &g : gauges_) {
      if (g.on && path == g.item.path)
        g.b.set(v, now);
    }
    corners_.on_value(path, v, now);
  }
  void tick(uint32_t now) override {
    bool redraw = false;
    for (auto &g : gauges_) {
      bool stale;
      if (g.on && g.b.due(now, stale)) {
        g.stale = stale;
        redraw = true;
      }
    }
    if (redraw)
      lv_obj_invalidate(canvas_);
    corners_.tick(now);
  }

 private:
  struct GaugeState {
    esphelm::DataItem item;
    double min{0}, max{0};
    std::vector<esphelm::Zone> zones;
    esphelm::EngineIcon icon{esphelm::EngineIcon::NONE};
    Gauge gauge{Gauge::RPM};
    bool on{false};
    Binding b;
    bool stale{true};
    /// The icon filled at mask_side pixels (A8), and its image for lv_draw_image.
    std::vector<uint8_t> mask;
    int mask_side{0};
    lv_image_dsc_t dsc{};
  };

  struct Box {
    float x, y, size;
  };
  /// A slot's icon (or label) box: centre and side as fractions of R.
  static Box box_(Gauge gauge) {
    // The side icons (the fuel pump with its hose reaching right, the oil can with its spout
    // reaching left) sit a little nearer the centre than the colour tile's, so the needle's base at
    // 0.34 R doesn't touch them in the middle of the scale.
    if (gauge == Gauge::RIGHT)
      return {es::ICONS_RIGHT_X - SIDE_ICON_INSET, es::ICONS_RIGHT_Y, es::ICONS_RIGHT_SIZE};
    if (gauge == Gauge::BOTTOM)
      return {es::ICONS_BOTTOM_X, es::ICONS_BOTTOM_Y, es::ICONS_BOTTOM_SIZE};
    return {es::ICONS_LEFT_X + SIDE_ICON_INSET, es::ICONS_LEFT_Y, es::ICONS_LEFT_SIZE};
  }

  static void drop_mask_(GaugeState &g) {
    if (g.mask_side == 0)
      return;
    lv_image_cache_drop(&g.dsc);
    g.mask.clear();
    g.mask.shrink_to_fit();
    g.mask_side = 0;
    g.dsc = lv_image_dsc_t{};
  }

  /// The largest full font whose line height is at most `px`; null when none fits (no text), as
  /// engineFont() in engine.ts.
  const lv_font_t *font_up_to(double px) const {
    const lv_font_t *best = nullptr;
    for (uint8_t i = 0; i < fonts_.count; i++) {
      if (!fonts_.digits[i] && lv_font_get_line_height(fonts_.ladder[i]) <= px)
        best = fonts_.ladder[i];
    }
    return best;
  }

  /// Whether `v` lies in an alarm zone of the gauge: its ticks are then drawn heavier.
  bool in_alarm_(const GaugeState &g, double v) const {
    for (const auto &z : g.zones) {
      if (v >= z.from && v <= z.to && draw::is_alarm(z.state))
        return true;
    }
    return false;
  }

  void draw_rpm_(lv_layer_t *layer, double cx, double cy) {
    const GaugeState &g = gauges_[0];
    const double R = r_;
    for (const auto &z : g.zones) {
      draw::zone_band(layer, ink_, cx, cy, R * es::RPM_BAND_RADIUS, R * es::RPM_BAND_WIDTH,
            esphelm::engine::angle(Gauge::RPM, z.from, g.min, g.max),
            esphelm::engine::angle(Gauge::RPM, z.to, g.min, g.max), z.state);
    }
    char buf[16];
    for (size_t i = 0; i < scale_.count; i++) {
      const auto &t = scale_.ticks[i];
      const double a = esphelm::engine::angle(Gauge::RPM, t.value, g.min, g.max);
      double len = es::RPM_MINOR_LENGTH, w = es::RPM_MINOR_WIDTH;
      if (t.kind == esphelm::engine::Kind::MAJOR) {
        len = es::RPM_MAJOR_LENGTH;
        w = es::RPM_MAJOR_WIDTH;
      } else if (t.kind == esphelm::engine::Kind::MEDIUM) {
        len = es::RPM_MEDIUM_LENGTH;
        w = es::RPM_MEDIUM_WIDTH;
      }
      // A tick in an alarm zone is a pixel heavier.
      draw::line(layer, ink_, draw::at(cx, cy, R * es::RPM_TICK_OUTER, a), draw::at(cx, cy, R * (es::RPM_TICK_OUTER - len), a),
            static_cast<int32_t>(std::lround(R * w)) + (in_alarm_(g, t.value) ? 1 : 0));
      if (labels_ && t.kind == esphelm::engine::Kind::MAJOR) {
        const lv_point_precise_t p = draw::at(cx, cy, R * es::RPM_LABEL_RADIUS, a);
        draw::text(layer, ink_, esphelm::engine::tick_label(t.value / scale_.divisor, buf), label_font_,
              static_cast<int32_t>(p.x), static_cast<int32_t>(p.y));
      }
    }
    if (labels_) {
      const int32_t fh = lv_font_get_line_height(label_font_);
      const int32_t y = static_cast<int32_t>(cy + R * es::RPM_UNIT_Y);
      if (!title_.empty())
        draw::text(layer, ink_, title_.c_str(), label_font_, static_cast<int32_t>(cx), y);
      if (scale_.divisor == 100)
        draw::text(layer, ink_, "x100", label_font_, static_cast<int32_t>(cx), y + fh);
    }
    if (g.b.has_number && !g.stale) {
      draw::wedge(layer, ink_, cx, cy, esphelm::engine::angle(Gauge::RPM, g.b.number, g.min, g.max), R * es::RPM_NEEDLE_BASE,
             R * es::RPM_NEEDLE_TIP, R * es::RPM_NEEDLE_HALF_WIDTH);
    }
  }

  void draw_slot_(lv_layer_t *layer, const GaugeState &g, double cx, double cy) {
    const double R = r_;
    const bool bottom = g.gauge == Gauge::BOTTOM;
    const double radius = R * (bottom ? es::BOTTOM_RADIUS : es::SIDE_RADIUS);
    const double track = R * (bottom ? es::BOTTOM_TRACK_WIDTH : es::SIDE_TRACK_WIDTH);
    const double band = R * (bottom ? es::BOTTOM_BAND_WIDTH : es::SIDE_BAND_WIDTH);
    const double tick = R * (bottom ? es::BOTTOM_TICK_LENGTH : es::SIDE_TICK_LENGTH);
    const double tick_w = R * (bottom ? es::BOTTOM_TICK_WIDTH : es::SIDE_TICK_WIDTH);
    const double a_min = esphelm::engine::angle(g.gauge, g.min, g.min, g.max);
    const double a_max = esphelm::engine::angle(g.gauge, g.max, g.min, g.max);
    // Only the warn and alarm zones are bands; a normal stretch is the track alone.
    for (const auto &z : g.zones) {
      if (z.state == esphelm::ZoneState::NORMAL)
        continue;
      draw::zone_band(layer, ink_, cx, cy, radius + 1, band, esphelm::engine::angle(g.gauge, z.from, g.min, g.max),
            esphelm::engine::angle(g.gauge, z.to, g.min, g.max), z.state);
    }
    draw::arc(layer, ink_, cx, cy, radius, track, a_min, a_max);
    for (int i = 0; i < es::SLOT_TICKS; i++) {
      const double a = a_min + (a_max - a_min) * i / (es::SLOT_TICKS - 1);
      // From the track's inner edge inward, so no tick crosses the arc.
      draw::line(layer, ink_, draw::at(cx, cy, radius - track, a), draw::at(cx, cy, radius - track - tick, a),
            static_cast<int32_t>(std::lround(tick_w)));
    }
    // The icon, else the label, in the slot's box.
    const Box bx = box_(g.gauge);
    if (g.icon != esphelm::EngineIcon::NONE) {
      if (g.mask_side > 0) {
        lv_draw_image_dsc_t img;
        lv_draw_image_dsc_init(&img);
        img.src = &g.dsc;
        img.recolor = ink_;  // an A8 image is drawn in this colour
        img.recolor_opa = LV_OPA_COVER;
        const int32_t x0 = static_cast<int32_t>(std::lround(cx + R * bx.x - g.mask_side / 2.0));
        const int32_t y0 = static_cast<int32_t>(std::lround(cy + R * bx.y - g.mask_side / 2.0));
        lv_area_t a{x0, y0, x0 + g.mask_side - 1, y0 + g.mask_side - 1};
        lv_draw_image(layer, &img, &a);
      }
    } else if (!g.item.label.empty() && slot_font_ != nullptr) {
      draw::text(layer, ink_, g.item.label.c_str(), slot_font_, static_cast<int32_t>(cx + R * bx.x),
            static_cast<int32_t>(cy + R * bx.y));
    }
    if (g.b.has_number && !g.stale) {
      draw::wedge(layer, ink_, cx, cy, esphelm::engine::angle(g.gauge, g.b.number, g.min, g.max),
             R * (bottom ? es::BOTTOM_NEEDLE_BASE : es::SIDE_NEEDLE_BASE),
             R * (bottom ? es::BOTTOM_NEEDLE_TIP : es::SIDE_NEEDLE_TIP),
             R * (bottom ? es::BOTTOM_NEEDLE_HALF_WIDTH : es::SIDE_NEEDLE_HALF_WIDTH));
    }
  }

  void draw_(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(canvas_, &box);
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    if (slots_) {
      for (int i = 1; i < 4; i++) {
        if (gauges_[i].on)
          draw_slot_(layer, gauges_[i], cx, cy);
      }
    }
    draw_rpm_(layer, cx, cy);  // last: its needle crosses the labels
  }

  std::string id_;
  lv_color_t ink_;
  Fonts fonts_;
  lv_obj_t *cell_;
  std::shared_ptr<const esphelm::EngineConfig> engine_;
  GaugeState gauges_[4];  // the RPM, then left, right, bottom
  std::string title_;
  lv_obj_t *canvas_;
  double r_{8};
  bool slots_{false}, labels_{false};
  const lv_font_t *label_font_{nullptr};
  const lv_font_t *slot_font_{nullptr};
  esphelm::engine::Scale scale_;
  CornerValues corners_;
};

}  // namespace

std::unique_ptr<Widget> make_engine(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  // The gauges are the picture: no frame around the tile (the other mono tiles are frames).
  lv_obj_set_style_border_width(cell, 0, LV_PART_MAIN);
  return std::make_unique<EngineWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
