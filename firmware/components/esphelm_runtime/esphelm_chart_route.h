#pragma once
// The active route on a chart tile (ADR-0037). Mirrors packages/schema/src/chartRoute.ts;
// packages/schema/fixtures/chart-route.cases.json proves they agree. No ESPHome or LVGL
// dependencies, so the host test builds it with g++.

#include <cmath>
#include <cstddef>
#include <cstring>

namespace esphelm {
namespace chart_route {

/// Most points the plugin sends for a route (MAX_ROUTE_POINTS); more is refused.
inline constexpr size_t MAX_POINTS = 500;
/// Longest route id (ROUTE_ID_PATTERN), so `out` needs MAX_ID + 1 bytes.
inline constexpr size_t MAX_ID = 128;

/// The route id in `navigation.course.activeRoute.href` ("/resources/routes/<id>") into `out`
/// (MAX_ID + 1 bytes); false when it isn't one.
inline bool route_id(const char *href, char *out) {
  static const char PREFIX[] = "/resources/routes/";
  const size_t p = sizeof(PREFIX) - 1;
  if (href == nullptr || std::strncmp(href, PREFIX, p) != 0)
    return false;
  const char *id = href + p;
  const size_t n = std::strlen(id);
  if (n == 0 || n > MAX_ID)
    return false;
  for (size_t i = 0; i < n; i++) {
    const char c = id[i];
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' ||
                    c == '_' || c == ':' || c == '-';
    if (!ok)
      return false;
  }
  std::memcpy(out, id, n + 1);
  return true;
}

struct EdgeArrow {
  bool on_screen;
  double x, y;   // from the view's top left
  double angle;  // vessel to waypoint, radians clockwise from up
};

/// The next-waypoint marker for a waypoint dx, dy pixels from the vessel in the middle of a
/// w x h view: on screen, or an arrow `inset` pixels inside the edge on the line to it.
inline EdgeArrow edge_arrow(double dx, double dy, double w, double h, double inset) {
  const double hw = std::fmax(0.0, w / 2 - inset), hh = std::fmax(0.0, h / 2 - inset);
  const double angle = std::atan2(dx, -dy);
  if (std::fabs(dx) <= hw && std::fabs(dy) <= hh)
    return {true, w / 2 + dx, h / 2 + dy, angle};
  const double tx = dx != 0 ? hw / std::fabs(dx) : INFINITY;
  const double ty = dy != 0 ? hh / std::fabs(dy) : INFINITY;
  const double t = std::fmin(tx, ty);
  return {false, w / 2 + dx * t, h / 2 + dy * t, angle};
}

}  // namespace chart_route
}  // namespace esphelm
