import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  axisLabels,
  circularMean,
  HISTORY,
  historyCount,
  historyEnabled,
  historySeries,
  type Layout,
  pointSeconds,
  ROSE_HISTORY_KEYS,
  ROSE_HISTORY_TITLES,
  roseHistorySeries,
  TILE_SLOTS,
  unwrapAround,
  type Wrap,
} from '../src/index.js';
import { FIXTURES } from './fixtures.js';

type HistoryCase =
  | { kind: 'mean'; values: number[]; wrap: Wrap; expected: number | null; note: string }
  | { kind: 'unwrap'; v: number; centre: number; wrap: Wrap; expected: number; note: string };

const readValid = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, 'valid', name), 'utf8')) as Layout;

const CASES = (
  JSON.parse(readFileSync(join(FIXTURES, 'history.cases.json'), 'utf8')) as {
    cases: HistoryCase[];
  }
).cases;

describe('value history', () => {
  it('is off unless switched on', () => {
    expect(historyEnabled({})).toBe(false);
    expect(historyEnabled({ history: true })).toBe(true);
    expect(historyEnabled({ history: false })).toBe(false);
  });

  it('names the slots first, then the three angles', () => {
    expect(ROSE_HISTORY_KEYS.slice(0, TILE_SLOTS.wind_rose.length)).toEqual(TILE_SLOTS.wind_rose);
    expect(ROSE_HISTORY_KEYS.slice(TILE_SLOTS.wind_rose.length)).toEqual([
      'apparentAngle',
      'trueDirection',
      'heading',
    ]);
    expect(Object.keys(ROSE_HISTORY_TITLES)).toEqual(ROSE_HISTORY_KEYS);
  });

  it('lists every value the layout records, and counts them against both limits', () => {
    const layout = readValid('value-history.json');
    const series = historySeries(layout);
    expect(series.map((s) => s.key)).toEqual([
      'sog',
      'depth',
      'water',
      'wind/center1',
      'wind/bottomLeft',
      'wind/apparentAngle',
      'hdg2',
    ]);
    expect(series.find((s) => s.key === 'wind/apparentAngle')).toMatchObject({
      title: 'AWA',
      path: 'environment.wind.angleApparent',
      unit: 'deg',
    });
    expect(series.find((s) => s.key === 'wind/center1')).toMatchObject({
      title: 'AWS',
      unit: 'kn',
    });
    expect(historyCount(layout)).toEqual({ count: 7, fitsPsram: true, fitsNoPsram: false });
  });

  it('skips a rose value whose slot is empty', () => {
    const series = roseHistorySeries({
      type: 'wind_rose',
      id: 'r',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      slots: { center1: { path: 'a.b' } },
      config: { heading: 'navigation.headingMagnetic' },
      history: ['center2', 'center1', 'heading'],
    });
    expect(series.map((s) => [s.key, s.title, s.path])).toEqual([
      ['r/center1', 'Centre 1', 'a.b'],
      ['r/heading', 'HDG', 'navigation.headingMagnetic'],
    ]);
  });

  it('labels the time axis in minutes, then hours', () => {
    expect(axisLabels(600)).toEqual(['-10 m', '-5 m', 'now']);
    expect(axisLabels(3600)).toEqual(['-60 m', '-30 m', 'now']);
    expect(axisLabels(21600)).toEqual(['-6 h', '-3 h', 'now']);
    expect(ageLabel(0)).toBe('now');
  });

  it('splits each window into whole-second points', () => {
    expect(HISTORY.windows.map((_, i) => pointSeconds(i))).toEqual([5, 30, 180]);
    expect(pointSeconds(9)).toBe(0);
    expect(HISTORY.noPsramWindows).toBeLessThanOrEqual(HISTORY.windows.length);
  });

  it.each(CASES.map((c) => [c.note, c] as const))('on the circle: %s', (_, c) => {
    if (c.kind === 'mean') {
      const m = circularMean(c.values, c.wrap);
      if (c.expected === null) expect(m).toBeNull();
      else expect(m).toBeCloseTo(c.expected, 6);
    } else {
      expect(unwrapAround(c.v, c.centre, c.wrap)).toBeCloseTo(c.expected, 9);
    }
  });
});
