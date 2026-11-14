import { MAX_ROUTE_POINTS } from '@esphelm/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { routePoints, thinRoute, type RoutePoint } from '../src/routes.js';
import { ADMIN, device, startHarness, type Harness } from './harness.js';

const ID = 'aabbccdd-0011-2233-0ba2-aabbccddeeff';
const route = (coordinates: unknown) => ({
  name: 'Home',
  feature: { type: 'Feature', geometry: { type: 'LineString', coordinates } },
});

describe('route points (ADR-0037)', () => {
  it('reads [lon, lat] GeoJSON as [lat, lon, index]', () => {
    expect(
      routePoints(
        route([
          [24.9, 60.1],
          [25, 60.2, 3],
        ]),
      ),
    ).toEqual([
      [60.1, 24.9, 0],
      [60.2, 25, 1],
    ]);
  });
  it('refuses what is not a usable route', () => {
    expect(routePoints(undefined)).toBeUndefined();
    expect(routePoints(route([[24.9, 60.1]]))).toBeUndefined(); // one point
    expect(
      routePoints(
        route([
          [24.9, 60.1],
          [200, 60],
        ]),
      ),
    ).toBeUndefined();
    expect(
      routePoints(
        route([
          [24.9, 60.1],
          ['x', 60],
        ]),
      ),
    ).toBeUndefined();
    expect(
      routePoints({ feature: { geometry: { type: 'Point', coordinates: [1, 2] } } }),
    ).toBeUndefined();
  });
  it('thins a long route to the points that shape it, keeping both ends and their indexes', () => {
    // A straight line with one sharp corner in the middle.
    const pts: RoutePoint[] = Array.from({ length: 2001 }, (_, i) => [
      60 + (i <= 1000 ? i : 2000 - i) * 1e-4,
      24 + i * 1e-4,
      i,
    ]);
    const thin = thinRoute(pts, 10);
    expect(thin).toHaveLength(10);
    expect(thin[0]![2]).toBe(0);
    expect(thin.at(-1)![2]).toBe(2000);
    expect(thin.map((p) => p[2])).toContain(1000); // the corner
    expect(thin.map((p) => p[2])).toEqual([...thin.map((p) => p[2])].sort((a, b) => a - b));
    expect(thinRoute(pts.slice(0, 5), 10)).toHaveLength(5);
  });
});

describe('GET /esphelm/routes/:id (ADR-0037)', () => {
  let h: Harness;
  afterEach(() => h.close());
  const routes: Record<string, unknown> = {
    home: route([
      [24.9, 60.1],
      [25.0, 60.2],
      [25.1, 60.15],
    ]),
    long: route(
      Array.from({ length: 3000 }, (_, i) => [24 + i * 1e-3, 60 + Math.sin(i / 50) * 0.1]),
    ),
  };
  const get = (id: string, headers?: Record<string, string>) =>
    h.call('GET', `/signalk/v1/api/esphelm/routes/${id}`, { as: device(ID), headers });

  it('serves a route compact, with an ETag and 304', async () => {
    h = await startHarness({ routes: { getRoute: (id) => Promise.resolve(routes[id]) } });
    const r = await get('home');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      points: [
        [60.1, 24.9, 0],
        [60.2, 25, 1],
        [60.15, 25.1, 2],
      ],
    });
    const etag = r.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect((await get('home', { 'If-None-Match': etag })).status).toBe(304);
  });
  it('thins a long route to fit the display', async () => {
    h = await startHarness({ routes: { getRoute: (id) => Promise.resolve(routes[id]) } });
    const r = await get('long');
    const text = await r.text();
    expect((JSON.parse(text) as { points: number[][] }).points).toHaveLength(MAX_ROUTE_POINTS);
    expect(text.length).toBeLessThan(16 * 1024);
  });
  it('answers 404 for an unknown route and 400 for a bad id, and needs a device token', async () => {
    h = await startHarness({ routes: { getRoute: (id) => Promise.resolve(routes[id]) } });
    expect((await get('nope')).status).toBe(404);
    expect((await get('bad%20id')).status).toBe(400);
    expect((await h.call('GET', '/signalk/v1/api/esphelm/routes/home', {})).status).toBe(401);
    expect((await h.call('GET', '/signalk/v1/api/esphelm/routes/home', { as: ADMIN })).status).toBe(
      200,
    );
  });
});
