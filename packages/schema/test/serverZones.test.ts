import { describe, expect, it } from 'vitest';
import { serverZonesToDisplay, UNITS, type UnitId } from '../src/index.js';
import { serverZoneCases } from './fixtures.js';

describe('serverZonesToDisplay (fixtures/server-zones.cases.json)', () => {
  it.each(serverZoneCases())('$note', (c) => {
    const got = c.range
      ? serverZonesToDisplay(c.zones, c.unit as UnitId | undefined, c.range)
      : serverZonesToDisplay(c.zones, c.unit as UnitId | undefined);
    expect(got.length).toBe(c.expected.length);
    got.forEach((z, i) => {
      const e = c.expected[i]!;
      expect(z.state).toBe(e.state);
      expect(z.from === undefined).toBe(e.from === undefined);
      expect(z.to === undefined).toBe(e.to === undefined);
      if (e.from !== undefined) expect(z.from).toBeCloseTo(e.from, 6);
      if (e.to !== undefined) expect(z.to).toBeCloseTo(e.to, 6);
    });
  });

  it('every unit keeps the order of a zone (a positive factor)', () => {
    for (const u of Object.values(UNITS)) expect(u.factor).toBeGreaterThan(0);
  });
});
