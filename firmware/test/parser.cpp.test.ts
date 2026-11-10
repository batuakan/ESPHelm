/**
 * Contract test for the firmware layout parser (firmware/components/esphelm_runtime/layout_parser.cpp).
 * Every layout fixture, plus extra mutations, is run through both the C++ parser and the TS
 * validateLayout(); the {code, pointer} sets must be identical, except for the two documented
 * differences: the firmware ignores unknown fields (UNKNOWN_FIELD), and has device-only codes
 * (INVALID_JSON, CAPACITY_EXCEEDED), which are tested separately below.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLayout } from '@esphelm/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arduinoJsonSrc } from './arduinojson.js';

const FIRMWARE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(FIRMWARE, '../packages/schema/fixtures');
const RUNTIME = join(FIRMWARE, 'components/esphelm_runtime');

interface DriverResult {
  file: string;
  ok: boolean;
  errors: { code: string; pointer: string }[];
  pages: number;
  tiles: number;
}

function hasCompiler(): boolean {
  try {
    execFileSync('g++', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const compiler = hasCompiler();
if (!compiler) {
  console.warn('\n*** g++ not found: SKIPPING the firmware parser contract test ***\n');
}

const sortErrors = (errors: { code: string; pointer: string }[]) =>
  [...errors].sort((a, b) => `${a.pointer}|${a.code}`.localeCompare(`${b.pointer}|${b.code}`));

/** What the firmware must report for a document, derived from the TS validator. */
function expectedFirmwareErrors(doc: unknown) {
  return sortErrors(
    validateLayout(doc)
      .errors.filter((e) => e.code !== 'UNKNOWN_FIELD')
      .map(({ code, pointer }) => ({ code, pointer })),
  );
}

const fixtureDocs: { name: string; doc: unknown }[] = [
  ...readdirSync(join(FIXTURES, 'valid')).map((f) => ({
    name: `valid/${f}`,
    doc: JSON.parse(readFileSync(join(FIXTURES, 'valid', f), 'utf8')) as unknown,
  })),
  ...readdirSync(join(FIXTURES, '../templates')).map((f) => ({
    name: `templates/${f}`,
    doc: JSON.parse(readFileSync(join(FIXTURES, '../templates', f), 'utf8')) as unknown,
  })),
  ...readdirSync(join(FIXTURES, 'invalid')).map((f) => ({
    name: `invalid/${f}`,
    doc: (JSON.parse(readFileSync(join(FIXTURES, 'invalid', f), 'utf8')) as { layout: unknown })
      .layout,
  })),
];

const minimal = JSON.parse(readFileSync(join(FIXTURES, 'valid/minimal.json'), 'utf8')) as {
  pages: { tiles: Record<string, unknown>[] }[];
} & Record<string, unknown>;
const withTile = (patch: Record<string, unknown>) => ({
  ...minimal,
  pages: [{ ...minimal.pages[0], tiles: [{ ...minimal.pages[0]?.tiles[0], ...patch }] }],
});

/** Extra mutations beyond the fixtures, compared the same way (differential test). */
const mutations: { name: string; doc: unknown }[] = [
  { name: 'integer written as 2.0', doc: withTile({ w: 1.0, decimals: 2.0 }) },
  {
    name: 'engine slots not an object',
    doc: withTile({ type: 'engine', min: 0, max: 5000, slots: [] }),
  },
  {
    name: 'engine slot: not an object, no path, an unknown unit and zone state, a numeric icon',
    doc: withTile({
      type: 'engine',
      min: 0,
      max: 5000,
      slots: {
        left: 'oil',
        right: { min: 0, max: 6, unit: 'furlongs', zones: [{ from: 0, to: 1, state: 'red' }] },
        bottom: { path: 'propulsion.p0.temperature', min: 40, max: 120, icon: 2 },
      },
    }),
  },
  {
    name: 'engine slot zones not an array, and a zone without ends',
    doc: withTile({
      type: 'engine',
      min: 0,
      max: 5000,
      zones: [{ state: 'alarm' }],
      slots: { left: { path: 'propulsion.p0.oilPressure', min: 0, max: 6, zones: 'low' } },
    }),
  },
  {
    name: 'engine corners: not an object, no path, an unknown unit, a label out of the charset',
    doc: withTile({
      type: 'engine',
      min: 0,
      max: 5000,
      slots: {
        topLeft: 12,
        topRight: { unit: 'furlongs' },
        bottomLeft: { path: 'propulsion.p0.runTime', label: 'Stunden ü' },
        bottomRight: { path: 'propulsion.p0.fuel.rate', unit: 'Lph', decimals: 1 },
      },
    }),
  },
  {
    name: 'engine without min and max',
    doc: withTile({ type: 'engine', slots: {} }),
  },
  { name: 'settings not an object', doc: { ...minimal, settings: 'bright' } },
  { name: 'position format of the wrong type', doc: withTile({ type: 'position', format: 3 }) },
  { name: 'value colour of the wrong type', doc: withTile({ color: 1 }) },
  {
    name: 'heading tape span of the wrong type',
    doc: withTile({ type: 'heading_tape', span: '90' }),
  },
  {
    name: 'heading tape markers: not strings, and not an array',
    doc: withTile({ type: 'heading_tape', markers: [1, 'cog'] }),
  },
  {
    name: 'heading tape markers not an array',
    doc: withTile({ type: 'heading_tape', markers: 'cog' }),
  },
  {
    name: 'heading tape with a zero stale time',
    doc: withTile({ type: 'heading_tape', staleAfter: 0 }),
  },
  {
    name: 'centre zero of the wrong type',
    doc: withTile({ type: 'gauge', min: -10, max: 10, centerZero: 'yes' }),
  },
  {
    name: 'centre zero on a scale that does not cross zero, with sides of the wrong type',
    doc: withTile({ type: 'bar', min: -10, max: -2, centerZero: true, sides: 3 }),
  },
  {
    name: 'centre zero with min above max',
    doc: withTile({ type: 'gauge', min: 10, max: -10, centerZero: true }),
  },
  { name: 'graph window of the wrong type', doc: withTile({ type: 'graph', window: 10 }) },
  { name: 'graph with only max', doc: withTile({ type: 'graph', max: 5 }) },
  { name: 'graph min of the wrong type', doc: withTile({ type: 'graph', min: '0', max: 5 }) },
  {
    name: 'graph zones with open ends and an inverted one',
    doc: withTile({
      type: 'graph',
      zones: [
        { to: 2, state: 'alarm' },
        { from: 5, to: 4, state: 'warn' },
      ],
    }),
  },
  {
    name: 'value zones of the wrong types',
    doc: withTile({ zones: [{ from: '1', state: 'warn' }, { to: 2, state: 'loud' }, 'x'] }),
  },
  { name: 'value zones not an array', doc: withTile({ zones: { to: 2, state: 'alarm' } }) },
  { name: 'value zone with min/max on a value tile', doc: withTile({ min: 0, max: 10 }) },
  {
    name: 'value zones, several problems at once',
    doc: withTile({
      zones: [{ state: 'warn' }, { from: 5, to: 5, state: 'alarm' }, { to: 1, state: 'normal' }],
    }),
  },
  {
    name: 'position with a zero stale time and fractional decimals',
    doc: withTile({ type: 'position', staleAfter: 0, decimals: 1.5 }),
  },
  {
    name: 'settings fields of the wrong type',
    doc: {
      ...minimal,
      settings: { brightness: 50, startPage: 3, autoTheme: 1, screenTimeout: 2.5 },
    },
  },
  {
    name: 'clock fields of the wrong type',
    doc: withTile({ type: 'clock', show: 1, hour12: 'yes', seconds: 0, utc: null, label: 3 }),
  },
  { name: 'clock date format of the wrong type', doc: withTile({ type: 'clock', dateFormat: 1 }) },
  { name: 'time zone not an object', doc: { ...minimal, settings: { timeZone: 'Europe/Oslo' } } },
  {
    name: 'time zone without its fields',
    doc: { ...minimal, settings: { timeZone: {} } },
  },
  {
    name: 'time zone with a bad name and a number for a rule',
    doc: { ...minimal, settings: { timeZone: { name: 'Europe Oslo', posix: 1 } } },
  },
  {
    name: 'time zone rules the device must refuse',
    doc: {
      ...minimal,
      settings: { timeZone: { name: 'Etc/Test', posix: 'CET-1CEST,M3.5.0,M10.5.0/3x' } },
    },
  },
  {
    name: 'clock settings of the wrong type and out of range',
    doc: {
      ...minimal,
      settings: { clockPath: 'a..b', screenSaver: true, screenSaverBrightness: 0 },
    },
  },
  { name: 'sound not an object', doc: { ...minimal, settings: { sound: 60 } } },
  {
    name: 'sound volume under 10 % and touch not a boolean',
    doc: { ...minimal, settings: { sound: { volume: 9, touch: 'yes' } } },
  },
  {
    name: 'sound volume fractional',
    doc: { ...minimal, settings: { sound: { volume: 50.5, touch: true } } },
  },
  { name: 'fractional integer', doc: withTile({ x: 0.5 }) },
  { name: 'null optional field', doc: withTile({ label: null }) },
  { name: 'number as label', doc: withTile({ label: 42 }) },
  { name: 'unit not a string', doc: withTile({ unit: 3 }) },
  { name: 'staleAfter zero', doc: withTile({ staleAfter: 0 }) },
  { name: 'theme not a string', doc: { ...minimal, theme: 5 } },
  { name: 'version as string', doc: { ...minimal, version: '1' } },
  { name: 'version missing', doc: { ...minimal, version: undefined } },
  { name: 'pages not an array', doc: { ...minimal, pages: {} } },
  { name: 'page not an object', doc: { ...minimal, pages: [3] } },
  { name: 'tile not an object', doc: withTileList(['x']) },
  { name: 'degree sign in label', doc: withTile({ label: 'HDG 12°T' }) },
  { name: 'path with empty segment', doc: withTile({ path: 'navigation..speed' }) },
  { name: 'path with trailing dot', doc: withTile({ path: 'navigation.' }) },
  { name: 'id starting with dash', doc: withTile({ id: '-sog' }) },
  {
    name: 'several errors at once',
    doc: withTile({ id: 'X', x: -1, unit: 'furlong', label: 'ä' }),
  },
  {
    name: 'gauge with every zone problem',
    doc: withTile({
      type: 'gauge',
      min: 0,
      max: 10,
      zones: [
        { from: 5, to: 2, state: 'warn' },
        { from: -1, to: 3, state: 'alarm' },
        { from: 1, to: 2 },
        'z',
      ],
    }),
  },
  {
    name: 'wind rose with bad config and slot',
    doc: withTileList([
      {
        type: 'wind_rose',
        id: 'w',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        config: { heading: 'a.*', showTrueWind: 'yes', extra: 1 },
        slots: { center1: { unit: 'kn' }, center2: 7, top: {} },
      },
    ]),
  },
  {
    name: 'autopilot with odd modes and config',
    doc: withTileList([
      { type: 'autopilot', id: 'a', x: 0, y: 0, w: 1, h: 1, modes: [1, 1, 'wind', 'wind', null] },
      {
        type: 'autopilot',
        id: 'b',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        modes: 'auto',
        config: { statePath: 3, extra: 'x' },
        label: 'Pilot ä',
      },
      { type: 'autopilot', id: 'c', x: 0, y: 0, w: 1, h: 1, config: [] },
    ]),
  },
  {
    name: 'chart tiles with odd fields',
    doc: withTileList([
      {
        type: 'chart',
        id: 'a',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        chart: 'ok',
        zoom: 0,
        anchor: 'yes',
        config: [],
      },
      {
        type: 'chart',
        id: 'b',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        chart: '',
        zoom: 2.5,
        config: { headingPath: 7, extra: 1 },
      },
      { type: 'chart', id: 'c', x: 0, y: 0, w: 1, h: 1, chart: 5, zoom: '15', label: 'x' },
      { type: 'chart', id: 'a', x: 0, y: 0, w: 1, h: 1, chart: 'dup' },
    ]),
  },
  {
    name: 'the old chart page kind',
    doc: {
      ...minimal,
      pages: [{ kind: 'chart', id: 'a', chart: 'ok', zoom: 0, anchor: 'yes', config: [] }],
    },
  },
  {
    name: 'wind rose without slots and the old page kind',
    doc: {
      ...minimal,
      pages: [
        { ...minimal.pages[0], tiles: [{ type: 'wind_rose', id: 'w', x: 0, y: 0, w: 1, h: 1 }] },
        { kind: 'widget', widget: 'wind_rose', id: 'old', slots: {} },
      ],
    },
  },
];

function withTileList(tiles: unknown[]) {
  return { ...minimal, pages: [{ ...minimal.pages[0], tiles }] };
}

describe.skipIf(!compiler)('firmware layout parser', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-parser-'));
  const exe = join(dir, 'parser_driver');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeAll(() => {
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      `-I${RUNTIME}`,
      `-I${arduinoJsonSrc()}`,
      join(RUNTIME, 'layout_parser.cpp'),
      join(FIRMWARE, 'test/cpp/parser_driver.cpp'),
      '-o',
      exe,
    ]);
  }, 120_000);

  /** Run the driver on raw byte strings; returns one result per input. */
  function run(inputs: string[], args: string[] = []): DriverResult[] {
    const files = inputs.map((content, i) => {
      const f = join(dir, `in-${i}.json`);
      writeFileSync(f, content);
      return f;
    });
    const out = execFileSync(exe, [...args, ...files], { encoding: 'utf8' });
    return out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as DriverResult);
  }

  describe('agrees with validateLayout', () => {
    const cases = [...fixtureDocs, ...mutations];
    let results: DriverResult[] = [];
    beforeAll(() => {
      results = run(cases.map((c) => JSON.stringify(c.doc)));
    });

    it.each(cases.map((c, i) => [c.name, i] as const))('%s', (_name, i) => {
      const doc = cases[i]?.doc;
      const got = results[i];
      const expected = expectedFirmwareErrors(doc);
      expect(sortErrors(got?.errors ?? [])).toEqual(expected);
      expect(got?.ok).toBe(expected.length === 0);
    });
  });

  it('builds the model for a valid layout', () => {
    const [r] = run([readFileSync(join(FIXTURES, 'valid/legacy-port.json'), 'utf8')]);
    expect(r).toMatchObject({ ok: true, pages: 4, tiles: 10, roseSlots: 3 });
  });

  it('ignores unknown fields (forward compatibility within a major)', () => {
    const [r] = run([JSON.stringify({ ...minimal, futureField: { anything: true } })]);
    expect(r).toMatchObject({ ok: true, errors: [] });
  });

  describe('device-only guards', () => {
    it.each([
      ['truncated JSON', '{"version": 1, "id": "x", "pages": ['],
      ['garbage bytes', '\u0000ÿ not json'],
      ['empty body', ''],
    ])('%s -> INVALID_JSON', (_name, body) => {
      expect(run([body])[0]).toMatchObject({
        ok: false,
        errors: [{ code: 'INVALID_JSON', pointer: '' }],
      });
    });

    it('rejects nesting deeper than the limit', () => {
      const deep = `${'['.repeat(64)}${']'.repeat(64)}`;
      expect(run([deep])[0]?.errors).toEqual([{ code: 'CAPACITY_EXCEEDED', pointer: '' }]);
    });

    it('rejects a body larger than the device can buffer', () => {
      const body = JSON.stringify(minimal);
      const [r] = run([body], ['--max-bytes', String(body.length - 1)]);
      expect(r?.errors).toEqual([{ code: 'CAPACITY_EXCEEDED', pointer: '' }]);
      expect(run([body], ['--max-bytes', String(body.length)])[0]?.ok).toBe(true);
    });

    it('rejects strings longer than the device string buffer', () => {
      // The tile path is 26 bytes, so a 30-byte limit only trips on the 32-byte label.
      const label = 'A label of exactly 32 bytes long';
      const [r] = run([JSON.stringify(withTile({ label }))], ['--max-string', '30']);
      expect(r?.errors).toEqual([{ code: 'CAPACITY_EXCEEDED', pointer: '/pages/0/tiles/0/label' }]);
    });
  });
});
