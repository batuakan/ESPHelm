import { describe, expect, it } from 'vitest';
import { roseLaylines, roseTarget, WIND_ROSE_DEFAULTS, WIND_ROSE_TACK } from '../src/index.js';
import { ROSE_CASES } from './fixtures.js';

describe('wind rose performance geometry (ADR-0029)', () => {
  for (const c of ROSE_CASES.laylines) {
    it(`laylines: ${c.note}`, () => {
      const got = roseLaylines(c.twd, c.heading, c.beat, c.gybe, c.fixed);
      expect(got.upwind).toBe(c.expected.upwind);
      expect(got.angle).toBeCloseTo(c.expected.angle, 3);
      expect(got.starboard).toBeCloseTo(c.expected.starboard, 3);
      expect(got.port).toBeCloseTo(c.expected.port, 3);
    });
  }
  for (const c of ROSE_CASES.targets) {
    it(`target: ${c.note}`, () => {
      const got = roseTarget(c.twd, c.heading, c.target);
      if (c.expected === null) expect(got).toBeUndefined();
      else expect(got).toBeCloseTo(c.expected, 3);
    });
  }

  it('defaults to the fixed angles', () => {
    expect(WIND_ROSE_DEFAULTS.fixedBeat).toBe(WIND_ROSE_TACK.beat.fixed);
    expect(WIND_ROSE_DEFAULTS.fixedGybe).toBe(WIND_ROSE_TACK.gybe.fixed);
  });
});
