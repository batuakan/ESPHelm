#pragma once
// The values of a battery tile (ADR-0046), for both tile sets: what each renderer shows, from the
// tile's bindings. It draws nothing. Main loop only.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "esphelm_battery.h"
#include "widget_base.h"

namespace esphome {
namespace esphelm_runtime {

/// Where a battery tile draws its battery (ADR-0046), in content pixels: an outline with its nub
/// on the right in the band `rows` leaves, and the % `percent_w` wide beside it.
struct BatteryBox {
  int32_t x{0}, y{0}, w{0}, h{0};  // the outline
  int32_t nub_w{0}, nub_h{0};
  int32_t border{2};  // the outline's width
  int32_t inset{4};   // from the outline's outer edge to the fill
  int32_t inner_w{0};  // the fill at 100 %
  int32_t gap{6};     // between the nub and the %
};

inline BatteryBox battery_box(int32_t width, const esphelm::battery::Rows &rows, int32_t percent_w) {
  BatteryBox b;
  b.gap = std::max<int32_t>(6, rows.line / 3);
  const int32_t avail = std::max<int32_t>(20, width - percent_w - b.gap);
  // At most a little over twice as wide as tall, and clear of the rows.
  b.h = std::max<int32_t>(12, std::min<int32_t>(rows.height - 4, avail * 45 / 100));
  b.nub_w = std::max<int32_t>(4, b.h / 8);
  b.nub_h = std::max<int32_t>(4, b.h * 40 / 100);
  b.w = avail - b.nub_w;
  b.y = rows.top + (rows.height - b.h) / 2;
  b.border = std::max<int32_t>(2, b.h / 14);
  b.inset = b.border + std::max<int32_t>(2, b.border / 2);
  b.inner_w = std::max<int32_t>(0, b.w - 2 * b.inset);
  return b;
}

/// The rows of a battery tile in `fonts` (full fonts only) for a w x h content box; `font` is set
/// to the rows' font.
inline esphelm::battery::Rows battery_rows(const Fonts &fonts, int32_t w, int32_t h, bool caption, bool power,
                                           bool status, bool solar, const lv_font_t *&font) {
  int lines[Fonts::MAX_LADDER];
  const lv_font_t *by_line[Fonts::MAX_LADDER];
  int n = 0;
  for (uint8_t i = 0; i < fonts.count; i++) {
    if (!fonts.digits[i]) {
      lines[n] = line_height(fonts.ladder[i]);
      by_line[n++] = fonts.ladder[i];
    }
  }
  const auto rows = esphelm::battery::rows(w, h, lines, n, caption, power, status, solar);
  font = fonts.small;
  for (int i = 0; i < n; i++) {
    if (lines[i] == rows.line)
      font = by_line[i];
  }
  return rows;
}

class BatteryValues {
 public:
  using Cfg = esphelm::BatteryConfig;

  void init(const esphelm::Tile &tile, const WidgetEnv &env, uint32_t now) {
    zones_ = tile.zones;
    soc_.b.item = tile.data;
    soc_.b.stale_ms = stale_ms(tile.data, env);
    soc_.b.last_value_ms = now;
    pct_suffix_ = tile.data.unit != nullptr ? tile.data.unit->label : "";
    if (tile.battery) {
      cfg_ = *tile.battery;
      for (int i = 0; i < Cfg::VALUES; i++) {
        if (!cfg_.has[i])
          continue;
        items_[i].b.item = cfg_.values[i];
        items_[i].b.stale_ms = stale_ms(cfg_.values[i], env);
        items_[i].b.last_value_ms = now;
      }
    }
    mode_stale_ms_ = env.default_stale_ms;
    compute_();
  }

  void paths(std::vector<std::string> &out) const {
    out.push_back(soc_.b.item.path);
    for (int i = 0; i < Cfg::VALUES; i++) {
      if (cfg_.has[i])
        out.push_back(cfg_.values[i].path);
    }
    if (!cfg_.mode_path.empty())
      out.push_back(cfg_.mode_path);
  }

  void on_value(const std::string &path, ArduinoJson::JsonVariantConst v, uint32_t now) {
    if (path == soc_.b.item.path)
      soc_.set(v, now);
    for (int i = 0; i < Cfg::VALUES; i++) {
      if (cfg_.has[i] && path == cfg_.values[i].path)
        items_[i].set(v, now);
    }
    if (!cfg_.mode_path.empty() && path == cfg_.mode_path) {
      // Raw, not printable(): mode_text() refuses what the fonts can't draw.
      std::string mode = v.is<const char *>() ? std::string(v.as<const char *>()).substr(0, 32) : std::string();
      mode_ms_ = now;
      mode_stale_ = false;
      if (mode != mode_) {
        mode_ = std::move(mode);
        mode_dirty_ = true;
      }
    }
  }

  /// True when the texts changed (throttled to DRAW_INTERVAL_MS) or a value went stale.
  bool due(uint32_t now) {
    bool any = false, stale;
    any |= soc_.b.due(now, stale);
    for (int i = 0; i < Cfg::VALUES; i++) {
      if (cfg_.has[i])
        any |= items_[i].b.due(now, stale);
    }
    if (mode_dirty_ && now - mode_draw_ms_ >= DRAW_INTERVAL_MS) {
      mode_dirty_ = false;
      mode_draw_ms_ = now;
      any = true;
    }
    if (!mode_.empty() && !mode_stale_ && now - mode_ms_ > mode_stale_ms_) {
      mode_stale_ = true;
      any = true;
    }
    if (any)
      compute_();
    return any;
  }

  bool has(int value) const { return cfg_.has[value]; }
  /// Rows the tile has (whether or not they fit).
  bool caption_row() const { return !soc_.b.item.label.empty() || cfg_.has[Cfg::VOLTAGE]; }
  bool power_row() const { return cfg_.has[Cfg::CURRENT] || shows_power(); }
  bool status_row() const { return cfg_.has[Cfg::CURRENT] || cfg_.has[Cfg::TIME] || !cfg_.mode_path.empty(); }
  bool solar_row() const { return cfg_.has[Cfg::SOLAR]; }
  /// A power value: its own path, or voltage times current.
  bool shows_power() const {
    return cfg_.has[Cfg::POWER] || (cfg_.has[Cfg::VOLTAGE] && cfg_.has[Cfg::CURRENT]);
  }
  const std::string &label() const { return soc_.b.item.label; }
  const std::string &solar_label() const { return solar_label_; }

  // What to show, after due() (or init()):
  bool live{false};      // the state of charge is fresh
  double fraction{0};    // 0..1, of the SignalK ratio
  std::string percent;   // "78%", "--"
  std::string voltage, current, power, status, solar;
  /// The state of charge's zone, when it is live and in one.
  bool zone(esphelm::ZoneState &out) const {
    return live && soc_.b.has_number && esphelm::value_zone_state(soc_.b.number, zones_, out);
  }

 private:
  struct Item {
    Binding b;
    bool has_si{false};
    double si{0};
    void set(ArduinoJson::JsonVariantConst v, uint32_t now) {
      b.set(v, now);
      has_si = !v.is<bool>() && v.is<double>() && std::isfinite(v.as<double>());
      si = has_si ? v.as<double>() : 0;
    }
    bool fresh() const { return !b.stale_shown && has_si; }
  };

  static std::string suffix(const esphelm::DataItem &item) {
    return item.unit != nullptr && item.unit->label[0] != '\0' ? std::string(" ") + item.unit->label : "";
  }
  /// A display-unit number with the charging sign: positive is charging.
  std::string signed_text(const Item &it, double sign) const {
    if (!it.fresh() || !it.b.has_number)
      return "--" + suffix(it.b.item);
    const int d = it.b.item.decimals >= 0 ? it.b.item.decimals : 1;
    double n = it.b.number * sign;
    if (std::fabs(n) < 0.5 * std::pow(10.0, -d))
      n = 0;  // no "-0.0"
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.*f", d, n);
    return buf + suffix(it.b.item);
  }

  void compute_() {
    const double sign = cfg_.invert_current ? -1 : 1;
    live = soc_.fresh();
    fraction = live ? std::clamp(soc_.si, 0.0, 1.0) : 0;
    percent = live ? soc_.b.text + pct_suffix_ : "--";
    const Item &v = items_[Cfg::VOLTAGE], &a = items_[Cfg::CURRENT];
    voltage = v.fresh() ? v.b.text + suffix(v.b.item) : "--" + suffix(v.b.item);
    current = signed_text(a, sign);
    if (cfg_.has[Cfg::POWER]) {
      power = signed_text(items_[Cfg::POWER], sign);
    } else if (v.fresh() && a.fresh()) {
      char buf[24];
      double w = v.si * a.si * sign;
      if (std::fabs(w) < 0.5)
        w = 0;
      std::snprintf(buf, sizeof(buf), "%.0f W", w);
      power = buf;
    } else {
      power = "-- W";
    }
    const Item &t = items_[Cfg::TIME];
    const bool mode = !mode_.empty() && !mode_stale_;
    char line[48];
    esphelm::battery::status(esphelm::battery::state(a.fresh(), a.si, cfg_.invert_current), t.fresh(), t.si,
                             mode ? mode_.c_str() : nullptr, line, sizeof(line));
    status = line;
    const Item &s = items_[Cfg::SOLAR];
    solar = s.fresh() ? s.b.text + suffix(s.b.item) : "--" + suffix(s.b.item);
    solar_label_ = cfg_.values[Cfg::SOLAR].label.empty() ? "Solar" : cfg_.values[Cfg::SOLAR].label;
  }

  Cfg cfg_;
  std::vector<esphelm::Zone> zones_;
  Item soc_;
  Item items_[Cfg::VALUES];
  std::string pct_suffix_, solar_label_{"Solar"};
  std::string mode_;
  uint32_t mode_ms_{0}, mode_draw_ms_{0}, mode_stale_ms_{0};
  bool mode_dirty_{false}, mode_stale_{true};
};

}  // namespace esphelm_runtime
}  // namespace esphome
