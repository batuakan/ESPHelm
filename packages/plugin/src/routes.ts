// The active route's points for the chart tile (ADR-0037). The course delta only names the
// route (navigation.course.activeRoute.href); its points live in the resources API as GeoJSON of
// any size. Displays get them compact: {"points": [[lat, lon, index], ...]}, at most
// MAX_ROUTE_POINTS, `index` being the point's place in the route, so a thinned route still says
// which legs are sailed.
import { MAX_ROUTE_POINTS, ROUTE_ID_PATTERN } from '@esphelm/schema';
import type { ResourcesApi } from '@signalk/server-api';
import { etagOf } from './etag.js';

const ROUTE_ID_RE = new RegExp(ROUTE_ID_PATTERN);

export interface RouteSource {
  /** The route resource as the resources API returns it, or undefined if there is none. */
  getRoute(id: string): Promise<unknown>;
}

/** Routes from whichever resources provider the boat runs (resources-provider, Freeboard...). */
export function resourcesRouteSource(
  resources: Pick<ResourcesApi, 'listResources' | 'getResource'> | undefined,
): RouteSource {
  return {
    async getRoute(id) {
      if (!resources) return undefined;
      // As for charts (tiles.ts): getResource asks only the default provider, the list merges all.
      return (
        (await resources.getResource('routes', id).catch(() => undefined)) ??
        (
          (await resources.listResources('routes', {}).catch(() => ({}))) as Record<string, unknown>
        )[id]
      );
    },
  };
}

/** [lat, lon, index into the route] */
export type RoutePoint = [number, number, number];

/** The route's points as [lat, lon, index], or undefined when it isn't a usable route. */
export function routePoints(raw: unknown): RoutePoint[] | undefined {
  const coords = (
    raw as { feature?: { geometry?: { type?: unknown; coordinates?: unknown } } } | undefined
  )?.feature?.geometry;
  if (coords?.type !== 'LineString' || !Array.isArray(coords.coordinates)) return undefined;
  const out: RoutePoint[] = [];
  for (const [i, c] of (coords.coordinates as unknown[]).entries()) {
    if (!Array.isArray(c) || c.length < 2) return undefined;
    const [lon, lat] = c as unknown[];
    if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return undefined;
    out.push([lat, lon, i]);
  }
  return out.length >= 2 ? out : undefined;
}

/** Distance of p from the line a-b, in degrees with longitude scaled by the latitude. */
function offLine(p: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const [ax, ay, bx, by, px, py] = [a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * At most `max` points of the route, the ones that shape it most (Douglas-Peucker: each point
 * ranked by how far it is off the line it would be dropped from), first and last always kept.
 */
export function thinRoute(points: RoutePoint[], max: number): RoutePoint[] {
  if (points.length <= max) return points;
  const rank = new Array<number>(points.length).fill(-1);
  rank[0] = rank[points.length - 1] = Infinity;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let far = -1;
    for (let i = a + 1; i < b; i++) {
      const d = offLine(points[i]!, points[a]!, points[b]!);
      if (d > far) {
        far = d;
        best = i;
      }
    }
    if (best < 0) continue;
    rank[best] = far;
    stack.push([a, best], [best, b]);
  }
  const keep = points
    .map((_, i) => i)
    .sort((i, j) => rank[j]! - rank[i]!)
    .slice(0, max)
    .sort((i, j) => i - j);
  return keep.map((i) => points[i]!);
}

export type ServedRoute =
  | { ok: true; bytes: Buffer; etag: string; points: number }
  | { ok: false; status: number; error: string; message: string };

export class RouteService {
  constructor(private readonly source: RouteSource) {}

  async compact(id: string): Promise<ServedRoute> {
    if (!ROUTE_ID_RE.test(id))
      return { ok: false, status: 400, error: 'INVALID_ROUTE_ID', message: 'bad route id' };
    const points = routePoints(await this.source.getRoute(id));
    if (!points)
      return { ok: false, status: 404, error: 'UNKNOWN_ROUTE', message: `no usable route "${id}"` };
    const thinned = thinRoute(points, MAX_ROUTE_POINTS);
    // Six decimals is about 10 cm: 500 points stay well under the display's 16 KB.
    const round = (v: number) => Math.round(v * 1e6) / 1e6;
    const bytes = Buffer.from(
      JSON.stringify({ points: thinned.map(([la, lo, i]) => [round(la), round(lo), i]) }),
    );
    return { ok: true, bytes, etag: etagOf(bytes), points: thinned.length };
  }
}
