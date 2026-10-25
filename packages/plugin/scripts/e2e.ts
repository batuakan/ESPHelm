/**
 * End-to-end check of signalk-esphelm inside a real signalk-server (security enabled):
 *   npm run build && npm run e2e -w signalk-esphelm
 * Needs `signalk-server` on PATH (or SIGNALK_SERVER=/path/to/bin/signalk-server). Uses a
 * throwaway config dir and free ports (scripts/sk-harness.ts); never touches ~/.signalk.
 * Tokens come from the real login and access-request flows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_DIR, startSignalK, waitFor } from './sk-harness.js';

const SCHEMA_FIXTURES = join(PLUGIN_DIR, '../schema/fixtures');
const DEVICE_ID = '0b0b0b0b-1111-2222-0ba2-0000e2e00001';
const RO_DEVICE_ID = '0b0b0b0b-1111-2222-0ba2-0000e2e00002';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const fixture = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SCHEMA_FIXTURES, rel), 'utf8')) as Record<string, unknown>;

async function main(): Promise<void> {
  const sk = await startSignalK({ chartSim: true });
  try {
    console.log(`signalk-server ${sk.version} (${sk.bin}) on ${sk.base}\n`);
    const { json, admin } = sk;

    const rw = await sk.deviceToken(DEVICE_ID, 'readwrite');
    const ro = await sk.deviceToken(RO_DEVICE_ID, 'readonly');
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
    const { ws, messages } = await sk.stream(rw);
    const versionPath = `plugins.esphelm.${DEVICE_ID}.version`;
    const versions = () =>
      messages.flatMap((m) =>
        ((m as { updates?: { values?: { path: string; value: unknown }[] }[] }).updates ?? [])
          .flatMap((u) => u.values ?? [])
          .filter((v) => v.path === versionPath)
          .map((v) => v.value),
      );
    ws.send(
      JSON.stringify({
        context: 'vessels.self',
        subscribe: [{ path: versionPath, policy: 'instant' }],
      }),
    );

    r = await json('GET', layoutPath, rw);
    const etag = r.headers.get('etag');
    check(
      'adopted device gets its layout with an ETag',
      r.status === 200 && !!etag && JSON.stringify(r.body) === JSON.stringify(layout),
      String(etag),
    );
    check(
      'subscription replays the current version (= ETag)',
      await waitFor(() => versions().includes(etag)),
      JSON.stringify(versions()),
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
      await waitFor(() => versions().includes(newEtag)),
      JSON.stringify(versions()),
    );
    r = await json('GET', '/signalk/v1/api/vessels/self', rw);
    check(
      'the SignalK data API still works next to the plugin routes',
      r.status === 200 && typeof r.body === 'object',
      String(r.status),
    );

    // Chart tiles (ADR-0012): the charts stand-in serves PNG tiles; displays get RGB565.
    r = await json('GET', '/plugins/esphelm/api/charts', admin);
    check(
      'the editor lists the charts of the charts plugin',
      Array.isArray(r.body) &&
        (r.body as unknown as { identifier: string; supported: boolean }[]).some(
          (c) => c.identifier === 'test-chart' && c.supported,
        ),
      JSON.stringify(r.body),
    );
    const tilePath = '/signalk/v1/api/esphelm/tiles/test-chart/12/2200/1300';
    const tile = await fetch(sk.base + tilePath, { headers: { Authorization: `Bearer ${rw}` } });
    const bytes = Buffer.from(await tile.arrayBuffer());
    check(
      'a device gets a 256x256 RGB565 tile',
      tile.status === 200 && bytes.length === 256 * 256 * 2,
      `${tile.status} ${bytes.length} bytes`,
    );
    const tileEtag = tile.headers.get('etag') ?? '';
    const again = await fetch(sk.base + tilePath, {
      headers: { Authorization: `Bearer ${rw}`, 'If-None-Match': tileEtag },
    });
    check('the same tile again with its ETag is 304', again.status === 304, String(again.status));
    const anon = await fetch(sk.base + tilePath);
    check('tiles need a device token', anon.status === 401, String(anon.status));
    const unknown = await fetch(sk.base + '/signalk/v1/api/esphelm/tiles/nope/1/0/0', {
      headers: { Authorization: `Bearer ${rw}` },
    });
    check('an unknown chart is 404', unknown.status === 404, String(unknown.status));

    // Alarms (ADR-0014): another source raises a notification with sound; a display
    // acknowledges it; the plugin silences it, and keeps it silent when it is sent again.
    const notifPath = 'notifications.environment.depth.belowTransducer';
    const restPath = `/signalk/v1/api/vessels/self/${notifPath.replace(/\./g, '/')}`;
    const alarmSource = await sk.stream(admin);
    const raise = (state: string) =>
      alarmSource.ws.send(
        JSON.stringify({
          context: 'vessels.self',
          updates: [
            {
              values: [
                {
                  path: notifPath,
                  value: { state, method: ['visual', 'sound'], message: 'Shallow water' },
                },
              ],
            },
          ],
        }),
      );
    const methodNow = async () =>
      ((await json('GET', restPath, admin)).body as { value?: { method?: string[] } } | undefined)
        ?.value?.method;
    raise('alarm');
    await new Promise((res) => setTimeout(res, 300));
    check(
      'the alarm reaches the server with sound',
      (await methodNow())?.includes('sound') === true,
    );
    r = await json('POST', '/signalk/v1/api/esphelm/notifications/ack', ro, { path: notifPath });
    check('a read-only token cannot acknowledge', r.status === 403, String(r.status));
    r = await json('POST', '/signalk/v1/api/esphelm/notifications/ack', rw, { path: notifPath });
    check('the display acknowledges the alarm', r.status === 200, JSON.stringify(r.body));
    await new Promise((res) => setTimeout(res, 300));
    let method = await methodNow();
    check(
      'the alarm is silenced (method without sound)',
      JSON.stringify(method) === '["visual"]',
      JSON.stringify(method),
    );
    raise('alarm');
    await new Promise((res) => setTimeout(res, 300));
    method = await methodNow();
    check(
      'sent again with sound, it stays silent',
      JSON.stringify(method) === '["visual"]',
      JSON.stringify(method),
    );
    raise('emergency');
    await new Promise((res) => setTimeout(res, 300));
    method = await methodNow();
    check('an escalation sounds again', method?.includes('sound') === true, JSON.stringify(method));
    alarmSource.ws.close();
  } finally {
    await sk.stop();
  }
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. Server log:\n${sk.log().slice(-3000)}`);
    process.exitCode = 1;
  } else {
    console.log('\nall checks passed');
  }
}

await main();
