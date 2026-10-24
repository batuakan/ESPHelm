import type { Hello, Layout } from '@esphelm/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ANON_AUTO,
  device,
  fixture,
  lastVersion,
  startHarness,
  type Harness,
  type Principal,
} from './harness.js';

const p4 = fixture<Hello>('hello/valid/p4.json');
const minimal = fixture<Layout>('valid/minimal.json');
const ID = p4.deviceId;
const OTHER = 'aabbccdd-0011-2233-0ba2-aabbccddeeff';

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const hello = (as?: Principal, body: unknown = p4) =>
  h.call('POST', '/signalk/v1/api/esphelm/devices/hello', { as, body });
const getLayout = (as?: Principal, headers?: Record<string, string>) =>
  h.call('GET', `/signalk/v1/api/esphelm/devices/${ID}/layout`, { as, headers });

/** Register, adopt and assign the minimal layout to the P4 device. */
async function adoptWithLayout() {
  await hello(device(ID));
  await h.call('PUT', '/plugins/esphelm/api/layouts/minimal', { as: ADMIN, body: minimal });
  await h.call('PUT', `/plugins/esphelm/api/devices/${ID}`, {
    as: ADMIN,
    body: { state: 'adopted', layoutId: 'minimal' },
  });
}

describe('device authentication (security enabled)', () => {
  it.each<[string, Principal | undefined, number, string]>([
    ['no principal', undefined, 401, 'DEVICE_TOKEN_REQUIRED'],
    ['anonymous AUTO readonly', ANON_AUTO, 401, 'DEVICE_TOKEN_REQUIRED'],
    ['readonly device token', device(ID, 'readonly'), 403, 'READWRITE_REQUIRED'],
    ['another device', device(OTHER), 403, 'DEVICE_MISMATCH'],
  ])('hello with %s -> %i %s', async (_label, as, status, error) => {
    const res = await hello(as);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error });
  });

  it.each<[string, Principal | undefined, number]>([
    ['no principal', undefined, 401],
    ['anonymous AUTO readonly', ANON_AUTO, 401],
    ['readonly device token', device(ID, 'readonly'), 403],
    ['another device', device(OTHER), 403],
    ['the device itself', device(ID), 200],
    ['admin', ADMIN, 200],
  ])('layout with %s -> %i', async (_label, as, status) => {
    await adoptWithLayout();
    expect((await getLayout(as)).status).toBe(status);
  });

  it('accepts unauthenticated devices when SignalK security is disabled', async () => {
    h.security.disabled = true;
    const res = await hello(undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ security: 'disabled' });
  });
});

describe('POST hello', () => {
  it('registers a pending device and publishes a null version', async () => {
    const res = await hello(device(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: 'pending',
      versionPath: `plugins.esphelm.${ID}.version`,
      layoutEtag: null,
      security: 'enabled',
    });
    expect(lastVersion(h.deltas, ID)).toBeNull();
  });

  it('rejects an invalid hello with schema error codes', async () => {
    const bad = { ...p4, display: { width: 720, height: 720, rotation: 45 } };
    const res = await hello(device(ID), bad);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'INVALID_HELLO',
      errors: [{ code: 'INVALID_VALUE', pointer: '/display/rotation' }],
    });
  });

  it('reports the current layout ETag to an adopted device', async () => {
    await adoptWithLayout();
    const etag = (await getLayout(device(ID))).headers.get('etag');
    expect(await (await hello(device(ID))).json()).toMatchObject({
      state: 'adopted',
      layoutEtag: etag,
    });
  });
});

describe('GET layout', () => {
  it('explains why there is nothing to serve', async () => {
    expect(await (await getLayout(device(ID))).json()).toMatchObject({ error: 'NOT_REGISTERED' });
    await hello(device(ID));
    expect(await (await getLayout(device(ID))).json()).toMatchObject({ error: 'NOT_ADOPTED' });
    await h.call('PUT', `/plugins/esphelm/api/devices/${ID}`, {
      as: ADMIN,
      body: { state: 'adopted' },
    });
    const res = await getLayout(device(ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'NO_LAYOUT' });
  });

  it('serves the layout with an ETag, answers 304 when unchanged, and changes the ETag on edit', async () => {
    await adoptWithLayout();
    const first = await getLayout(device(ID));
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toMatch(/application\/json/);
    expect(first.headers.get('cache-control')).toBe('no-cache');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(await first.json()).toEqual(minimal);
    expect(lastVersion(h.deltas, ID)).toBe(etag);

    const notModified = await getLayout(device(ID), { 'If-None-Match': etag ?? '' });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe(etag);
    expect(await notModified.text()).toBe('');

    await h.call('PUT', '/plugins/esphelm/api/layouts/minimal', {
      as: ADMIN,
      body: { ...minimal, theme: 'night' },
    });
    const changed = await getLayout(device(ID), { 'If-None-Match': etag ?? '' });
    expect(changed.status).toBe(200);
    const newEtag = changed.headers.get('etag');
    expect(newEtag).not.toBe(etag);
    expect(lastVersion(h.deltas, ID)).toBe(newEtag);
  });

  it('answers 503 before the plugin is started', async () => {
    h.service.stop();
    expect((await getLayout(device(ID))).status).toBe(503);
  });
});
