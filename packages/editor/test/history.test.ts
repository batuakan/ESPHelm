import { HISTORY } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import { exampleCurve } from '../src/components/HistoryPreview';

describe('history preview', () => {
  it('draws one example point per display point, with a gap, around the live value', () => {
    const points = exampleCurve(12, 0);
    expect(points).toHaveLength(HISTORY.points);
    expect(points.filter((p) => p === null)).toHaveLength(8);
    const shown = points.filter((p): p is number => p !== null);
    expect(Math.min(...shown)).toBeGreaterThan(12 - 12 * 0.2 - 1e-9);
    expect(Math.max(...shown)).toBeLessThan(12 + 12 * 0.2 + 1e-9);
  });

  it('keeps a visible swing around zero', () => {
    const shown = exampleCurve(0, 1).filter((p): p is number => p !== null);
    expect(Math.max(...shown) - Math.min(...shown)).toBeGreaterThan(1);
  });
});
