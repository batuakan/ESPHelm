#include "renderer.h"

#include "esphome/core/log.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_heap_caps.h>
#elif defined(__GLIBC__)
#include <malloc.h>
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.render";

// Stop building when free heap drops below this (all allocation capabilities). Leaves room for
// Wi-Fi, SignalK and LVGL redraws; matters on boards without PSRAM.
static const size_t MIN_FREE_HEAP = 32 * 1024;

/// Bytes currently allocated (all heaps), for the per-layout memory log.
static size_t heap_used() {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  return heap_caps_get_total_size(MALLOC_CAP_8BIT) - heap_caps_get_free_size(MALLOC_CAP_8BIT);
#elif defined(__GLIBC__)
  return mallinfo2().uordblks;
#else
  return 0;
#endif
}

static bool low_memory() {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  return heap_caps_get_free_size(MALLOC_CAP_8BIT) < MIN_FREE_HEAP;
#else
  return false;
#endif
}

Renderer::Colors Renderer::colors_for(esphelm::Theme theme) {
  if (theme == esphelm::Theme::NIGHT) {
    // Red on black keeps night vision.
    return Colors{lv_color_hex(0x000000), lv_color_hex(0x140404), lv_color_hex(0xE0302A), lv_color_hex(0x6A2020)};
  }
  return Colors{lv_color_hex(0x10161C), lv_color_hex(0x1E2A36), lv_color_hex(0xF2F5F8), lv_color_hex(0x7A8794)};
}

void Renderer::clear_(esphelm::Theme theme) {
  this->tiles_.clear();
  lv_obj_clean(this->container_);
  this->colors_ = colors_for(theme);
  lv_obj_set_layout(this->container_, LV_LAYOUT_NONE);
  lv_obj_remove_flag(this->container_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(this->container_, this->colors_.background, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(this->container_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(this->container_, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(this->container_, 0, LV_PART_MAIN);
}

static lv_obj_t *make_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const std::string &text) {
  lv_obj_t *label = lv_label_create(parent);
  if (font != nullptr)
    lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(label, color, LV_PART_MAIN);
  lv_label_set_text(label, text.c_str());
  return label;
}

void Renderer::show_status(const std::string &headline, const std::string &detail, const std::string &footer,
                           esphelm::Theme theme) {
  if (this->container_ == nullptr)
    return;
  this->clear_(theme);
  lv_obj_set_style_pad_all(this->container_, 16, LV_PART_MAIN);

  lv_obj_t *title = make_label(this->container_, this->fonts_.label, this->colors_.text, headline);
  lv_obj_set_width(title, lv_pct(100));
  lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(title, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align(title, LV_ALIGN_CENTER, 0, -30);

  lv_obj_t *body = make_label(this->container_, this->fonts_.small, this->colors_.muted, detail);
  lv_obj_set_width(body, lv_pct(100));
  lv_obj_set_style_text_align(body, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(body, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align_to(body, title, LV_ALIGN_OUT_BOTTOM_MID, 0, 16);

  lv_obj_t *foot = make_label(this->container_, this->fonts_.small, this->colors_.muted, footer);
  lv_obj_set_width(foot, lv_pct(100));
  lv_obj_set_style_text_align(foot, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(foot, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align(foot, LV_ALIGN_BOTTOM_MID, 0, 0);
}

bool Renderer::show_grid_page(const esphelm::Page &page, esphelm::Theme theme) {
  if (this->container_ == nullptr)
    return false;
  this->clear_(theme);
  lv_obj_set_style_pad_all(this->container_, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_row(this->container_, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_column(this->container_, 8, LV_PART_MAIN);

  this->col_dsc_.assign(page.cols, LV_GRID_FR(1));
  this->col_dsc_.push_back(LV_GRID_TEMPLATE_LAST);
  this->row_dsc_.assign(page.rows, LV_GRID_FR(1));
  this->row_dsc_.push_back(LV_GRID_TEMPLATE_LAST);
  lv_obj_set_grid_dsc_array(this->container_, this->col_dsc_.data(), this->row_dsc_.data());
  lv_obj_set_layout(this->container_, LV_LAYOUT_GRID);

  this->tiles_.resize(page.tiles.size());
  const size_t used_before = heap_used();
  for (size_t i = 0; i < page.tiles.size(); i++) {
    if (low_memory()) {
      ESP_LOGE(TAG, "Low memory after %u of %u tiles; not showing this layout", (unsigned) i,
               (unsigned) page.tiles.size());
      this->clear_(theme);
      return false;
    }
    const esphelm::Tile &tile = page.tiles[i];
    lv_obj_t *box = lv_obj_create(this->container_);
    lv_obj_set_grid_cell(box, LV_GRID_ALIGN_STRETCH, tile.x, tile.w, LV_GRID_ALIGN_STRETCH, tile.y, tile.h);
    lv_obj_remove_flag(box, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(box, this->colors_.tile, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(box, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(box, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(box, 16, LV_PART_MAIN);
    lv_obj_set_style_pad_all(box, 10, LV_PART_MAIN);

    if (tile.type != esphelm::TileType::VALUE) {
      // Not sent by the plugin (hello lists only "value"); shown instead of failing.
      lv_obj_t *note = make_label(box, this->fonts_.small, this->colors_.muted, "Not supported by this firmware");
      lv_obj_center(note);
      continue;
    }
    lv_obj_t *caption = make_label(box, this->fonts_.small, this->colors_.muted, tile.data.label);
    lv_obj_align(caption, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_t *value = make_label(box, this->fonts_.value, this->colors_.muted, "--");
    lv_obj_align(value, LV_ALIGN_CENTER, 0, 0);
    if (tile.data.unit != nullptr) {
      lv_obj_t *unit = make_label(box, this->fonts_.small, this->colors_.muted, tile.data.unit->label);
      lv_obj_align(unit, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    }
    this->tiles_[i].value = value;
    this->tiles_[i].text = "--";
  }
  const size_t used = heap_used() - used_before;
  ESP_LOGD(TAG, "Grid page %ux%u, %u tiles: %u bytes of LVGL objects (%u per tile)", page.cols, page.rows,
           (unsigned) page.tiles.size(), (unsigned) used,
           (unsigned) (page.tiles.empty() ? 0 : used / page.tiles.size()));
  return true;
}

void Renderer::set_tile_value(size_t tile, const std::string &text, bool stale) {
  if (tile >= this->tiles_.size() || this->tiles_[tile].value == nullptr)
    return;
  TileObjects &t = this->tiles_[tile];
  if (t.text != text) {
    lv_label_set_text(t.value, text.c_str());
    t.text = text;
  }
  if (t.stale != stale) {
    lv_obj_set_style_text_color(t.value, stale ? this->colors_.muted : this->colors_.text, LV_PART_MAIN);
    t.stale = stale;
  }
}

}  // namespace esphelm_runtime
}  // namespace esphome
