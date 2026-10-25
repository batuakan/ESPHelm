#pragma once
// Builds LVGL objects for a layout inside the container the runtime owns: the visible page
// plus, for layouts with several pages, a footer with previous/next buttons and the page title.
// Only the visible page exists at any time (memory stays flat on boards without PSRAM).
// Main loop only (LVGL is not thread-safe and is driven by LvglComponent::loop()).

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "lvgl.h"
#include "layout_model.h"
#include "widgets.h"

namespace esphome {
namespace esphelm_runtime {

class Renderer {
 public:
  void set_container(lv_obj_t *container) { this->container_ = container; }
  void set_fonts(const Fonts &fonts) { this->fonts_ = fonts; }
  /// Called from the footer buttons (main loop, inside LVGL event handling).
  void set_navigation(std::function<void(int delta)> navigate) { this->navigate_ = std::move(navigate); }

  /// Full-screen status text (no layout, waiting for approval, errors, ...).
  void show_status(const std::string &headline, const std::string &detail, const std::string &footer,
                   esphelm::Theme theme);

  /// Build page `index` of `layout`. Returns its widgets, or an empty vector and false (with the
  /// container left empty) if memory runs low.
  bool show_page(const esphelm::Layout &layout, size_t index, const WidgetEnv &env,
                 std::vector<std::unique_ptr<Widget>> &widgets);

  const Fonts &fonts() const { return this->fonts_; }

 protected:
  void clear_(esphelm::Theme theme);
  void build_footer_(const esphelm::Layout &layout, size_t index, const Colors &colors);

  lv_obj_t *container_{nullptr};
  Fonts fonts_;
  std::function<void(int)> navigate_;
  // LVGL keeps pointers to the grid descriptors, so they must outlive the page.
  std::vector<int32_t> col_dsc_;
  std::vector<int32_t> row_dsc_;
};

}  // namespace esphelm_runtime
}  // namespace esphome
