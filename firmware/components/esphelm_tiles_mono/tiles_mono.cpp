// The mono tile set (ADR-0035): its palette, the frame and zone style every tile shares, and the
// factory for its tiles.
#include "mono_common.h"

namespace esphome {
namespace esphelm_runtime {

Colors colors_for(esphelm::Theme theme) {
  // Day: black on white. Dark and night: white on black (night vision needs no red on a panel
  // without a backlight). Every colour is one of the two, so nothing the core draws is grey.
  const bool inverted = theme != esphelm::Theme::DAY;
  const lv_color_t ink = inverted ? lv_color_hex(0xFFFFFF) : lv_color_hex(0x000000);
  const lv_color_t page = inverted ? lv_color_hex(0x000000) : lv_color_hex(0xFFFFFF);
  return Colors{page, page, ink, ink, ink, ink, {ink, ink, ink, ink}, ink, ink, ink, ink, ink, page, ink,
                {ink, ink, ink, ink, ink, ink}};
}

void tile_types(std::vector<const char *> &out, bool psram) {
  for (const char *t : {"value", "bar", "clock", "position"})
    out.push_back(t);
}

const char *display_kind() { return "mono"; }

std::unique_ptr<Widget> make_tile_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  mono::style_cell(cell, env.colors);
  lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
  switch (tile.type) {
    case esphelm::TileType::VALUE:
      return mono::make_value(cell, tile, env);
    case esphelm::TileType::BAR:
      return mono::make_bar(cell, tile, env);
    case esphelm::TileType::CLOCK:
      return mono::make_clock(cell, tile, env);
    case esphelm::TileType::POSITION:
      return mono::make_position(cell, tile, env);
    default:
      return mono::make_unsupported(cell, tile, env);
  }
}

namespace mono {

lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font, const std::string &text) {
  lv_obj_t *l = lv_label_create(parent);
  if (font != nullptr)
    lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
  lv_label_set_text(l, text.c_str());
  return l;
}

void style_cell(lv_obj_t *cell, const Colors &c) {
  lv_obj_remove_flag(cell, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(cell, c.background, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(cell, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_color(cell, c.text, LV_PART_MAIN);
  lv_obj_set_style_border_opa(cell, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(cell, FRAME, LV_PART_MAIN);
  lv_obj_set_style_radius(cell, RADIUS, LV_PART_MAIN);
  lv_obj_set_style_pad_all(cell, PAD, LV_PART_MAIN);
  lv_obj_set_style_text_color(cell, c.text, LV_PART_MAIN);
}

bool Frame::show(bool zoned, esphelm::ZoneState state) {
  const bool inverted = zoned && (state == esphelm::ZoneState::ALARM || state == esphelm::ZoneState::EMERGENCY);
  const int32_t border = zoned && state == esphelm::ZoneState::WARN ? FRAME_WARN : FRAME;
  if (border != border_) {
    border_ = border;
    lv_obj_set_style_border_width(cell_, border, LV_PART_MAIN);
  }
  if (inverted == inverted_)
    return false;
  inverted_ = inverted;
  lv_obj_set_style_bg_color(cell_, paper(), LV_PART_MAIN);
  lv_obj_set_style_text_color(cell_, ink(), LV_PART_MAIN);
  return true;
}

namespace {
/// "<type>: not on this display" for a tile type the set doesn't have.
class UnsupportedWidget : public Widget {
 public:
  UnsupportedWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) : id_(tile.id) {
    lv_obj_t *l = label(cell, env.fonts.small, "Not on this display");
    lv_obj_set_width(l, lv_pct(100));
    lv_label_set_long_mode(l, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_center(l);
  }
  const std::string &id() const override { return id_; }
  void paths(std::vector<std::string> &out) const override {}
  void on_value(const std::string &path, ArduinoJson::JsonVariantConst value, uint32_t now) override {}
  void tick(uint32_t now) override {}

 private:
  std::string id_;
};
}  // namespace

std::unique_ptr<Widget> make_unsupported(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<UnsupportedWidget>(cell, tile, env);
}

}  // namespace mono
}  // namespace esphelm_runtime
}  // namespace esphome
