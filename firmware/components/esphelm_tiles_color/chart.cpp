// Chart tile (ADR-0030; a page until then, ADR-0012): map tiles of a SignalK chart centred on
// the vessel, north up, with the vessel, and the anchor position and alarm radius when anchor
// watch is on.
//
// The Web-Mercator maths are ported from ESPTiles (github.com/batuakan/ESPTiles, Batu Akan,
// MIT). Map tiles come from the signalk-esphelm plugin (GET .../tiles/<chart>/<z>/<x>/<y>, raw
// RGB565) through the ChartTileStore, which every chart on the display shares: a chart says
// which tiles cover its view and draws those the store has, straight from it, so a second chart
// of the same chart and zoom costs no tile memory. Main loop only.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/esphelm_runtime/chart_store.h"
#include "esphome/components/esphelm_runtime/esphelm_sizes.h"
#include "esphome/components/esphelm_runtime/widgets.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.chart";

static constexpr int TILE = ChartTileStore::TILE;
static constexpr uint32_t DRAW_MS = 250;
static constexpr int MIN_ZOOM = 1, MAX_ZOOM = 20;

/// Fractional Web-Mercator tile coordinates of a position at `zoom`.
static void latlon_to_tile(double lat, double lon, int zoom, double &x, double &y) {
  const double n = std::ldexp(1.0, zoom);
  const double lat_rad = lat * M_PI / 180.0;
  x = (lon + 180.0) / 360.0 * n;
  y = (1.0 - std::log(std::tan(lat_rad) + 1.0 / std::cos(lat_rad)) / M_PI) / 2.0 * n;
}

/// Reads a SignalK position value ({latitude, longitude}); false if it isn't one.
static bool read_position(ArduinoJson::JsonVariantConst v, double &lat, double &lon) {
  if (!v.is<ArduinoJson::JsonObjectConst>())
    return false;
  ArduinoJson::JsonVariantConst la = v["latitude"], lo = v["longitude"];
  if (!la.is<double>() || !lo.is<double>())
    return false;
  lat = la.as<double>();
  lon = lo.as<double>();
  return std::isfinite(lat) && std::isfinite(lon) && std::fabs(lat) <= 85.0 && std::fabs(lon) <= 180.0;
}

static lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const char *text) {
  lv_obj_t *l = lv_label_create(parent);
  if (font != nullptr)
    lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
  lv_obj_set_style_text_color(l, color, LV_PART_MAIN);
  lv_label_set_text(l, text);
  return l;
}

class ChartWidget : public Widget {
 public:
  ChartWidget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env)
      : id_(tile.id), colors_(env.colors), fonts_(env.fonts), area_(cell), store_(env.charts),
        stale_ms_(env.default_stale_ms), night_(env.night) {
    static const esphelm::ChartConfig DEFAULTS;
    const esphelm::ChartConfig &cfg = tile.chart ? *tile.chart : DEFAULTS;
    zoom_ = cfg.zoom;
    anchor_ = cfg.anchor;
    position_path_ = cfg.position_path;
    heading_path_ = cfg.heading_path;
    anchor_position_path_ = cfg.anchor_position_path;
    anchor_radius_path_ = cfg.anchor_radius_path;
    anchor_alarm_path_ = cfg.anchor_alarm_path;

    lv_obj_remove_flag(cell, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(cell, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_pad_all(cell, 0, LV_PART_MAIN);
    lv_obj_set_style_clip_corner(cell, true, LV_PART_MAIN);

    if (!env.psram || store_ == nullptr) {
      message_ = label(cell, fonts_.small, colors_.muted, "No PSRAM for charts");
      lv_obj_center(message_);
      return;
    }
    chart_ = store_->chart_index(cfg.chart);

    // The map and the overlay are drawn in one callback, map tiles first.
    view_ = lv_obj_create(cell);
    lv_obj_remove_style_all(view_);
    lv_obj_remove_flag(view_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(view_, lv_pct(100), lv_pct(100));
    lv_obj_add_event_cb(
        view_, [](lv_event_t *e) { static_cast<ChartWidget *>(lv_event_get_user_data(e))->draw_(e); },
        LV_EVENT_DRAW_MAIN, this);

    banner_ = label(cell, fonts_.label, colors_.background, "ANCHOR ALARM");
    lv_obj_set_style_bg_color(banner_, colors_.zone[2], LV_PART_MAIN);
    lv_obj_set_style_bg_opa(banner_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_hor(banner_, 12, LV_PART_MAIN);
    lv_obj_set_style_radius(banner_, 8, LV_PART_MAIN);
    lv_obj_align(banner_, LV_ALIGN_TOP_MID, 0, 8);
    lv_obj_add_flag(banner_, LV_OBJ_FLAG_HIDDEN);

    info_ = label(cell, fonts_.small, colors_.text, "--");
    lv_obj_set_style_bg_color(info_, colors_.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(info_, LV_OPA_70, LV_PART_MAIN);
    lv_obj_set_style_pad_hor(info_, 10, LV_PART_MAIN);
    lv_obj_set_style_pad_ver(info_, 2, LV_PART_MAIN);
    lv_obj_set_style_radius(info_, 8, LV_PART_MAIN);
    lv_obj_align(info_, LV_ALIGN_BOTTOM_MID, 0, -6);

    zoom_in_ = button_("+", +1);
    zoom_out_ = button_("-", -1);
  }

  const std::string &id() const override { return id_; }

  void paths(std::vector<std::string> &out) const override {
    out.push_back(position_path_);
    out.push_back(heading_path_);
    if (anchor_) {
      out.push_back(anchor_position_path_);
      out.push_back(anchor_radius_path_);
      out.push_back(anchor_alarm_path_);
    }
  }

  void layout_done() override {
    view_w_ = lv_obj_get_content_width(area_);
    view_h_ = lv_obj_get_content_height(area_);
    if (view_ == nullptr)
      return;
    // Size tiers (esphelm_sizes.h, shared with the editor's size hint).
    const int32_t d = std::min(view_w_, view_h_);
    small_ = d < esphelm::sizes::CHART_BUTTONS;
    const int32_t b = std::max<int32_t>(48, d / 9);
    for (lv_obj_t *btn : {zoom_in_, zoom_out_}) {
      lv_obj_set_size(btn, b, b);
      if (small_)
        lv_obj_add_flag(btn, LV_OBJ_FLAG_HIDDEN);
      else
        lv_obj_remove_flag(btn, LV_OBJ_FLAG_HIDDEN);
    }
    lv_obj_align(zoom_in_, LV_ALIGN_TOP_RIGHT, -8, 8);
    lv_obj_align(zoom_out_, LV_ALIGN_TOP_RIGHT, -8, 16 + b);
    if (d < esphelm::sizes::CHART_INFO)
      lv_obj_add_flag(info_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_remove_flag(info_, LV_OBJ_FLAG_HIDDEN);
    dirty_ = true;
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) override {
    if (path == position_path_) {
      double lat, lon;
      if (read_position(v, lat, lon)) {
        lat_ = lat;
        lon_ = lon;
        has_position_ = true;
        position_ms_ = now;
        dirty_ = true;
      }
    } else if (path == heading_path_ && v.is<double>()) {
      heading_ = v.as<double>();
      has_heading_ = true;
      dirty_ = true;
    } else if (anchor_ && path == anchor_position_path_) {
      // A raised anchor shows up as null.
      has_anchor_ = read_position(v, anchor_lat_, anchor_lon_);
      dirty_ = true;
    } else if (anchor_ && path == anchor_radius_path_) {
      anchor_radius_ = v.is<double>() ? v.as<double>() : 0;
      dirty_ = true;
    } else if (anchor_ && path == anchor_alarm_path_) {
      // A SignalK notification: {state, message, ...}; null or "normal"/"nominal" is no alarm.
      const char *state = v["state"].is<const char *>() ? v["state"].as<const char *>() : nullptr;
      alarm_ = state != nullptr && std::strcmp(state, "normal") != 0 && std::strcmp(state, "nominal") != 0;
      dirty_ = true;
    }
  }

  void tick(uint32_t now) override {
    if (view_ == nullptr)
      return;
    if (zoom_step_ != 0) {
      const int z = std::max(MIN_ZOOM, std::min(MAX_ZOOM, zoom_ + zoom_step_));
      zoom_step_ = 0;
      if (z != zoom_) {
        ESP_LOGI(TAG, "Chart %s: zoom %d", id_.c_str(), z);
        zoom_ = z;
        dirty_ = true;
      }
    }
    const bool stale = !has_position_ || now - position_ms_ > stale_ms_;
    if (stale != stale_) {
      stale_ = stale;
      dirty_ = true;
    }
    if (has_position_)
      want_tiles_(now);
    if (store_->version() != store_version_) {
      store_version_ = store_->version();
      dirty_ = true;
    }
    if (!dirty_ || now - last_draw_ms_ < DRAW_MS)
      return;
    dirty_ = false;
    last_draw_ms_ = now;
    redraw_();
  }

  void tap(const std::string &part) override {
    if (part == "zoom_in")
      zoom_step_ = +1;
    else if (part == "zoom_out")
      zoom_step_ = -1;
    else
      ESP_LOGW(TAG, "Chart %s: no button \"%s\"", id_.c_str(), part.c_str());
  }

 protected:
  lv_obj_t *button_(const char *text, int step) {
    lv_obj_t *btn = lv_button_create(area_);
    lv_obj_set_style_bg_color(btn, colors_.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_80, LV_PART_MAIN);
    lv_obj_set_style_radius(btn, 10, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(btn, 0, LV_PART_MAIN);
    lv_obj_t *l = label(btn, fonts_.label, colors_.text, text);
    lv_obj_center(l);
    lv_obj_set_user_data(btn, reinterpret_cast<void *>(static_cast<intptr_t>(step)));
    // Zoom is applied in tick(), not inside the LVGL event.
    lv_obj_add_event_cb(
        btn,
        [](lv_event_t *e) {
          auto *self = static_cast<ChartWidget *>(lv_event_get_user_data(e));
          auto *target = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
          self->zoom_step_ = static_cast<int>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(target)));
        },
        LV_EVENT_CLICKED, this);
    return btn;
  }

  /// The map tiles covering the view: columns x0..x1 and rows y0..y1 (unwrapped), and the
  /// vessel's fractional tile position, which is the middle of the view.
  void cover_(double &fx, double &fy, int &x0, int &x1, int &y0, int &y1) const {
    latlon_to_tile(lat_, lon_, zoom_, fx, fy);
    const double hw = view_w_ / 2.0 / TILE, hh = view_h_ / 2.0 / TILE;
    x0 = static_cast<int>(std::floor(fx - hw));
    x1 = static_cast<int>(std::floor(fx + hw));
    y0 = static_cast<int>(std::floor(fy - hh));
    y1 = static_cast<int>(std::floor(fy + hh));
  }

  /// Tell the store which tiles this chart shows, nearest to the vessel first.
  void want_tiles_(uint32_t now) {
    double fx, fy;
    int x0, x1, y0, y1;
    cover_(fx, fy, x0, x1, y0, y1);
    const int n = 1 << zoom_;
    const int cx = static_cast<int>(std::floor(fx)), cy = static_cast<int>(std::floor(fy));
    for (int ty = std::max(0, y0); ty <= std::min(n - 1, y1); ty++) {
      for (int tx = x0; tx <= x1; tx++)
        store_->want(chart_, zoom_, (tx % n + n) % n, ty, std::abs(tx - cx) + std::abs(ty - cy), now);
    }
  }

  /// Screen position of a lat/lon relative to the view's top left corner.
  void view_point_(double lat, double lon, int32_t &vx, int32_t &vy) const {
    double fx, fy, vfx, vfy;
    latlon_to_tile(lat, lon, zoom_, fx, fy);
    latlon_to_tile(lat_, lon_, zoom_, vfx, vfy);
    vx = static_cast<int32_t>(std::lround(view_w_ / 2.0 + (fx - vfx) * TILE));
    vy = static_cast<int32_t>(std::lround(view_h_ / 2.0 + (fy - vfy) * TILE));
  }

  /// Metres on the ground per screen pixel at the vessel's latitude.
  double metres_per_pixel_() const { return 156543.03392 * std::cos(lat_ * M_PI / 180.0) / std::ldexp(1.0, zoom_); }

  void redraw_() {
    char text[96];
    if (!has_position_)
      std::snprintf(text, sizeof(text), "no position   z%d", zoom_);
    else
      std::snprintf(text, sizeof(text), "%.4f %c  %.4f %c   z%d%s", std::fabs(lat_), lat_ >= 0 ? 'N' : 'S',
                    std::fabs(lon_), lon_ >= 0 ? 'E' : 'W', zoom_, stale_ ? "   position stale" : "");
    if (shown_ != text) {
      shown_ = text;
      lv_label_set_text(info_, text);
    }
    lv_obj_set_style_text_color(info_, stale_ ? colors_.muted : colors_.text, LV_PART_MAIN);
    // An anchor alarm: a banner, or on a small chart a red frame (the page's banner names it).
    const bool alarm = anchor_ && alarm_;
    if (alarm && !small_)
      lv_obj_remove_flag(banner_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(banner_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_style_border_color(area_, colors_.zone[2], LV_PART_MAIN);
    lv_obj_set_style_border_width(area_, alarm && small_ ? 4 : 0, LV_PART_MAIN);
    lv_obj_invalidate(view_);
  }

  void draw_map_(lv_layer_t *layer, const lv_area_t &box) {
    double fx, fy;
    int x0, x1, y0, y1;
    cover_(fx, fy, x0, x1, y0, y1);
    const int n = 1 << zoom_;
    const double cx = (box.x1 + box.x2 + 1) / 2.0, cy = (box.y1 + box.y2 + 1) / 2.0;
    lv_draw_image_dsc_t img;
    lv_draw_image_dsc_init(&img);
    if (night_) {
      // Daylight chart colours would ruin night vision: darken and tint them red.
      img.recolor = lv_color_hex(0x300000);
      img.recolor_opa = LV_OPA_70;
    }
    for (int ty = std::max(0, y0); ty <= std::min(n - 1, y1); ty++) {
      for (int tx = x0; tx <= x1; tx++) {
        const lv_image_dsc_t *tile = store_->get(chart_, zoom_, (tx % n + n) % n, ty);
        if (tile == nullptr)
          continue;  // not there (yet): the tile background shows
        const int32_t left = static_cast<int32_t>(std::lround(cx + (tx - fx) * TILE));
        const int32_t top = static_cast<int32_t>(std::lround(cy + (ty - fy) * TILE));
        img.src = tile;
        lv_area_t a{left, top, left + TILE - 1, top + TILE - 1};
        lv_draw_image(layer, &img, &a);
      }
    }
  }

  void draw_(lv_event_t *e) {
    if (!has_position_)
      return;
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(view_, &box);
    draw_map_(layer, box);
    // Anchor: the alarm circle and the anchor's position.
    int32_t ax, ay;
    if (anchor_ && has_anchor_) {
      view_point_(anchor_lat_, anchor_lon_, ax, ay);
      const lv_color_t ring = alarm_ ? colors_.zone[2] : colors_.zone[0];
      if (anchor_radius_ > 0) {
        const int32_t r = static_cast<int32_t>(std::lround(anchor_radius_ / metres_per_pixel_()));
        lv_draw_rect_dsc_t c;
        lv_draw_rect_dsc_init(&c);
        c.radius = LV_RADIUS_CIRCLE;
        c.bg_color = ring;
        c.bg_opa = LV_OPA_20;
        c.border_color = ring;
        c.border_width = 3;
        c.border_opa = LV_OPA_COVER;
        lv_area_t a{box.x1 + ax - r, box.y1 + ay - r, box.x1 + ax + r, box.y1 + ay + r};
        lv_draw_rect(layer, &c, &a);
      }
      lv_draw_rect_dsc_t m;
      lv_draw_rect_dsc_init(&m);
      m.radius = LV_RADIUS_CIRCLE;
      m.bg_color = colors_.background;
      m.border_color = ring;
      m.border_width = 3;
      lv_area_t a{box.x1 + ax - 7, box.y1 + ay - 7, box.x1 + ax + 7, box.y1 + ay + 7};
      lv_draw_rect(layer, &m, &a);
    }
    // Vessel: an arrowhead pointing along the heading (north up), in the middle of the view.
    const double cx = (box.x1 + box.x2) / 2.0, cy = (box.y1 + box.y2) / 2.0;
    const double s = std::max<int32_t>(small_ ? 10 : 18, std::min(view_w_, view_h_) / 16);
    const double h = (has_heading_ ? heading_ : 0.0);
    auto at = [&](double ang, double r) {
      return lv_point_precise_t{static_cast<lv_value_precise_t>(cx + std::sin(h + ang) * r),
                                static_cast<lv_value_precise_t>(cy - std::cos(h + ang) * r)};
    };
    // Red (the alarm zone's colour), which stands out on the blues of a chart by day.
    const lv_color_t vessel = stale_ ? colors_.muted : colors_.zone[static_cast<int>(esphelm::ZoneState::ALARM)];
    lv_draw_triangle_dsc_t t;
    lv_draw_triangle_dsc_init(&t);
    t.color = vessel;
    t.opa = LV_OPA_COVER;
    // Two triangles make a notched arrowhead.
    t.p[0] = at(0, s);
    t.p[1] = at(2.5, s * 0.8);
    t.p[2] = at(M_PI, s * 0.25);
    lv_draw_triangle(layer, &t);
    t.p[1] = at(-2.5, s * 0.8);
    lv_draw_triangle(layer, &t);
  }

  std::string id_;
  Colors colors_;
  Fonts fonts_;
  lv_obj_t *area_;
  ChartTileStore *store_;
  uint32_t stale_ms_;
  bool night_;
  uint8_t chart_{0};
  std::string position_path_, heading_path_, anchor_position_path_, anchor_radius_path_, anchor_alarm_path_;
  int zoom_{15};
  bool anchor_{true};
  uint32_t store_version_{0};

  lv_obj_t *view_{nullptr}, *banner_{nullptr}, *info_{nullptr}, *message_{nullptr};
  lv_obj_t *zoom_in_{nullptr}, *zoom_out_{nullptr};
  int32_t view_w_{0}, view_h_{0};
  bool small_{false};
  int zoom_step_{0};

  double lat_{0}, lon_{0}, heading_{0}, anchor_lat_{0}, anchor_lon_{0}, anchor_radius_{0};
  bool has_position_{false}, has_heading_{false}, has_anchor_{false}, alarm_{false}, stale_{true};
  uint32_t position_ms_{0}, last_draw_ms_{0};
  bool dirty_{true};
  std::string shown_;
};

std::unique_ptr<Widget> make_chart_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<ChartWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
