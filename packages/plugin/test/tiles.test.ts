import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chartInfo,
  decodeTile,
  TILE_BYTES,
  tileRequest,
  tileUrl,
  TileService,
  toRgb565,
  type ChartInfo,
  type ChartSource,
} from '../src/tiles.js';
import { ADMIN, ANON_AUTO, device, startHarness, type Harness } from './harness.js';

/** A 256x256 PNG: the top-left pixel `first`, everything else `rest` (RGBA). */
function png(first: number[], rest: number[], size = 256): Buffer {
  const img = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) img.data.set(i === 0 ? first : rest, i * 4);
  return PNG.sync.write(img);
}

const CHARTS: Record<string, ChartInfo> = {
  sea: chartInfo('sea', {
    name: 'Sea',
    chartFormat: 'png',
    tilemapUrl: '/tiles/sea/{z}/{x}/{y}.png',
  }),
  vector: chartInfo('vector', { name: 'Vector', chartFormat: 'pbf', tilemapUrl: '/v/{z}/{x}/{y}' }),
};

/** Fake chart server: records requests; tile bodies by URL. */
function fakeSource(bodies: Record<string, Buffer | number>) {
  const requests: { url: string; authorization?: string }[] = [];
  const source: ChartSource = {
    listCharts: async () => Object.values(CHARTS),
    getChart: async (id) => CHARTS[id],
    fetchTile: async (url, authorization) => {
      requests.push({ url, authorization });
      const b = bodies[url];
      if (b === undefined) return { status: 404, body: Buffer.alloc(0) };
      if (typeof b === 'number') return { status: b, body: Buffer.alloc(0) };
      return { status: 200, body: b };
    },
  };
  return { source, requests };
}

describe('tile conversion', () => {
  it('RGB565 little-endian, transparent pixels as white', () => {
    const px = toRgb565(
      Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]),
    );
    expect([...px]).toEqual([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]);
  });

  it('decodes PNG and JPEG, sniffing the bytes', () => {
    const p = decodeTile(png([255, 0, 0, 255], [0, 0, 255, 255]));
    expect([p.width, p.height, ...p.rgba.slice(0, 4)]).toEqual([256, 256, 255, 0, 0, 255]);
    const data = Buffer.alloc(16 * 16 * 4, 200);
    const j = decodeTile(jpeg.encode({ data, width: 16, height: 16 }, 90).data);
    expect([j.width, j.height]).toEqual([16, 16]);
    expect(Math.abs(j.rgba[0]! - 200)).toBeLessThan(4);
    expect(() => decodeTile(Buffer.from('GIF89a'))).toThrow(/PNG or JPEG/);
  });

  it('fills tile URL templates, TMS {-y} included', () => {
    expect(tileUrl('/t/{z}/{x}/{y}.png', 3, 2, 1)).toBe('/t/3/2/1.png');
    expect(tileUrl('/t/{z}/{x}/{-y}', 3, 2, 1)).toBe('/t/3/2/6');
  });

  it('marks only raster charts with a tile URL as supported', () => {
    expect(CHARTS.sea!.supported).toBe(true);
    expect(CHARTS.vector!.supported).toBe(false);
    expect(chartInfo('x', { chartFormat: 'jpg' }).supported).toBe(false); // no tilemapUrl
  });

  it('reads v2 resources (format, url, type), as signalk-charts-provider-simple serves them', () => {
    const v2 = (format: string, type: string, url: string) =>
      chartInfo('c', { identifier: 'c', name: 'C', format, type, url, proxy: true });
    const tiled = v2('png', 'tilelayer', '/signalk/chart-tiles/c/{z}/{x}/{y}');
    expect(tiled).toMatchObject({
      supported: true,
      tilemapUrl: '/signalk/chart-tiles/c/{z}/{x}/{y}',
    });
    expect(tiled.reason).toBeUndefined();
    expect(v2('jpg', 'tilelayer', '/t/{z}/{x}/{y}').supported).toBe(true);
    expect(v2('webp', 'tilelayer', '/t/{z}/{x}/{y}')).toMatchObject({
      supported: false,
      reason: 'webp tiles',
    });
    expect(v2('mvt', 'S-57', 'https://x/{z}/{x}/{y}.mvt')).toMatchObject({
      supported: false,
      reason: 'S-57 charts',
    });
    const wms = v2('png', 'WMS', 'https://x/wms?SERVICE=WMS&REQUEST=GetMap');
    expect(wms).toMatchObject({ supported: false, reason: 'WMS charts' });
    expect(wms.tilemapUrl).toBeUndefined();
    expect(v2('png', 'WMTS', 'https://x/WMTS').reason).toBe('WMTS charts');
    expect(v2('png', 'tilelayer', '/style.json')).toMatchObject({
      supported: false,
      reason: 'no tile URL',
    });
  });

  it('sends the device token only to this server, never to an online chart source', () => {
    expect(tileRequest('/signalk/chart-tiles/c/1/0/0', 3000, 'Bearer dev')).toEqual({
      url: 'http://127.0.0.1:3000/signalk/chart-tiles/c/1/0/0',
      headers: { Authorization: 'Bearer dev' },
    });
    expect(tileRequest('https://tiles.example/1/0/0.png', 3000, 'Bearer dev')).toEqual({
      url: 'https://tiles.example/1/0/0.png',
      headers: {},
    });
  });
});

describe('TileService', () => {
  it('converts, caches (LRU) and reports errors', async () => {
    const { source, requests } = fakeSource({
      '/tiles/sea/1/0/0.png': png([255, 255, 255, 255], [0, 0, 0, 255]),
      '/tiles/sea/1/1/0.png': png([0, 0, 0, 255], [0, 0, 0, 255]),
      '/tiles/sea/1/0/1.png': png([0, 0, 0, 255], [0, 0, 0, 255], 128),
      '/tiles/sea/1/1/1.png': Buffer.from('not an image'),
      '/tiles/sea/2/0/0.png': 500,
    });
    const tiles = new TileService(source, 2);
    const a = await tiles.rgb565('sea', 1, 0, 0, 'Bearer t');
    expect(a.ok && a.body.length).toBe(TILE_BYTES);
    expect(a.ok && [...a.body.subarray(0, 4)]).toEqual([0xff, 0xff, 0, 0]);
    expect(requests[0]).toEqual({ url: '/tiles/sea/1/0/0.png', authorization: 'Bearer t' });
    await tiles.rgb565('sea', 1, 0, 0);
    expect(requests).toHaveLength(1); // cached
    await tiles.rgb565('sea', 1, 1, 0);
    await tiles.rgb565('sea', 0, 0, 0); // 404, not cached
    await tiles.rgb565('sea', 1, 1, 0);
    expect(requests).toHaveLength(3);

    const codes = async (...args: [string, number, number, number]) => {
      const r = await tiles.rgb565(...args);
      return r.ok ? 'ok' : `${r.status} ${r.error}`;
    };
    expect(await codes('nope', 1, 0, 0)).toBe('404 UNKNOWN_CHART');
    expect(await codes('vector', 1, 0, 0)).toBe('415 UNSUPPORTED_CHART');
    expect(await codes('sea', 1, 2, 0)).toBe('400 BAD_TILE');
    expect(await codes('sea', 0, 0, 0)).toBe('404 NO_TILE');
    expect(await codes('sea', 1, 0, 1)).toBe('502 BAD_TILE_SIZE');
    expect(await codes('sea', 1, 1, 1)).toBe('502 BAD_TILE_IMAGE');
    expect(await codes('sea', 2, 0, 0)).toBe('502 CHART_SERVER');
  });
});

describe('tile and chart routes', () => {
  let h: Harness;
  afterEach(() => h.close());

  it('serves RGB565 tiles to devices, with ETag, and lists charts for the editor', async () => {
    const { source, requests } = fakeSource({
      '/tiles/sea/3/4/5.png': png([255, 0, 0, 255], [0, 0, 0, 255]),
    });
    h = await startHarness({ charts: source });
    const path = '/signalk/v1/api/esphelm/tiles/sea/3/4/5';
    expect((await h.call('GET', path)).status).toBe(401);
    expect((await h.call('GET', path, { as: ANON_AUTO })).status).toBe(401);
    expect((await h.call('GET', path, { as: device('d1', 'readonly') })).status).toBe(403);
    const res = await h.call('GET', path, {
      as: device('d1'),
      headers: { Authorization: 'Bearer dev' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/octet-stream/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(TILE_BYTES);
    expect([...body.subarray(0, 2)]).toEqual([0x00, 0xf8]);
    expect(requests[0]?.authorization).toBe('Bearer dev');
    const etag = res.headers.get('etag')!;
    const again = await h.call('GET', path, {
      as: device('d1'),
      headers: { 'If-None-Match': etag },
    });
    expect(again.status).toBe(304);
    expect(
      (await h.call('GET', '/signalk/v1/api/esphelm/tiles/sea/3/x/5', { as: device('d1') })).status,
    ).toBe(400);
    expect(
      (await h.call('GET', '/signalk/v1/api/esphelm/tiles/vector/3/4/5', { as: device('d1') }))
        .status,
    ).toBe(415);

    const charts = (await (
      await h.call('GET', '/plugins/esphelm/api/charts', { as: ADMIN })
    ).json()) as ChartInfo[];
    expect(charts.map((c) => [c.identifier, c.supported])).toEqual([
      ['sea', true],
      ['vector', false],
    ]);
  });
});
