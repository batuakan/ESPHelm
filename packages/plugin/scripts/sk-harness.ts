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
 * Start the server. SIGNALK_SERVER=/path/to/bin/signalk-server picks an install; default: the
 * first `signalk-server` on PATH. `port` fixes the HTTP port (default: a free one);
 * `sampleData` feeds the server's bundled NMEA 0183 sample (live wind, speed, depth, ...);
 * `putEcho` lists paths whose PUTs are accepted and echoed back as deltas.
 */
export async function startSignalK(
  opts: { port?: number; sampleData?: boolean; putEcho?: string[] } = {},
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
