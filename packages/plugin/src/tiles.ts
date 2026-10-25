// Chart tiles for displays (Phase 5d, ADR-0012). The boat's SignalK charts plugin serves raster
// tiles (PNG or JPEG) for each chart in the resources API; displays cannot decode those, so this
// module fetches a tile, decodes it and returns the raw RGB565 pixels the display copies into its
// tile buffer. Recently used tiles are kept in a small LRU.
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { ResourcesApi } from '@signalk/server-api';

export const TILE_SIZE = 256;
/** Bytes of one RGB565 tile: 256 x 256 pixels, 2 bytes each. */
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 2;

export interface ChartInfo {
  identifier: string;
  name: string;
  /** chartFormat from the resources API, e.g. "png", "jpg", "pbf". */
  format: string;
  tilemapUrl?: string;
  bounds?: [[number, number], [number, number]];
  /** Whether ESPHelm can convert this chart's tiles (raster PNG or JPEG with a tile URL). */
  supported: boolean;
}

/** What the tile service needs from the server (tests provide a fake). */
export interface ChartSource {
  listCharts(): Promise<ChartInfo[]>;
  getChart(id: string): Promise<ChartInfo | undefined>;
  /** GET a tile URL (relative URLs are on this server); `authorization` is forwarded as is. */
  fetchTile(url: string, authorization?: string): Promise<{ status: number; body: Buffer }>;
}

export const RASTER_FORMATS = ['png', 'jpg', 'jpeg'];

export function chartInfo(id: string, raw: Record<string, unknown>): ChartInfo {
  const format = String(raw.chartFormat ?? raw.format ?? '').toLowerCase();
  const tilemapUrl = typeof raw.tilemapUrl === 'string' ? raw.tilemapUrl : undefined;
  return {
    identifier: typeof raw.identifier === 'string' ? raw.identifier : id,
    name: typeof raw.name === 'string' ? raw.name : id,
    format,
    ...(tilemapUrl ? { tilemapUrl } : {}),
    ...(Array.isArray(raw.bounds) ? { bounds: raw.bounds as ChartInfo['bounds'] } : {}),
    supported: RASTER_FORMATS.includes(format) && tilemapUrl !== undefined,
  };
}

export type TileResult =
  | { ok: true; body: Buffer; etag: string }
  | { ok: false; status: 400 | 404 | 415 | 502; error: string; message: string };

/** Decode a PNG or JPEG tile (sniffed from its bytes) to RGBA pixels. */
export function decodeTile(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, rgba: png.data };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
    return { width: img.width, height: img.height, rgba: img.data };
  }
  throw new Error('not a PNG or JPEG image');
}

/**
 * RGBA to RGB565, little-endian (the byte order LVGL uses for RGB565 in memory on ESP32 and on
 * the SDL host build). Transparent pixels become white, as an empty chart area would look.
 */
export function toRgb565(rgba: Uint8Array): Buffer {
  const out = Buffer.alloc((rgba.length / 4) * 2);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
    const a = rgba[i + 3]! / 255;
    const r = Math.round(rgba[i]! * a + 255 * (1 - a));
    const g = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    const b = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
    out.writeUInt16LE(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3), o);
  }
  return out;
}

/** Fill a tile URL template ({z}/{x}/{y}; "{-y}" for TMS). */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{-y}', String(2 ** z - 1 - y))
    .replace('{y}', String(y));
}

export class TileService {
  private cache = new Map<string, { body: Buffer; etag: string }>();

  constructor(
    private readonly source: ChartSource,
    private readonly maxTiles = 64,
  ) {}

  listCharts(): Promise<ChartInfo[]> {
    return this.source.listCharts();
  }

  async rgb565(
    chartId: string,
    z: number,
    x: number,
    y: number,
    authorization?: string,
  ): Promise<TileResult> {
    if (
      ![z, x, y].every(Number.isInteger) ||
      z < 0 ||
      z > 24 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    ) {
      return { ok: false, status: 400, error: 'BAD_TILE', message: `no tile ${z}/${x}/${y}` };
    }
    const key = `${chartId}/${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh its place in the LRU.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { ok: true, ...hit };
    }
    const chart = await this.source.getChart(chartId);
    if (!chart)
      return { ok: false, status: 404, error: 'UNKNOWN_CHART', message: `no chart "${chartId}"` };
    if (!chart.supported || !chart.tilemapUrl) {
      return {
        ok: false,
        status: 415,
        error: 'UNSUPPORTED_CHART',
        message: `chart "${chartId}" is ${chart.format || 'of an unknown format'}; displays need PNG or JPEG tiles`,
      };
    }
    let fetched: { status: number; body: Buffer };
    try {
      fetched = await this.source.fetchTile(tileUrl(chart.tilemapUrl, z, x, y), authorization);
    } catch (e) {
      return { ok: false, status: 502, error: 'CHART_SERVER', message: (e as Error).message };
    }
    if (fetched.status === 404 || fetched.status === 204) {
      return {
        ok: false,
        status: 404,
        error: 'NO_TILE',
        message: `chart has no tile ${z}/${x}/${y}`,
      };
    }
    if (fetched.status !== 200) {
      return {
        ok: false,
        status: 502,
        error: 'CHART_SERVER',
        message: `chart server answered ${fetched.status}`,
      };
    }
    let img: ReturnType<typeof decodeTile>;
    try {
      img = decodeTile(fetched.body);
    } catch (e) {
      return { ok: false, status: 502, error: 'BAD_TILE_IMAGE', message: (e as Error).message };
    }
    if (img.width !== TILE_SIZE || img.height !== TILE_SIZE) {
      return {
        ok: false,
        status: 502,
        error: 'BAD_TILE_SIZE',
        message: `tile is ${img.width}x${img.height}; displays need ${TILE_SIZE}x${TILE_SIZE}`,
      };
    }
    const body = toRgb565(img.rgba);
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
    this.cache.set(key, { body, etag });
    while (this.cache.size > this.maxTiles) this.cache.delete(this.cache.keys().next().value!);
    return { ok: true, body, etag };
  }
}

/**
 * Chart source backed by the SignalK resources API: charts come from whichever charts plugin
 * the boat runs; relative tile URLs are fetched from this server over HTTP on localhost.
 */
export function resourcesChartSource(
  resources: Pick<ResourcesApi, 'listResources' | 'getResource'> | undefined,
  port: () => number,
  timeoutMs = 10000,
): ChartSource {
  return {
    async listCharts() {
      if (!resources) return [];
      const all = (await resources.listResources('charts', {}).catch(() => ({}))) as Record<
        string,
        Record<string, unknown>
      >;
      return Object.entries(all).map(([id, raw]) => chartInfo(id, raw));
    },
    async getChart(id) {
      if (!resources) return undefined;
      const raw = (await resources.getResource('charts', id).catch(() => undefined)) as
        Record<string, unknown> | undefined;
      return raw ? chartInfo(id, raw) : undefined;
    },
    async fetchTile(url, authorization) {
      const absolute = /^https?:\/\//.test(url)
        ? url
        : `http://127.0.0.1:${port()}${url.startsWith('/') ? '' : '/'}${url}`;
      const res = await fetch(absolute, {
        headers: authorization ? { Authorization: authorization } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    },
  };
}
