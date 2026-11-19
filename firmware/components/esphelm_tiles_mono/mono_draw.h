#pragma once
// Drawing helpers of the mono tiles that draw in an LV_EVENT_DRAW_MAIN callback (mono_engine.cpp,
// mono_gauge.cpp, mono_heading_tape.cpp; ADR-0040, ADR-0042). Everything is in one colour, the
// ink, with full opacity: the flush thresholds every pixel anyway (esphelm_mono.h), so nothing here
// relies on blending. Angles are LVGL's: degrees clockwise from 3 o'clock.

#include <cstdint>

#include "esphome/components/esphelm_runtime/widget_base.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {
namespace draw {

/// The point at radius `r` and angle `deg` around (cx, cy).
lv_point_precise_t at(double cx, double cy, double r, double deg);

/// A line with flat ends (a round cap would poke past a track).
void line(lv_layer_t *layer, lv_color_t ink, lv_point_precise_t p1, lv_point_precise_t p2, int32_t width);

/// A filled rectangle, corners included.
void rect(lv_layer_t *layer, lv_color_t ink, int32_t x1, int32_t y1, int32_t x2, int32_t y2);

/// An arc of radius `r` (its outer edge) and `width` between two angles in either order.
void arc(lv_layer_t *layer, lv_color_t ink, double cx, double cy, double r, double width, double a1, double a2);

/// A zone as a band along an arc: a thin line for normal, dashes for warn and a solid heavy band for
/// alarm and emergency. `radius` is the band's outer edge, `width` the width the colour tile gives
/// it; the heavy styles are a little wider.
void zone_band(lv_layer_t *layer, lv_color_t ink, double cx, double cy, double radius, double width, double a1,
               double a2, esphelm::ZoneState state);

/// A wedge pointing outward along `deg`, from radius `base` to `tip`, `half` wide each side.
void wedge(lv_layer_t *layer, lv_color_t ink, double cx, double cy, double deg, double base, double tip,
           double half);

/// A filled triangle.
void triangle(lv_layer_t *layer, lv_color_t ink, float x0, float y0, float x1, float y1, float x2, float y2);

/// `text` in `font`, centred on (x, y).
void text(lv_layer_t *layer, lv_color_t ink, const char *text, const lv_font_t *font, int32_t x, int32_t y);

/// Alarm or emergency: the states a mono tile shows inverted, or as a solid band.
inline bool is_alarm(esphelm::ZoneState s) {
  return s == esphelm::ZoneState::ALARM || s == esphelm::ZoneState::EMERGENCY;
}

}  // namespace draw
}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
