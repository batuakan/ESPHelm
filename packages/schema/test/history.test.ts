import { describe, expect, it } from 'vitest';
import { ageLabel, axisLabels, HISTORY, historyEnabled, pointSeconds } from '../src/index.js';

describe('value history', () => {
  it('is on unless turned off', () => {
    expect(historyEnabled({})).toBe(true);
    expect(historyEnabled({ history: true })).toBe(true);
    expect(historyEnabled({ history: false })).toBe(false);
  });

  it('labels the time axis in minutes, then hours', () => {
    expect(axisLabels(600)).toEqual(['-10 m', '-5 m', 'now']);
    expect(axisLabels(3600)).toEqual(['-60 m', '-30 m', 'now']);
    expect(axisLabels(21600)).toEqual(['-6 h', '-3 h', 'now']);
    expect(ageLabel(0)).toBe('now');
  });

  it('splits each window into whole-second points', () => {
    expect(HISTORY.windows.map((_, i) => pointSeconds(i))).toEqual([5, 30, 180]);
    expect(pointSeconds(9)).toBe(0);
    expect(HISTORY.noPsramWindows).toBeLessThanOrEqual(HISTORY.windows.length);
  });
});
