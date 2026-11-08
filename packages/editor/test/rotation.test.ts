import { describe, expect, it } from 'vitest';
import { screenShape, shownSize } from '../src/rotation';

const hello = (width: number, height: number, rotation: number, canRotate = true) => ({
  display: { width, height, rotation },
  capabilities: { touch: true, put: true, rotation: canRotate },
});

describe('mounting rotation (ADR-0028)', () => {
  it('turns the panel by the layout rotation', () => {
    expect(shownSize(hello(1280, 800, 0), 90)).toEqual({ width: 800, height: 1280 });
    expect(shownSize(hello(1280, 800, 0), 180)).toEqual({ width: 1280, height: 800 });
    expect(shownSize(hello(1280, 800, 0), undefined)).toEqual({ width: 1280, height: 800 });
  });

  it('starts from the panel, not from the size the display shows now', () => {
    // The display shows a layout turned 90 degrees: it reports 800x1280.
    expect(shownSize(hello(800, 1280, 90), 0)).toEqual({ width: 1280, height: 800 });
    expect(shownSize(hello(800, 1280, 90), 270)).toEqual({ width: 800, height: 1280 });
  });

  it('a display that cannot turn keeps its size', () => {
    expect(shownSize(hello(320, 240, 0, false), 90)).toEqual({ width: 320, height: 240 });
  });

  it('names shapes with the 1.25 rule', () => {
    expect(screenShape({ width: 720, height: 720 })).toBe('square');
    expect(screenShape({ width: 800, height: 720 })).toBe('square');
    expect(screenShape({ width: 1280, height: 800 })).toBe('landscape');
    expect(screenShape({ width: 800, height: 1280 })).toBe('portrait');
  });
});
