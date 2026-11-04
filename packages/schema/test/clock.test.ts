import { describe, expect, it } from 'vitest';
import {
  POSIX_TZ_PATTERN,
  clockDate,
  clockTime,
  intlOffset,
  isPosixTz,
  localOffset,
  parseIsoUtc,
  posixTz,
  type ClockDateFormat,
} from '../src/index.js';
import { CLOCK_CASES } from './fixtures.js';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('clock', () => {
  for (const c of CLOCK_CASES.offsets) {
    it(`offset: ${c.posix} at ${c.utc}`, () => {
      expect(localOffset(c.posix, at(c.utc))).toBe(c.expected);
    });
  }
  for (const c of CLOCK_CASES.times) {
    it(`time: ${c.local} (${c.hour12 ? '12' : '24'} h${c.seconds ? ', seconds' : ''})`, () => {
      expect(clockTime(c.local, c.hour12, c.seconds)).toEqual(c.expected);
    });
  }
  for (const c of CLOCK_CASES.dates) {
    it(`date: ${c.local} (${c.format})`, () => {
      expect(clockDate(c.local, c.format as ClockDateFormat)).toBe(c.expected);
    });
  }
  for (const c of CLOCK_CASES.iso) {
    it(`iso: ${JSON.stringify(c.text)}`, () => expect(parseIsoUtc(c.text)).toBe(c.expected));
  }
  for (const c of CLOCK_CASES.posix) {
    it(`posixTz: ${c.zone}`, () => {
      expect(posixTz(c.zone, c.year)).toBe(c.expected);
      expect(c.expected).toMatch(new RegExp(POSIX_TZ_PATTERN));
    });
  }

  it('builds rules that follow Intl for two years', () => {
    for (const { zone } of CLOCK_CASES.posix) {
      const rule = posixTz(zone, 2026);
      for (let t = at('2026-01-01T00:00:00Z'); t < at('2028-01-01T00:00:00Z'); t += 6 * 3600) {
        expect(localOffset(rule, t), `${zone} at ${new Date(t * 1000).toISOString()}`).toBe(
          intlOffset(zone, t),
        );
      }
    }
  }, 30_000);

  it('gives a zone POSIX cannot describe a rule the display reads', () => {
    // Morocco's summer time pauses for Ramadan: right for the year it's built for, not beyond.
    const rule = posixTz('Africa/Casablanca', 2026, at('2026-06-01T00:00:00Z'));
    expect(isPosixTz(rule)).toBe(true);
  });

  it('refuses rules it cannot read', () => {
    for (const bad of [
      '',
      'CET',
      'CET-1CEST',
      'CET-1CEST,M3.5.0',
      'CET-25',
      '<+01>-1<+02>,M13.1.0,M1.1.0',
      '<>0',
      'CET-1:5',
      'CET-1CEST,M03.5.0,M10.5.0',
      'Europe/Stockholm',
    ]) {
      expect(isPosixTz(bad), bad).toBe(false);
      expect(localOffset(bad, 0)).toBe(0);
    }
  });
});
