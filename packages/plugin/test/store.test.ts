import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hello, Layout } from '@esphelm/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { etagOf, ifNoneMatchHits, serializeLayout } from '../src/etag.js';
import { Store } from '../src/store.js';
import { fixture } from './harness.js';

const minimal = fixture<Layout>('valid/minimal.json');
const p4 = fixture<Hello>('hello/valid/p4.json');

describe('etag', () => {
  it('is stable for identical bytes and changes with content', () => {
    const a = etagOf(serializeLayout(minimal));
    expect(etagOf(serializeLayout(structuredClone(minimal)))).toBe(a);
    expect(etagOf(serializeLayout({ ...minimal, theme: 'night' }))).not.toBe(a);
    expect(a).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it.each([
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", "abc"', true],
    ['*', true],
    ['"abd"', false],
    [undefined, false],
  ])('If-None-Match %s -> %s', (header, hit) => {
    expect(ifNoneMatchHits(header, '"abc"')).toBe(hit);
  });
});

describe('Store', () => {
  let dir: string;
  let problems: string[];
  const open = () => {
    const s = new Store(dir, (m) => problems.push(m));
    s.load();
    return s;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'esphelm-store-'));
    problems = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists layouts and devices across reloads', () => {
    const s = open();
    const saved = s.saveLayout(minimal);
    s.upsertHello(p4, new Date('2026-10-24T10:00:00Z'));
    s.updateDevice(p4.deviceId, { state: 'adopted', layoutId: 'minimal', name: 'Helm' });

    const again = open();
    expect(again.getLayout('minimal')?.etag).toBe(saved.etag);
    expect(again.getDevice(p4.deviceId)).toMatchObject({
      state: 'adopted',
      layoutId: 'minimal',
      name: 'Helm',
    });
    expect(problems).toEqual([]);
    // Atomic writes leave no temp files behind.
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('first hello creates a pending device; later hellos keep state and refresh lastSeen', () => {
    const s = open();
    const first = s.upsertHello(p4, new Date('2026-10-24T10:00:00Z'));
    expect(first).toMatchObject({ created: true, device: { state: 'pending' } });
    s.updateDevice(p4.deviceId, { state: 'adopted' });
    const second = s.upsertHello(p4, new Date('2026-10-24T11:00:00Z'));
    expect(second.created).toBe(false);
    expect(second.device).toMatchObject({
      state: 'adopted',
      firstSeen: '2026-10-24T10:00:00.000Z',
      lastSeen: '2026-10-24T11:00:00.000Z',
    });
  });

  it('migrates a stored layout with the old wind-rose page kind, once', () => {
    mkdirSync(join(dir, 'layouts'), { recursive: true });
    const old = {
      ...minimal,
      id: 'old',
      pages: [
        ...minimal.pages,
        {
          kind: 'widget',
          widget: 'wind_rose',
          id: 'wind',
          config: { showTrueWind: false },
          slots: {},
        },
      ],
    };
    writeFileSync(join(dir, 'layouts', 'old.json'), JSON.stringify(old));
    const logs: string[] = [];
    const s = new Store(
      dir,
      (m) => problems.push(m),
      (m) => logs.push(m),
    );
    s.load();
    expect(problems).toEqual([]);
    expect(logs).toEqual([expect.stringContaining('old.json: wind-rose pages migrated')]);
    const page = s.getLayout('old')?.layout.pages[1];
    expect(page).toMatchObject({
      kind: 'grid',
      id: 'wind',
      grid: { cols: 1, rows: 1 },
      tiles: [{ type: 'wind_rose', id: 'wind-rose', config: { showTrueWind: false }, slots: {} }],
    });
    // Rewritten on disk with the bytes that are served, so the next load has nothing to do.
    const onDisk = readFileSync(join(dir, 'layouts', 'old.json'));
    expect(onDisk.equals(s.getLayout('old')!.bytes)).toBe(true);
    logs.length = 0;
    new Store(
      dir,
      (m) => problems.push(m),
      (m) => logs.push(m),
    ).load();
    expect(logs).toEqual([]);
  });

  it('skips and reports invalid files instead of serving them', () => {
    mkdirSync(join(dir, 'layouts'), { recursive: true });
    writeFileSync(join(dir, 'layouts', 'broken.json'), '{ not json');
    writeFileSync(
      join(dir, 'layouts', 'bad.json'),
      JSON.stringify({ ...minimal, id: 'bad', theme: 'dusk' }),
    );
    writeFileSync(join(dir, 'layouts', 'renamed.json'), JSON.stringify(minimal));
    writeFileSync(join(dir, 'devices.json'), JSON.stringify({ x: { id: 'x', hello: {} } }));
    const s = open();
    expect(s.listLayouts()).toEqual([]);
    expect(s.listDevices()).toEqual([]);
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/broken\.json could not be read/);
    expect(problems.join('\n')).toMatch(/bad\.json is invalid \(INVALID_VALUE\)/);
    expect(problems.join('\n')).toMatch(/renamed\.json has id "minimal"/);
  });

  it('clears name and layoutId when patched to undefined', () => {
    const s = open();
    s.saveLayout(minimal);
    s.upsertHello(p4, new Date());
    s.updateDevice(p4.deviceId, { layoutId: 'minimal', name: 'Helm' });
    const d = s.updateDevice(p4.deviceId, { layoutId: undefined, name: undefined });
    expect(d).not.toHaveProperty('layoutId');
    expect(d).not.toHaveProperty('name');
  });
});
