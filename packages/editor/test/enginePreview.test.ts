import { describe, expect, it } from 'vitest';
import { engineCornerLine } from '../src/components/EnginePreview';

// The display's ladder at 480 (small 26, label 38, ...).
const LADDER = [26, 38, 56, 75, 113];

describe('engineCornerLine (CornerValues::layout on the display)', () => {
  it('uses the label font where it fits, else the small one, else nothing', () => {
    // A wide tile: plenty of room beside the arc.
    expect(engineCornerLine(720, 420, 212, LADDER, 'Hours h')).toBe(38);
    // Square: a 480 tile has room for small text in its corners, a 300 one none.
    expect(engineCornerLine(480, 480, 242, LADDER, 'h')).toBe(26);
    expect(engineCornerLine(300, 300, 152, LADDER, 'h')).toBeUndefined();
    expect(engineCornerLine(560, 480, 242, LADDER, 'h')).toBe(38);
  });

  it('counts a long caption against the room', () => {
    expect(engineCornerLine(600, 480, 242, LADDER, 'h')).toBe(38);
    expect(engineCornerLine(600, 480, 242, LADDER, 'Exhaust temperature degC')).toBeUndefined();
  });

  it('lets a bottom corner use the open bottom of the arc, clear of the bottom gauge', () => {
    // 470 x 410 (a full 480 page): R 205. "Exhaust °C" misses the circle but sits below the arc's ends.
    const open = { below: 205 * 0.52, r: 205 * 0.9 + 2 };
    expect(engineCornerLine(470, 410, 207, LADDER, 'Exhaust °C')).toBeUndefined();
    expect(engineCornerLine(470, 410, 207, LADDER, 'Exhaust °C', open)).toBe(26);
    // Still not into the bottom gauge.
    expect(
      engineCornerLine(470, 410, 207, LADDER, 'A very long caption text', open),
    ).toBeUndefined();
  });
});
