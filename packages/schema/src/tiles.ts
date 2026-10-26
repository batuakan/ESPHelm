import Type from 'typebox';
import { DataItem, Decimals, Id, Label, SkPath } from './primitives.js';

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

/**
 * Colour names for value tiles. The display theme decides the actual colour: distinct colours
 * by day, the night text colour at night (night vision). Layouts never carry hex colours.
 */
export const VALUE_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple'] as const;
export const ValueColor = Type.Union(VALUE_COLORS.map((c) => Type.Literal(c)));
export type ValueColor = (typeof VALUE_COLORS)[number];

/**
 * A range of a value tile, in display units, that colours the number. A value tile has no
 * min/max, so either end may be left open; at least one is required.
 */
export const ValueZone = Type.Object(
  {
    from: Type.Optional(Type.Number()),
    to: Type.Optional(Type.Number()),
    state: ZoneState,
  },
  { additionalProperties: false },
);
export type ValueZone = Type.Static<typeof ValueZone>;

/** Shows one value with label and unit; optionally coloured (fixed, or by value). */
export const ValueTile = Type.Object(
  {
    type: Type.Literal('value'),
    ...Placement,
    ...DataItem.properties,
    color: Type.Optional(ValueColor),
    zones: Type.Optional(Type.Array(ValueZone)),
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
 * GPS position: latitude over longitude, as text in one of the POSITION_FORMATS (position.ts
 * defines the text; the firmware mirrors it). The device picks the largest font that fits.
 */
export const PositionTile = Type.Object(
  {
    type: Type.Literal('position'),
    ...Placement,
    path: Type.Optional(SkPath),
    label: Type.Optional(Label),
    format: Type.Optional(
      Type.Union(
        [Type.Literal('ddm'), Type.Literal('dms'), Type.Literal('dd'), Type.Literal('decimal')],
        {
          description:
            "ddm: 60° 09.000' N; dms: 60° 09' 00.0\" N; dd: 60.15000° N; decimal: 60.150000 (signed).",
        },
      ),
    ),
    decimals: Type.Optional(Decimals),
    staleAfter: DataItem.properties.staleAfter,
  },
  { additionalProperties: false },
);

/** Defaults for omitted position tile fields (decimals: POSITION_DEFAULT_DECIMALS per format). */
export const POSITION_DEFAULTS = {
  path: 'navigation.position',
  format: 'ddm',
} as const;

/**
 * Wind rose: apparent and true wind pointers relative to the bow, heading, and named slots at
 * predetermined positions in the centre, each showing a user-chosen DataItem.
 */
const WindRoseSlots = Type.Object(
  {
    // stacked in the middle of the rose
    center1: Type.Optional(DataItem),
    center2: Type.Optional(DataItem),
    center3: Type.Optional(DataItem),
    // in the tile's corners, outside the ring (shown when there is room)
    topLeft: Type.Optional(DataItem),
    topRight: Type.Optional(DataItem),
    bottomLeft: Type.Optional(DataItem),
    bottomRight: Type.Optional(DataItem),
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

/** Autopilot modes the tile can engage (steering.autopilot.state values); `standby` is always there. */
export const AutopilotMode = Type.Union([
  Type.Literal('auto'),
  Type.Literal('wind'),
  Type.Literal('route'),
]);
export type AutopilotMode = Type.Static<typeof AutopilotMode>;

/**
 * Autopilot: state, target and heading, plus course and mode buttons that send PUTs (classic
 * SignalK autopilot paths, as the legacy app). Safety rules (ADR-0011): engaging needs a tap and a
 * confirming tap, standby is one tap, course changes only while engaged, no controls when the
 * cell is too small (AUTOPILOT_FIT) or the display is offline.
 */
export const AutopilotTile = Type.Object(
  {
    type: Type.Literal('autopilot'),
    ...Placement,
    label: Type.Optional(Label),
    modes: Type.Optional(Type.Array(AutopilotMode, { uniqueItems: true })),
    config: Type.Optional(
      Type.Object(
        {
          statePath: Type.Optional(SkPath),
          targetPath: Type.Optional(SkPath),
          adjustPath: Type.Optional(SkPath),
          headingPath: Type.Optional(SkPath),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** Defaults for omitted autopilot fields (the paths the legacy autopilot app uses). */
export const AUTOPILOT_DEFAULTS = {
  modes: ['auto', 'wind', 'route'] as readonly AutopilotMode[],
  statePath: 'steering.autopilot.state',
  targetPath: 'steering.autopilot.target',
  adjustPath: 'steering.autopilot.actions.adjustHeading',
  headingPath: 'navigation.headingMagnetic',
} as const;

/**
 * Smallest content box (device pixels) in which an autopilot tile shows its buttons (about
 * 56 px each, a finger-sized target). Smaller tiles show status only. Generated into
 * esphelm_sizes.h; the editor uses the same numbers for its size hint.
 */
export const AUTOPILOT_FIT = { controlsWidth: 260, controlsHeight: 220 } as const;

/** Every grid tile type, keyed by its `type` value. Used by the validator to dispatch. */
export const TILE_TYPES = {
  value: ValueTile,
  gauge: GaugeTile,
  bar: BarTile,
  switch: SwitchTile,
  position: PositionTile,
  wind_rose: WindRoseTile,
  autopilot: AutopilotTile,
} as const;
export type TileType = keyof typeof TILE_TYPES;

/** Named slots of the tile types that have them. */
export const TILE_SLOTS = {
  wind_rose: Object.keys(WindRoseSlots.properties) as (keyof Type.Static<typeof WindRoseSlots>)[],
} as const;

export const Tile = Type.Union([
  ValueTile,
  GaugeTile,
  BarTile,
  SwitchTile,
  PositionTile,
  WindRoseTile,
  AutopilotTile,
]);
export type ValueTile = Type.Static<typeof ValueTile>;
export type GaugeTile = Type.Static<typeof GaugeTile>;
export type BarTile = Type.Static<typeof BarTile>;
export type SwitchTile = Type.Static<typeof SwitchTile>;
export type PositionTile = Type.Static<typeof PositionTile>;
export type WindRoseTile = Type.Static<typeof WindRoseTile>;
export type AutopilotTile = Type.Static<typeof AutopilotTile>;
export type Tile = Type.Static<typeof Tile>;
