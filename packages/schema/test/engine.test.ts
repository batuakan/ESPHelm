import { describe, expect, it } from 'vitest';
import {
  ENGINE_DEFAULTS,
  ENGINE_ICON_NAMES,
  ENGINE_ICONS,
  signedArea,
  engineAngle,
  engineFont,
  engineScale,
  engineTickLabel,
  validateLayout,
} from '../src/index.js';
import { ENGINE_CASES } from './fixtures.js';

describe('engine tile geometry', () => {
  for (const c of ENGINE_CASES.scales) {
    it(`scale: ${c.note}`, () => {
      const got = engineScale(c.min, c.max, c.radius);
      expect(got.step).toBeCloseTo(c.expected.step, 6);
      expect(got.divisor).toBe(c.expected.divisor);
      const shape = (t: { kind: string; label?: string }) => [t.kind, t.label];
      expect(got.ticks.map(shape)).toEqual(c.expected.ticks.map(shape));
      got.ticks.forEach((t, i) => expect(t.value).toBeCloseTo(c.expected.ticks[i]!.value, 3));
    });
  }
  for (const c of ENGINE_CASES.angles) {
    it(`angle: ${c.gauge} ${c.value} on ${c.min}..${c.max}`, () => {
      expect(engineAngle(c.gauge, c.value, c.min, c.max)).toBeCloseTo(c.expected, 3);
    });
  }

  it('picks the largest font that fits, or none', () => {
    expect(engineFont([26, 38, 56], 40)).toBe(38);
    expect(engineFont([56, 26, 38], 100)).toBe(56);
    expect(engineFont([26, 38], 20)).toBeUndefined();
  });

  it('labels ticks without trailing zeros or a negative zero', () => {
    expect([0, -0, 10.5, 12, 0.1 + 0.2, -1e-12].map(engineTickLabel)).toEqual([
      '0',
      '0',
      '10.5',
      '12',
      '0.3',
      '0',
    ]);
  });

  it('keeps every icon inside its box, filled where the SVG is', () => {
    for (const name of ENGINE_ICON_NAMES) {
      const contours = ENGINE_ICONS[name];
      expect(contours.length).toBeGreaterThan(0);
      for (const c of contours) {
        expect(c.length % 2).toBe(0);
        expect(c.length).toBeGreaterThanOrEqual(6);
        for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
      }
      // Fitted: one side spans the whole box.
      const xs = contours.flatMap((c) => c.filter((_, i) => i % 2 === 0));
      const ys = contours.flatMap((c) => c.filter((_, i) => i % 2 === 1));
      expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))).toBe(
        1,
      );
      // Holes wind against their outline, so nonzero filling leaves them open.
      const area = Math.abs(signedArea(contours));
      expect(area).toBeGreaterThan(0.1);
      expect(area).toBeLessThan(0.8);
    }
  });

  it('a tile from the defaults is valid', () => {
    const layout = {
      version: 1,
      id: 'e',
      theme: 'day',
      pages: [
        {
          kind: 'grid',
          id: 'p',
          grid: { cols: 1, rows: 1 },
          tiles: [{ type: 'engine', id: 't', x: 0, y: 0, w: 1, h: 1, ...ENGINE_DEFAULTS }],
        },
      ],
    };
    expect(validateLayout(layout).errors).toEqual([]);
  });
});
