/**
 * The active route on a chart tile (ADR-0037), the one definition shared by the editor preview,
 * the plugin and the firmware (firmware/components/esphelm_runtime/esphelm_chart_route.h
 * mirrors it; fixtures/chart-route.cases.json proves they agree).
 */

/** Most points the plugin sends for a route; a longer one is thinned to this many. */
export const MAX_ROUTE_POINTS = 500;

/** A route id as the plugin's device route takes it (it ends up in a URL path). */
export const ROUTE_ID_PATTERN = '^[A-Za-z0-9._:-]{1,128}$';
const ROUTE_ID_RE = new RegExp(ROUTE_ID_PATTERN);

/**
 * The route id in `navigation.course.activeRoute.href` ("/resources/routes/<id>"), or undefined
 * when it isn't one.
 */
export function routeId(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  const prefix = '/resources/routes/';
  if (!href.startsWith(prefix)) return undefined;
  const id = href.slice(prefix.length);
  return ROUTE_ID_RE.test(id) ? id : undefined;
}

/** Where the next-waypoint marker goes on a chart view. */
export interface EdgeArrow {
  /** The waypoint is inside the view (less `inset` from each edge): a ring at x, y. */
  onScreen: boolean;
  /** From the view's top left: the waypoint, or where the line to it leaves the inset view. */
  x: number;
  y: number;
  /** The direction from the vessel to the waypoint, radians clockwise from up (screen north). */
  angle: number;
}

/**
 * The next-waypoint marker for a waypoint `dx`, `dy` pixels from the vessel, which is the middle
 * of a `w` × `h` view: on screen, or an arrow `inset` pixels inside the edge, on the line from
 * the vessel to the waypoint, pointing at it.
 */
export function edgeArrow(dx: number, dy: number, w: number, h: number, inset: number): EdgeArrow {
  const hw = Math.max(0, w / 2 - inset);
  const hh = Math.max(0, h / 2 - inset);
  const angle = Math.atan2(dx, -dy);
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh)
    return { onScreen: true, x: w / 2 + dx, y: h / 2 + dy, angle };
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { onScreen: false, x: w / 2 + dx * t, y: h / 2 + dy * t, angle };
}
