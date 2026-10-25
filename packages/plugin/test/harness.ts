import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Delta } from '@signalk/server-api';
import express from 'express';
import { registerDeviceApi } from '../src/deviceApi.js';
import { registerEditorApi } from '../src/editorApi.js';
import type { PluginHost } from '../src/host.js';
import { Service } from '../src/service.js';
import type { ChartSource } from '../src/tiles.js';

const SCHEMA_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../schema/fixtures');

export function fixture<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(join(SCHEMA_FIXTURES, rel), 'utf8')) as T;
}

export interface Principal {
  identifier: string;
  permissions: string;
}

export const ADMIN: Principal = { identifier: 'admin', permissions: 'admin' };
/** What signalk-server attaches to anonymous requests when allow_readonly is on. */
export const ANON_AUTO: Principal = { identifier: 'AUTO', permissions: 'readonly' };
export const device = (id: string, permissions = 'readwrite'): Principal => ({
  identifier: id,
  permissions,
});

export interface Harness {
  base: string;
  dataDir: string;
  deltas: Delta[];
  errors: string[];
  service: Service;
  security: { disabled: boolean };
  /** fetch with an optional principal (as signalk-server's http_authorize would set it). */
  call(
    method: string,
    path: string,
    opts?: { as?: Principal; body?: unknown; headers?: Record<string, string> },
  ): Promise<Response>;
  restart(): void;
  close(): Promise<void>;
}

/**
 * The real routers in an Express app shaped like signalk-server's: JSON body parsing,
 * device API under /signalk/v1/api, editor API under /plugins/esphelm, plus a fake host.
 */
export async function startHarness(
  opts: { dataDir?: string; charts?: ChartSource } = {},
): Promise<Harness> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'esphelm-plugin-'));
  const deltas: Delta[] = [];
  const errors: string[] = [];
  const security = { disabled: false };
  // A tiny SignalK data model for /api/paths.
  const skData: Record<string, { value: unknown; timestamp: string }> = {
    'navigation.speedOverGround': { value: 3.19, timestamp: '2026-10-24T12:00:00.000Z' },
    'environment.depth.belowTransducer': { value: 12.4, timestamp: '2026-10-24T12:00:01.000Z' },
    'navigation.position': {
      value: { latitude: 60.15, longitude: 24.95 },
      timestamp: '2026-10-24T12:00:02.000Z',
    },
  };
  const skMeta: Record<string, { units?: string; description?: string }> = {
    'navigation.speedOverGround': { units: 'm/s', description: 'Speed over ground' },
    'environment.depth.belowTransducer': { units: 'm' },
  };
  const host: PluginHost = {
    getDataDirPath: () => dataDir,
    handleMessage: (_id, delta) => {
      deltas.push(delta as Delta);
    },
    setPluginStatus: () => {},
    setPluginError: (msg) => {
      errors.push(msg);
    },
    debug: Object.assign(() => {}, { enabled: false }),
    error: () => {},
    securityStrategy: { isDummy: () => security.disabled },
    streambundle: { getAvailablePaths: () => Object.keys(skData) as never },
    getSelfPath: (path: string) => skData[path],
    getMetadata: (path: string) => skMeta[path.replace(/^vessels\.self\./, '')] as never,
  };
  let now = Date.parse('2026-10-24T12:00:00Z');
  const service = new Service(host, () => new Date((now += 1000)), opts.charts);
  service.start();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const p = req.header('x-test-principal');
    if (p)
      (req as typeof req & { skPrincipal?: Principal }).skPrincipal = JSON.parse(p) as Principal;
    next();
  });
  app.use('/signalk/v1/api', registerDeviceApi(express.Router(), service));
  const editor = express.Router();
  registerEditorApi(editor, service);
  app.use('/plugins/esphelm', editor);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    dataDir,
    deltas,
    errors,
    service,
    security,
    call: (method, path, o = {}) =>
      fetch(base + path, {
        method,
        headers: {
          ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(o.as ? { 'x-test-principal': JSON.stringify(o.as) } : {}),
          ...o.headers,
        },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      }),
    restart: () => {
      service.stop();
      service.start();
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!opts.dataDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Value of the last version delta emitted for a device. */
export function lastVersion(deltas: Delta[], deviceId: string): unknown {
  const path = `plugins.esphelm.${deviceId}.version`;
  for (let i = deltas.length - 1; i >= 0; i--) {
    for (const u of deltas[i]?.updates ?? []) {
      if ('values' in u) {
        const v = u.values.find((pv) => pv.path === path);
        if (v) return v.value;
      }
    }
  }
  return undefined;
}
