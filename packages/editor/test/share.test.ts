import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Layout as LayoutSchema,
  SkPath,
  TEMPLATES,
  validateLayout,
  type Layout,
} from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import {
  layoutCharts,
  layoutPathRefs,
  newLayoutFor,
  replaceChart,
  replacePath,
} from '../src/layoutOps';
import { IMPORT_MAX_BYTES, exportFile, missingRefs, parseImport } from '../src/share';

const FIXTURES = fileURLToPath(new URL('../../schema/fixtures/valid', import.meta.url));
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, layout: JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Layout }));
const examples = [
  ...fixtures,
  ...Object.values(TEMPLATES).map((l) => ({ name: `template ${l.id}`, layout: l })),
];
const fixture = (name: string) => fixtures.find((f) => f.name === name)!.layout;

const current = { ...newLayoutFor({ id: 'helm', name: 'Helm' }) };
const paths = (l: Layout) => layoutPathRefs(l).map((r) => r.path);

describe('exportFile', () => {
  it('names the file after the layout and round-trips', () => {
    const l = fixture('multi-page-widgets-480.json');
    const { fileName, text } = exportFile({ ...l, name: 'Cockpit: Port & Stbd' });
    expect(fileName).toBe('esphelm-cockpit-port-stbd.json');
    expect(JSON.parse(text)).toEqual({ ...l, name: 'Cockpit: Port & Stbd' });
    expect(exportFile({ ...l, name: undefined, id: 'display-a1' }).fileName).toBe(
      'esphelm-display-a1.json',
    );
    expect(exportFile({ ...l, name: '°°' }).fileName).toBe('esphelm-layout.json');
  });
});

describe('parseImport', () => {
  it('keeps the display’s id and name, takes everything else from the file', () => {
    const l = fixture('settings.json');
    const r = parseImport(exportFile(l).text, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe(l.name);
    expect(r.layout).toEqual({ ...l, id: current.id, name: 'Helm' });
    expect(validateLayout(r.layout).ok).toBe(true);
  });

  it('drops the file’s name when the display’s layout has none', () => {
    const r = parseImport(JSON.stringify({ ...fixture('minimal.json'), name: 'Theirs' }), {
      ...current,
      name: undefined,
    });
    expect(r.ok && 'name' in r.layout).toBe(false);
  });

  it('upgrades a layout from before Phase 5b (wind rose page)', () => {
    const old = {
      version: 1,
      id: 'old',
      theme: 'night',
      pages: [{ kind: 'widget', widget: 'wind_rose', id: 'wind', slots: {} }],
    };
    const r = parseImport(JSON.stringify(old), current);
    expect(r.ok && r.layout.pages[0]?.kind).toBe('grid');
  });

  it('refuses what isn’t a valid layout', () => {
    expect(parseImport('not json', current)).toMatchObject({ ok: false, errors: [/not JSON/] });
    expect(parseImport(' '.repeat(IMPORT_MAX_BYTES + 1), current)).toMatchObject({
      ok: false,
      errors: [/larger/],
    });
    const bad = parseImport(JSON.stringify({ version: 2, id: 'x', pages: [] }), current);
    expect(bad.ok).toBe(false);
    const many = parseImport(
      JSON.stringify({ ...fixture('minimal.json'), a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }),
      current,
    );
    expect(many.ok).toBe(false);
    if (!many.ok) {
      expect(many.errors).toHaveLength(6);
      expect(many.errors[5]).toMatch(/^and \d+ more$/);
    }
  });
});

describe('layoutPathRefs and replacePath', () => {
  it('knows every path field of the schema', () => {
    // A new SkPath field in the schema must be handled by layoutPathRefs; then add it here.
    const found = new Set<string>();
    const walk = (s: unknown, key?: string) => {
      if (Array.isArray(s)) return s.forEach((x) => walk(x, key));
      if (typeof s !== 'object' || s === null) return;
      const o = s as Record<string, unknown>;
      if (key && o.type === 'string' && o.pattern === (SkPath as { pattern?: string }).pattern)
        found.add(key);
      for (const [k, v] of Object.entries(o))
        walk(v, k === 'properties' || k === 'anyOf' || k === 'items' ? key : k);
      if (o.properties) for (const [k, v] of Object.entries(o.properties as object)) walk(v, k);
    };
    walk(LayoutSchema);
    expect([...found].sort()).toEqual(
      [
        'path', // value, gauge, bar, switch, graph, position tiles and wind-rose slots
        'headingPath', // heading tape, autopilot, chart page
        'cogPath',
        'bearingPath',
        'targetPath', // heading tape, autopilot
        'statePath',
        'adjustPath',
        'apparentAngle',
        'trueDirection',
        'heading', // wind rose
        'beatAngle',
        'gybeAngle',
        'targetAngle',
        'waypointBearing', // wind rose performance (ADR-0029)
        'positionPath',
        'anchorPositionPath',
        'anchorRadiusPath',
        'anchorAlarmPath', // chart page
        'autoThemePath',
        'clockPath', // settings
      ].sort(),
    );
  });

  it.each(examples)('replaces every path of $name, and the result is valid', ({ layout }) => {
    let l = layout;
    const before = [...new Set(paths(layout))];
    before.forEach((p, i) => (l = replacePath(l, p, `remapped.p${i}`)));
    expect(validateLayout(l).errors).toEqual([]);
    expect(new Set(paths(l))).toEqual(new Set(before.map((_, i) => `remapped.p${i}`)));
  });

  it('writes the field when a default was in use', () => {
    const l = fixture('heading-tape.json');
    expect(paths(l)).toContain('navigation.courseOverGroundTrue');
    const r = replacePath(l, 'navigation.courseOverGroundTrue', 'navigation.cogTrue');
    expect(paths(r)).not.toContain('navigation.courseOverGroundTrue');
    expect(JSON.stringify(r)).toContain('"cogPath":"navigation.cogTrue"');
  });

  it('counts the clock path only with a clock, and the sun path only with auto day/night', () => {
    const minimal = fixture('minimal.json');
    expect(paths(minimal)).not.toContain('navigation.datetime');
    expect(paths(minimal)).not.toContain('environment.sun');
    expect(paths(fixture('clock.json'))).toContain('navigation.datetime');
    const sun = { ...minimal, settings: { autoTheme: 'sun' as const } };
    expect(paths(sun)).toContain('environment.sun');
    expect(replacePath(sun, 'environment.sun', 'environment.sun2').settings?.autoThemePath).toBe(
      'environment.sun2',
    );
  });

  it('replaces a chart', () => {
    const l = fixture('chart-page.json');
    const [first] = layoutCharts(l);
    expect(first).toBe('test-chart');
    const r = replaceChart(l, first!, 'other-chart');
    expect(layoutCharts(r)).toEqual(['other-chart', 'OSM.raster_v2']);
  });
});

describe('missingRefs', () => {
  it('lists the paths and charts this server lacks, with their uses', () => {
    const l = fixture('chart-page.json');
    const all = paths(l);
    const first = all[0]!;
    const known = new Set(all.filter((p) => p !== first));
    const m = missingRefs(l, known, new Set());
    expect(m[0]).toEqual({
      kind: 'path',
      value: first,
      uses: all.filter((p) => p === first).length,
    });
    expect(m.some((x) => x.kind === 'chart')).toBe(true);
    const chartIds = new Set(layoutCharts(l));
    expect(missingRefs(l, new Set(all), chartIds)).toEqual([]);
  });
});
