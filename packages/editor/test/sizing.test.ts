import { TEMPLATES, WIND_ROSE_FIT, type Layout } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import { roseTier, tilePixels } from '../src/sizing';

const onePage = (cols: number, rows: number, pages = 1): Layout => ({
  version: 1,
  id: 'x',
  theme: 'day',
  pages: Array.from({ length: pages }, (_, i) => ({
    kind: 'grid' as const,
    id: `p${i}`,
    grid: { cols, rows },
    tiles: [],
  })),
});

describe('tilePixels', () => {
  it('follows the runtime geometry (area padding, gaps, tile padding)', () => {
    // 480 wide, 1 column: 480 - 2*8 padding - 2*10 tile padding = 444.
    expect(tilePixels({ width: 480, height: 480 }, onePage(1, 1), 0, { w: 1, h: 1 })).toEqual({
      width: 444,
      height: 444,
    });
    // 3x3 at 480: cells of (480 - 16 - 16) / 3 = 149.3, minus 20 = 129.
    expect(tilePixels({ width: 480, height: 480 }, onePage(3, 3), 0, { w: 1, h: 1 }).width).toBe(
      129,
    );
    // A 2x2 tile spans one gap.
    expect(tilePixels({ width: 480, height: 480 }, onePage(3, 3), 0, { w: 2, h: 2 }).width).toBe(
      286,
    );
  });

  it('leaves room for the footer when there are several pages', () => {
    const one = tilePixels({ width: 720, height: 720 }, onePage(1, 1), 0, { w: 1, h: 1 });
    const two = tilePixels({ width: 720, height: 720 }, onePage(1, 1, 2), 0, { w: 1, h: 1 });
    expect(two.width).toBe(one.width);
    expect(two.height).toBeLessThan(one.height - 70);
  });
});

describe('roseTier', () => {
  it('uses the shared WIND_ROSE_FIT thresholds', () => {
    expect(roseTier(WIND_ROSE_FIT.full)).toBe('full');
    expect(roseTier(WIND_ROSE_FIT.full - 1)).toBe('compact');
    expect(roseTier(WIND_ROSE_FIT.compact)).toBe('compact');
    expect(roseTier(WIND_ROSE_FIT.compact - 1)).toBe('pointers');
  });

  it('draws the large-display templates in full on 720x720', () => {
    for (const t of Object.values(TEMPLATES).filter((x) => x.id.endsWith('-720'))) {
      const rose = t.pages[0]!.tiles.find((x) => x.type === 'wind_rose')!;
      const px = tilePixels({ width: 720, height: 720 }, t, 0, rose);
      expect(roseTier(Math.min(px.width, px.height))).toBe('full');
    }
  });
});
