#include "layout_parser.h"

#include <cmath>
#include <cstring>
#include <limits>

// Mirrors packages/schema/src/validate.ts: structural checks first (dispatching on page `kind`
// and tile `type`, so each problem is reported once at the field that is wrong), then
// semantic checks only if the structure is valid. Error codes are the same string literals.

namespace esphelm {
namespace {

using ArduinoJson::JsonArrayConst;
using ArduinoJson::JsonObjectConst;
using ArduinoJson::JsonPairConst;
using ArduinoJson::JsonString;
using ArduinoJson::JsonVariantConst;

class Checker {
 public:
  explicit Checker(const ParserLimits &limits) : limits_(limits) {}

  std::vector<ParseError> errors;

  void add(const std::string &pointer, const char *code) {
    for (const auto &e : this->errors) {
      if (e.pointer == pointer && std::strcmp(e.code, code) == 0)
        return;
    }
    if (this->errors.size() < this->limits_.max_errors)
      this->errors.push_back(ParseError{pointer, code});
  }

  const ParserLimits &limits() const { return this->limits_; }

 private:
  const ParserLimits &limits_;
};

bool has(JsonObjectConst obj, const char *key) {
  for (JsonPairConst kv : obj) {
    if (std::strcmp(kv.key().c_str(), key) == 0)
      return true;
  }
  return false;
}

bool is_number(JsonVariantConst v) { return v.is<double>() && !v.is<bool>(); }

/// JSON Schema "integer": any number with no fractional part (2.0 counts).
bool as_integer(JsonVariantConst v, long long &out) {
  if (!is_number(v))
    return false;
  double d = v.as<double>();
  if (!std::isfinite(d) || std::floor(d) != d || std::fabs(d) > 9.0e15)
    return false;
  out = static_cast<long long>(d);
  return true;
}

// ---- Primitive patterns (hand-written; std::regex is too heavy for a microcontroller) ----

bool valid_id(const char *s, size_t n) {
  if (n == 0)
    return false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    bool alnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (!(alnum || (i > 0 && (c == '_' || c == '-'))))
      return false;
  }
  return true;
}

/// Printable ASCII plus U+00B0 (UTF-8 C2 B0): the glyphs compiled into the firmware fonts.
/// SignalK chart identifier: [A-Za-z0-9][A-Za-z0-9._-]* (it ends up in a URL path).
bool valid_chart_id(const char *s, size_t n) {
  if (n == 0)
    return false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    bool alnum = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    if (!(alnum || (i > 0 && (c == '.' || c == '_' || c == '-'))))
      return false;
  }
  return true;
}

bool valid_label(const char *s, size_t n) {
  for (size_t i = 0; i < n; i++) {
    auto c = static_cast<unsigned char>(s[i]);
    if (c >= 0x20 && c <= 0x7E)
      continue;
    if (c == 0xC2 && i + 1 < n && static_cast<unsigned char>(s[i + 1]) == 0xB0) {
      i++;
      continue;
    }
    return false;
  }
  return true;
}

/// Dot-separated segments of [A-Za-z0-9_-], no wildcards.
bool valid_path(const char *s, size_t n) {
  bool segment_empty = true;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (c == '.') {
      if (segment_empty)
        return false;
      segment_empty = true;
      continue;
    }
    bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    if (!ok)
      return false;
    segment_empty = false;
  }
  return !segment_empty;
}

enum class StrKind { PLAIN, ID, LABEL, PATH, CHART_ID };

/// Optional/required string field. Returns true and sets `out` only if present and valid.
bool string_field(Checker &chk, JsonObjectConst obj, const std::string &ptr, const char *key, bool required,
                  StrKind kind, std::string &out) {
  const std::string fp = ptr + "/" + key;
  if (!has(obj, key)) {
    if (required)
      chk.add(fp, "MISSING_FIELD");
    return false;
  }
  JsonVariantConst v = obj[key];
  if (!v.is<JsonString>()) {
    chk.add(fp, "INVALID_TYPE");
    return false;
  }
  JsonString s = v.as<JsonString>();
  bool ok = true;
  switch (kind) {
    case StrKind::ID:
      ok = valid_id(s.c_str(), s.size());
      if (!ok)
        chk.add(fp, "INVALID_ID");
      break;
    case StrKind::LABEL:
      ok = valid_label(s.c_str(), s.size());
      if (!ok)
        chk.add(fp, "INVALID_LABEL");
      break;
    case StrKind::PATH:
      ok = valid_path(s.c_str(), s.size());
      if (!ok)
        chk.add(fp, "INVALID_PATH");
      break;
    case StrKind::CHART_ID:
      ok = valid_chart_id(s.c_str(), s.size());
      if (!ok)
        chk.add(fp, "INVALID_ID");
      break;
    case StrKind::PLAIN:
      break;
  }
  if (!ok)
    return false;
  if (s.size() > chk.limits().max_string) {
    chk.add(fp, "CAPACITY_EXCEEDED");
    return false;
  }
  out.assign(s.c_str(), s.size());
  return true;
}

/// Integer field with a minimum (and optional maximum).
bool int_field(Checker &chk, JsonObjectConst obj, const std::string &ptr, const char *key, bool required,
               long long min, long long max, long long &out) {
  const std::string fp = ptr + "/" + key;
  if (!has(obj, key)) {
    if (required)
      chk.add(fp, "MISSING_FIELD");
    return false;
  }
  if (!as_integer(obj[key], out)) {
    chk.add(fp, "INVALID_TYPE");
    return false;
  }
  if (out < min || out > max) {
    chk.add(fp, "OUT_OF_RANGE");
    return false;
  }
  return true;
}

bool number_field(Checker &chk, JsonObjectConst obj, const std::string &ptr, const char *key, bool required,
                  double &out) {
  const std::string fp = ptr + "/" + key;
  if (!has(obj, key)) {
    if (required)
      chk.add(fp, "MISSING_FIELD");
    return false;
  }
  if (!is_number(obj[key])) {
    chk.add(fp, "INVALID_TYPE");
    return false;
  }
  out = obj[key].as<double>();
  return true;
}

/// A union of string literals (theme, zone state, orientation). Returns the index or -1.
int enum_field(Checker &chk, JsonObjectConst obj, const std::string &ptr, const char *key, bool required,
               const char *const *values, int count) {
  const std::string fp = ptr + "/" + key;
  if (!has(obj, key)) {
    if (required)
      chk.add(fp, "MISSING_FIELD");
    return -1;
  }
  JsonVariantConst v = obj[key];
  if (!v.is<const char *>()) {
    // Ajv reports the per-branch type failure and the anyOf failure.
    chk.add(fp, "INVALID_TYPE");
    chk.add(fp, "INVALID_VALUE");
    return -1;
  }
  const char *s = v.as<const char *>();
  for (int i = 0; i < count; i++) {
    if (std::strcmp(s, values[i]) == 0)
      return i;
  }
  chk.add(fp, "INVALID_VALUE");
  return -1;
}

void data_item_fields(Checker &chk, JsonObjectConst obj, const std::string &ptr, DataItem &item) {
  string_field(chk, obj, ptr, "path", true, StrKind::PATH, item.path);
  if (has(obj, "unit")) {
    JsonVariantConst v = obj["unit"];
    const std::string fp = ptr + "/unit";
    if (!v.is<const char *>()) {
      // Like Ajv: the type failure plus the enum failure (which carries UNKNOWN_UNIT).
      chk.add(fp, "INVALID_TYPE");
      chk.add(fp, "UNKNOWN_UNIT");
    } else {
      item.unit = units::find_unit(v.as<const char *>());
      if (item.unit == nullptr)
        chk.add(fp, "UNKNOWN_UNIT");
    }
  }
  long long decimals;
  if (int_field(chk, obj, ptr, "decimals", false, 0, 6, decimals))
    item.decimals = static_cast<int8_t>(decimals);
  string_field(chk, obj, ptr, "label", false, StrKind::LABEL, item.label);
  double stale;
  if (number_field(chk, obj, ptr, "staleAfter", false, stale)) {
    if (!(stale > 0))
      chk.add(ptr + "/staleAfter", "OUT_OF_RANGE");
    else
      item.stale_after = static_cast<float>(stale);
  }
}

const char *const ZONE_STATES[] = {"normal", "warn", "alarm", "emergency"};
const char *const ORIENTATIONS[] = {"horizontal", "vertical"};
const char *const THEMES[] = {"day", "night"};
// Same order as position::Format.
const char *const POSITION_FORMATS[] = {"ddm", "dms", "dd", "decimal"};
const char *const VALUE_COLORS[] = {"blue", "green", "yellow", "orange", "red", "purple"};
const char *const SLOT_NAMES[RoseConfig::MAX_SLOTS] = {"center1",  "center2",  "center3",   "topLeft",
                                                       "topRight", "bottomLeft", "bottomRight"};

void check_wind_rose(Checker &chk, JsonObjectConst obj, const std::string &ptr, RoseConfig &rose) {
  if (has(obj, "config")) {
    JsonVariantConst config = obj["config"];
    const std::string cp = ptr + "/config";
    if (!config.is<JsonObjectConst>()) {
      chk.add(cp, "INVALID_TYPE");
    } else {
      JsonObjectConst c = config.as<JsonObjectConst>();
      string_field(chk, c, cp, "apparentAngle", false, StrKind::PATH, rose.apparent_angle);
      string_field(chk, c, cp, "trueDirection", false, StrKind::PATH, rose.true_direction);
      string_field(chk, c, cp, "heading", false, StrKind::PATH, rose.heading);
      if (has(c, "showTrueWind")) {
        if (!c["showTrueWind"].is<bool>())
          chk.add(cp + "/showTrueWind", "INVALID_TYPE");
        else
          rose.show_true_wind = c["showTrueWind"].as<bool>();
      }
    }
  }
  const std::string sp = ptr + "/slots";
  if (!has(obj, "slots")) {
    chk.add(sp, "MISSING_FIELD");
    return;
  }
  if (!obj["slots"].is<JsonObjectConst>()) {
    chk.add(sp, "INVALID_TYPE");
    return;
  }
  for (JsonPairConst kv : obj["slots"].as<JsonObjectConst>()) {
    int slot = -1;
    for (int i = 0; i < RoseConfig::MAX_SLOTS; i++) {
      if (std::strcmp(kv.key().c_str(), SLOT_NAMES[i]) == 0)
        slot = i;
    }
    const std::string kp = sp + "/" + kv.key().c_str();
    // Slot names are part of the widget's contract, so unknown ones are reported (not ignored).
    if (slot < 0) {
      chk.add(kp, "UNKNOWN_SLOT");
      continue;
    }
    if (!kv.value().is<JsonObjectConst>()) {
      chk.add(kp, "INVALID_TYPE");
      continue;
    }
    data_item_fields(chk, kv.value().as<JsonObjectConst>(), kp, rose.slots[slot]);
    rose.has_slot[slot] = true;
  }
}

const char *const AUTOPILOT_MODES[] = {"auto", "wind", "route"};

void check_autopilot(Checker &chk, JsonObjectConst obj, const std::string &ptr, AutopilotConfig &ap) {
  if (has(obj, "modes")) {
    const std::string mp = ptr + "/modes";
    JsonVariantConst modes = obj["modes"];
    if (!modes.is<JsonArrayConst>()) {
      chk.add(mp, "INVALID_TYPE");
    } else {
      ap.modes.clear();
      std::vector<std::string> seen;
      bool duplicate = false;
      size_t k = 0;
      for (JsonVariantConst m : modes.as<JsonArrayConst>()) {
        const std::string ip = mp + "/" + std::to_string(k++);
        // uniqueItems compares whole values, whatever their type.
        std::string text;
        serializeJson(m, text);
        for (const auto &t : seen)
          duplicate = duplicate || t == text;
        seen.push_back(text);
        if (!m.is<const char *>()) {
          // Ajv reports the per-branch type failure and the anyOf failure.
          chk.add(ip, "INVALID_TYPE");
          chk.add(ip, "INVALID_VALUE");
          continue;
        }
        int found = -1;
        for (int i = 0; i < 3; i++) {
          if (std::strcmp(m.as<const char *>(), AUTOPILOT_MODES[i]) == 0)
            found = i;
        }
        if (found < 0)
          chk.add(ip, "INVALID_VALUE");
        else
          ap.modes.push_back(static_cast<AutopilotMode>(found));
      }
      if (duplicate)
        chk.add(mp, "INVALID_VALUE");
    }
  }
  if (has(obj, "config")) {
    JsonVariantConst config = obj["config"];
    const std::string cp = ptr + "/config";
    if (!config.is<JsonObjectConst>()) {
      chk.add(cp, "INVALID_TYPE");
    } else {
      JsonObjectConst c = config.as<JsonObjectConst>();
      string_field(chk, c, cp, "statePath", false, StrKind::PATH, ap.state_path);
      string_field(chk, c, cp, "targetPath", false, StrKind::PATH, ap.target_path);
      string_field(chk, c, cp, "adjustPath", false, StrKind::PATH, ap.adjust_path);
      string_field(chk, c, cp, "headingPath", false, StrKind::PATH, ap.heading_path);
    }
  }
}

void check_tile(Checker &chk, JsonObjectConst obj, const std::string &ptr, Tile &tile) {
  JsonVariantConst type = obj["type"];
  const char *t = type.is<const char *>() ? type.as<const char *>() : nullptr;
  if (t != nullptr && std::strcmp(t, "value") == 0) {
    tile.type = TileType::VALUE;
  } else if (t != nullptr && std::strcmp(t, "gauge") == 0) {
    tile.type = TileType::GAUGE;
  } else if (t != nullptr && std::strcmp(t, "bar") == 0) {
    tile.type = TileType::BAR;
  } else if (t != nullptr && std::strcmp(t, "switch") == 0) {
    tile.type = TileType::SWITCH;
  } else if (t != nullptr && std::strcmp(t, "wind_rose") == 0) {
    tile.type = TileType::WIND_ROSE;
  } else if (t != nullptr && std::strcmp(t, "autopilot") == 0) {
    tile.type = TileType::AUTOPILOT;
  } else if (t != nullptr && std::strcmp(t, "position") == 0) {
    tile.type = TileType::POSITION;
  } else {
    chk.add(ptr + "/type", "UNKNOWN_TILE_TYPE");
    return;
  }

  string_field(chk, obj, ptr, "id", true, StrKind::ID, tile.id);
  long long v;
  const long long big = 0xFFFF;
  if (int_field(chk, obj, ptr, "x", true, 0, big, v))
    tile.x = static_cast<uint16_t>(v);
  if (int_field(chk, obj, ptr, "y", true, 0, big, v))
    tile.y = static_cast<uint16_t>(v);
  if (int_field(chk, obj, ptr, "w", true, 1, big, v))
    tile.w = static_cast<uint16_t>(v);
  if (int_field(chk, obj, ptr, "h", true, 1, big, v))
    tile.h = static_cast<uint16_t>(v);

  if (tile.type == TileType::AUTOPILOT) {
    string_field(chk, obj, ptr, "label", false, StrKind::LABEL, tile.data.label);
    auto ap = std::make_shared<AutopilotConfig>();
    check_autopilot(chk, obj, ptr, *ap);
    tile.autopilot = std::move(ap);
    return;
  }
  if (tile.type == TileType::WIND_ROSE) {
    auto rose = std::make_shared<RoseConfig>();
    check_wind_rose(chk, obj, ptr, *rose);
    tile.rose = std::move(rose);
    return;
  }
  if (tile.type == TileType::POSITION) {
    tile.data.path = "navigation.position";
    string_field(chk, obj, ptr, "path", false, StrKind::PATH, tile.data.path);
    string_field(chk, obj, ptr, "label", false, StrKind::LABEL, tile.data.label);
    int f = enum_field(chk, obj, ptr, "format", false, POSITION_FORMATS, 4);
    if (f >= 0)
      tile.position_format = static_cast<position::Format>(f);
    long long d;
    if (int_field(chk, obj, ptr, "decimals", false, 0, 6, d))
      tile.data.decimals = static_cast<int8_t>(d);
    double stale;
    if (number_field(chk, obj, ptr, "staleAfter", false, stale)) {
      if (!(stale > 0))
        chk.add(ptr + "/staleAfter", "OUT_OF_RANGE");
      else
        tile.data.stale_after = static_cast<float>(stale);
    }
    return;
  }
  if (tile.type == TileType::SWITCH) {
    string_field(chk, obj, ptr, "path", true, StrKind::PATH, tile.data.path);
    string_field(chk, obj, ptr, "label", false, StrKind::LABEL, tile.data.label);
    return;
  }
  data_item_fields(chk, obj, ptr, tile.data);
  const bool value = tile.type == TileType::VALUE;
  if (value) {
    int c = enum_field(chk, obj, ptr, "color", false, VALUE_COLORS, 6);
    if (c >= 0)
      tile.color = static_cast<ValueColor>(c);
  } else {
    number_field(chk, obj, ptr, "min", true, tile.min);
    number_field(chk, obj, ptr, "max", true, tile.max);
  }
  if (has(obj, "zones")) {
    JsonVariantConst zones = obj["zones"];
    if (!zones.is<JsonArrayConst>()) {
      chk.add(ptr + "/zones", "INVALID_TYPE");
    } else {
      size_t k = 0;
      for (JsonVariantConst z : zones.as<JsonArrayConst>()) {
        const std::string zp = ptr + "/zones/" + std::to_string(k++);
        if (!z.is<JsonObjectConst>()) {
          chk.add(zp, "INVALID_TYPE");
          continue;
        }
        JsonObjectConst zo = z.as<JsonObjectConst>();
        // Value tiles have no min/max, so either end may be open.
        Zone zone{-std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity(),
                  ZoneState::NORMAL};
        number_field(chk, zo, zp, "from", !value, zone.from);
        number_field(chk, zo, zp, "to", !value, zone.to);
        int state = enum_field(chk, zo, zp, "state", true, ZONE_STATES, 4);
        if (state >= 0)
          zone.state = static_cast<ZoneState>(state);
        tile.zones.push_back(zone);
      }
    }
  }
  if (tile.type == TileType::BAR) {
    int o = enum_field(chk, obj, ptr, "orientation", false, ORIENTATIONS, 2);
    if (o >= 0)
      tile.orientation = static_cast<Orientation>(o);
  }
}

void check_chart_page(Checker &chk, JsonObjectConst obj, const std::string &ptr, Page &page) {
  page.kind = PageKind::CHART;
  string_field(chk, obj, ptr, "id", true, StrKind::ID, page.id);
  string_field(chk, obj, ptr, "title", false, StrKind::LABEL, page.title);
  auto chart = std::make_shared<ChartConfig>();
  string_field(chk, obj, ptr, "chart", true, StrKind::CHART_ID, chart->chart);
  long long zoom;
  if (has(obj, "zoom") && int_field(chk, obj, ptr, "zoom", false, 1, 20, zoom))
    chart->zoom = static_cast<int>(zoom);
  if (has(obj, "anchor")) {
    if (!obj["anchor"].is<bool>())
      chk.add(ptr + "/anchor", "INVALID_TYPE");
    else
      chart->anchor = obj["anchor"].as<bool>();
  }
  if (has(obj, "config")) {
    JsonVariantConst config = obj["config"];
    const std::string cp = ptr + "/config";
    if (!config.is<JsonObjectConst>()) {
      chk.add(cp, "INVALID_TYPE");
    } else {
      JsonObjectConst c = config.as<JsonObjectConst>();
      string_field(chk, c, cp, "positionPath", false, StrKind::PATH, chart->position_path);
      string_field(chk, c, cp, "headingPath", false, StrKind::PATH, chart->heading_path);
      string_field(chk, c, cp, "anchorPositionPath", false, StrKind::PATH, chart->anchor_position_path);
      string_field(chk, c, cp, "anchorRadiusPath", false, StrKind::PATH, chart->anchor_radius_path);
      string_field(chk, c, cp, "anchorAlarmPath", false, StrKind::PATH, chart->anchor_alarm_path);
    }
  }
  page.chart = std::move(chart);
}

void check_grid_page(Checker &chk, JsonObjectConst obj, const std::string &ptr, Page &page) {
  string_field(chk, obj, ptr, "id", true, StrKind::ID, page.id);
  string_field(chk, obj, ptr, "title", false, StrKind::LABEL, page.title);
  if (!has(obj, "grid")) {
    chk.add(ptr + "/grid", "MISSING_FIELD");
  } else if (!obj["grid"].is<JsonObjectConst>()) {
    chk.add(ptr + "/grid", "INVALID_TYPE");
  } else {
    JsonObjectConst grid = obj["grid"].as<JsonObjectConst>();
    long long v;
    if (int_field(chk, grid, ptr + "/grid", "cols", true, 1, 0xFFFF, v))
      page.cols = static_cast<uint16_t>(v);
    if (int_field(chk, grid, ptr + "/grid", "rows", true, 1, 0xFFFF, v))
      page.rows = static_cast<uint16_t>(v);
  }
  if (!has(obj, "tiles")) {
    chk.add(ptr + "/tiles", "MISSING_FIELD");
    return;
  }
  JsonVariantConst tiles = obj["tiles"];
  if (!tiles.is<JsonArrayConst>()) {
    chk.add(ptr + "/tiles", "INVALID_TYPE");
    return;
  }
  JsonArrayConst arr = tiles.as<JsonArrayConst>();
  if (arr.size() == 0)
    chk.add(ptr + "/tiles", "EMPTY_PAGE");
  size_t j = 0;
  for (JsonVariantConst t : arr) {
    const std::string tp = ptr + "/tiles/" + std::to_string(j++);
    if (!t.is<JsonObjectConst>()) {
      chk.add(tp, "INVALID_TYPE");
      continue;
    }
    Tile tile{};
    check_tile(chk, t.as<JsonObjectConst>(), tp, tile);
    page.tiles.push_back(std::move(tile));
  }
}

const char *const AUTO_THEMES[] = {"off", "sun"};

void check_settings(Checker &chk, JsonVariantConst v, Settings &settings) {
  const std::string sp = "/settings";
  if (!v.is<JsonObjectConst>()) {
    chk.add(sp, "INVALID_TYPE");
    return;
  }
  JsonObjectConst obj = v.as<JsonObjectConst>();
  long long n;
  if (has(obj, "brightness")) {
    const std::string bp = sp + "/brightness";
    if (!obj["brightness"].is<JsonObjectConst>()) {
      chk.add(bp, "INVALID_TYPE");
    } else {
      JsonObjectConst b = obj["brightness"].as<JsonObjectConst>();
      if (int_field(chk, b, bp, "day", false, 5, 100, n))
        settings.brightness_day = static_cast<uint8_t>(n);
      if (int_field(chk, b, bp, "night", false, 1, 100, n))
        settings.brightness_night = static_cast<uint8_t>(n);
    }
  }
  string_field(chk, obj, sp, "startPage", false, StrKind::ID, settings.start_page);
  int auto_theme = enum_field(chk, obj, sp, "autoTheme", false, AUTO_THEMES, 2);
  if (auto_theme >= 0)
    settings.auto_theme = static_cast<AutoTheme>(auto_theme);
  string_field(chk, obj, sp, "autoThemePath", false, StrKind::PATH, settings.auto_theme_path);
  if (int_field(chk, obj, sp, "screenTimeout", false, 0, 3600, n))
    settings.screen_timeout = static_cast<uint16_t>(n);
}

void check_structure(Checker &chk, JsonVariantConst root, Layout &layout) {
  if (!root.is<JsonObjectConst>()) {
    chk.add("", "INVALID_TYPE");
    return;
  }
  JsonObjectConst obj = root.as<JsonObjectConst>();
  // Check the major first: other majors may be shaped differently, so stop there.
  if (has(obj, "version") && !(is_number(obj["version"]) && obj["version"].as<double>() == 1.0)) {
    chk.add("/version", "UNSUPPORTED_VERSION");
    return;
  }
  if (!has(obj, "version"))
    chk.add("/version", "MISSING_FIELD");
  string_field(chk, obj, "", "id", true, StrKind::ID, layout.id);
  string_field(chk, obj, "", "name", false, StrKind::LABEL, layout.name);
  int theme = enum_field(chk, obj, "", "theme", true, THEMES, 2);
  if (theme >= 0)
    layout.theme = static_cast<Theme>(theme);
  if (has(obj, "settings"))
    check_settings(chk, obj["settings"], layout.settings);

  if (!has(obj, "pages")) {
    chk.add("/pages", "MISSING_FIELD");
    return;
  }
  if (!obj["pages"].is<JsonArrayConst>()) {
    chk.add("/pages", "INVALID_TYPE");
    return;
  }
  JsonArrayConst pages = obj["pages"].as<JsonArrayConst>();
  if (pages.size() == 0)
    chk.add("/pages", "NO_PAGES");
  size_t i = 0;
  for (JsonVariantConst p : pages) {
    const std::string pp = "/pages/" + std::to_string(i++);
    if (!p.is<JsonObjectConst>()) {
      chk.add(pp, "INVALID_TYPE");
      continue;
    }
    JsonObjectConst po = p.as<JsonObjectConst>();
    JsonVariantConst kind = po["kind"];
    Page page{};
    if (kind.is<const char *>() && std::strcmp(kind.as<const char *>(), "grid") == 0) {
      check_grid_page(chk, po, pp, page);
    } else if (kind.is<const char *>() && std::strcmp(kind.as<const char *>(), "chart") == 0) {
      check_chart_page(chk, po, pp, page);
    } else {
      chk.add(pp + "/kind", "UNKNOWN_PAGE_KIND");
      continue;
    }
    layout.pages.push_back(std::move(page));
  }
}

void check_semantics(Checker &chk, const Layout &layout) {
  std::vector<std::string> ids;
  auto claim = [&](const std::string &id, const std::string &pointer) {
    for (const auto &seen : ids) {
      if (seen == id) {
        chk.add(pointer, "DUPLICATE_ID");
        return;
      }
    }
    ids.push_back(id);
  };

  for (size_t i = 0; i < layout.pages.size(); i++) {
    const Page &page = layout.pages[i];
    const std::string pp = "/pages/" + std::to_string(i);
    claim(page.id, pp + "/id");
    if (page.kind != PageKind::GRID)
      continue;
    std::vector<size_t> placed;
    for (size_t j = 0; j < page.tiles.size(); j++) {
      const Tile &t = page.tiles[j];
      const std::string tp = pp + "/tiles/" + std::to_string(j);
      claim(t.id, tp + "/id");
      if (t.x + t.w > page.cols || t.y + t.h > page.rows) {
        chk.add(tp, "TILE_OUT_OF_GRID");
      } else {
        for (size_t k : placed) {
          const Tile &o = page.tiles[k];
          if (t.x < o.x + o.w && o.x < t.x + t.w && t.y < o.y + o.h && o.y < t.y + t.h) {
            chk.add(tp, "TILE_OVERLAP");
            break;
          }
        }
        placed.push_back(j);
      }
      if (t.type == TileType::VALUE) {
        for (size_t k = 0; k < t.zones.size(); k++) {
          const Zone &z = t.zones[k];
          // Missing ends are infinite: both infinite means neither was given.
          if ((std::isinf(z.from) && std::isinf(z.to)) || !(z.from < z.to))
            chk.add(tp + "/zones/" + std::to_string(k), "INVALID_ZONE");
        }
      }
      if (t.type == TileType::GAUGE || t.type == TileType::BAR) {
        if (!(t.min < t.max)) {
          chk.add(tp + "/max", "INVALID_RANGE");
          continue;
        }
        for (size_t k = 0; k < t.zones.size(); k++) {
          const Zone &z = t.zones[k];
          const std::string zp = tp + "/zones/" + std::to_string(k);
          if (!(z.from < z.to)) {
            chk.add(zp, "INVALID_ZONE");
          } else if (z.from < t.min || z.to > t.max) {
            chk.add(zp, "ZONE_OUT_OF_RANGE");
          }
        }
      }
    }
  }
  if (!layout.settings.start_page.empty()) {
    bool found = false;
    for (const Page &page : layout.pages)
      found = found || page.id == layout.settings.start_page;
    if (!found)
      chk.add("/settings/startPage", "UNKNOWN_PAGE");
  }
}

}  // namespace

ParseResult parse_layout(const char *data, size_t len, const ParserLimits &limits,
                         ArduinoJson::Allocator *allocator) {
  ParseResult result;
  Checker chk(limits);
  if (len > limits.max_bytes) {
    result.errors.push_back(ParseError{"", "CAPACITY_EXCEEDED"});
    return result;
  }
  {
    ArduinoJson::JsonDocument doc(allocator != nullptr ? allocator : ArduinoJson::detail::DefaultAllocator::instance());
    ArduinoJson::DeserializationError err =
        ArduinoJson::deserializeJson(doc, data, len, ArduinoJson::DeserializationOption::NestingLimit(limits.max_nesting));
    if (err == ArduinoJson::DeserializationError::TooDeep || err == ArduinoJson::DeserializationError::NoMemory) {
      result.errors.push_back(ParseError{"", "CAPACITY_EXCEEDED"});
      return result;
    }
    if (err) {
      result.errors.push_back(ParseError{"", "INVALID_JSON"});
      return result;
    }
    check_structure(chk, doc.as<JsonVariantConst>(), result.layout);
  }  // the JsonDocument is freed here; the model holds its own copies
  if (chk.errors.empty())
    check_semantics(chk, result.layout);
  result.errors = std::move(chk.errors);
  result.ok = result.errors.empty();
  if (!result.ok)
    result.layout = Layout{};
  return result;
}

}  // namespace esphelm
