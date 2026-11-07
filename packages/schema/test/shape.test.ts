import { describe, expect, it } from 'vitest';
import { displayShape, pageArrangement, type GridPage } from '../src/index.js';
import { SHAPE_CASES } from './fixtures.js';

describe('screen shape', () => {
  for (const c of SHAPE_CASES.cases) {
    it(`${c.width}x${c.height} is ${c.expected}`, () => {
      expect(displayShape(c.width, c.height)).toBe(c.expected);
    });
  }
});

describe('page arrangement', () => {
  const page: GridPage = {
    kind: 'grid',
    id: 'p',
    grid: { cols: 2, rows: 1 },
    tiles: [
      { type: 'value', id: 'a', x: 0, y: 0, w: 1, h: 1, path: 'navigation.speedOverGround' },
      { type: 'value', id: 'b', x: 1, y: 0, w: 1, h: 1, path: 'navigation.speedThroughWater' },
    ],
    arrangements: {
      portrait: { grid: { cols: 1, rows: 2 }, tiles: [{ id: 'b', x: 0, y: 1, w: 1, h: 1 }] },
    },
  };

  it('a shape without an arrangement uses the default', () => {
    const a = pageArrangement(page, 'landscape');
    expect(a.own).toBe(false);
    expect(a.grid).toEqual({ cols: 2, rows: 1 });
    expect(a.tiles.map((t) => [t.tile.id, t.x, t.y])).toEqual([
      ['a', 0, 0],
      ['b', 1, 0],
    ]);
  });

  it("a shape's own arrangement places only its tiles, in page order", () => {
    const a = pageArrangement(page, 'portrait');
    expect(a.own).toBe(true);
    expect(a.grid).toEqual({ cols: 1, rows: 2 });
    expect(a.tiles.map((t) => [t.tile.id, t.x, t.y, t.w, t.h])).toEqual([['b', 0, 1, 1, 1]]);
    expect(a.hidden.map((t) => t.id)).toEqual(['a']);
  });
});
