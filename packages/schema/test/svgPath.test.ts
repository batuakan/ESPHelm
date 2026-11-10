import { describe, expect, it } from 'vitest';
import { fitContours, flattenSvgPath, signedArea } from '../src/svgPath.js';

describe('flattenSvgPath', () => {
  it('reads lines, H and V, absolute and relative, closed by Z or the next M', () => {
    expect(flattenSvgPath('M1,1H3V3H1Z')).toEqual([[1, 1, 3, 1, 3, 3, 1, 3]]);
    expect(flattenSvgPath('m 1 1 h 2 v 2 h -2 m 5 0 l 1 0 0 1')).toEqual([
      [1, 1, 3, 1, 3, 3, 1, 3],
      [6, 3, 7, 3, 7, 4],
    ]);
  });

  it('turns arcs into segments on the circle', () => {
    // A half circle of radius 1 around (1, 0), then closed.
    const [c] = flattenSvgPath('M0,0 A1,1 0 0 1 2,0 Z');
    for (let i = 0; i + 1 < c!.length - 2; i += 2) {
      expect(Math.hypot(c![i]! - 1, c![i + 1]!)).toBeCloseTo(1, 6);
    }
    // Sweep 1 runs through negative y (y down: over the top).
    expect(Math.min(...c!.filter((_, i) => i % 2 === 1))).toBeCloseTo(-1, 2);
  });

  it('ends cubic curves on their end point', () => {
    const [c] = flattenSvgPath('M0,0 C0,1 1,1 1,0 c 0,-1 1,-1 1,0 Z');
    expect(c!.slice(16, 18)).toEqual([1, 0]);
    expect(c!.slice(-2)).toEqual([2, 0]);
  });

  it('refuses what it cannot read', () => {
    expect(() => flattenSvgPath('M0,0 X1,1')).toThrow();
    expect(() => flattenSvgPath('1,1')).toThrow();
  });
});

describe('fitContours', () => {
  it('scales into the unit box, aspect kept and centred', () => {
    const fitted = fitContours([[0, 0, 4, 0, 4, 2, 0, 2, 0, 0]]);
    expect(fitted).toEqual([[0, 0.25, 1, 0.25, 1, 0.75, 0, 0.75]]);
    expect(Math.abs(signedArea(fitted))).toBeCloseTo(0.5);
  });
});
