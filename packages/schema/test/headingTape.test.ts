import { describe, expect, it } from 'vitest';
import {
  HEADING_TAPE_DEFAULTS,
  HEADING_TAPE_MARKERS,
  tapeLabel,
  tapeMarks,
  tapeX,
} from '../src/index.js';
import { TAPE_CASES } from './fixtures.js';

describe('heading tape geometry', () => {
  for (const c of TAPE_CASES.marks) {
    it(`ticks: ${c.note}`, () => {
      const got = tapeMarks(c.heading, c.span, c.width);
      const shape = (t: { deg: number; kind: string; label?: string }) => [t.deg, t.kind, t.label];
      expect(got.map(shape)).toEqual(c.expected.map(shape));
      got.forEach((t, i) => expect(t.x).toBeCloseTo(c.expected[i]!.x, 3));
    });
  }
  for (const c of TAPE_CASES.markers) {
    it(`marker: ${c.note}`, () => {
      const got = tapeX(c.value, c.heading, c.span, c.width);
      expect(got.off).toBe(c.expected.off);
      expect(got.x).toBeCloseTo(c.expected.x, 3);
    });
  }

  it('labels the cardinal points with letters', () => {
    expect([0, 90, 180, 270, 360, 30, -30].map(tapeLabel)).toEqual([
      'N',
      'E',
      'S',
      'W',
      'N',
      '30',
      '330',
    ]);
  });

  it('marks all three by default', () => {
    expect(HEADING_TAPE_DEFAULTS.markers).toEqual(HEADING_TAPE_MARKERS);
  });
});
