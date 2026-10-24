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

/** Every grid tile type, keyed by its `type` value. Used by the validator to dispatch. */
export const TILE_TYPES = {
  value: ValueTile,
  gauge: GaugeTile,
  bar: BarTile,
  switch: SwitchTile,
} as const;
export type TileType = keyof typeof TILE_TYPES;

export const Tile = Type.Union([ValueTile, GaugeTile, BarTile, SwitchTile]);
export type ValueTile = Type.Static<typeof ValueTile>;
export type GaugeTile = Type.Static<typeof GaugeTile>;
export type BarTile = Type.Static<typeof BarTile>;
export type SwitchTile = Type.Static<typeof SwitchTile>;
export type Tile = Type.Static<typeof Tile>;
