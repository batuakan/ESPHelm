// The colour tile set (ADR-0035): its palettes, and the factory for its tiles.
#include "widget_common.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "esphome/components/esphelm_runtime/esphelm_sizes.h"

namespace esphome {
namespace esphelm_runtime {

Colors colors_for(esphelm::Theme theme) {
  if (theme == esphelm::Theme::NIGHT) {
    // Red on black keeps night vision; zones differ in brightness, not hue.
    return Colors{lv_color_hex(0x000000), lv_color_hex(0x140404), lv_color_hex(0xE0302A), lv_color_hex(0x6A2020),
                  lv_color_hex(0xE0302A), lv_color_hex(0x9A2A22),
                  {lv_color_hex(0x6A2020), lv_color_hex(0xB0401A), lv_color_hex(0xFF3B30), lv_color_hex(0xFF6060)},
                  // port bright, starboard dim; apparent bright, true dim
                  lv_color_hex(0xFF3B30), lv_color_hex(0x7A1A12), lv_color_hex(0xE0302A), lv_color_hex(0x8A1E18),
                  lv_color_hex(0x6A2020), lv_color_hex(0x1C0606), lv_color_hex(0x9A2A22),
                  // value tile colours: hue would cost night vision, so all are the text red
                  {lv_color_hex(0xE0302A), lv_color_hex(0xE0302A), lv_color_hex(0xE0302A), lv_color_hex(0xE0302A),
                   lv_color_hex(0xE0302A), lv_color_hex(0xE0302A)}};
  }
  if (theme == esphelm::Theme::DARK) {
    // Dark (ADR-0034): the editor's own dark theme (packages/editor/src/styles.css), full colours.
    return Colors{lv_color_hex(0x0E141A), lv_color_hex(0x17202A), lv_color_hex(0xE5EBF1), lv_color_hex(0x93A1AE),
                  lv_color_hex(0x4A9EFF), lv_color_hex(0xF2C14E),
                  {lv_color_hex(0x4CC38A), lv_color_hex(0xF0B04A), lv_color_hex(0xFF6B6B), lv_color_hex(0xD34DD9)},
                  // red port, green starboard, orange A, purple T, lightened for the dark page
                  lv_color_hex(0xFF5A52), lv_color_hex(0x3DDC84), lv_color_hex(0xFF9F43), lv_color_hex(0xC77DFF),
                  lv_color_hex(0x2A3744), lv_color_hex(0x17202A), lv_color_hex(0xE5EBF1),
                  // value tile colours: light shades that read on the dark tile
                  {lv_color_hex(0x4A9EFF), lv_color_hex(0x4CC38A), lv_color_hex(0xF2C14E), lv_color_hex(0xFF9F43),
                   lv_color_hex(0xFF6B6B), lv_color_hex(0xC77DFF)}};
  }
  // Day: light, for sunlight. White page, light grey tiles, dark text.
  return Colors{lv_color_hex(0xFFFFFF), lv_color_hex(0xE6EAEE), lv_color_hex(0x111820), lv_color_hex(0x5D6B78),
                lv_color_hex(0x0A6CD6), lv_color_hex(0xB07800),
                {lv_color_hex(0x1D8A4F), lv_color_hex(0xC77700), lv_color_hex(0xD32F2F), lv_color_hex(0x9C27B0)},
                // The legacy wind page: red port, green starboard, orange A, purple T; a dark card.
                lv_color_hex(0xFF0000), lv_color_hex(0x00C800), lv_color_hex(0xFF8000), lv_color_hex(0xA020F0),
                lv_color_hex(0x555555), lv_color_hex(0x2E2E2E), lv_color_hex(0xFFFFFF),
                // value tile colours: blue, green, yellow, orange, red, purple (dark enough for the
                // light grey tile in sunlight)
                {lv_color_hex(0x0A6CD6), lv_color_hex(0x1D8A4F), lv_color_hex(0xA68A00), lv_color_hex(0xD96C00),
                 lv_color_hex(0xD32F2F), lv_color_hex(0x8E24AA)}};
}

/// Zone styles (scale section arcs) per alert state and arc width. LVGL keeps pointers to them,
/// so they are static and only recoloured when a page is built. Widgets on one page may use
/// different widths (gauges and wind roses), hence one style per (state, width).
lv_style_t *zone_style(esphelm::ZoneState state, const Colors &colors, int32_t width) {
  static constexpr int WIDTHS = 4;
  static lv_style_t styles[4][WIDTHS];
  static int32_t widths[WIDTHS] = {0};
  static bool init = false;
  if (!init) {
    for (auto &row : styles)
      for (auto &s : row)
        lv_style_init(&s);
    init = true;
  }
  int w = 0;
  while (w < WIDTHS - 1 && widths[w] != 0 && widths[w] != width)
    w++;
  widths[w] = width;  // more than WIDTHS distinct widths share the last slot
  lv_style_t *s = &styles[static_cast<int>(state)][w];
  lv_style_set_arc_color(s, colors.zone[static_cast<int>(state)]);
  lv_style_set_arc_width(s, width);
  lv_style_set_line_color(s, colors.zone[static_cast<int>(state)]);
  return s;
}

void style_cell(lv_obj_t *cell, const Colors &c) {
  lv_obj_remove_flag(cell, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(cell, c.tile, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(cell, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(cell, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(cell, 16, LV_PART_MAIN);
  lv_obj_set_style_pad_all(cell, 10, LV_PART_MAIN);
}

lv_obj_t *make_history_mark(lv_obj_t *parent, const Colors &c) {
  static const lv_point_precise_t MARK[] = {{0, 10}, {6, 4}, {12, 7}, {20, 0}};
  lv_obj_t *mark = lv_line_create(parent);
  lv_line_set_points(mark, MARK, 4);
  lv_obj_set_style_line_width(mark, 2, LV_PART_MAIN);
  lv_obj_set_style_line_rounded(mark, true, LV_PART_MAIN);
  lv_obj_set_style_line_color(mark, c.muted, LV_PART_MAIN);
  return mark;
}

// ---- factories ----

void tile_types(std::vector<const char *> &out, bool psram) {
  for (const char *t : {"value", "gauge", "bar", "switch", "position", "wind_rose", "autopilot", "graph",
                        "heading_tape", "clock", "engine"})
    out.push_back(t);
  // Chart tiles keep their map tiles in PSRAM (ADR-0030).
  if (psram)
    out.push_back("chart");
}

std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  style_cell(cell, env.colors);
  switch (tile.type) {
    case esphelm::TileType::WIND_ROSE:
      // The rose sits on the page background, as on the legacy wind page.
      lv_obj_set_style_bg_color(cell, env.colors.background, LV_PART_MAIN);
      return make_wind_rose_widget(cell, tile, env);
    case esphelm::TileType::AUTOPILOT:
      return make_autopilot_widget(cell, tile, env);
    case esphelm::TileType::GAUGE:
      return make_gauge_widget(cell, tile, env);
    case esphelm::TileType::BAR:
      return make_bar_widget(cell, tile, env);
    case esphelm::TileType::SWITCH:
      return make_switch_widget(cell, tile, env);
    case esphelm::TileType::POSITION:
      return make_position_widget(cell, tile, env);
    case esphelm::TileType::GRAPH:
      return make_graph_widget(cell, tile, env);
    case esphelm::TileType::HEADING_TAPE:
      return make_heading_tape_widget(cell, tile, env);
    case esphelm::TileType::CLOCK:
      return make_clock_widget(cell, tile, env);
    case esphelm::TileType::ENGINE:
      // Like the rose, it sits on the page background, as on the legacy engine page.
      lv_obj_set_style_bg_color(cell, env.colors.background, LV_PART_MAIN);
      return make_engine_widget(cell, tile, env);
    case esphelm::TileType::CHART:
      return make_chart_widget(cell, tile, env);
    case esphelm::TileType::VALUE:
    default:
      return make_value_widget(cell, tile, env);
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
