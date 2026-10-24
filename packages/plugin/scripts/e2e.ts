/**
 * End-to-end check of signalk-esphelm inside a real signalk-server (security enabled):
 *   npm run build && npm run e2e -w signalk-esphelm
 * Needs `signalk-server` on PATH (or SIGNALK_SERVER=/path/to/bin/signalk-server). Uses a throwaway config dir in the OS temp dir and free
 * ports; never touches ~/.signalk. Tokens come from the real login and access-request flows.
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

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_FIXTURES = join(PLUGIN_DIR, '../schema/fixtures');
const DEVICE_ID = '0b0b0b0b-1111-2222-0ba2-0000e2e00001';
const RO_DEVICE_ID = '0b0b0b0b-1111-2222-0ba2-0000e2e00002';
const ADMIN_PASSWORD = 'e2e-admin-password';

/** The subset of the `ws` client used here (loaded from the server's own dependencies). */
interface WsClient {
  once(event: 'open', cb: () => void): void;
  once(event: 'error', cb: (err: Error) => void): void;
  on(event: 'message', cb: (data: Buffer) => void): void;
  send(data: string): void;
  close(): void;
}
type WsConstructor = new (url: string, opts: { headers: Record<string, string> }) => WsClient;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const fixture = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SCHEMA_FIXTURES, rel), 'utf8')) as Record<string, unknown>;

async function main(): Promise<void> {
  if (!existsSync(join(PLUGIN_DIR, 'dist/index.js'))) throw new Error('run `npm run build` first');
  // SIGNALK_SERVER=/path/to/bin/signalk-server picks a specific install; default: first on PATH.
  const serverBin = realpathSync(
    process.env.SIGNALK_SERVER ??
      execFileSync('which', ['signalk-server'], { encoding: 'utf8' }).trim(),
  );
  const serverRequire = createRequire(serverBin);
  // Reuse the server's own dependencies: bcrypt for the admin user, ws for the stream.
  const bcrypt = serverRequire('bcryptjs') as { hashSync(pw: string, rounds: number): string };
  const WebSocket = serverRequire('ws') as WsConstructor;
  const serverVersion = (
    JSON.parse(readFileSync(join(dirname(serverBin), '../package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

  const config = mkdtempSync(join(tmpdir(), 'esphelm-e2e-'));
  mkdirSync(join(config, 'node_modules'));
  mkdirSync(join(config, 'plugin-config-data'));
  symlinkSync(PLUGIN_DIR, join(config, 'node_modules', 'signalk-esphelm'));
  writeFileSync(
    join(config, 'package.json'),
    JSON.stringify({ name: 'e2e', private: true, dependencies: { 'signalk-esphelm': '*' } }),
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

  const [port, nmeaPort, tcpPort] = [await freePort(), await freePort(), await freePort()];
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  let log = '';
  try {
    server = spawn(serverBin, ['-c', config, '--securityenabled'], {
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
    for (let i = 0; ; i++) {
      if (i > 60) throw new Error(`server did not start:\n${log}`);
      const up = await fetch(`${base}/signalk`).then(
        (r) => r.ok,
        () => false,
      );
      if (up) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`signalk-server ${serverVersion} (${serverBin}) on ${base}, config ${config}\n`);

    const json = async (
      method: string,
      path: string,
      token?: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
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

    // Tokens via the real flows
    const login = await json('POST', '/signalk/v1/auth/login', undefined, {
      username: 'admin',
      password: ADMIN_PASSWORD,
    });
    const admin = String(login.body.token);
    const deviceToken = async (clientId: string, permissions: string) => {
      const req = await json('POST', '/signalk/v1/access/requests', undefined, {
        clientId,
        description: `e2e ${permissions}`,
        permissions,
      });
      await json('PUT', `/skServer/security/access/requests/${clientId}/approved`, admin, {
        permissions,
        expiration: 'NEVER',
      });
      const done = await json('GET', String(req.body.href));
      return String((done.body.accessRequest as Record<string, unknown>).token);
    };
    const rw = await deviceToken(DEVICE_ID, 'readwrite');
    const ro = await deviceToken(RO_DEVICE_ID, 'readonly');
    check(
      'obtained admin and device tokens',
      admin.length > 20 && rw.length > 20 && ro.length > 20,
    );

    const hello = { ...fixture('hello/valid/p4.json'), deviceId: DEVICE_ID };
    const layout = fixture('valid/grid-2x2-values-480.json');
    const layoutPath = `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/layout`;

    let r = await json('POST', '/signalk/v1/api/esphelm/devices/hello', undefined, hello);
    check('anonymous hello is rejected', r.status === 401, `${r.status} ${String(r.body?.error)}`);
    r = await json('POST', '/signalk/v1/api/esphelm/devices/hello', ro, {
      ...hello,
      deviceId: RO_DEVICE_ID,
    });
    check(
      'read-only device token is rejected',
      r.status === 403,
      `${r.status} ${String(r.body?.error)}`,
    );
    r = await json('POST', '/signalk/v1/api/esphelm/devices/hello', rw, hello);
    check(
      'read/write device hello registers a pending device',
      r.status === 200 && r.body.state === 'pending',
      JSON.stringify(r.body),
    );
    r = await json('GET', layoutPath, rw);
    check(
      'layout before adoption is 404 NOT_ADOPTED',
      r.status === 404 && r.body.error === 'NOT_ADOPTED',
    );
    r = await json('GET', '/plugins/esphelm/api/devices', rw);
    check('device token cannot use the editor API', r.status === 401, String(r.status));

    r = await json('PUT', `/plugins/esphelm/api/layouts/${String(layout.id)}`, admin, layout);
    check('admin saves a layout', r.status === 200, JSON.stringify(r.body));
    r = await json('PUT', `/plugins/esphelm/api/layouts/${String(layout.id)}`, admin, {
      ...layout,
      theme: 'dusk',
    });
    check(
      'invalid layout is rejected with error codes',
      r.status === 400 && JSON.stringify(r.body).includes('"pointer":"/theme"'),
      JSON.stringify(r.body),
    );
    r = await json('PUT', `/plugins/esphelm/api/devices/${DEVICE_ID}`, admin, {
      state: 'adopted',
      layoutId: layout.id,
      name: 'E2E display',
    });
    check(
      'admin adopts the device and assigns the layout',
      r.status === 200,
      JSON.stringify(r.body).slice(0, 120),
    );

    // Subscribe to the version path as the device would
    const versions: unknown[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/signalk/v1/stream?subscribe=none`, {
      headers: { Authorization: `Bearer ${rw}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as {
        updates?: { values?: { path: string; value: unknown }[] }[];
      };
      for (const u of msg.updates ?? [])
        for (const v of u.values ?? [])
          if (v.path === `plugins.esphelm.${DEVICE_ID}.version`) versions.push(v.value);
    });
    ws.send(
      JSON.stringify({
        context: 'vessels.self',
        subscribe: [{ path: `plugins.esphelm.${DEVICE_ID}.version`, policy: 'instant' }],
      }),
    );
    const waitFor = async (pred: () => boolean, ms = 5000) => {
      const t0 = Date.now();
      while (!pred() && Date.now() - t0 < ms) await new Promise((res) => setTimeout(res, 50));
      return pred();
    };

    r = await json('GET', layoutPath, rw);
    const etag = r.headers.get('etag');
    check(
      'adopted device gets its layout with an ETag',
      r.status === 200 && !!etag && JSON.stringify(r.body) === JSON.stringify(layout),
      String(etag),
    );
    check(
      'subscription replays the current version (= ETag)',
      await waitFor(() => versions.includes(etag)),
      JSON.stringify(versions),
    );
    r = await json('GET', layoutPath, rw, undefined, { 'If-None-Match': etag ?? '' });
    check('If-None-Match with the current ETag gives 304', r.status === 304);
    r = await json('GET', layoutPath, undefined);
    check('anonymous layout request is rejected', r.status === 401);
    r = await json('GET', layoutPath, ro);
    check("another device's token cannot read this layout", r.status === 403);

    await json('PUT', `/plugins/esphelm/api/layouts/${String(layout.id)}`, admin, {
      ...layout,
      theme: 'night',
    });
    r = await json('GET', layoutPath, rw, undefined, { 'If-None-Match': etag ?? '' });
    const newEtag = r.headers.get('etag');
    check(
      'after an edit the device gets 200 with a new ETag',
      r.status === 200 && !!newEtag && newEtag !== etag,
      String(newEtag),
    );
    check(
      'the edit is pushed as a version delta',
      await waitFor(() => versions.includes(newEtag)),
      JSON.stringify(versions),
    );
    r = await json('GET', '/signalk/v1/api/vessels/self', rw);
    check(
      'the SignalK data API still works next to the plugin routes',
      r.status === 200 && typeof r.body === 'object',
      String(r.status),
    );
    ws.close();
  } finally {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    rmSync(config, { recursive: true, force: true });
  }
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. Server log:\n${log.slice(-3000)}`);
    process.exitCode = 1;
  } else {
    console.log('\nall checks passed');
  }
}

await main();
