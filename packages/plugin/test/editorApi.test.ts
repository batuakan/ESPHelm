import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hello, Layout } from '@esphelm/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, device, fixture, lastVersion, startHarness, type Harness } from './harness.js';

const minimal = fixture<Layout>('valid/minimal.json');
const windRose = fixture<Layout>('valid/three-pages-wind-rose.json');
const p4 = fixture<Hello>('hello/valid/p4.json');
const c3 = fixture<Hello>('hello/valid/c3-no-psram.json');

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const api = (method: string, path: string, body?: unknown) =>
  h.call(method, `/plugins/esphelm/api${path}`, { as: ADMIN, body });
const register = (hello: Hello) =>
  h.call('POST', '/signalk/v1/api/esphelm/devices/hello', {
    as: device(hello.deviceId),
    body: hello,
  });

describe('layouts', () => {
  it('saves a valid layout and lists it', async () => {
    const res = await api('PUT', '/layouts/minimal', minimal);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { etag: string; bytes: number; warnings: unknown[] };
    expect(body.warnings).toEqual([]);
    expect(await (await api('GET', '/layouts')).json()).toEqual([
      { id: 'minimal', name: null, pages: 1, bytes: body.bytes, etag: body.etag, devices: [] },
    ]);
    expect(await (await api('GET', '/layouts/minimal')).json()).toEqual(minimal);
  });

  it('rejects an invalid layout with validator error codes and stores nothing', async () => {
    const res = await api('PUT', '/layouts/minimal', { ...minimal, pages: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'INVALID_LAYOUT',
      errors: [{ code: 'NO_PAGES', pointer: '/pages' }],
    });
    expect(await (await api('GET', '/layouts')).json()).toEqual([]);
  });

  it('rejects an id that differs from the URL', async () => {
    const res = await api('PUT', '/layouts/other', minimal);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ID_MISMATCH' });
  });

  it('refuses to delete a layout in use, then deletes it once unassigned', async () => {
    await register(p4);
    await api('PUT', '/layouts/minimal', minimal);
    await api('PUT', `/devices/${p4.deviceId}`, { layoutId: 'minimal' });
    const inUse = await api('DELETE', '/layouts/minimal');
    expect(inUse.status).toBe(409);
    expect(await inUse.json()).toEqual({ error: 'LAYOUT_IN_USE', devices: [p4.deviceId] });
    await api('PUT', `/devices/${p4.deviceId}`, { layoutId: null });
    expect((await api('DELETE', '/layouts/minimal')).status).toBe(204);
    expect((await api('GET', '/layouts/minimal')).status).toBe(404);
  });

  it('survives a plugin restart', async () => {
    await api('PUT', '/layouts/minimal', minimal);
    h.restart();
    expect(await (await api('GET', '/layouts/minimal')).json()).toEqual(minimal);
  });

  it('reports (and does not serve) a layout file broken on disk', async () => {
    writeFileSync(join(h.dataDir, 'layouts', 'hand-edited.json'), '{"version": 2}');
    h.restart();
    expect(h.errors.join('\n')).toMatch(/hand-edited\.json is invalid \(UNSUPPORTED_VERSION\)/);
    expect(await (await api('GET', '/layouts')).json()).toEqual([]);
  });
});

describe('devices', () => {
  it('adopts and assigns, publishing the new version only when it changes', async () => {
    await register(p4);
    await api('PUT', '/layouts/minimal', minimal);
    const before = h.deltas.length;

    await api('PUT', `/devices/${p4.deviceId}`, { name: 'Helm display' });
    expect(h.deltas.length).toBe(before); // name only: nothing to download

    const res = await api('PUT', `/devices/${p4.deviceId}`, {
      state: 'adopted',
      layoutId: 'minimal',
    });
    expect(res.status).toBe(200);
    const { device: d } = (await res.json()) as { device: { servedEtag: string; name: string } };
    expect(d.name).toBe('Helm display');
    expect(lastVersion(h.deltas, p4.deviceId)).toBe(d.servedEtag);

    await api('PUT', `/devices/${p4.deviceId}`, { state: 'pending' });
    expect(lastVersion(h.deltas, p4.deviceId)).toBeNull();
  });

  it('refuses a layout the device cannot render', async () => {
    await register(c3); // renders value + bar only
    await api('PUT', '/layouts/sailing', windRose);
    const res = await api('PUT', `/devices/${c3.deviceId}`, { layoutId: 'sailing' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'INCOMPATIBLE',
      devices: [
        {
          device: c3.deviceId,
          errors: [{ code: 'UNSUPPORTED_WIDGET', message: 'device cannot render: wind_rose' }],
        },
      ],
    });
  });

  it('refuses a layout edit that would break a device using it', async () => {
    await register(c3);
    const valueOnly: Layout = { ...minimal, id: 'c3' };
    await api('PUT', '/layouts/c3', valueOnly);
    await api('PUT', `/devices/${c3.deviceId}`, { state: 'adopted', layoutId: 'c3' });
    const withGauge: Layout = {
      ...valueOnly,
      pages: [
        {
          kind: 'grid',
          id: 'main',
          grid: { cols: 1, rows: 1 },
          tiles: [
            {
              type: 'gauge',
              id: 'rpm',
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              path: 'propulsion.p0.revolutions',
              min: 0,
              max: 4000,
            },
          ],
        },
      ],
    };
    const res = await api('PUT', '/layouts/c3', withGauge);
    expect(res.status).toBe(409);
    expect((await api('GET', '/layouts/c3').then((r) => r.json())) as Layout).toEqual(valueOnly);
  });

  it('warns, but assigns, when a layout exceeds the device capacity', async () => {
    const tiny: Hello = { ...c3, capacity: { psram: false, maxLayoutBytes: 100 } };
    await register(tiny);
    await api('PUT', '/layouts/minimal', minimal);
    const res = await api('PUT', `/devices/${tiny.deviceId}`, { layoutId: 'minimal' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ warnings: [{ code: 'LAYOUT_TOO_LARGE' }] });
  });

  it('validates device updates', async () => {
    await register(p4);
    for (const body of [
      { state: 'gone' },
      { name: 'Kühlwasser' },
      { colour: 'red' },
      { layoutId: 3 },
    ]) {
      const res = await api('PUT', `/devices/${p4.deviceId}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await api('PUT', `/devices/${p4.deviceId}`, { layoutId: 'nope' })).status).toBe(404);
    expect((await api('PUT', '/devices/unknown', { state: 'adopted' })).status).toBe(404);
  });

  it('deletes a device and tells it there is nothing to show', async () => {
    await register(p4);
    await api('PUT', '/layouts/minimal', minimal);
    await api('PUT', `/devices/${p4.deviceId}`, { state: 'adopted', layoutId: 'minimal' });
    expect((await api('DELETE', `/devices/${p4.deviceId}`)).status).toBe(204);
    expect(lastVersion(h.deltas, p4.deviceId)).toBeNull();
    expect(await (await api('GET', '/devices')).json()).toEqual([]);
  });

  it('republishes every device version on start', async () => {
    await register(p4);
    await api('PUT', '/layouts/minimal', minimal);
    await api('PUT', `/devices/${p4.deviceId}`, { state: 'adopted', layoutId: 'minimal' });
    const etag = lastVersion(h.deltas, p4.deviceId);
    h.deltas.length = 0;
    h.restart();
    expect(lastVersion(h.deltas, p4.deviceId)).toBe(etag);
  });
});

describe('widget catalog', () => {
  it('lists tiles, their slots, and units', async () => {
    const body = (await (await api('GET', '/widgets')).json()) as Record<string, unknown>;
    expect(body.tiles).toEqual(['value', 'gauge', 'bar', 'switch', 'wind_rose', 'autopilot']);
    expect(body.tileSlots).toEqual({
      wind_rose: [
        'center1',
        'center2',
        'center3',
        'topLeft',
        'topRight',
        'bottomLeft',
        'bottomRight',
      ],
    });
    expect(body).not.toHaveProperty('pageWidgets');
    expect(body.units).toHaveProperty('kn.label', 'kn');
  });
});

describe('paths', () => {
  it('lists self paths sorted, with SignalK units, description and latest value', async () => {
    expect(await (await api('GET', '/paths')).json()).toEqual([
      {
        path: 'environment.depth.belowTransducer',
        units: 'm',
        description: null,
        value: 12.4,
        timestamp: '2026-10-24T12:00:01.000Z',
      },
      {
        path: 'navigation.position',
        units: null,
        description: null,
        value: { latitude: 60.15, longitude: 24.95 },
        timestamp: '2026-10-24T12:00:02.000Z',
      },
      {
        path: 'navigation.speedOverGround',
        units: 'm/s',
        description: 'Speed over ground',
        value: 3.19,
        timestamp: '2026-10-24T12:00:00.000Z',
      },
    ]);
  });
});
