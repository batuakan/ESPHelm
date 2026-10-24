import { describe, expect, it } from 'vitest';
import {
  QUANTITIES,
  UNITS,
  UNIT_IDS,
  fromDisplay,
  isUnitId,
  toDisplay,
  validateLayout,
  type UnitId,
} from '../src/index.js';
import { unitCases, validFixtures } from './fixtures.js';

/** Same tolerance as the C++ test: 1e-9 relative, at least 1e-9 absolute. */
function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

describe('unit conversion cases (shared with C++)', () => {
  it.each(unitCases())('$si SI -> $expected $unit', ({ si, unit, expected }) => {
    expect(isUnitId(unit)).toBe(true);
    const got = toDisplay(si, unit as UnitId);
    expect(close(got, expected), `got ${got}, expected ${expected}`).toBe(true);
  });

  it('covers every unit at least once', () => {
    const covered = new Set(unitCases().map((c) => c.unit));
    expect(UNIT_IDS.filter((id) => !covered.has(id))).toEqual([]);
  });
});

describe('unit table invariants', () => {
  it('each quantity lists its SI unit with factor 1 and no offset', () => {
    for (const [name, q] of Object.entries(QUANTITIES)) {
      const si = UNITS[q.si];
      expect(si.factor, name).toBe(1);
      expect(si.offset, name).toBe(0);
    }
  });

  it.each(UNIT_IDS.filter((id) => UNITS[id].wrap === null))(
    '%s round-trips SI -> display -> SI',
    (id) => {
      for (const si of [-12.5, 0, 1, 273.15, 101325]) {
        expect(close(fromDisplay(toDisplay(si, id), id), si)).toBe(true);
      }
    },
  );

  it('wrapped units stay inside [min, max)', () => {
    for (const id of UNIT_IDS) {
      const wrap = UNITS[id].wrap;
      if (!wrap) continue;
      for (let si = -20; si <= 20; si += 0.37) {
        const v = toDisplay(si, id);
        expect(v >= wrap[0] && v < wrap[1], `${id}(${si}) = ${v}`).toBe(true);
      }
    }
  });
});

describe('fixtures only use known units', () => {
  it.each(validFixtures('valid'))('$name', ({ json }) => {
    // validateLayout rejects unknown units with UNKNOWN_UNIT; valid fixtures must pass it.
    expect(validateLayout(json).errors.filter((e) => e.code === 'UNKNOWN_UNIT')).toEqual([]);
  });
});
