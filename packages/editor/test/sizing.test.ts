import { AUTOPILOT_FIT, TEMPLATES, WIND_ROSE_FIT, type Layout } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import { pageTiles } from '../src/layoutOps';
import { autopilotTier, roseTier, tilePixels, valueTextSize } from '../src/sizing';

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
    // 480 wide, 1 column: 480 - 2*8 padding - 2*10 tile padding = 444; the footer takes 11 % of
    // the height: 480 * 0.89 - 16 - 20 = 391.
    expect(tilePixels({ width: 480, height: 480 }, onePage(1, 1), 0, { w: 1, h: 1 })).toEqual({
      width: 444,
      height: 391,
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

  it('leaves room for the footer on every layout, one page or several (ADR-0025)', () => {
    const one = tilePixels({ width: 720, height: 720 }, onePage(1, 1), 0, { w: 1, h: 1 });
    const two = tilePixels({ width: 720, height: 720 }, onePage(1, 1, 2), 0, { w: 1, h: 1 });
    expect(two).toEqual(one);
    expect(one.height).toBeLessThan(one.width - 70);
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
      const rose = pageTiles(t.pages[0]).find((x) => x.type === 'wind_rose')!;
      const px = tilePixels({ width: 720, height: 720 }, t, 0, rose);
      expect(roseTier(Math.min(px.width, px.height))).toBe('full');
    }
  });
});

describe('autopilotTier', () => {
  it('shows controls only from AUTOPILOT_FIT', () => {
    const { controlsWidth: w, controlsHeight: h } = AUTOPILOT_FIT;
    expect(autopilotTier({ width: w, height: h })).toBe('controls');
    expect(autopilotTier({ width: w - 1, height: h + 100 })).toBe('status');
    expect(autopilotTier({ width: w + 100, height: h - 1 })).toBe('status');
  });

  it('the autopilot and helm templates get controls on their display sizes', () => {
    const at = (key: string, size: number) => {
      const t = TEMPLATES[key]!;
      const ap = pageTiles(t.pages[0]).find((x) => x.type === 'autopilot')!;
      return autopilotTier(tilePixels({ width: size, height: size }, t, 0, ap));
    };
    expect(at('autopilot', 480)).toBe('controls');
    expect(at('helm-720', 720)).toBe('controls');
  });
});

describe('valueTextSize', () => {
  const P4 = [33, 49, 75, 113, 169];
  const tile = {
    type: 'value',
    id: 'v',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    path: 'a.b',
    label: 'SOG',
    unit: 'kn',
  } as const;
  /** Display pixels of a preview size min(Xcqh, Ycqw) on a box of the given height. */
  const px = (css: string, height: number) =>
    (parseFloat(/([\d.]+)cqh/.exec(css)![1]!) / 100) * height;
  const cqw = (css: string, width: number) =>
    (parseFloat(/([\d.]+)cqw/.exec(css)![1]!) / 100) * width;

  it('gives a big tile bigger text than a small one, in display pixels', () => {
    const big = valueTextSize(P4, { width: 680, height: 290 }, tile);
    const small = valueTextSize(P4, { width: 150, height: 130 }, tile);
    expect(px(big.value, 290)).toBeGreaterThan(px(small.value, 130));
    expect(px(big.caption, 290)).toBeGreaterThan(px(small.caption, 130));
    // The 144 px font (line height 169) on the full-width tile.
    expect(px(big.value, 290)).toBeCloseTo(144, 0);
  });

  it('the caption stays well below the number', () => {
    const t = valueTextSize(P4, { width: 680, height: 290 }, tile);
    expect(px(t.caption, 290)).toBeLessThan(px(t.value, 290) / 2);
  });

  it('scales with the width too, so a value as wide as the sample fits a narrower preview', () => {
    // The 1x1 depth tile of the Sailing layout on a 720 display: 10.7 is as wide as 88.8.
    const box = { width: 152, height: 141 };
    const t = valueTextSize(P4, box, { ...tile, decimals: 1 }, '10.7');
    expect(t.value).toMatch(/^min\([\d.]+cqh, [\d.]+cqw\)$/);
    // Both shares name the same font size in display pixels.
    expect(cqw(t.value, box.width)).toBeCloseTo(px(t.value, box.height), 1);
    // A preview tile 5 % narrower than the display's in proportion gets a 5 % smaller font, so
    // the text keeps the share of the width it has on the display.
    const preview = { width: box.width * 0.95, height: box.height };
    const font = Math.min(
      (parseFloat(/([\d.]+)cqh/.exec(t.value)![1]!) / 100) * preview.height,
      (parseFloat(/([\d.]+)cqw/.exec(t.value)![1]!) / 100) * preview.width,
    );
    expect(font).toBeCloseTo(px(t.value, box.height) * 0.95, 1);
  });
});
