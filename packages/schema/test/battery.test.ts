import { describe, expect, it } from 'vitest';
import {
  batteryRows,
  batteryState,
  batteryStatus,
  chargingModeText,
  timeLeft,
} from '../src/battery.js';
import { batteryDefaults, validateLayout } from '../src/index.js';
import { BATTERY_CASES } from './fixtures.js';

describe('battery tile text (ADR-0046)', () => {
  for (const c of BATTERY_CASES.timeLeft)
    it(`${c.seconds} s left is "${c.expected}"`, () =>
      expect(timeLeft(c.seconds)).toBe(c.expected));
  for (const c of BATTERY_CASES.states)
    it(`${c.current} A${c.invert ? ' inverted' : ''} is ${c.expected}`, () =>
      expect(batteryState(c.current, c.invert)).toBe(c.expected));
  for (const c of BATTERY_CASES.modes)
    it(`mode ${JSON.stringify(c.mode)} is "${c.expected}"`, () =>
      expect(chargingModeText(c.mode)).toBe(c.expected));
  for (const c of BATTERY_CASES.status)
    it(`${c.state} ${c.seconds} ${c.mode} is "${c.expected}"`, () =>
      expect(batteryStatus(c.state, c.seconds, c.mode)).toBe(c.expected));
});

describe('battery tile rows (ADR-0046)', () => {
  for (const c of BATTERY_CASES.rows)
    it(`${c.width}x${c.height}`, () =>
      expect(batteryRows(c.width, c.height, c.ladder, c.want)).toEqual(c.expected));
});

describe('battery defaults', () => {
  it('fill a valid tile from a battery id', () => {
    const tile = { type: 'battery', id: 'b', x: 0, y: 0, w: 1, h: 1, ...batteryDefaults('house') };
    expect(tile.path).toBe('electrical.batteries.house.capacity.stateOfCharge');
    expect(tile.label).toBe('House');
    const layout = {
      version: 1,
      id: 'l',
      theme: 'day',
      pages: [{ kind: 'grid', id: 'p', grid: { cols: 1, rows: 1 }, tiles: [tile] }],
    };
    expect(validateLayout(layout).errors).toEqual([]);
  });
});
