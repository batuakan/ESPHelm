import type { Tile } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import { withServerZones } from '../src/components/Previews';

const value = {
  id: 'd',
  type: 'value',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  path: 'environment.depth.belowTransducer',
  unit: 'ft',
  zones: [{ to: 1, state: 'warn' }],
} as Tile;
const gauge = {
  id: 'g',
  type: 'gauge',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  path: 'environment.depth.belowTransducer',
  min: 0,
  max: 5,
  zones: [{ from: 4, to: 5, state: 'warn' }],
} as Tile;
const zones = (raw: unknown) => new Map([['environment.depth.belowTransducer', raw]]);

describe('withServerZones (ADR-0020)', () => {
  it("the server's zones replace a value tile's own, in its unit", () => {
    const got = withServerZones(value, zones([{ upper: 1, state: 'alarm' }]));
    expect(got).toMatchObject({ zones: [{ state: 'alarm' }] });
    expect((got as { zones: { to: number }[] }).zones[0]!.to).toBeCloseTo(3.2808, 3);
  });

  it("a gauge's are closed and clipped to its scale", () => {
    expect(
      withServerZones(
        gauge,
        zones([
          { upper: 2, state: 'alarm' },
          { lower: 3, upper: 9, state: 'warn' },
        ]),
      ),
    ).toMatchObject({
      zones: [
        { from: 0, to: 2, state: 'alarm' },
        { from: 3, to: 5, state: 'warn' },
      ],
    });
  });

  it.each([[null], [[]], [[{ state: 'panic', lower: 1 }]], [undefined]])(
    "nothing usable (%j): the tile's own",
    (raw) => {
      expect(withServerZones(value, zones(raw))).toBe(value);
      expect(withServerZones(gauge, zones(raw))).toBe(gauge);
    },
  );

  it('other tiles and paths are left alone', () => {
    const other = { ...value, path: 'navigation.speedOverGround' } as Tile;
    expect(withServerZones(other, zones([{ upper: 1, state: 'alarm' }]))).toBe(other);
    expect(withServerZones(value, undefined)).toBe(value);
  });
});
