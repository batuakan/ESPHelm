import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABEL_PATTERN, validateHello, type Hello, type Layout } from '@esphelm/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_TILES, DEMO_DISPLAYS, MONO_TILES, isDemoId } from '../src/demo.js';
import { ADMIN, device, fixture, startHarness, type Harness } from './harness.js';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '../../../firmware/components');
const minimal = fixture<Layout>('valid/minimal.json');
const p4 = fixture<Hello>('hello/valid/p4.json');
const [d480, , dMono, dCyd] = DEMO_DISPLAYS.map((d) => d.hello);

/** The tile names a tile set's tile_types() lists first, in the C++ source. */
function tileTypes(file: string): string[] {
  const src = readFileSync(join(COMPONENTS, file), 'utf8');
  const list = /tile_types\([^)]*\)\s*\{\s*for \(const char \*t : \{([^}]*)\}/.exec(src)?.[1];
  return [...(list ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe('demo displays (ADR-0041)', () => {
  let h: Harness;
  afterEach(() => h?.close());
  const api = (method: string, path: string, body?: unknown) =>
    h.call(method, `/plugins/esphelm/api${path}`, { as: ADMIN, body });
  const devices = async () =>
    (await (await api('GET', '/devices')).json()) as {
      id: string;
      name?: string;
      state: string;
      demo?: boolean;
      layoutId?: string;
    }[];

  it('have valid hellos and list the tile sets the firmware has', () => {
    for (const d of DEMO_DISPLAYS) {
      expect(validateHello(d.hello).ok, d.name).toBe(true);
      expect(isDemoId(d.hello.deviceId)).toBe(true);
      expect(d.hello.capabilities.ota).toBeUndefined();
      // The editor names a new layout after its display; layout names are display text.
      expect(new RegExp(LABEL_PATTERN, 'u').test(d.name), d.name).toBe(true);
    }
    expect(tileTypes('esphelm_tiles_color/tiles_color.cpp')).toEqual([...COLOR_TILES]);
    expect(tileTypes('esphelm_tiles_mono/tiles_mono.cpp')).toEqual([...MONO_TILES]);
    expect(dCyd!.widgets).not.toContain('chart');
    expect(dMono!.display.kind).toBe('mono');
    expect(isDemoId(p4.deviceId)).toBe(false);
  });

  it('are listed adopted when on, keep their name and layout, and go when turned off', async () => {
    h = await startHarness({ demoDisplays: true });
    const list = await devices();
    expect(list.map((d) => [d.name, d.state, d.demo])).toEqual(
      DEMO_DISPLAYS.map((d) => [d.name, 'adopted', true]),
    );
    expect((await api('PUT', '/layouts/minimal', minimal)).status).toBe(200);
    const put = await api('PUT', `/devices/${d480!.deviceId}`, {
      layoutId: 'minimal',
      name: 'Mine',
    });
    expect(put.status).toBe(200);
    // Saving a demo's layout publishes no version: nothing subscribes to it.
    expect(h.deltas.some((x) => JSON.stringify(x).includes(d480!.deviceId))).toBe(false);

    h.restart();
    const again = (await devices()).find((d) => d.id === d480!.deviceId);
    expect(again).toMatchObject({ name: 'Mine', layoutId: 'minimal', demo: true });

    h.restart({ demoDisplays: false });
    expect(await devices()).toEqual([]);
    expect((await api('GET', '/layouts/minimal')).status).toBe(200);
  });

  it('never reach the device side and cannot be deleted or updated', async () => {
    h = await startHarness({ demoDisplays: true });
    const id = d480!.deviceId;
    const hello = await h.call('POST', '/signalk/v1/api/esphelm/devices/hello', {
      as: ADMIN,
      body: d480,
    });
    expect(hello.status).toBe(403);
    expect(await hello.json()).toMatchObject({ error: 'DEMO_DEVICE' });
    await api('PUT', '/layouts/minimal', minimal);
    await api('PUT', `/devices/${id}`, { layoutId: 'minimal' });
    const layout = await h.call('GET', `/signalk/v1/api/esphelm/devices/${id}/layout`, {
      as: device(id),
    });
    expect(layout.status).toBe(404);
    const del = await api('DELETE', `/devices/${id}`);
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({ error: 'DEMO_DEVICE' });
    const update = await api('POST', `/devices/${id}/update`, { buildId: 'x' });
    expect(update.status).toBe(409);
    expect(await update.json()).toMatchObject({ error: 'DEMO_DEVICE' });
  });

  it('get the same compatibility checks as real displays', async () => {
    h = await startHarness({ demoDisplays: true });
    const chart = fixture<Layout>('valid/chart-tiles.json');
    expect((await api('PUT', `/layouts/${chart.id}`, chart)).status).toBe(200);
    const res = await api('PUT', `/devices/${dCyd!.deviceId}`, { layoutId: chart.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'INCOMPATIBLE' });
  });

  it('are off unless the service is started with them', async () => {
    h = await startHarness();
    expect(await devices()).toEqual([]);
  });
});
