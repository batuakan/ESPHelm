/**
 * End-to-end check of signalk-esphelm inside a real signalk-server (security enabled):
 *   npm run build && npm run e2e -w signalk-esphelm
 * Needs `signalk-server` on PATH (or SIGNALK_SERVER=/path/to/bin/signalk-server). Uses a
 * throwaway config dir and free ports (scripts/sk-harness.ts); never touches ~/.signalk.
 * Tokens come from the real login and access-request flows.
 */
import { createHash } from 'node:crypto';
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

    // Zones in SignalK metadata reach the editor's path list (ADR-0020), and a device can read them.
    const zones = [{ upper: 3, state: 'alarm' }];
    r = await json('PUT', '/signalk/v1/api/vessels/self/environment/depth/belowKeel/meta', admin, {
      value: { units: 'm', zones },
    });
    check('the server takes zones for a path', r.status === 202, String(r.status));
    // signalk-server 2.30+ only lists paths that have had a value (getAvailablePaths), as on a
    // boat with a depth sounder: send one.
    const depthSource = await sk.stream(admin);
    depthSource.ws.send(
      JSON.stringify({
        context: 'vessels.self',
        updates: [{ values: [{ path: 'environment.depth.belowKeel', value: 4.2 }] }],
      }),
    );
    await new Promise((res) => setTimeout(res, 500));
    depthSource.ws.close();
    r = await json('GET', '/plugins/esphelm/api/paths', admin);
    const listed = (r.body as unknown as { path: string; zones: unknown }[]).find(
      (p) => p.path === 'environment.depth.belowKeel',
    );
    check(
      "/api/paths carries a path's zones",
      JSON.stringify(listed?.zones) === JSON.stringify(zones),
      JSON.stringify(listed),
    );
    r = await json('GET', '/signalk/v1/api/vessels/self/environment/depth/belowKeel/meta', rw);
    check(
      'a device token reads the metadata',
      r.status === 200 && JSON.stringify(r.body.zones) === JSON.stringify(zones),
      `${r.status}`,
    );
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
    // The same alarm comes back later: a display that (re)subscribes must not be replayed a
    // silenced copy from the earlier acknowledgement (it would show the new alarm as acknowledged).
    raise('normal');
    await new Promise((res) => setTimeout(res, 300));
    raise('alarm');
    await new Promise((res) => setTimeout(res, 300));
    const node = (await json('GET', restPath, admin)).body as { values?: Record<string, unknown> };
    check(
      'one source holds the notification (no silenced copy beside it)',
      !node.values || Object.keys(node.values).length === 1,
      JSON.stringify(node.values ?? {}),
    );
    const display = await sk.stream(rw);
    display.ws.send(
      JSON.stringify({
        context: 'vessels.self',
        subscribe: [{ path: 'notifications.*', policy: 'instant' }],
      }),
    );
    await new Promise((res) => setTimeout(res, 800));
    const replayed = display.messages.flatMap((m) =>
      (
        (m as { updates?: { values?: { path: string; value: { method?: string[] } }[] }[] })
          .updates ?? []
      )
        .flatMap((u) => u.values ?? [])
        .filter((v) => v.path === notifPath)
        .map((v) => v.value.method),
    );
    check(
      'a new subscriber is replayed only the sounding alarm',
      replayed.length > 0 && replayed.every((m) => m?.includes('sound')),
      JSON.stringify(replayed),
    );
    display.ws.close();
    alarmSource.ws.close();

    // Firmware updates from the editor (ADR-0036): an image through the real server's body
    // handling, the offer over a real WebSocket, the one-shot download with the device token.
    const helloOta = {
      ...fixture('hello/valid/p4-ota.json'),
      deviceId: DEVICE_ID,
    } as typeof hello & { board: string; fw: { version: string; build: string } };
    r = await json('POST', '/signalk/v1/api/esphelm/devices/hello', rw, helloOta);
    check('hello with fw.build and capabilities.ota', r.status === 200, String(r.status));
    const image = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    image[0] = 0xe9;
    image.writeUInt32LE(0xabcd5432, 0x20);
    const newBuild = 'e2'.repeat(32);
    Buffer.from(newBuild, 'hex').copy(image, 0x20 + 0x90);
    image.write(
      `ESPHELM-IMAGE/1 fw=0.9.0 board=${String(helloOta.board)} kind=color\0`,
      1 << 20,
      'latin1',
    );
    const upload = (token: string | undefined) =>
      fetch(`${sk.base}/plugins/esphelm/api/firmware`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: image,
      });
    check('a device token cannot upload firmware', (await upload(rw)).status === 401);
    const up = await upload(admin);
    const upBody = (await up.json()) as { buildId?: string; version?: string };
    check(
      'admin uploads a 4 MB image; the plugin reads its build and version',
      up.status === 201 && upBody.buildId === newBuild && upBody.version === '0.9.0',
      `${up.status} ${JSON.stringify(upBody).slice(0, 160)}`,
    );
    r = await json('GET', '/plugins/esphelm/api/devices', admin);
    const offered = (
      r.body as unknown as { id: string; updateAvailable?: { version: string } }[]
    ).find((d) => d.id === DEVICE_ID);
    check(
      'the editor sees an update for the display',
      offered?.updateAvailable?.version === '0.9.0',
    );

    const fwStream = await sk.stream(rw);
    const fwPath = `plugins.esphelm.${DEVICE_ID}.firmware`;
    const offers = () =>
      fwStream.messages.flatMap((m) =>
        ((m as { updates?: { values?: { path: string; value: unknown }[] }[] }).updates ?? [])
          .flatMap((u) => u.values ?? [])
          .filter((v) => v.path === fwPath)
          .map((v) => v.value as { request?: string; size?: number; md5?: string } | null),
      );
    fwStream.ws.send(
      JSON.stringify({ context: 'vessels.self', subscribe: [{ path: fwPath, policy: 'instant' }] }),
    );
    r = await json('POST', `/plugins/esphelm/api/devices/${DEVICE_ID}/update`, admin, {
      buildId: newBuild,
    });
    check(
      'admin asks the display to update',
      r.status === 202,
      `${r.status} ${JSON.stringify(r.body)}`,
    );
    const md5 = createHash('md5').update(image).digest('hex');
    check(
      'the display is offered the image over its stream (an object value)',
      await waitFor(() => offers().some((o) => o?.size === image.length && o.md5 === md5)),
      JSON.stringify(offers()).slice(0, 200),
    );
    const request = offers().find((o) => o?.request)?.request ?? '';
    const fwUrl = `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/firmware?request=${request}`;
    r = await json('GET', fwUrl, ro);
    check("another device's token cannot download it", r.status === 403, String(r.status));
    const dl = await fetch(sk.base + fwUrl, { headers: { Authorization: `Bearer ${rw}` } });
    const got = Buffer.from(await dl.arrayBuffer());
    check(
      'the display downloads the image with Content-Length',
      dl.status === 200 &&
        dl.headers.get('content-length') === String(image.length) &&
        got.equals(image),
      `${dl.status} ${dl.headers.get('content-length')} ${got.length}`,
    );
    check('the offer is withdrawn once downloading', await waitFor(() => offers().at(-1) === null));
    r = await json('GET', fwUrl, rw);
    check('a second download of the same request is refused (409)', r.status === 409);
    r = await json('POST', `/signalk/v1/api/esphelm/devices/${DEVICE_ID}/firmware/result`, rw, {
      request,
      error: 'the image is damaged (MD5 mismatch)',
    });
    check('the display reports a failure', r.status === 200 && r.body.state === 'failed');
    r = await json('GET', '/plugins/esphelm/api/devices', admin);
    const failedDev = (
      r.body as unknown as { id: string; update?: { state: string; error?: string } }[]
    ).find((d) => d.id === DEVICE_ID);
    check(
      'the editor shows why',
      failedDev?.update?.state === 'failed' && /MD5/.test(failedDev.update.error ?? ''),
      JSON.stringify(failedDev?.update),
    );
    // Again, and this time the display comes back on the new build.
    await json('POST', `/plugins/esphelm/api/devices/${DEVICE_ID}/update`, admin, {
      buildId: newBuild,
    });
    await waitFor(() => offers().filter((o) => o?.request && o.request !== request).length > 0);
    const request2 =
      offers()
        .filter((o) => o?.request && o.request !== request)
        .at(-1)?.request ?? '';
    await (
      await fetch(
        `${sk.base}/signalk/v1/api/esphelm/devices/${DEVICE_ID}/firmware?request=${request2}`,
        {
          headers: { Authorization: `Bearer ${rw}` },
        },
      )
    ).arrayBuffer();
    await json('POST', '/signalk/v1/api/esphelm/devices/hello', rw, {
      ...helloOta,
      fw: { version: '0.9.0', build: newBuild },
    });
    r = await json('GET', '/plugins/esphelm/api/devices', admin);
    const doneDev = (r.body as unknown as { id: string; update?: { state: string } }[]).find(
      (d) => d.id === DEVICE_ID,
    );
    check('a hello with the new build completes the update', doneDev?.update?.state === 'done');
    fwStream.ws.close();
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
