import Type from 'typebox';
import { DataItem, Id, Label, SkPath } from './primitives.js';

/** Placement of a tile on its page grid, in cells (0-based; a tile may span several cells). */
const Placement = {
  id: Id,
  x: Type.Integer({ minimum: 0 }),
  y: Type.Integer({ minimum: 0 }),
  w: Type.Integer({ minimum: 1 }),
  h: Type.Integer({ minimum: 1 }),
};

/** Alert state of a range; colours come from the theme, not from the layout. */
export const ZoneState = Type.Union([
  Type.Literal('normal'),
  Type.Literal('warn'),
  Type.Literal('alarm'),
  Type.Literal('emergency'),
]);

/** A coloured range on a gauge or bar, in display units. */
export const Zone = Type.Object(
  {
    from: Type.Number(),
    to: Type.Number(),
    state: ZoneState,
  },
  { additionalProperties: false },
);
export type Zone = Type.Static<typeof Zone>;

/** Shows one value with label and unit. */
export const ValueTile = Type.Object(
  {
    type: Type.Literal('value'),
    ...Placement,
    ...DataItem.properties,
  },
  { additionalProperties: false },
);

const Scale = {
  min: Type.Number({ description: 'Scale start, in display units.' }),
  max: Type.Number({ description: 'Scale end, in display units; must be greater than min.' }),
  zones: Type.Optional(Type.Array(Zone)),
};

/** Round gauge with a needle and optional zones. */
export const GaugeTile = Type.Object(
  {
    type: Type.Literal('gauge'),
    ...Placement,
    ...DataItem.properties,
    ...Scale,
  },
  { additionalProperties: false },
);

/** Linear bar (e.g. tank level, state of charge). */
export const BarTile = Type.Object(
  {
    type: Type.Literal('bar'),
    ...Placement,
    ...DataItem.properties,
    ...Scale,
    orientation: Type.Optional(Type.Union([Type.Literal('horizontal'), Type.Literal('vertical')])),
  },
  { additionalProperties: false },
);

/** Boolean SignalK path: shows its state and sends a PUT to the same path when tapped. */
export const SwitchTile = Type.Object(
  {
    type: Type.Literal('switch'),
    ...Placement,
    path: SkPath,
    label: Type.Optional(Label),
  },
  { additionalProperties: false },
);

/**
 * Wind rose: apparent and true wind pointers relative to the bow, heading, and named slots at
 * predetermined positions in the centre, each showing a user-chosen DataItem.
 */
const WindRoseSlots = Type.Object(
  {
    center1: Type.Optional(DataItem),
    center2: Type.Optional(DataItem),
    center3: Type.Optional(DataItem),
  },
  { additionalProperties: false, errorCode: 'UNKNOWN_SLOT' },
);

export const WindRoseTile = Type.Object(
  {
    type: Type.Literal('wind_rose'),
    ...Placement,
    config: Type.Optional(
      Type.Object(
        {
          apparentAngle: Type.Optional(SkPath),
          trueDirection: Type.Optional(SkPath),
          heading: Type.Optional(SkPath),
          showTrueWind: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    slots: WindRoseSlots,
  },
  { additionalProperties: false },
);

/** Defaults for omitted wind_rose config fields (standard SignalK paths). */
export const WIND_ROSE_DEFAULTS = {
  apparentAngle: 'environment.wind.angleApparent',
  trueDirection: 'environment.wind.directionTrue',
  heading: 'navigation.headingTrue',
  showTrueWind: true,
} as const;

/**
 * What a wind rose draws for the shorter side of its cell, in device pixels. The device picks
 * the tier from the cell it actually got; the editor uses the same numbers for its size hint.
 * Generated into the firmware's esphelm_sizes.h.
 */
export const WIND_ROSE_FIT = {
  /** At least this: tick labels, heading and every slot that fits. */
  full: 260,
  /** At least this: no tick labels or heading; slots as far as they fit. Below: pointers only. */
  compact: 150,
} as const;

/** Every grid tile type, keyed by its `type` value. Used by the validator to dispatch. */
export const TILE_TYPES = {
  value: ValueTile,
  gauge: GaugeTile,
  bar: BarTile,
  switch: SwitchTile,
  wind_rose: WindRoseTile,
} as const;
export type TileType = keyof typeof TILE_TYPES;

/** Named slots of the tile types that have them. */
export const TILE_SLOTS = {
  wind_rose: Object.keys(WindRoseSlots.properties) as ('center1' | 'center2' | 'center3')[],
} as const;

export const Tile = Type.Union([ValueTile, GaugeTile, BarTile, SwitchTile, WindRoseTile]);
export type ValueTile = Type.Static<typeof ValueTile>;
export type GaugeTile = Type.Static<typeof GaugeTile>;
export type BarTile = Type.Static<typeof BarTile>;
export type SwitchTile = Type.Static<typeof SwitchTile>;
export type WindRoseTile = Type.Static<typeof WindRoseTile>;
export type Tile = Type.Static<typeof Tile>;
