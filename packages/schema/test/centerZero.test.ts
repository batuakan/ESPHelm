import { describe, expect, it } from 'vitest';
import {
  centerZeroSpan,
  centerZeroText,
  centerZeroTick,
  type CenterZeroSides,
} from '../src/index.js';
import { CENTER_ZERO_CASES } from './fixtures.js';

describe('centre-zero text', () => {
  for (const c of CENTER_ZERO_CASES.text) {
    it(`text: ${c.n} (${c.decimals ?? 'default'} decimals, ${c.sides})`, () => {
      expect(centerZeroText(c.n, c.decimals, c.sides as CenterZeroSides)).toEqual(c.expected);
    });
  }
  for (const c of CENTER_ZERO_CASES.ticks) {
    it(`tick: ${c.v} of ±${c.m} (${c.sides})`, () => {
      expect(centerZeroTick(c.v, c.m, c.sides as CenterZeroSides)).toBe(c.expected);
    });
  }
  for (const c of CENTER_ZERO_CASES.spans) {
    it(`span: ${c.min}..${c.max}`, () => expect(centerZeroSpan(c.min, c.max)).toBe(c.expected));
  }
});
