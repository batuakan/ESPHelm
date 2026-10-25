#pragma once
// Builds LVGL objects for a layout inside the container the runtime owns.
// Main loop only (LVGL is not thread-safe and is driven by LvglComponent::loop()).

#include <cstdint>
#include <string>
#include <vector>

#include "lvgl.h"
#include "layout_model.h"

namespace esphome {
namespace esphelm_runtime {

struct Fonts {
  const lv_font_t *value{nullptr};
  const lv_font_t *label{nullptr};
  const lv_font_t *small{nullptr};
};

class Renderer {
 public:
  void set_container(lv_obj_t *container) { this->container_ = container; }
  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }

  /// Full-screen status text (no layout, waiting for approval, errors, ...).
  void show_status(const std::string &headline, const std::string &detail, const std::string &footer,
                   esphelm::Theme theme);

  /// Build a grid page. Returns false (and leaves the container empty) if memory runs low.
  bool show_grid_page(const esphelm::Page &page, esphelm::Theme theme);

  /// Update a tile's value text; only touches LVGL when something changed.
  void set_tile_value(size_t tile, const std::string &text, bool stale);

  size_t tile_count() const { return this->tiles_.size(); }

 protected:
  struct Colors {
    lv_color_t background;
    lv_color_t tile;
    lv_color_t text;
    lv_color_t muted;
  };
  struct TileObjects {
    lv_obj_t *value{nullptr};  // nullptr for tile types this firmware cannot render
    std::string text;
    bool stale{true};
  };

  static Colors colors_for(esphelm::Theme theme);
  void clear_(esphelm::Theme theme);

  lv_obj_t *container_{nullptr};
  Fonts fonts_;
  Colors colors_{};
  // LVGL keeps pointers to the grid descriptors, so they must outlive the page.
  std::vector<int32_t> col_dsc_;
  std::vector<int32_t> row_dsc_;
  std::vector<TileObjects> tiles_;
};

}  // namespace esphelm_runtime
}  // namespace esphome
