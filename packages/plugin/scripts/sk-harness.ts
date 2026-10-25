/**
 * Throwaway signalk-server for end-to-end tests: security enabled, an admin user, the
 * signalk-esphelm plugin symlinked in and enabled, a fresh config dir in the OS temp dir.
 * Never touches ~/.signalk. Used by scripts/e2e.ts and firmware/test/e2e_sdl.ts.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_PASSWORD = 'e2e-admin-password';

/** The subset of the `ws` client used here (loaded from the server's own dependencies). */
export interface WsClient {
  once(event: 'open', cb: () => void): void;
  once(event: 'error', cb: (err: Error) => void): void;
  on(event: 'message', cb: (data: Buffer) => void): void;
  send(data: string): void;
  close(): void;
}
type WsConstructor = new (url: string, opts: { headers: Record<string, string> }) => WsClient;

export interface JsonResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

export interface SignalKHarness {
  base: string;
  port: number;
  version: string;
  bin: string;
  admin: string;
  log(): string;
  json(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<JsonResponse>;
  /** Request access for a clientId and approve it; returns the device token. */
  deviceToken(clientId: string, permissions: string): Promise<string>;
  /** Approve an access request a device created itself. */
  approve(clientId: string, permissions: string): Promise<JsonResponse>;
  /** Open a stream as the given token; returns the socket and every received message. */
  stream(token: string): Promise<{ ws: WsClient; messages: unknown[] }>;
  stop(): Promise<void>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < ms) await new Promise((res) => setTimeout(res, 50));
  return pred();
}

/**
 * A tiny plugin that accepts PUTs on the given paths and echoes each value back as a delta,
 * standing in for real switching hardware.
 */
const PUT_ECHO_PLUGIN = `
module.exports = (app) => ({
  id: 'esphelm-put-echo',
  name: 'ESPHelm e2e PUT echo',
  schema: {},
  start(config) {
    for (const path of config.paths || []) {
      app.registerPutHandler('vessels.self', path, (context, p, value) => {
        app.handleMessage('esphelm-put-echo', { updates: [{ values: [{ path: p, value }] }] });
        return { state: 'COMPLETED', statusCode: 200 };
      });
    }
  },
  stop() {},
});
`;

/**
 * A stand-in for an autopilot plugin with the classic PUT interface (what the legacy app and
 * the autopilot tile use): `steering.autopilot.state` is echoed, and
 * `steering.autopilot.actions.adjustHeading` (degrees) moves `steering.autopilot.target`
 * (radians) only while engaged, like a real pilot. It reads the current values from the
 * server, so tests can also set them with plain deltas.
 */
const AUTOPILOT_SIM_PLUGIN = `
module.exports = (app) => {
  const current = (path) => {
    const v = app.getSelfPath(path);
    return v && typeof v === 'object' && 'value' in v ? v.value : v;
  };
  const send = (path, value) =>
    app.handleMessage('esphelm-autopilot-sim', { updates: [{ values: [{ path, value }] }] });
  return {
    id: 'esphelm-autopilot-sim',
    name: 'ESPHelm e2e autopilot stand-in',
    schema: {},
    start() {
      app.registerPutHandler('vessels.self', 'steering.autopilot.state', (c, p, value) => {
        send('steering.autopilot.state', value);
        return { state: 'COMPLETED', statusCode: 200 };
      });
      app.registerPutHandler('vessels.self', 'steering.autopilot.actions.adjustHeading', (c, p, value) => {
        const state = current('steering.autopilot.state');
        if (!state || state === 'standby') return { state: 'COMPLETED', statusCode: 400 };
        const target = Number(current('steering.autopilot.target')) || 0;
        const next = (target + (Number(value) * Math.PI) / 180 + 2 * Math.PI) % (2 * Math.PI);
        send('steering.autopilot.target', next);
        return { state: 'COMPLETED', statusCode: 200 };
      });
    },
    stop() {},
  };
};
`;

/**
 * A stand-in for a SignalK charts plugin: a resources-API provider with one PNG chart
 * ("test-chart") whose tiles are generated: a checkerboard tinted per tile with a dark border,
 * so stitching and offsets show in screenshots. Tiles are served where real chart plugins put
 * them (/signalk/chart-tiles/...), readable with any read token. PNGs are written with the
 * plugin package's own pngjs.
 */
const CHART_SIM_PLUGIN = (pngjsPath: string) => `
const { PNG } = require(${JSON.stringify(pngjsPath)});
const CHART = {
  identifier: 'test-chart', name: 'Test chart', description: 'generated tiles',
  chartFormat: 'png', tilemapUrl: '/signalk/chart-tiles/test-chart/{z}/{x}/{y}.png',
  bounds: [[-180, -85], [180, 85]],
};
function tile(z, x, y) {
  const png = new PNG({ width: 256, height: 256 });
  const hue = ((x * 7 + y * 13 + z * 3) % 6);
  const tints = [[200, 230, 255], [210, 245, 210], [255, 240, 200], [235, 215, 250], [255, 220, 220], [215, 240, 240]];
  const [tr, tg, tb] = tints[hue];
  for (let py = 0; py < 256; py++)
    for (let px = 0; px < 256; px++) {
      const i = (py * 256 + px) * 4;
      const border = px < 3 || py < 3 || px > 252 || py > 252;
      const dark = ((px >> 5) + (py >> 5)) % 2 === 1;
      const f = border ? 0.25 : dark ? 0.85 : 1;
      png.data[i] = tr * f; png.data[i + 1] = tg * f; png.data[i + 2] = tb * f; png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}
module.exports = (app) => ({
  id: 'esphelm-chart-sim',
  name: 'ESPHelm e2e chart stand-in',
  schema: {},
  start() {
    app.registerResourceProvider({
      type: 'charts',
      methods: {
        listResources: async () => ({ 'test-chart': CHART }),
        getResource: async (id) => { if (id !== 'test-chart') throw new Error('not found'); return CHART; },
        setResource: async () => { throw new Error('read only'); },
        deleteResource: async () => { throw new Error('read only'); },
      },
    });
    app.get('/signalk/chart-tiles/test-chart/:z/:x/:y.png', (req, res) => {
      app.tileRequests = (app.tileRequests || 0) + 1;
      res.type('image/png').send(tile(Number(req.params.z), Number(req.params.x), Number(req.params.y)));
    });
  },
  stop() {},
});
`;

/**
 * Start the server. SIGNALK_SERVER=/path/to/bin/signalk-server picks an install; default: the
 * first `signalk-server` on PATH. `port` fixes the HTTP port (default: a free one);
 * `sampleData` feeds the server's bundled NMEA 0183 sample (live wind, speed, depth, ...);
 * `putEcho` lists paths whose PUTs are accepted and echoed back as deltas; `autopilotSim`
 * installs the autopilot stand-in above; `chartSim` the charts stand-in.
 */
export async function startSignalK(
  opts: {
    port?: number;
    sampleData?: boolean;
    putEcho?: string[];
    autopilotSim?: boolean;
    chartSim?: boolean;
  } = {},
): Promise<SignalKHarness> {
  if (!existsSync(join(PLUGIN_DIR, 'dist/index.js'))) throw new Error('run `npm run build` first');
  const bin = realpathSync(
    process.env.SIGNALK_SERVER ??
      execFileSync('which', ['signalk-server'], { encoding: 'utf8' }).trim(),
  );
  const serverRequire = createRequire(bin);
  // Reuse the server's own dependencies: bcrypt for the admin user, ws for the stream.
  const bcrypt = serverRequire('bcryptjs') as { hashSync(pw: string, rounds: number): string };
  const WebSocket = serverRequire('ws') as WsConstructor;
  const version = (
    JSON.parse(readFileSync(join(dirname(bin), '../package.json'), 'utf8')) as { version: string }
  ).version;

  const config = mkdtempSync(join(tmpdir(), 'esphelm-e2e-'));
  mkdirSync(join(config, 'node_modules'));
  mkdirSync(join(config, 'plugin-config-data'));
  symlinkSync(PLUGIN_DIR, join(config, 'node_modules', 'signalk-esphelm'));
  const dependencies: Record<string, string> = { 'signalk-esphelm': '*' };
  if (opts.putEcho) {
    const echo = join(config, 'node_modules', 'esphelm-put-echo');
    mkdirSync(echo);
    writeFileSync(
      join(echo, 'package.json'),
      JSON.stringify({
        name: 'esphelm-put-echo',
        version: '1.0.0',
        main: 'index.js',
        keywords: ['signalk-node-server-plugin'],
      }),
    );
    writeFileSync(join(echo, 'index.js'), PUT_ECHO_PLUGIN);
    writeFileSync(
      join(config, 'plugin-config-data', 'esphelm-put-echo.json'),
      JSON.stringify({ enabled: true, configuration: { paths: opts.putEcho } }),
    );
    dependencies['esphelm-put-echo'] = '*';
  }
  if (opts.autopilotSim) {
    const sim = join(config, 'node_modules', 'esphelm-autopilot-sim');
    mkdirSync(sim);
    writeFileSync(
      join(sim, 'package.json'),
      JSON.stringify({
        name: 'esphelm-autopilot-sim',
        version: '1.0.0',
        main: 'index.js',
        keywords: ['signalk-node-server-plugin'],
      }),
    );
    writeFileSync(join(sim, 'index.js'), AUTOPILOT_SIM_PLUGIN);
    writeFileSync(
      join(config, 'plugin-config-data', 'esphelm-autopilot-sim.json'),
      JSON.stringify({ enabled: true, configuration: {} }),
    );
    dependencies['esphelm-autopilot-sim'] = '*';
  }
  if (opts.chartSim) {
    const sim = join(config, 'node_modules', 'esphelm-chart-sim');
    mkdirSync(sim);
    writeFileSync(
      join(sim, 'package.json'),
      JSON.stringify({
        name: 'esphelm-chart-sim',
        version: '1.0.0',
        main: 'index.js',
        keywords: ['signalk-node-server-plugin'],
      }),
    );
    const pngjs = createRequire(join(PLUGIN_DIR, 'package.json')).resolve('pngjs');
    writeFileSync(join(sim, 'index.js'), CHART_SIM_PLUGIN(pngjs));
    writeFileSync(
      join(config, 'plugin-config-data', 'esphelm-chart-sim.json'),
      JSON.stringify({ enabled: true, configuration: {} }),
    );
    dependencies['esphelm-chart-sim'] = '*';
  }
  writeFileSync(
    join(config, 'package.json'),
    JSON.stringify({ name: 'e2e', private: true, dependencies }),
  );
  writeFileSync(
    join(config, 'plugin-config-data', 'esphelm.json'),
    JSON.stringify({ enabled: true, configuration: {} }),
  );
  writeFileSync(
    join(config, 'security.json'),
    JSON.stringify({
      allow_readonly: true,
      expiration: 'NEVER',
      secretKey: `e2e-${Date.now()}-${Math.random()}`,
      users: [{ username: 'admin', type: 'admin', password: bcrypt.hashSync(ADMIN_PASSWORD, 10) }],
      devices: [],
      allowDeviceAccessRequests: true,
      allowNewUserRegistration: false,
    }),
  );

  const port = opts.port ?? (await freePort());
  const [nmeaPort, tcpPort] = [await freePort(), await freePort()];
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  const args = ['-c', config, '--securityenabled'];
  if (opts.sampleData) args.push('--sample-nmea0183-data');
  const server: ChildProcess = spawn(bin, args, {
    env: {
      ...process.env,
      PORT: String(port),
      NMEA0183PORT: String(nmeaPort),
      TCPSTREAMPORT: String(tcpPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  server.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const sockets: WsClient[] = [];
  const stop = async () => {
    sockets.forEach((s) => s.close());
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    rmSync(config, { recursive: true, force: true });
  };

  try {
    for (let i = 0; ; i++) {
      if (i > 60) throw new Error(`server did not start:\n${log}`);
      const up = await fetch(`${base}/signalk`).then(
        (r) => r.ok,
        () => false,
      );
      if (up) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    await stop();
    throw e;
  }

  const json: SignalKHarness['json'] = async (method, path, token, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // keep text
    }
    return { status: res.status, headers: res.headers, body: parsed as Record<string, unknown> };
  };

  const login = await json('POST', '/signalk/v1/auth/login', undefined, {
    username: 'admin',
    password: ADMIN_PASSWORD,
  });
  const admin = String(login.body.token);

  const approve: SignalKHarness['approve'] = (clientId, permissions) =>
    json('PUT', `/skServer/security/access/requests/${clientId}/approved`, admin, {
      permissions,
      expiration: 'NEVER',
    });

  return {
    base,
    port,
    version,
    bin,
    admin,
    log: () => log,
    json,
    approve,
    deviceToken: async (clientId, permissions) => {
      const req = await json('POST', '/signalk/v1/access/requests', undefined, {
        clientId,
        description: `e2e ${permissions}`,
        permissions,
      });
      await approve(clientId, permissions);
      const done = await json('GET', String(req.body.href));
      return String((done.body.accessRequest as Record<string, unknown>).token);
    },
    stream: async (token) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/signalk/v1/stream?subscribe=none`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      sockets.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      const messages: unknown[] = [];
      ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
      return { ws, messages };
    },
    stop,
  };
}
