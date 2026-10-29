// Client for the signalk-esphelm editor API (docs/plugin-api.md). Same-origin requests carry
// the SignalK login cookie; the editor API needs an admin login.
import type { Hello, Layout, UnitDef, ValidationError } from '@esphelm/schema';

export const API = '/plugins/esphelm/api';

export interface Device {
  id: string;
  state: 'pending' | 'adopted';
  name?: string;
  layoutId?: string;
  hello: Hello;
  firstSeen: string;
  lastSeen: string;
  servedEtag: string | null;
}

export interface PathInfo {
  path: string;
  units: string | null;
  description: string | null;
  value: unknown;
  timestamp: string | null;
}

/** A chart of the boat's SignalK charts plugin (GET /api/charts). */
export interface ChartInfo {
  identifier: string;
  name: string;
  format: string;
  tilemapUrl?: string;
  bounds?: [[number, number], [number, number]];
  /** Raster PNG/JPEG with a tile URL: displays can show it. */
  supported: boolean;
  /** Why not, when it isn't (e.g. "WMS charts", "webp tiles"). */
  reason?: string;
}

export interface WidgetCatalog {
  tiles: string[];
  pageWidgets: Record<string, { slots: string[] }>;
  units: Record<string, UnitDef>;
}

export interface Problem {
  code: string;
  message: string;
  device?: string;
}

/** A failed call, with what the editor should show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: ValidationError[] = [],
    readonly problems: Problem[] = [],
  ) {
    super(message);
  }

  /** 401/403: not logged in to SignalK as an admin. */
  get needsLogin(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createApi(fetchImpl: Fetch = (input, init) => fetch(input, init), base = API) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const d = (data ?? {}) as {
        error?: string;
        message?: string;
        errors?: ValidationError[];
        devices?: { device: string; errors?: Problem[] }[];
      };
      const problems = (d.devices ?? []).flatMap((x) =>
        (x.errors ?? []).map((e) => ({ ...e, device: x.device })),
      );
      const message =
        res.status === 401 || res.status === 403
          ? 'Log in to SignalK as an administrator to edit displays.'
          : (d.message ?? problems[0]?.message ?? d.error ?? `HTTP ${res.status}`);
      throw new ApiError(
        res.status,
        d.error ?? `HTTP_${res.status}`,
        message,
        d.errors ?? [],
        problems,
      );
    }
    return data as T;
  }

  return {
    devices: () => call<Device[]>('GET', '/devices'),
    updateDevice: (
      id: string,
      patch: { state?: string; name?: string | null; layoutId?: string | null },
    ) =>
      call<{ device: Device; warnings: Problem[] }>(
        'PUT',
        `/devices/${encodeURIComponent(id)}`,
        patch,
      ),
    layout: (id: string) => call<Layout>('GET', `/layouts/${encodeURIComponent(id)}`),
    saveLayout: (layout: Layout) =>
      call<{ id: string; etag: string; bytes: number; warnings: Problem[] }>(
        'PUT',
        `/layouts/${encodeURIComponent(layout.id)}`,
        layout,
      ),
    paths: () => call<PathInfo[]>('GET', '/paths'),
    widgets: () => call<WidgetCatalog>('GET', '/widgets'),
    charts: () => call<ChartInfo[]>('GET', '/charts'),
  };
}

export type Api = ReturnType<typeof createApi>;
