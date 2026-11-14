# ADR-0037: The active route and next waypoint on the chart tile

Status: **Accepted** (2026-11-14)

## Context
- **Where is the boat going?** The chart tile (ADR-0030) shows the map, the vessel and the anchor watch. When a route or a waypoint is active in SignalK (Freeboard-SK, a plotter on NMEA), the chart doesn't show it.
- **What SignalK gives** (checked in signalk-server 2.37, `api/course`):
  - `navigation.course.activeRoute`: `{href: "/resources/routes/<id>", name, pointIndex, pointTotal, reverse}`, or null. It is sent again when the point advances or the route is reversed.
  - `navigation.course.nextPoint` and `previousPoint`: `{position, type, ...}`, also for a single waypoint "go to"; null without a course.
  - `navigation.course.calcValues.distance`: metres to the next point.
- **The route's points are not in any delta.** They come only from the resources API, as GeoJSON with any number of points and any metadata. That is too big and too loose to hand to a display as it is.

## Decision
**The chart draws the course** when `route` is on, which is the default:
- **The route:** legs as lines, those already sailed faint, with a dot per point. Magenta by day and in the dark theme (the chartplotter convention, apart from the blues and the red vessel), red at night.
- **The leg being sailed:** bold, from the previous to the next waypoint, which come from the course delta, so it is right even when the route was thinned.
- **The next waypoint:** a ring, or off the chart a **small arrow at the edge** on the line from the vessel, pointing at it. A thin line runs from the vessel to it. The distance in nm shows from 260 px (`CHART_FIT.info`).
- **The edge geometry** is shared: `edgeArrow()` in `packages/schema/src/chartRoute.ts`, mirrored in `esphelm_chart_route.h`, with `fixtures/chart-route.cases.json`.

**The plugin serves the points:** `GET /signalk/v1/api/esphelm/routes/:id`, with a device token.
- It reads the route through the resources API and answers `{"points": [[lat, lon, index], ...]}`, with an ETag.
- A route longer than 500 points (`MAX_ROUTE_POINTS`) is thinned by ranking each point by how much it shapes the route (Douglas–Peucker), keeping both ends. `index`, the point's place in the route, still says which legs are sailed after thinning.

**The display fetches them once for all its charts:**
- The store every chart shares (`ChartTileStore`) keeps the points, as it keeps the map tiles. A chart tells it the route id from `activeRoute`.
- The store asks the plugin on the tile worker, before map tiles, on every course delta, with If-None-Match. An unchanged route is a 304; a route edited while active shows on the next delta.
- **Checks:** every field (2–500 points, finite, |lat| ≤ 85, increasing indexes) and a body of at most 16 KB. A refused or missing route draws nothing, and the next waypoint still shows.

**Schema:** `route?` and the four paths (`activeRoutePath`, `nextPointPath`, `previousPointPath`, `distancePath`) on `ChartTile`, all optional. Firmware before this ignores keys it doesn't know (`check_chart`), so no capability flag and no major version are needed.

## Consequences
- **Memory:** 12 bytes per point (6 KB for 500) once per display, plus up to 16 KB of body and its JSON document while it is read. The CYD and C3 builds have no charts.
- **Last values on a page change:** the course is sent only when it changes, and SignalK replays only the paths it newly subscribes, so a chart on a page opened later would never get the route. The runtime now keeps the last value of each subscribed path, with the time it came, and hands it to a new page's tiles. That fixes the same gap for every tile (switch states, the anchor position, and values like SOG that showed `--` until their next delta; goldens `62` and `83` changed for that reason). Flash: about 11 KB on every board (CYD 1,537,259 B, 83.8 %; C3 check 90.5 %).
- **Paths:** each chart with `route` on follows four more paths. Old plugins answer the route request with 404, so only the next waypoint shows.
- **Not done:** routes of other vessels, waypoints that aren't part of the active route, and a distance unit other than nm.
- **Checked:** plugin unit tests and e2e (a stand-in route through the resources API), editor tests, and SDL goldens `88-chart-route`, `89-chart-route-arrow` and `90-chart-route-night`.
