#pragma once
// Alarms panel text (ADR-0038). Mirrors packages/schema/src/alarms.ts;
// packages/schema/fixtures/alarms.cases.json proves they agree. No ESPHome or LVGL dependencies.

#include <cstdint>
#include <cstdio>
#include <cstring>

namespace esphelm {
namespace alarm_age {

/// How long an alarm has been in its state into `out` (at least 12 bytes): "now", "12 min",
/// "3 h 05", "2 d".
inline void format(uint32_t seconds, char *out, size_t n) {
  const uint32_t m = seconds / 60;
  if (seconds < 60)
    std::snprintf(out, n, "now");
  else if (m < 60)
    std::snprintf(out, n, "%u min", (unsigned) m);
  else if (m / 60 < 24)
    std::snprintf(out, n, "%u h %02u", (unsigned) (m / 60), (unsigned) (m % 60));
  else
    std::snprintf(out, n, "%u d", (unsigned) (m / 60 / 24));
}

/// Whether `path` is `prefix` or under it, by whole segments.
inline bool under_prefix(const char *path, const char *prefix) {
  const size_t p = std::strlen(prefix);
  return std::strncmp(path, prefix, p) == 0 && (path[p] == '\0' || path[p] == '.');
}

}  // namespace alarm_age
}  // namespace esphelm
