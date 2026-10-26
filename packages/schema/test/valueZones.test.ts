import { describe, expect, it } from 'vitest';
import { valueZoneState } from '../src/index.js';
import { valueZoneCases } from './fixtures.js';

describe('valueZoneState', () => {
  it.each(valueZoneCases())('$n -> $expected $note', (c) => {
    expect(valueZoneState(c.n, c.zones) ?? null).toBe(c.expected);
  });
});
