// Drawing helpers of the mono tiles (mono_draw.h).
#include "mono_draw.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <utility>

namespace esphome {
namespace esphelm_runtime {
namespace mono {
namespace draw {

lv_point_precise_t at(double cx, double cy, double r, double deg) {
  const double a = deg * M_PI / 180.0;
  return {static_cast<lv_value_precise_t>(cx + r * std::cos(a)), static_cast<lv_value_precise_t>(cy + r * std::sin(a))};
}

void line(lv_layer_t *layer, lv_color_t ink, lv_point_precise_t p1, lv_point_precise_t p2, int32_t width) {
  lv_draw_line_dsc_t d;
  lv_draw_line_dsc_init(&d);
  d.color = ink;
  d.opa = LV_OPA_COVER;
  d.width = std::max<int32_t>(1, width);
  d.p1 = p1;
  d.p2 = p2;
  lv_draw_line(layer, &d);
}

void rect(lv_layer_t *layer, lv_color_t ink, int32_t x1, int32_t y1, int32_t x2, int32_t y2) {
  lv_draw_rect_dsc_t d;
  lv_draw_rect_dsc_init(&d);
  d.bg_color = ink;
  d.bg_opa = LV_OPA_COVER;
  lv_area_t a{x1, y1, x2, y2};
  lv_draw_rect(layer, &d, &a);
}

void arc(lv_layer_t *layer, lv_color_t ink, double cx, double cy, double r, double width, double a1, double a2) {
  if (a2 < a1)
    std::swap(a1, a2);
  if (a2 - a1 < 0.5)
    return;
  lv_draw_arc_dsc_t d;
  lv_draw_arc_dsc_init(&d);
  d.color = ink;
  d.opa = LV_OPA_COVER;
  d.center = {static_cast<int32_t>(std::lround(cx)), static_cast<int32_t>(std::lround(cy))};
  d.radius = static_cast<uint16_t>(std::max(1.0, r));
  d.width = static_cast<int32_t>(std::max(1.0, width));
  d.start_angle = static_cast<lv_value_precise_t>(std::fmod(a1 + 360.0, 360.0));
  d.end_angle = static_cast<lv_value_precise_t>(std::fmod(a2 + 360.0, 360.0));
  lv_draw_arc(layer, &d);
}

void zone_band(lv_layer_t *layer, lv_color_t ink, double cx, double cy, double radius, double width, double a1,
               double a2, esphelm::ZoneState state) {
  if (a2 < a1)
    std::swap(a1, a2);
  if (is_alarm(state)) {
    arc(layer, ink, cx, cy, radius, std::max(3.0, std::round(width * 1.5)), a1, a2);
  } else if (state == esphelm::ZoneState::WARN) {
    // Dashes of 3.5 degrees with a gap of 2.5: more of a dash than a dot, on a small arc too.
    const double w = std::max(2.0, std::round(width * 1.25));
    for (double a = a1; a < a2; a += 6.0)
      arc(layer, ink, cx, cy, radius, w, a, std::min(a + 3.5, a2));
  } else {
    arc(layer, ink, cx, cy, radius, 1.0, a1, a2);
  }
}

void wedge(lv_layer_t *layer, lv_color_t ink, double cx, double cy, double deg, double base, double tip,
           double half) {
  const double a = deg * M_PI / 180.0;
  const double ux = std::cos(a), uy = std::sin(a), px = -uy, py = ux;
  lv_draw_triangle_dsc_t tri;
  lv_draw_triangle_dsc_init(&tri);
  tri.color = ink;
  tri.opa = LV_OPA_COVER;
  tri.p[0] = {static_cast<lv_value_precise_t>(cx + ux * base + px * half),
              static_cast<lv_value_precise_t>(cy + uy * base + py * half)};
  tri.p[1] = {static_cast<lv_value_precise_t>(cx + ux * base - px * half),
              static_cast<lv_value_precise_t>(cy + uy * base - py * half)};
  tri.p[2] = {static_cast<lv_value_precise_t>(cx + ux * tip), static_cast<lv_value_precise_t>(cy + uy * tip)};
  lv_draw_triangle(layer, &tri);
}

void triangle(lv_layer_t *layer, lv_color_t ink, float x0, float y0, float x1, float y1, float x2, float y2) {
  lv_draw_triangle_dsc_t t;
  lv_draw_triangle_dsc_init(&t);
  t.color = ink;
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

void text(lv_layer_t *layer, lv_color_t ink, const char *text, const lv_font_t *font, int32_t x, int32_t y) {
  const int32_t fh = lv_font_get_line_height(font);
  // Centred in a box wide enough for the text (glyphs are narrower than the line height).
  const int32_t w = static_cast<int32_t>(std::strlen(text)) * fh;
  lv_draw_label_dsc_t label;
  lv_draw_label_dsc_init(&label);
  label.text = text;
  label.text_local = 1;  // copied: the caller's buffer may be on its stack
  label.font = font;
  label.color = ink;
  label.align = LV_TEXT_ALIGN_CENTER;
  lv_area_t area{x - w / 2 - 2, y - fh / 2, x + w / 2 + 2, y + fh / 2};
  lv_draw_label(layer, &label, &area);
}

}  // namespace draw
}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
