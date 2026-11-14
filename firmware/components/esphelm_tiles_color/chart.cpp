// Chart tile (ADR-0030; a page until then, ADR-0012): map tiles of a SignalK chart centred on
// the vessel, north up, with the vessel, the anchor position and alarm radius when anchor watch
// is on, and the active route and the next waypoint from SignalK's course API (ADR-0037).
//
// The Web-Mercator maths are ported from ESPTiles (github.com/batuakan/ESPTiles, Batu Akan,
// MIT). Map tiles come from the signalk-esphelm plugin (GET .../tiles/<chart>/<z>/<x>/<y>, raw
// RGB565) through the ChartTileStore, which every chart on the display shares: a chart says
// which tiles cover its view and draws those the store has, straight from it, so a second chart
// of the same chart and zoom costs no tile memory. Main loop only.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/esphelm_runtime/chart_store.h"
#include "esphome/components/esphelm_runtime/esphelm_chart_route.h"
#include "esphome/components/esphelm_runtime/esphelm_sizes.h"
#include "esphome/components/esphelm_runtime/widgets.h"

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.chart";

static constexpr int TILE = ChartTileStore::TILE;
static constexpr uint32_t DRAW_MS = 250;
static constexpr int MIN_ZOOM = 1, MAX_ZOOM = 20;
/// The route's colour by day and in the dark theme: magenta, as on chartplotters, apart from the
/// chart's blues and the red vessel. At night the theme's red.
static const uint32_t ROUTE_COLOR = 0xD0209C;

/// Clips the segment a-b to the box [x0, x1] x [y0, y1] (Liang-Barsky); false when it misses.
static bool clip_segment(double &ax, double &ay, double &bx, double &by, double x0, double y0, double x1,
                         double y1) {
  double t0 = 0, t1 = 1;
  const double dx = bx - ax, dy = by - ay;
  const double p[4] = {-dx, dx, -dy, dy}, q[4] = {ax - x0, x1 - ax, ay - y0, y1 - ay};
  for (int i = 0; i < 4; i++) {
    if (p[i] == 0) {
      if (q[i] < 0)
        return false;
    } else {
      const double t = q[i] / p[i];
      if (p[i] < 0)
        t0 = std::max(t0, t);
      else
        t1 = std::min(t1, t);
    }
  }
  if (t0 > t1)
    return false;
  const double sx = ax, sy = ay;
  ax = sx + t0 * dx;
  ay = sy + t0 * dy;
  bx = sx + t1 * dx;
  by = sy + t1 * dy;
  return true;
}

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
    route_ = cfg.route;
    active_route_path_ = cfg.active_route_path;
    next_point_path_ = cfg.next_point_path;
    previous_point_path_ = cfg.previous_point_path;
    distance_path_ = cfg.distance_path;

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
    if (route_) {
      out.push_back(active_route_path_);
      out.push_back(next_point_path_);
      out.push_back(previous_point_path_);
      out.push_back(distance_path_);
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
    } else if (route_ && path == active_route_path_) {
      // {href: "/resources/routes/<id>", pointIndex, pointTotal, reverse}, or null (no route).
      char id[esphelm::chart_route::MAX_ID + 1];
      const char *href = v["href"].is<const char *>() ? v["href"].as<const char *>() : nullptr;
      const bool ok = esphelm::chart_route::route_id(href, id);
      route_index_ = v["pointIndex"].is<long>() ? v["pointIndex"].as<long>() : 0;
      route_total_ = v["pointTotal"].is<long>() ? v["pointTotal"].as<long>() : 0;
      route_reverse_ = v["reverse"].is<bool>() && v["reverse"].as<bool>();
      if (store_ != nullptr)
        store_->want_route(ok ? std::string(id) : std::string(), now);
      dirty_ = true;
    } else if (route_ && path == next_point_path_) {
      // {position: {latitude, longitude}, type, ...}, or null (no course).
      has_next_ = read_position(v["position"], next_lat_, next_lon_);
      next_ms_ = now;
      dirty_ = true;
    } else if (route_ && path == previous_point_path_) {
      has_previous_ = read_position(v["position"], previous_lat_, previous_lon_);
      dirty_ = true;
    } else if (route_ && path == distance_path_) {
      has_distance_ = v.is<double>() && std::isfinite(v.as<double>()) && v.as<double>() >= 0;
      distance_ = has_distance_ ? v.as<double>() : 0;
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
    const bool next_stale = has_next_ && now - next_ms_ > stale_ms_;
    if (next_stale != next_stale_) {
      next_stale_ = next_stale;
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
    if (route_)
      draw_route_(layer, box);
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
    if (route_ && has_next_)
      draw_waypoint_(layer, box);
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

  lv_color_t route_color_() const { return night_ ? colors_.text : lv_color_hex(ROUTE_COLOR); }

  /// A line between two view points, clipped to the view (a route leg can be far off screen).
  void line_(lv_layer_t *layer, const lv_area_t &box, double ax, double ay, double bx, double by, int32_t width,
             lv_color_t color, lv_opa_t opa) {
    const double m = width;
    if (!clip_segment(ax, ay, bx, by, -m, -m, view_w_ + m, view_h_ + m))
      return;
    lv_draw_line_dsc_t l;
    lv_draw_line_dsc_init(&l);
    l.color = color;
    l.opa = opa;
    l.width = width;
    l.round_start = 1;
    l.round_end = 1;
    l.p1 = {static_cast<lv_value_precise_t>(box.x1 + ax), static_cast<lv_value_precise_t>(box.y1 + ay)};
    l.p2 = {static_cast<lv_value_precise_t>(box.x1 + bx), static_cast<lv_value_precise_t>(box.y1 + by)};
    lv_draw_line(layer, &l);
  }

  /// The active route: legs sailed thin and faint, the rest solid with a dot at each point, and
  /// the leg being sailed (previous point to next point) bold.
  void draw_route_(lv_layer_t *layer, const lv_area_t &box) {
    const lv_color_t color = route_color_();
    const int32_t d = std::min(view_w_, view_h_);
    const int32_t w = std::max<int32_t>(3, d / 160);
    const auto &pts = store_->route();
    if (pts.size() >= 2) {
      // A point's place in the order it is sailed; legs before the next point are behind.
      const long total = route_total_ > 0 ? route_total_ : static_cast<long>(pts.back().index) + 1;
      auto order = [&](const ChartTileStore::RoutePoint &p) {
        return route_reverse_ ? total - 1 - static_cast<long>(p.index) : static_cast<long>(p.index);
      };
      int32_t px = 0, py = 0;
      view_point_(pts[0].lat, pts[0].lon, px, py);
      for (size_t i = 1; i < pts.size(); i++) {
        int32_t qx, qy;
        view_point_(pts[i].lat, pts[i].lon, qx, qy);
        const bool behind = std::max(order(pts[i - 1]), order(pts[i])) < route_index_;
        line_(layer, box, px, py, qx, qy, behind ? std::max<int32_t>(2, w - 1) : w, color,
              behind ? LV_OPA_50 : LV_OPA_COVER);
        px = qx;
        py = qy;
      }
      // Route points, skipping one closer than a few dots to the last one drawn.
      lv_draw_rect_dsc_t dot;
      lv_draw_rect_dsc_init(&dot);
      dot.radius = LV_RADIUS_CIRCLE;
      dot.bg_color = colors_.background;
      dot.border_color = color;
      dot.border_width = std::max<int32_t>(2, w - 1);
      const int32_t r = w + 2;
      int32_t lx = 0, ly = 0;
      bool first = true;
      for (const auto &p : pts) {
        int32_t x, y;
        view_point_(p.lat, p.lon, x, y);
        if (x < -r || y < -r || x > view_w_ + r || y > view_h_ + r)
          continue;
        if (!first && std::abs(x - lx) + std::abs(y - ly) < 4 * r)
          continue;
        first = false;
        lx = x;
        ly = y;
        lv_area_t a{box.x1 + x - r, box.y1 + y - r, box.x1 + x + r, box.y1 + y + r};
        lv_draw_rect(layer, &dot, &a);
      }
    }
    if (has_previous_ && has_next_) {
      int32_t ax, ay, bx, by;
      view_point_(previous_lat_, previous_lon_, ax, ay);
      view_point_(next_lat_, next_lon_, bx, by);
      line_(layer, box, ax, ay, bx, by, w * 2, next_stale_ ? colors_.muted : color, LV_OPA_COVER);
    }
  }

  /// The next waypoint: a ring on screen, else a small arrow at the edge pointing at it; a thin
  /// line from the vessel to it, and the distance to go on charts big enough for text.
  void draw_waypoint_(lv_layer_t *layer, const lv_area_t &box) {
    const lv_color_t color = next_stale_ ? colors_.muted : route_color_();
    const int32_t d = std::min(view_w_, view_h_);
    const double s = std::max<int32_t>(small_ ? 9 : 12, d / 28);
    int32_t wx, wy;
    view_point_(next_lat_, next_lon_, wx, wy);
    const double cx = view_w_ / 2.0, cy = view_h_ / 2.0;
    // The arrow stays clear of the zoom buttons (a ninth of the view, at least 48 px, 8 px from
    // the edge) and so of the position line too; on a small chart, of the edge only.
    const double inset = small_ ? s * 1.6 : std::max<int32_t>(48, d / 9) + 8 + s;
    const auto at = esphelm::chart_route::edge_arrow(wx - cx, wy - cy, view_w_, view_h_, inset);
    line_(layer, box, cx, cy, at.x, at.y, 2, color, LV_OPA_70);
    double lx, ly;  // where the distance goes
    if (at.on_screen) {
      const int32_t r = static_cast<int32_t>(s * 0.8);
      lv_draw_rect_dsc_t ring;
      lv_draw_rect_dsc_init(&ring);
      ring.radius = LV_RADIUS_CIRCLE;
      ring.bg_color = colors_.background;
      ring.bg_opa = LV_OPA_60;
      ring.border_color = color;
      ring.border_width = std::max<int32_t>(3, d / 160);
      lv_area_t a{box.x1 + wx - r, box.y1 + wy - r, box.x1 + wx + r, box.y1 + wy + r};
      lv_draw_rect(layer, &ring, &a);
      lx = wx;
      ly = wy + r + s * 0.9;
    } else {
      const double ux = std::sin(at.angle), uy = -std::cos(at.angle);
      auto pt = [&](double ang, double r) {
        return lv_point_precise_t{static_cast<lv_value_precise_t>(box.x1 + at.x + std::sin(at.angle + ang) * r),
                                  static_cast<lv_value_precise_t>(box.y1 + at.y - std::cos(at.angle + ang) * r)};
      };
      lv_draw_triangle_dsc_t t;
      lv_draw_triangle_dsc_init(&t);
      t.opa = LV_OPA_COVER;
      // A background-coloured outline, so the arrow stands out on any chart.
      t.color = colors_.background;
      t.p[0] = pt(0, s * 1.35);
      t.p[1] = pt(2.45, s * 1.05);
      t.p[2] = pt(-2.45, s * 1.05);
      lv_draw_triangle(layer, &t);
      t.color = color;
      t.p[0] = pt(0, s);
      t.p[1] = pt(2.45, s * 0.7);
      t.p[2] = pt(-2.45, s * 0.7);
      lv_draw_triangle(layer, &t);
      lx = at.x - ux * s * 2.4;
      ly = at.y - uy * s * 2.4;
    }
    if (!has_distance_ || d < esphelm::sizes::CHART_INFO)
      return;
    char text[24];
    const double nm = distance_ / 1852.0;
    std::snprintf(text, sizeof(text), nm < 10 ? "%.2f nm" : nm < 100 ? "%.1f nm" : "%.0f nm", nm);
    const lv_font_t *font = fonts_.small;
    lv_point_t size;
    lv_text_get_size(&size, text, font, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    // Kept inside the view, on a translucent box like the position line.
    const int32_t hw = size.x / 2 + 6, hh = size.y / 2 + 2;
    const int32_t x = std::max(hw, std::min(view_w_ - hw, static_cast<int32_t>(std::lround(lx))));
    const int32_t y = std::max(hh, std::min(view_h_ - hh, static_cast<int32_t>(std::lround(ly))));
    lv_draw_rect_dsc_t bg;
    lv_draw_rect_dsc_init(&bg);
    bg.radius = 6;
    bg.bg_color = colors_.background;
    bg.bg_opa = LV_OPA_70;
    lv_area_t a{box.x1 + x - hw, box.y1 + y - hh, box.x1 + x + hw, box.y1 + y + hh};
    lv_draw_rect(layer, &bg, &a);
    lv_draw_label_dsc_t label;
    lv_draw_label_dsc_init(&label);
    label.text = text;
    label.text_local = 1;
    label.font = font;
    label.color = color;
    label.align = LV_TEXT_ALIGN_CENTER;
    lv_area_t ta{box.x1 + x - hw, box.y1 + y - size.y / 2, box.x1 + x + hw, box.y1 + y + size.y / 2};
    lv_draw_label(layer, &label, &ta);
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
  // The course (ADR-0037).
  bool route_{true};
  std::string active_route_path_, next_point_path_, previous_point_path_, distance_path_;
  double next_lat_{0}, next_lon_{0}, previous_lat_{0}, previous_lon_{0}, distance_{0};
  bool has_next_{false}, has_previous_{false}, has_distance_{false}, next_stale_{false}, route_reverse_{false};
  long route_index_{0}, route_total_{0};
  uint32_t next_ms_{0};
  uint32_t position_ms_{0}, last_draw_ms_{0};
  bool dirty_{true};
  std::string shown_;
};

std::unique_ptr<Widget> make_chart_widget(lv_obj_t *cell, const esphelm::Tile &tile, const WidgetEnv &env) {
  return std::make_unique<ChartWidget>(cell, tile, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
