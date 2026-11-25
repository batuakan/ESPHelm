#pragma once
// Battery tile text and rows (ADR-0046). Mirrors packages/schema/src/battery.ts;
// packages/schema/fixtures/battery.cases.json proves they agree. No ESPHome or LVGL dependencies.

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <strings.h>

#include "esphelm_sizes.h"

namespace esphelm {
namespace battery {

/// Below this many amperes either way the battery is idle (BATTERY_IDLE_CURRENT).
inline constexpr double IDLE_CURRENT = 0.1;
/// Longer than 99 days is not shown (BATTERY_MAX_TIME_LEFT).
inline constexpr double MAX_TIME_LEFT = 99.0 * 86400.0;

enum class State : int8_t { UNKNOWN = -1, CHARGING, DISCHARGING, IDLE };

/// Time until empty into `out` (at least 16 bytes): "< 1 min", "45 min", "3 h 05", "2 d 4 h";
/// "" when `has` is false, negative or over 99 days.
inline void time_left(bool has, double seconds, char *out, size_t n) {
  out[0] = '\0';
  if (!has || !(seconds >= 0) || seconds > MAX_TIME_LEFT)
    return;
  const uint32_t s = static_cast<uint32_t>(seconds);
  const uint32_t m = s / 60, h = m / 60;
  if (s < 60)
    std::snprintf(out, n, "< 1 min");
  else if (m < 60)
    std::snprintf(out, n, "%u min", (unsigned) m);
  else if (h < 24)
    std::snprintf(out, n, "%u h %02u", (unsigned) h, (unsigned) (m % 60));
  else
    std::snprintf(out, n, "%u d %u h", (unsigned) (h / 24), (unsigned) (h % 24));
}

/// Charging, discharging or idle from the current in amperes (positive charges unless `invert`).
inline State state(bool has, double current, bool invert) {
  if (!has || !(current == current))
    return State::UNKNOWN;
  const double c = invert ? -current : current;
  if (c > IDLE_CURRENT)
    return State::CHARGING;
  if (c < -IDLE_CURRENT)
    return State::DISCHARGING;
  return State::IDLE;
}

/// A charger's mode for the display into `out` (at least 24 bytes): "bulk" or "charging bulk" is
/// "Bulk"; "" for null, "unknown", "other", over 20 characters or not printable ASCII.
inline void mode_text(const char *mode, char *out, size_t n) {
  out[0] = '\0';
  if (mode == nullptr || n < 2)
    return;
  const char *b = mode;
  const char *e = mode + std::strlen(mode);
  while (b < e && std::isspace(static_cast<unsigned char>(*b)))
    b++;
  while (e > b && std::isspace(static_cast<unsigned char>(e[-1])))
    e--;
  if (e - b >= 9 && strncasecmp(b, "charging ", 9) == 0) {
    b += 9;
    while (b < e && std::isspace(static_cast<unsigned char>(*b)))
      b++;
  }
  const size_t len = static_cast<size_t>(e - b);
  if (len == 0 || len > 20 || len + 1 > n)
    return;
  for (const char *p = b; p < e; p++) {
    const auto c = static_cast<unsigned char>(*p);
    if (c < 0x20 || c > 0x7E)
      return;
  }
  if ((len == 7 && strncasecmp(b, "unknown", 7) == 0) || (len == 5 && strncasecmp(b, "other", 5) == 0))
    return;
  std::memcpy(out, b, len);
  out[len] = '\0';
  out[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(out[0])));
}

/// The tile's state line into `out` (at least 40 bytes): "Charging: Bulk" or "Charging"; "14 h 20
/// left" or "Discharging"; the mode or "Idle"; without a current, the time left or the mode.
inline void status(State st, bool has_seconds, double seconds, const char *mode, char *out, size_t n) {
  char m[24], t[16];
  mode_text(mode, m, sizeof(m));
  time_left(has_seconds, seconds, t, sizeof(t));
  switch (st) {
    case State::CHARGING:
      if (m[0] != '\0')
        std::snprintf(out, n, "Charging: %s", m);
      else
        std::snprintf(out, n, "Charging");
      break;
    case State::DISCHARGING:
      if (t[0] != '\0')
        std::snprintf(out, n, "%s left", t);
      else
        std::snprintf(out, n, "Discharging");
      break;
    case State::IDLE:
      std::snprintf(out, n, "%s", m[0] != '\0' ? m : "Idle");
      break;
    default:
      if (t[0] != '\0')
        std::snprintf(out, n, "%s left", t);
      else
        std::snprintf(out, n, "%s", m);
      break;
  }
}

/// Which rows a battery tile shows (batteryRows() in battery.ts), in device pixels.
struct Rows {
  int line{0};
  bool caption{false}, power{false}, status{false}, solar{false};
  int top{0}, height{0};
};

/// Rows for a `width` x `height` content box, with the full fonts' line heights `ladder` (`count`
/// of them, any order) and the rows the tile has.
inline Rows rows(int width, int height, const int *ladder, int count, bool caption, bool power, bool status,
                 bool solar) {
  Rows r;
  int smallest = 0;
  for (int i = 0; i < count; i++) {
    if (smallest == 0 || ladder[i] < smallest)
      smallest = ladder[i];
  }
  r.line = smallest;
  for (int i = 0; i < count; i++) {
    const int l = ladder[i];
    if (l > r.line && l * 100 <= height * sizes::BATTERY_LINE_PERCENT && l * sizes::BATTERY_LINE_WIDTHS <= width)
      r.line = l;
  }
  r.caption = caption;
  r.power = power;
  r.status = status;
  r.solar = solar;
  bool *order[4] = {&r.solar, &r.status, &r.power, &r.caption};
  auto kept = [&]() { return (int) r.caption + (int) r.power + (int) r.status + (int) r.solar; };
  for (bool *row : order) {
    if (height - kept() * r.line >= sizes::BATTERY_MIN_BODY)
      break;
    *row = false;
  }
  r.top = r.caption ? r.line : 0;
  r.height = height - kept() * r.line;
  return r;
}

}  // namespace battery
}  // namespace esphelm
