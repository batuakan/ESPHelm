#include "renderer.h"

#include "esphome/core/log.h"

#include <cstdlib>

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

/// Bytes currently allocated (all heaps), for the per-page memory log.
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

static lv_obj_t *make_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const std::string &text) {
  lv_obj_t *label = lv_label_create(parent);
  if (font != nullptr)
    lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(label, color, LV_PART_MAIN);
  lv_label_set_text(label, text.c_str());
  return label;
}

static void plain(lv_obj_t *obj) {
  lv_obj_remove_style_all(obj);
  lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
}

void Renderer::clear_(esphelm::Theme theme) {
  lv_obj_clean(this->container_);
  const Colors c = colors_for(theme);
  lv_obj_set_layout(this->container_, LV_LAYOUT_NONE);
  lv_obj_remove_flag(this->container_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(this->container_, c.background, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(this->container_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(this->container_, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(this->container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(this->container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_top(this->container_, this->top_inset_, LV_PART_MAIN);
  lv_obj_set_style_pad_row(this->container_, 0, LV_PART_MAIN);
}

bool Renderer::set_top_inset(int32_t px) {
  if (px == this->top_inset_)
    return false;
  this->top_inset_ = px;
  if (this->container_ != nullptr) {
    lv_obj_set_style_pad_top(this->container_, px, LV_PART_MAIN);
    lv_obj_update_layout(this->container_);
  }
  return true;
}

void Renderer::show_status(const std::string &headline, const std::string &detail, const std::string &footer,
                           esphelm::Theme theme) {
  if (this->container_ == nullptr)
    return;
  this->clear_(theme);
  const Colors c = colors_for(theme);
  lv_obj_set_style_pad_all(this->container_, 16, LV_PART_MAIN);

  lv_obj_t *title = make_label(this->container_, this->fonts_.label, c.text, headline);
  lv_obj_set_width(title, lv_pct(100));
  lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(title, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align(title, LV_ALIGN_CENTER, 0, -30);

  lv_obj_t *body = make_label(this->container_, this->fonts_.small, c.muted, detail);
  lv_obj_set_width(body, lv_pct(100));
  lv_obj_set_style_text_align(body, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(body, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align_to(body, title, LV_ALIGN_OUT_BOTTOM_MID, 0, 16);

  lv_obj_t *foot = make_label(this->container_, this->fonts_.small, c.muted, footer);
  lv_obj_set_width(foot, lv_pct(100));
  lv_obj_set_style_text_align(foot, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_label_set_long_mode(foot, LV_LABEL_LONG_MODE_WRAP);
  lv_obj_align(foot, LV_ALIGN_BOTTOM_MID, 0, 0);
}

void Renderer::build_footer_(const esphelm::Layout &layout, size_t index, const Colors &c) {
  lv_obj_t *footer = lv_obj_create(this->container_);
  plain(footer);
  const int32_t h = lv_font_get_line_height(this->fonts_.small) * 22 / 10;
  lv_obj_set_size(footer, lv_pct(100), h);
  lv_obj_set_style_bg_color(footer, c.tile, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(footer, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_pad_hor(footer, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_ver(footer, 6, LV_PART_MAIN);

  const auto make_button = [&](const char *text, intptr_t delta, lv_align_t align, bool enabled) {
    lv_obj_t *btn = lv_button_create(footer);
    lv_obj_set_size(btn, h * 16 / 10, lv_pct(100));
    lv_obj_align(btn, align, 0, 0);
    lv_obj_set_style_bg_color(btn, c.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(btn, 10, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(btn, 0, LV_PART_MAIN);
    // The default theme recolours disabled buttons grey, far too bright at night.
    lv_obj_set_style_recolor_opa(btn, LV_OPA_TRANSP, LV_STATE_DISABLED);
    lv_obj_t *label = make_label(btn, this->fonts_.label, enabled ? c.text : c.muted, text);
    lv_obj_center(label);
    if (!enabled) {
      lv_obj_add_state(btn, LV_STATE_DISABLED);
      return;
    }
    // The page step (+1 / -1) rides along as the button's user data.
    lv_obj_set_user_data(btn, reinterpret_cast<void *>(delta));
    lv_obj_add_event_cb(
        btn,
        [](lv_event_t *e) {
          auto *self = static_cast<Renderer *>(lv_event_get_user_data(e));
          auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
          const int step = reinterpret_cast<intptr_t>(lv_obj_get_user_data(target)) > 0 ? 1 : -1;
          if (self->navigate_)
            self->navigate_(step);
        },
        LV_EVENT_CLICKED, this);
  };
  make_button("<", -1, LV_ALIGN_LEFT_MID, index > 0);
  make_button(">", +1, LV_ALIGN_RIGHT_MID, index + 1 < layout.pages.size());

  const esphelm::Page &page = layout.pages[index];
  const std::string title = (page.title.empty() ? page.id : page.title) + "   " + std::to_string(index + 1) + "/" +
                            std::to_string(layout.pages.size());
  lv_obj_t *label = make_label(footer, this->fonts_.small, c.text, title);
  lv_obj_center(label);
}

bool Renderer::show_page(const esphelm::Layout &layout, size_t index, const WidgetEnv &env,
                         std::vector<std::unique_ptr<Widget>> &widgets) {
  if (this->container_ == nullptr || index >= layout.pages.size())
    return false;
  // Delete the LVGL objects first, then the widgets that referred to them.
  this->clear_(layout.theme);
  widgets.clear();
  const esphelm::Page &page = layout.pages[index];

  lv_obj_set_flex_flow(this->container_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_layout(this->container_, LV_LAYOUT_FLEX);
  lv_obj_t *area = lv_obj_create(this->container_);
  plain(area);
  lv_obj_set_width(area, lv_pct(100));
  lv_obj_set_flex_grow(area, 1);
  lv_obj_set_style_pad_all(area, 8, LV_PART_MAIN);
  if (layout.pages.size() > 1)
    this->build_footer_(layout, index, env.colors);

  const size_t used_before = heap_used();
  if (page.kind == esphelm::PageKind::CHART) {
    widgets.push_back(make_chart(area, page, env));
    lv_obj_update_layout(this->container_);
    widgets.back()->layout_done();
    ESP_LOGD(TAG, "Page %u/%u \"%s\": chart, %u bytes", (unsigned) index + 1, (unsigned) layout.pages.size(),
             page.id.c_str(), (unsigned) (heap_used() - used_before));
    return true;
  }
  lv_obj_set_style_pad_row(area, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_column(area, 8, LV_PART_MAIN);
  this->col_dsc_.assign(page.cols, LV_GRID_FR(1));
  this->col_dsc_.push_back(LV_GRID_TEMPLATE_LAST);
  this->row_dsc_.assign(page.rows, LV_GRID_FR(1));
  this->row_dsc_.push_back(LV_GRID_TEMPLATE_LAST);
  lv_obj_set_grid_dsc_array(area, this->col_dsc_.data(), this->row_dsc_.data());
  lv_obj_set_layout(area, LV_LAYOUT_GRID);
  for (size_t i = 0; i < page.tiles.size(); i++) {
    if (low_memory()) {
      ESP_LOGE(TAG, "Low memory after %u of %u tiles; not showing this page", (unsigned) i,
               (unsigned) page.tiles.size());
      this->clear_(layout.theme);
      widgets.clear();
      return false;
    }
    const esphelm::Tile &tile = page.tiles[i];
#ifdef USE_HOST
    // Test hook (SDL e2e of the boot guard): crash while building this tile, as a renderer bug would.
    const char *crash_on = std::getenv("ESPHELM_TEST_CRASH_ON");
    if (crash_on != nullptr && tile.id == crash_on) {
      ESP_LOGE(TAG, "ESPHELM_TEST_CRASH_ON: crashing at tile %s", tile.id.c_str());
      std::abort();
    }
#endif
    lv_obj_t *cell = lv_obj_create(area);
    lv_obj_set_grid_cell(cell, LV_GRID_ALIGN_STRETCH, tile.x, tile.w, LV_GRID_ALIGN_STRETCH, tile.y, tile.h);
    widgets.push_back(make_tile_widget(cell, tile, env));
  }
  lv_obj_update_layout(this->container_);
  for (auto &w : widgets)
    w->layout_done();
  const size_t used = heap_used() - used_before;
  ESP_LOGD(TAG, "Page %u/%u \"%s\": %u widgets, %u bytes of LVGL objects", (unsigned) index + 1,
           (unsigned) layout.pages.size(), page.id.c_str(), (unsigned) widgets.size(), (unsigned) used);
  return true;
}

}  // namespace esphelm_runtime
}  // namespace esphome
