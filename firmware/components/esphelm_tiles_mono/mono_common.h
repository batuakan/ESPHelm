#pragma once
// Helpers shared by the mono tile renderers (tiles_mono.cpp, mono_*.cpp), ADR-0035. Two colours:
// the ink (colors.text) and the page (colors.background). A tile is a frame on the page; its labels
// take their colour from the cell, so inverting a tile is two style changes. Zones show as a style:
// warn as a heavy frame, alarm and emergency as an inverted tile.

#include <memory>
#include <string>

#include "esphome/components/esphelm_runtime/widget_base.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

static const int32_t FRAME = 2;        // a tile's frame, px
static const int32_t FRAME_WARN = 6;   // the frame of a tile in a warn zone
static const int32_t RADIUS = 8;
static const int32_t PAD = 8;

/// A label in `font` that takes its colour from its parent (the cell).
lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font, const std::string &text);

/// A tile's frame and its zone style.
class Frame {
 public:
  Frame(lv_obj_t *cell, const Colors &c) : cell_(cell), c_(c) {}
  /// Show the zone state of a live value (`zoned` false: no zone matches, or no live value).
  /// True when the ink changed (an inverted tile), for parts that set their colour themselves.
  bool show(bool zoned, esphelm::ZoneState state);
  /// The colour of text and marks in the tile now.
  lv_color_t ink() const { return inverted_ ? c_.background : c_.text; }
  /// The colour behind them.
  lv_color_t paper() const { return inverted_ ? c_.text : c_.background; }

 private:
  lv_obj_t *cell_;
  Colors c_;
  bool inverted_{false};
  int32_t border_{FRAME};
};

/// Cell style of every mono tile: the page colour, a thin frame in the ink, the ink for text.
void style_cell(lv_obj_t *cell, const Colors &c);

// One factory per tile type (mono_<type>.cpp).
std::unique_ptr<Widget> make_value(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_bar(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_clock(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
std::unique_ptr<Widget> make_position(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);
/// A tile type this set doesn't render (the plugin doesn't send one; a cached layout might).
std::unique_ptr<Widget> make_unsupported(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env);

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
