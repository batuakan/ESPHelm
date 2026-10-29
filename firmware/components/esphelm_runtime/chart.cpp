// Chart page (Phase 5d, ADR-0012): map tiles of a SignalK chart centred on the vessel, north up,
// with the vessel, and the anchor position and alarm radius when anchor watch is on.
//
// The tile grid and Web-Mercator maths are ported from ESPTiles (github.com/batuakan/ESPTiles,
// Batu Akan, MIT): a 5x5 grid of 256 px RGB565 tiles in one image buffer, recentred by moving
// tiles inside the buffer when the vessel crosses into another tile. Tiles come from the
// signalk-esphelm plugin (GET .../tiles/<chart>/<z>/<x>/<y>, raw RGB565) on the tile worker and
// are copied into the buffer on the main loop, so LVGL is never touched from another thread.
// Main loop only.

#include <cmath>
#include <cstdio>
#include <cstring>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "widgets.h"
// Not in lvgl.h: dropping a cached image after its pixels changed.
#include "src/misc/cache/instance/lv_image_cache.h"

#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
#include <esp_heap_caps.h>
#endif

namespace esphome {
namespace esphelm_runtime {

static const char *const TAG = "esphelm.chart";

static constexpr int TILE = 256;
static constexpr int GRID = 5;  // tiles per side; the vessel's tile is in the middle
static constexpr int IMG = TILE * GRID;
static constexpr size_t TILE_BYTES = TILE * TILE * 2;
static constexpr size_t BUFFER_BYTES = static_cast<size_t>(IMG) * IMG * 2;
static constexpr uint32_t RETRY_MS = 30000;  // failed tiles are retried at most this often
static constexpr uint32_t DRAW_MS = 250;
static constexpr int MIN_ZOOM = 1, MAX_ZOOM = 20;

static uint8_t *alloc_buffer() {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  return static_cast<uint8_t *>(heap_caps_malloc(BUFFER_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
#else
  return new (std::nothrow) uint8_t[BUFFER_BYTES];
#endif
}

static void free_buffer(uint8_t *p) {
#ifdef USE_ESP32_FRAMEWORK_ESP_IDF
  heap_caps_free(p);
#else
  delete[] p;
#endif
}

static uint16_t rgb565(lv_color_t c) {
  return static_cast<uint16_t>(((c.red & 0xF8) << 8) | ((c.green & 0xFC) << 3) | (c.blue >> 3));
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
  ChartWidget(lv_obj_t *area, const esphelm::Page &page, const WidgetEnv &env)
      : id_(page.id), colors_(env.colors), fonts_(env.fonts), area_(area), fetch_(env.fetch),
        stale_ms_(env.default_stale_ms), night_(env.night) {
    static const esphelm::ChartConfig DEFAULTS;
    const esphelm::ChartConfig &cfg = page.chart ? *page.chart : DEFAULTS;
    chart_ = cfg.chart;
    zoom_ = cfg.zoom;
    anchor_ = cfg.anchor;
    position_path_ = cfg.position_path;
    heading_path_ = cfg.heading_path;
    anchor_position_path_ = cfg.anchor_position_path;
    anchor_radius_path_ = cfg.anchor_radius_path;
    anchor_alarm_path_ = cfg.anchor_alarm_path;

    lv_obj_remove_flag(area, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_pad_all(area, 0, LV_PART_MAIN);
    lv_obj_set_style_clip_corner(area, true, LV_PART_MAIN);
    lv_obj_set_style_bg_color(area, colors_.tile, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(area, LV_OPA_COVER, LV_PART_MAIN);

    if (!env.psram) {
      message_ = label(area, fonts_.label, colors_.muted, "This display has no PSRAM for charts");
      lv_obj_center(message_);
      return;
    }
    buffer_ = alloc_buffer();
    if (buffer_ == nullptr) {
      ESP_LOGE(TAG, "No memory for the chart (%u bytes)", (unsigned) BUFFER_BYTES);
      message_ = label(area, fonts_.label, colors_.muted, "Not enough memory for the chart");
      lv_obj_center(message_);
      return;
    }
    placeholder_ = rgb565(colors_.tile);
    for (int g = 0; g < GRID * GRID; g++)
      fill_tile_(g % GRID, g / GRID);
    std::memset(&dsc_, 0, sizeof(dsc_));
    dsc_.header.magic = LV_IMAGE_HEADER_MAGIC;
    dsc_.header.cf = LV_COLOR_FORMAT_RGB565;
    dsc_.header.w = IMG;
    dsc_.header.h = IMG;
    dsc_.header.stride = IMG * 2;
    dsc_.data_size = BUFFER_BYTES;
    dsc_.data = buffer_;
    image_ = lv_image_create(area);
    lv_image_set_src(image_, &dsc_);
    lv_obj_remove_flag(image_, LV_OBJ_FLAG_CLICKABLE);
    if (night_) {
      // Daylight chart colours would ruin night vision: darken and tint them red.
      lv_obj_set_style_image_recolor(image_, lv_color_hex(0x300000), LV_PART_MAIN);
      lv_obj_set_style_image_recolor_opa(image_, LV_OPA_70, LV_PART_MAIN);
    }

    overlay_ = lv_obj_create(area);
    lv_obj_remove_style_all(overlay_);
    lv_obj_remove_flag(overlay_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(overlay_, lv_pct(100), lv_pct(100));
    lv_obj_add_event_cb(
        overlay_, [](lv_event_t *e) { static_cast<ChartWidget *>(lv_event_get_user_data(e))->draw_overlay_(e); },
        LV_EVENT_DRAW_MAIN, this);

    banner_ = label(area, fonts_.label, colors_.background, "ANCHOR ALARM");
    lv_obj_set_style_bg_color(banner_, colors_.zone[2], LV_PART_MAIN);
    lv_obj_set_style_bg_opa(banner_, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_hor(banner_, 12, LV_PART_MAIN);
    lv_obj_set_style_radius(banner_, 8, LV_PART_MAIN);
    lv_obj_align(banner_, LV_ALIGN_TOP_MID, 0, 8);
    lv_obj_add_flag(banner_, LV_OBJ_FLAG_HIDDEN);

    info_ = label(area, fonts_.small, colors_.text, "--");
    lv_obj_set_style_bg_color(info_, colors_.background, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(info_, LV_OPA_70, LV_PART_MAIN);
    lv_obj_set_style_pad_hor(info_, 10, LV_PART_MAIN);
    lv_obj_set_style_pad_ver(info_, 2, LV_PART_MAIN);
    lv_obj_set_style_radius(info_, 8, LV_PART_MAIN);
    lv_obj_align(info_, LV_ALIGN_BOTTOM_MID, 0, -6);

    zoom_in_ = button_("+", +1);
    zoom_out_ = button_("-", -1);
  }

  ~ChartWidget() override {
    // The LVGL objects are deleted first (renderer), so nothing draws from the buffer any more.
    if (buffer_ != nullptr) {
      lv_image_cache_drop(&dsc_);
      free_buffer(buffer_);
    }
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
    if (zoom_in_ != nullptr) {
      const int32_t b = std::max<int32_t>(48, std::min(view_w_, view_h_) / 9);
      for (lv_obj_t *btn : {zoom_in_, zoom_out_})
        lv_obj_set_size(btn, b, b);
      lv_obj_align(zoom_in_, LV_ALIGN_TOP_RIGHT, -8, 8);
      lv_obj_align(zoom_out_, LV_ALIGN_TOP_RIGHT, -8, 16 + b);
    }
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
    if (buffer_ == nullptr)
      return;
    if (zoom_step_ != 0) {
      const int z = std::max(MIN_ZOOM, std::min(MAX_ZOOM, zoom_ + zoom_step_));
      zoom_step_ = 0;
      if (z != zoom_) {
        ESP_LOGI(TAG, "Chart %s: zoom %d", id_.c_str(), z);
        zoom_ = z;
        reset_grid_();
        dirty_ = true;
      }
    }
    const bool stale = !has_position_ || now - position_ms_ > stale_ms_;
    if (stale != stale_) {
      stale_ = stale;
      dirty_ = true;
    }
    if (has_position_)
      request_tiles_(now);
    if (!dirty_ || now - last_draw_ms_ < DRAW_MS)
      return;
    dirty_ = false;
    last_draw_ms_ = now;
    redraw_();
  }

  void on_http(const HttpResult &r) override {
    if (buffer_ == nullptr || r.kind != RequestKind::TILE)
      return;
    in_flight_ = false;
    const uint32_t generation = r.tag >> 8;
    const int g = static_cast<int>(r.tag & 0xFF);
    if (generation != generation_ || g >= GRID * GRID)
      return;  // the grid moved on since this was asked for
    Cell &cell = cells_[g];
    if (r.status == 200 && !r.truncated && r.body.size() == TILE_BYTES) {
      copy_tile_(g % GRID, g / GRID, reinterpret_cast<const uint8_t *>(r.body.data()));
      cell.state = Cell::LOADED;
      lv_image_cache_drop(&dsc_);
      lv_obj_invalidate(image_);
      return;
    }
    // 404: the chart has no tile there; anything else: retry later. Neither is drawn.
    cell.state = r.status == 404 ? Cell::NONE : Cell::FAILED;
    cell.failed_ms = millis();
    if (r.status != 404)
      ESP_LOGW(TAG, "Chart %s: tile %d/%d/%d failed (HTTP %d%s)", id_.c_str(), zoom_, cell.tx, cell.ty, r.status,
               r.truncated || (r.status == 200 && r.body.size() != TILE_BYTES) ? ", wrong size" : "");
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
  struct Cell {
    enum State : uint8_t { EMPTY, LOADED, FAILED, NONE };
    State state{EMPTY};
    int tx{0}, ty{0};  // the tile this cell shows (or will)
    uint32_t failed_ms{0};
  };

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

  uint8_t *tile_ptr_(int gx, int gy) { return buffer_ + (static_cast<size_t>(gy) * TILE * IMG + gx * TILE) * 2; }

  void fill_tile_(int gx, int gy) {
    for (int y = 0; y < TILE; y++) {
      auto *row = reinterpret_cast<uint16_t *>(tile_ptr_(gx, gy) + static_cast<size_t>(y) * IMG * 2);
      for (int x = 0; x < TILE; x++)
        row[x] = placeholder_;
    }
  }

  void copy_tile_(int gx, int gy, const uint8_t *src) {
    for (int y = 0; y < TILE; y++)
      std::memcpy(tile_ptr_(gx, gy) + static_cast<size_t>(y) * IMG * 2, src + static_cast<size_t>(y) * TILE * 2,
                  TILE * 2);
  }

  /// Forget every tile (zoom change): the grid is rebuilt around the vessel.
  void reset_grid_() {
    generation_++;
    in_flight_ = false;
    centered_ = false;
    for (int g = 0; g < GRID * GRID; g++) {
      cells_[g] = Cell{};
      fill_tile_(g % GRID, g / GRID);
    }
    lv_image_cache_drop(&dsc_);
    lv_obj_invalidate(image_);
  }

  /**
   * Recentre the grid on the vessel's tile. Tiles that stay visible are moved inside the
   * buffer (rows in an order that never overwrites what still has to be read); the rest are
   * cleared and queued.
   */
  void recenter_(int cx, int cy) {
    const int n = 1 << zoom_;
    if (centered_ && cx == center_x_ && cy == center_y_)
      return;
    const int dx = cx - center_x_, dy = cy - center_y_;
    const bool shift = centered_ && std::abs(dx) < GRID && std::abs(dy) < GRID;
    generation_++;  // results for the old placement are dropped
    in_flight_ = false;
    Cell old[GRID * GRID];
    std::memcpy(old, cells_, sizeof(cells_));
    if (shift) {
      // New cell (gx, gy) shows old cell (gx + dx, gy + dy).
      const int rows = IMG;
      const size_t row_bytes = static_cast<size_t>(IMG) * 2;
      auto move_row = [&](int y) {
        const int sy = y + dy * TILE;
        if (sy < 0 || sy >= rows)
          return;
        uint8_t *dst = buffer_ + static_cast<size_t>(y) * row_bytes;
        const uint8_t *src = buffer_ + static_cast<size_t>(sy) * row_bytes;
        const int sx = dx * TILE;  // pixels
        if (sx >= 0)
          std::memmove(dst, src + static_cast<size_t>(sx) * 2, row_bytes - static_cast<size_t>(sx) * 2);
        else
          std::memmove(dst - static_cast<ptrdiff_t>(sx) * 2, src, row_bytes + static_cast<ptrdiff_t>(sx) * 2);
      };
      if (dy >= 0)
        for (int y = 0; y < rows; y++)
          move_row(y);
      else
        for (int y = rows - 1; y >= 0; y--)
          move_row(y);
    }
    for (int gy = 0; gy < GRID; gy++) {
      for (int gx = 0; gx < GRID; gx++) {
        Cell &c = cells_[gy * GRID + gx];
        const int ox = gx + dx, oy = gy + dy;
        const bool kept = shift && ox >= 0 && ox < GRID && oy >= 0 && oy < GRID &&
                          old[oy * GRID + ox].state == Cell::LOADED;
        c = kept ? old[oy * GRID + ox] : Cell{};
        if (!kept)
          fill_tile_(gx, gy);
        c.ty = cy - GRID / 2 + gy;
        c.tx = ((cx - GRID / 2 + gx) % n + n) % n;  // wraps around the antimeridian
        if (c.ty < 0 || c.ty >= n)
          c.state = Cell::NONE;  // beyond the poles
      }
    }
    center_x_ = cx;
    center_y_ = cy;
    centered_ = true;
    lv_image_cache_drop(&dsc_);
    lv_obj_invalidate(image_);
  }

  /// One tile at a time, nearest to the vessel first.
  void request_tiles_(uint32_t now) {
    double fx, fy;
    latlon_to_tile(lat_, lon_, zoom_, fx, fy);
    recenter_(static_cast<int>(std::floor(fx)), static_cast<int>(std::floor(fy)));
    if (in_flight_ || !fetch_)
      return;
    int best = -1, best_d = 1 << 30;
    for (int g = 0; g < GRID * GRID; g++) {
      const Cell &c = cells_[g];
      const bool want = c.state == Cell::EMPTY || (c.state == Cell::FAILED && now - c.failed_ms >= RETRY_MS);
      const int d = std::abs(g % GRID - GRID / 2) + std::abs(g / GRID - GRID / 2);
      if (want && d < best_d) {
        best = g;
        best_d = d;
      }
    }
    if (best < 0)
      return;
    const Cell &c = cells_[best];
    char path[160];
    std::snprintf(path, sizeof(path), "/tiles/%s/%d/%d/%d", chart_.c_str(), zoom_, c.tx, c.ty);
    if (fetch_(path, (generation_ << 8) | static_cast<uint32_t>(best), TILE_BYTES + 1024))
      in_flight_ = true;
  }

  /// Image position (relative to the view) and pixel position of a lat/lon on the image.
  bool view_point_(double lat, double lon, int32_t &vx, int32_t &vy) const {
    if (!centered_)
      return false;
    double fx, fy, vfx, vfy;
    latlon_to_tile(lat, lon, zoom_, fx, fy);
    latlon_to_tile(lat_, lon_, zoom_, vfx, vfy);
    vx = static_cast<int32_t>(std::lround(view_w_ / 2.0 + (fx - vfx) * TILE));
    vy = static_cast<int32_t>(std::lround(view_h_ / 2.0 + (fy - vfy) * TILE));
    return true;
  }

  /// Metres on the ground per screen pixel at the vessel's latitude.
  double metres_per_pixel_() const {
    return 156543.03392 * std::cos(lat_ * M_PI / 180.0) / std::ldexp(1.0, zoom_);
  }

  void redraw_() {
    if (centered_) {
      // The vessel's position on the image goes to the middle of the view.
      double fx, fy;
      latlon_to_tile(lat_, lon_, zoom_, fx, fy);
      const double px = (fx - (center_x_ - GRID / 2)) * TILE, py = (fy - (center_y_ - GRID / 2)) * TILE;
      lv_obj_set_pos(image_, static_cast<int32_t>(std::lround(view_w_ / 2.0 - px)),
                     static_cast<int32_t>(std::lround(view_h_ / 2.0 - py)));
    }
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
    if (anchor_ && alarm_)
      lv_obj_remove_flag(banner_, LV_OBJ_FLAG_HIDDEN);
    else
      lv_obj_add_flag(banner_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_invalidate(overlay_);
  }

  void draw_overlay_(lv_event_t *e) {
    if (!has_position_ || !centered_)
      return;
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_area_t box;
    lv_obj_get_coords(overlay_, &box);
    // Anchor: the alarm circle and the anchor's position.
    int32_t ax, ay;
    if (anchor_ && has_anchor_ && view_point_(anchor_lat_, anchor_lon_, ax, ay)) {
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
    const double s = std::max<int32_t>(14, std::min(view_w_, view_h_) / 22);
    const double h = (has_heading_ ? heading_ : 0.0);
    auto at = [&](double ang, double r) {
      return lv_point_precise_t{static_cast<lv_value_precise_t>(cx + std::sin(h + ang) * r),
                                static_cast<lv_value_precise_t>(cy - std::cos(h + ang) * r)};
    };
    const lv_color_t vessel = stale_ ? colors_.muted : colors_.accent;
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
  std::function<bool(const std::string &, uint32_t, size_t)> fetch_;
  uint32_t stale_ms_;
  bool night_;
  std::string chart_, position_path_, heading_path_, anchor_position_path_, anchor_radius_path_, anchor_alarm_path_;
  int zoom_{15};
  bool anchor_{true};

  uint8_t *buffer_{nullptr};
  lv_image_dsc_t dsc_{};
  uint16_t placeholder_{0};
  Cell cells_[GRID * GRID];
  uint32_t generation_{1};
  bool centered_{false}, in_flight_{false};
  int center_x_{0}, center_y_{0};

  lv_obj_t *image_{nullptr}, *overlay_{nullptr}, *banner_{nullptr}, *info_{nullptr}, *message_{nullptr};
  lv_obj_t *zoom_in_{nullptr}, *zoom_out_{nullptr};
  int32_t view_w_{0}, view_h_{0};
  int zoom_step_{0};

  double lat_{0}, lon_{0}, heading_{0}, anchor_lat_{0}, anchor_lon_{0}, anchor_radius_{0};
  bool has_position_{false}, has_heading_{false}, has_anchor_{false}, alarm_{false}, stale_{true};
  uint32_t position_ms_{0}, last_draw_ms_{0};
  bool dirty_{true};
  std::string shown_;
};

std::unique_ptr<Widget> make_chart(lv_obj_t *area, const esphelm::Page &page, const WidgetEnv &env) {
  return std::make_unique<ChartWidget>(area, page, env);
}

}  // namespace esphelm_runtime
}  // namespace esphome
