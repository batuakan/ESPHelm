import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPosition, POSITION_FORMATS, type PositionFormat } from '../src/position.js';
import { FIXTURES } from './fixtures.js';

interface PositionCase {
  value: unknown;
  format: PositionFormat;
  decimals?: number;
  expected: { lat: string; lon: string } | null;
}

const cases = (
  JSON.parse(readFileSync(join(FIXTURES, 'position.cases.json'), 'utf8')) as {
    cases: PositionCase[];
  }
).cases;

describe('formatPosition (fixtures/position.cases.json)', () => {
  it.each(cases)('$format $decimals $value', ({ value, format, decimals, expected }) => {
    expect(formatPosition(value, format, decimals)).toEqual(expected);
  });

  it('covers every format', () => {
    const covered = new Set(cases.filter((c) => c.expected).map((c) => c.format));
    expect([...covered].sort()).toEqual([...POSITION_FORMATS].sort());
  });

  it('only uses characters the display fonts have (ASCII and the degree sign)', () => {
    for (const c of cases) {
      for (const text of Object.values(c.expected ?? {})) expect(text).toMatch(/^[\x20-\x7E°]*$/);
    }
  });

  it('clamps decimals to 0..6', () => {
    const p = { latitude: 60.15, longitude: 24.95 };
    expect(formatPosition(p, 'dd', 9)?.lat).toBe('60.150000° N');
    expect(formatPosition(p, 'dd', -1)?.lat).toBe('60° N');
  });
});
