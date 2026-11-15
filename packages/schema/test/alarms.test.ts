import { describe, expect, it } from 'vitest';
import { alarmAge, underPrefix } from '../src/alarms.js';
import { ALARMS_CASES } from './fixtures.js';

describe('alarms panel text (ADR-0038)', () => {
  for (const c of ALARMS_CASES.ages)
    it(`${c.seconds} s is "${c.expected}"`, () => expect(alarmAge(c.seconds)).toBe(c.expected));
  for (const c of ALARMS_CASES.prefixes)
    it(`${c.path} under ${c.prefix}: ${c.expected}`, () =>
      expect(underPrefix(c.path, c.prefix)).toBe(c.expected));
});
