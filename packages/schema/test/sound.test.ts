import { describe, expect, it } from 'vitest';
import { ALARM_LEVELS, ALARM_REPEAT_MS, alarmSound } from '../src/index.js';
import { SOUND_CASES } from './fixtures.js';

describe('alarm tones', () => {
  for (const c of SOUND_CASES.cases) {
    it(c.name, () => expect(alarmSound(c.input)).toBe(c.expected));
  }
  it('every level has a repeat rule', () => {
    for (const l of ALARM_LEVELS) expect(typeof ALARM_REPEAT_MS[l]).toBe('number');
  });
});
