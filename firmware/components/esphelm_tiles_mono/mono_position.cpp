// The mono position tile (ADR-0035). Shared helpers: mono_common.h.
#include "mono_common.h"

#include <algorithm>

#include "esphome/core/hal.h"

namespace esphome {
namespace esphelm_runtime {
namespace mono {

/**
 * GPS position: the caption, then latitude over longitude in the tile's format
 * (esphelm_position.h), sized like the colour position tile. "--" when stale or not a position.
 * Memory: three labels.
 */
class PositionWidget : public Widget {
 public:
  PositionWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), fonts_(env.fonts), cell_(cell), format_(tile.position_format), decimals_(tile.data.decimals) {
    b_.item = tile.data;
    b_.stale_ms = stale_ms(tile.data, env);
    b_.last_value_ms = millis();
    caption_ = label(cell, env.fonts.small, tile.data.label);
    lv_obj_align(caption_, LV_ALIGN_TOP_LEFT, 0, 0);
    lat_ = label(cell, env.fonts.value, "--");
    lon_ = label(cell, env.fonts.value, "");
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override { out.push_back(b_.item.path); }

  void layout_done() override {
    const int32_t w = lv_obj_get_content_width(cell_);
    const int32_t full_h = lv_obj_get_content_height(cell_);
    int32_t caption_h = b_.item.label.empty() ? 0 : lv_font_get_line_height(fonts_.small);
    // Two lines of the smallest font come first: in a tile too small for the caption too (e.g.
    // under the alarm banner), the caption goes. Half a line of slack: a line's height includes
    // room above and below the letters.
    const int32_t small_line = line_height(smallest_font(fonts_));
    if (caption_h > 0 && caption_h + 2 * small_line > full_h + small_line / 2)
      caption_h = 0;
    if (caption_h > 0)
      lv_obj_remove_flag(caption_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(caption_, LV_OBJ_FLAG_HIDDEN);
    const int32_t h = full_h - caption_h;
    std::string worst_lat, worst_lon;
    esphelm::position::format(-88.8888888, -178.8888888, format_, decimals_, worst_lat, worst_lon);
    const lv_font_t *font = fit_font(fonts_, worst_lon.c_str(), w, h, 2);
    const int32_t line = lv_font_get_line_height(font);
    const int32_t top = caption_h + std::max<int32_t>(0, (h - 2 * line) / 2);
    for (lv_obj_t *l : {lat_, lon_})
      lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
    lv_obj_align(lat_, LV_ALIGN_TOP_MID, 0, top);
    lv_obj_align(lon_, LV_ALIGN_TOP_MID, 0, top + line);
    if (!b_.stale_shown)
      b_.dirty = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path != b_.item.path)
      return;
    // Untrusted: only an object with two numbers in range is a position; anything else is "--".
    ArduinoJson::JsonVariantConst lat = v["latitude"], lon = v["longitude"];
    valid_ = v.is<ArduinoJson::JsonObjectConst>() && lat.is<double>() && !lat.is<bool>() && lon.is<double>() &&
             !lon.is<bool>() &&
             esphelm::position::format(lat.as<double>(), lon.as<double>(), format_, decimals_, lat_text_, lon_text_);
    b_.last_value_ms = now;
    b_.dirty = true;
  }

  void tick(uint32_t now) override {
    bool stale;
    if (!b_.due(now, stale))
      return;
    const bool live = !stale && valid_;
    set_text(lat_, shown_lat_, live ? lat_text_ : "--");
    set_text(lon_, shown_lon_, live ? lon_text_ : "");
    lv_obj_align(lat_, LV_ALIGN_TOP_MID, 0, lv_obj_get_y_aligned(lat_));
    lv_obj_align(lon_, LV_ALIGN_TOP_MID, 0, lv_obj_get_y_aligned(lon_));
  }

 protected:
  std::string id_;
  Fonts fonts_;
  lv_obj_t *cell_;
  esphelm::position::Format format_;
  int decimals_;
  Binding b_;
  lv_obj_t *caption_;
  lv_obj_t *lat_;
  lv_obj_t *lon_;
  bool valid_{false};
  std::string lat_text_, lon_text_;
  std::string shown_lat_{"--"}, shown_lon_;
};

std::unique_ptr<Widget> make_position(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<PositionWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
