import { describe, expect, it } from 'vitest';
import {
  companionLine,
  DEFAULT_FONT_LINE_HEIGHTS,
  fitValueText,
  textWidth,
  valueSample,
} from '../src/index.js';

const P4 = [33, 49, 75, 113, 169];

describe('tile text fit', () => {
  it('samples two digits plus the decimals', () => {
    expect(valueSample(0)).toBe('88');
    expect(valueSample(2)).toBe('88.88');
  });

  it('estimates wider text for more characters and bigger fonts', () => {
    expect(textWidth('888.8', 113)).toBeGreaterThan(textWidth('888', 113));
    expect(textWidth('888', 169)).toBeGreaterThan(textWidth('888', 113));
  });

  it('gives captions at most 40 % of the number, never below the smallest font', () => {
    expect(companionLine(P4, 169)).toBe(49);
    expect(companionLine(P4, 113)).toBe(33);
    expect(companionLine(P4, 49)).toBe(33);
  });

  it('picks bigger text for bigger tiles', () => {
    const opts = { decimals: 1, caption: true, unit: true };
    const full = fitValueText(P4, { width: 680, height: 290 }, opts);
    const quarter = fitValueText(P4, { width: 150, height: 130 }, opts);
    expect(full).toEqual({ value: 169, caption: 49 });
    expect(quarter.value).toBeLessThan(full.value);
    expect(textWidth(valueSample(1), quarter.value)).toBeLessThanOrEqual(150);
  });

  it('steps a value wider than the sample down until it fits, keeping the caption', () => {
    const box = { width: 130, height: 130 };
    const opts = { decimals: 0, caption: true, unit: true };
    const plain = fitValueText(P4, box, opts);
    const rpm = fitValueText(P4, box, { ...opts, text: '2400' });
    expect(rpm.value).toBeLessThan(plain.value);
    expect(rpm.caption).toBe(plain.caption);
    expect(textWidth('2400', rpm.value)).toBeLessThanOrEqual(130);
    expect(fitValueText(P4, box, { ...opts, text: '24' })).toEqual(plain);
  });

  it('falls back to the smallest font when nothing fits', () => {
    const fit = fitValueText(
      DEFAULT_FONT_LINE_HEIGHTS,
      { width: 10, height: 10 },
      {
        decimals: 1,
        caption: true,
        unit: false,
      },
    );
    expect(fit).toEqual({ value: 26, caption: 26 });
  });

  it('gives the number the caption and unit room when they are absent', () => {
    const box = { width: 400, height: 110 };
    const bare = fitValueText(P4, box, { decimals: 0, caption: false, unit: false });
    const dressed = fitValueText(P4, box, { decimals: 0, caption: true, unit: true });
    expect(bare.value).toBeGreaterThan(dressed.value);
  });
});
