import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTOPILOT_FIT,
  migrateLayout,
  TEXT_FIT,
  HISTORY,
  validateLayout,
  WIND_ROSE_FIT,
} from '../src/index.js';
import { PACKAGE_ROOT } from '../scripts/render.js';

/** A layout as stored before Phase 5b, with the wind rose as a page kind. */
const old = {
  version: 1,
  id: 'old',
  theme: 'night',
  pages: [
    {
      kind: 'widget',
      widget: 'wind_rose',
      id: 'wind',
      title: 'Wind',
      config: { showTrueWind: false },
      slots: { center1: { path: 'navigation.speedOverGround', unit: 'kn', label: 'SOG' } },
    },
    {
      kind: 'grid',
      id: 'main',
      grid: { cols: 1, rows: 1 },
      tiles: [{ type: 'value', id: 'wind-rose', x: 0, y: 0, w: 1, h: 1, path: 'a.b' }],
    },
    { kind: 'widget', widget: 'wind_rose', id: 'bare', slots: {} },
  ],
};

describe('migrateLayout', () => {
  it('turns wind-rose pages into 1x1 grid pages with a rose tile, keeping config and slots', () => {
    expect(validateLayout(old).errors.map((e) => e.code)).toEqual([
      'UNKNOWN_PAGE_KIND',
      'UNKNOWN_PAGE_KIND',
    ]);
    const { layout, changed } = migrateLayout(old);
    expect(changed).toBe(true);
    expect(validateLayout(layout).errors).toEqual([]);
    expect((layout as typeof old).pages[0]).toEqual({
      kind: 'grid',
      id: 'wind',
      title: 'Wind',
      grid: { cols: 1, rows: 1 },
      tiles: [
        {
          type: 'wind_rose',
          id: 'wind-rose-1', // "wind-rose" is taken by a tile on another page
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          config: { showTrueWind: false },
          slots: old.pages[0]!.slots,
        },
      ],
    });
    expect((layout as typeof old).pages[2]).toMatchObject({
      kind: 'grid',
      tiles: [{ type: 'wind_rose', id: 'bare-rose', slots: {} }],
    });
    expect((layout as typeof old).pages[2]!).not.toHaveProperty('tiles.0.config');
  });

  it('leaves current layouts and junk alone', () => {
    const current = migrateLayout({ ...old, pages: [old.pages[1]] });
    expect(current.changed).toBe(false);
    for (const junk of [null, 'x', 3, {}, { pages: 'no' }, { pages: [null, 1] }])
      expect(migrateLayout(junk)).toEqual({ layout: junk, changed: false });
  });
});

describe('size tiers', () => {
  it('matches the generated firmware header', () => {
    const header = readFileSync(
      join(PACKAGE_ROOT, '../../firmware/components/esphelm_runtime/esphelm_sizes.h'),
      'utf8',
    );
    expect(header).toContain(`WIND_ROSE_FULL = ${WIND_ROSE_FIT.full};`);
    expect(header).toContain(`WIND_ROSE_COMPACT = ${WIND_ROSE_FIT.compact};`);
    expect(WIND_ROSE_FIT.full).toBeGreaterThan(WIND_ROSE_FIT.compact);
    expect(header).toContain(`AUTOPILOT_CONTROLS_WIDTH = ${AUTOPILOT_FIT.controlsWidth};`);
    expect(header).toContain(`AUTOPILOT_CONTROLS_HEIGHT = ${AUTOPILOT_FIT.controlsHeight};`);
    expect(header).toContain(`TEXT_COMPANION_PERCENT = ${TEXT_FIT.companionPercent};`);
    expect(header).toContain(`TEXT_SAMPLE_DIGITS = ${TEXT_FIT.sampleDigits};`);
    expect(header).toContain(`HISTORY_POINTS = ${HISTORY.points};`);
    expect(header).toContain(
      `HISTORY_WINDOW_SECONDS[HISTORY_WINDOWS] = {${HISTORY.windows.map((w) => w.seconds).join(', ')}};`,
    );
    expect(header).toContain(`HISTORY_NO_PSRAM_WINDOWS = ${HISTORY.noPsramWindows};`);
    expect(header).toContain(`HISTORY_MAX_VALUES_NO_PSRAM = ${HISTORY.maxValuesNoPsram};`);
  });
});
