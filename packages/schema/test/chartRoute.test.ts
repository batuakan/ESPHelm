import { describe, expect, it } from 'vitest';
import { edgeArrow, routeId } from '../src/chartRoute.js';
import { CHART_ROUTE_CASES } from './fixtures.js';

describe('chart route (ADR-0037)', () => {
  for (const c of CHART_ROUTE_CASES.arrows) {
    it(`edge arrow: ${c.note}`, () => {
      const a = edgeArrow(c.dx, c.dy, c.w, c.h, c.inset);
      expect(a.onScreen).toBe(c.expected.onScreen);
      expect(a.x).toBeCloseTo(c.expected.x, 3);
      expect(a.y).toBeCloseTo(c.expected.y, 3);
      expect(a.angle).toBeCloseTo(c.expected.angle, 3);
    });
  }
  it('an off-screen arrow sits on the inset edge', () => {
    for (const c of CHART_ROUTE_CASES.arrows.filter(
      (a) => !a.expected.onScreen && a.w / 2 > a.inset,
    )) {
      const a = edgeArrow(c.dx, c.dy, c.w, c.h, c.inset);
      const onX = Math.abs(Math.abs(a.x - c.w / 2) - (c.w / 2 - c.inset)) < 1e-9;
      const onY = Math.abs(Math.abs(a.y - c.h / 2) - (c.h / 2 - c.inset)) < 1e-9;
      expect(onX || onY).toBe(true);
    }
  });
  for (const c of CHART_ROUTE_CASES.ids) {
    it(`route id of ${c.href.slice(0, 60)}`, () =>
      expect(routeId(c.href) ?? null).toBe(c.expected));
  }
  it('route id of a non-string', () => expect(routeId(42)).toBeUndefined());
});
