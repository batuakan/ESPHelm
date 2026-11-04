import Type from 'typebox';
import { CLOCK_DATE_FORMATS } from './clock.js';
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
    history: Type.Optional(
      Type.Boolean({
        description:
          'Record the value; a tap on the tile shows a graph of its recent values (ADR-0018, ADR-0019). Absent means false.',
      }),
    ),
  },
  { additionalProperties: false },
);

/** What the two sides of a centre-zero scale mean (ADR-0023). */
export const CenterZeroSides = Type.Union([
  Type.Literal('portStarboard'),
  Type.Literal('plusMinus'),
]);
export type CenterZeroSides = Type.Static<typeof CenterZeroSides>;

const Scale = {
  min: Type.Number({ description: 'Scale start, in display units.' }),
  max: Type.Number({ description: 'Scale end, in display units; must be greater than min.' }),
  zones: Type.Optional(Type.Array(Zone)),
  centerZero: Type.Optional(
    Type.Boolean({
      description:
        'Centre the scale on zero and fill from zero to the value (ADR-0023); needs min < 0 < max.',
    }),
  ),
  sides: Type.Optional(
    Type.Union(CenterZeroSides.anyOf, {
      description:
        'With centerZero: portStarboard (P/S, red/green; the default) or plusMinus (signed, one colour). Without centerZero it has no effect.',
    }),
  ),
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

/**
 * Graph windows, the keys of HISTORY.windows in order (the popup's buttons use the same keys).
 * Boards without PSRAM keep only the first HISTORY.noPsramWindows; a longer window falls back to
 * the longest they keep.
 */
export const GraphWindow = Type.Union(
  [Type.Literal('10m'), Type.Literal('1h'), Type.Literal('6h')],
  { description: 'The time the graph covers. Absent: 10m. 6h only with PSRAM, else 1h.' },
);
export type GraphWindow = Type.Static<typeof GraphWindow>;
export const GRAPH_WINDOWS = GraphWindow.anyOf.map((l) => l.const) as GraphWindow[];

/**
 * Line graph of a value's recent history (ADR-0021). It always records: the value counts against
 * HISTORY's limits like a value tile with `history: true`. A tap opens the history popup.
 */
export const GraphTile = Type.Object(
  {
    type: Type.Literal('graph'),
    ...Placement,
    ...DataItem.properties,
    window: Type.Optional(GraphWindow),
    min: Type.Optional(
      Type.Number({ description: 'Fixed bottom of the y axis, in display units; needs max.' }),
    ),
    max: Type.Optional(
      Type.Number({
        description:
          'Fixed top of the y axis; needs min, must be greater. Absent: follows the data.',
      }),
    ),
    zones: Type.Optional(Type.Array(ValueZone)),
  },
  { additionalProperties: false },
);

/** What a heading tape can mark besides the heading (ADR-0022). */
export const HeadingTapeMarker = Type.Union([
  Type.Literal('cog'),
  Type.Literal('bearing'),
  Type.Literal('target'),
]);
export type HeadingTapeMarker = Type.Static<typeof HeadingTapeMarker>;
export const HEADING_TAPE_MARKERS = HeadingTapeMarker.anyOf.map(
  (l) => l.const,
) as HeadingTapeMarker[];

/**
 * Heading tape (ADR-0022): a compass strip that scrolls with the heading under a fixed centre
 * line, with markers for course over ground, the bearing to the next waypoint and the autopilot
 * target. Whole degrees, so it takes no unit or decimals.
 */
export const HeadingTapeTile = Type.Object(
  {
    type: Type.Literal('heading_tape'),
    ...Placement,
    label: Type.Optional(Label),
    span: Type.Optional(
      Type.Integer({
        minimum: 30,
        maximum: 180,
        description: 'Degrees visible across the tape. Absent: 90.',
      }),
    ),
    markers: Type.Optional(
      Type.Array(HeadingTapeMarker, {
        uniqueItems: true,
        description: 'Which markers it draws (each only while fresh). Absent: all three.',
      }),
    ),
    config: Type.Optional(
      Type.Object(
        {
          headingPath: Type.Optional(SkPath),
          cogPath: Type.Optional(SkPath),
          bearingPath: Type.Optional(SkPath),
          targetPath: Type.Optional(SkPath),
        },
        { additionalProperties: false },
      ),
    ),
    staleAfter: DataItem.properties.staleAfter,
  },
  { additionalProperties: false },
);

/** Defaults for omitted heading tape fields (standard SignalK paths, all true). */
export const HEADING_TAPE_DEFAULTS = {
  span: 90,
  markers: ['cog', 'bearing', 'target'] as readonly HeadingTapeMarker[],
  headingPath: 'navigation.headingTrue',
  cogPath: 'navigation.courseOverGroundTrue',
  bearingPath: 'navigation.course.calcValues.bearingTrue',
  targetPath: 'steering.autopilot.target',
} as const;

/** What a clock tile shows (ADR-0024). */
export const ClockShow = Type.Union([
  Type.Literal('time'),
  Type.Literal('date'),
  Type.Literal('both'),
]);
export type ClockShow = Type.Static<typeof ClockShow>;

/**
 * Clock (ADR-0024): the display's own time and/or date in the layout's time zone
 * (settings.timeZone), or in UTC. The display sets its clock from settings.clockPath (GPS time)
 * or the board's time source and keeps it running offline; it shows "--" until it has one.
 * clock.ts defines the text; the firmware mirrors it.
 */
export const ClockTile = Type.Object(
  {
    type: Type.Literal('clock'),
    ...Placement,
    label: Type.Optional(Label),
    show: Type.Optional(Type.Union(ClockShow.anyOf, { description: 'Absent: time.' })),
    hour12: Type.Optional(
      Type.Boolean({ description: '12-hour time with AM/PM. Absent: 24-hour.' }),
    ),
    seconds: Type.Optional(Type.Boolean({ description: 'Show seconds. Absent: false.' })),
    dateFormat: Type.Optional(
      Type.Union(
        CLOCK_DATE_FORMATS.map((f) => Type.Literal(f)),
        {
          description:
            'ymd: 2026-11-04; dmy: 04.11.2026; mdy: 11/04/2026; weekday: Wed 4 Nov. Absent: ymd.',
        },
      ),
    ),
    utc: Type.Optional(
      Type.Boolean({ description: 'Show UTC instead of the layout time zone. Absent: false.' }),
    ),
  },
  { additionalProperties: false },
);

/** Defaults for omitted clock tile fields. */
export const CLOCK_DEFAULTS = {
  show: 'time',
  hour12: false,
  seconds: false,
  dateFormat: 'ymd',
  utc: false,
} as const;

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

/**
 * What a wind rose can record (ADR-0019): its slots, then the three angles it draws. The order
 * is the order of the popup's buttons and of the editor's checkboxes.
 */
export const RoseHistoryKey = Type.Union([
  Type.Literal('center1'),
  Type.Literal('center2'),
  Type.Literal('center3'),
  Type.Literal('topLeft'),
  Type.Literal('topRight'),
  Type.Literal('bottomLeft'),
  Type.Literal('bottomRight'),
  Type.Literal('apparentAngle'),
  Type.Literal('trueDirection'),
  Type.Literal('heading'),
]);
export type RoseHistoryKey = Type.Static<typeof RoseHistoryKey>;
export const ROSE_HISTORY_KEYS = RoseHistoryKey.anyOf.map((l) => l.const) as RoseHistoryKey[];

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
    history: Type.Optional(
      Type.Array(RoseHistoryKey, {
        uniqueItems: true,
        description:
          'The values that record; a tap on the rose shows their graphs (ADR-0019). Absent: none. A name whose slot is empty records nothing.',
      }),
    ),
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

/**
 * How tile text follows the tile size (ADR-0017). The device has a ladder of compiled fonts and
 * gives each tile's number the largest one whose sample text ("88" plus the tile's decimals)
 * fits; captions and units take the largest font at most `companionPercent` of the number's line
 * height (never below the smallest). Generated into esphelm_sizes.h.
 */
export const TEXT_FIT = { companionPercent: 40, sampleDigits: 2 } as const;

/**
 * Value history (ADR-0018, ADR-0019). The display records every value switched on (value tiles
 * with `history: true`, the wind rose's `history` names), from boot, into one ring of `points`
 * points per window (each point: mean, min and max of its values). Boards without PSRAM keep
 * only the first `noPsramWindows` windows and fewer values. Generated into esphelm_sizes.h; the
 * editor's mock popup and its memory counter use the same numbers.
 */
export const HISTORY = {
  points: 120,
  windows: [
    { label: '10 min', seconds: 600 },
    { label: '1 h', seconds: 3600 },
    { label: '6 h', seconds: 21600 },
  ],
  noPsramWindows: 2,
  maxValuesPsram: 48,
  maxValuesNoPsram: 6,
} as const;

/**
 * Graph tile (ADR-0021): content box height in device pixels from which it shows its y labels
 * and time label (else only the header and the line). Generated into esphelm_sizes.h; the
 * editor's preview uses the same number.
 */
export const GRAPH_FIT = { axisHeight: 120 } as const;

/**
 * Heading tape (ADR-0022), in device pixels: minor (5°) ticks are drawn when they are at least
 * `minorTickPx` apart, and every 10° is labelled when 10° is at least `label10Px` (else every
 * 30°). Generated into esphelm_sizes.h; headingTape.ts and the editor's preview use them.
 */
export const HEADING_TAPE_FIT = { minorTickPx: 6, label10Px: 40 } as const;

/** Zones read from SignalK metadata (ADR-0020): how many of a path's zones are used. */
export const SERVER_ZONES = {
  maxPerPath: 16,
} as const;

/** Every grid tile type, keyed by its `type` value. Used by the validator to dispatch. */
export const TILE_TYPES = {
  value: ValueTile,
  gauge: GaugeTile,
  bar: BarTile,
  switch: SwitchTile,
  position: PositionTile,
  wind_rose: WindRoseTile,
  autopilot: AutopilotTile,
  graph: GraphTile,
  heading_tape: HeadingTapeTile,
  clock: ClockTile,
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
  GraphTile,
  HeadingTapeTile,
  ClockTile,
]);
export type ValueTile = Type.Static<typeof ValueTile>;
export type GaugeTile = Type.Static<typeof GaugeTile>;
export type BarTile = Type.Static<typeof BarTile>;
export type SwitchTile = Type.Static<typeof SwitchTile>;
export type PositionTile = Type.Static<typeof PositionTile>;
export type WindRoseTile = Type.Static<typeof WindRoseTile>;
export type AutopilotTile = Type.Static<typeof AutopilotTile>;
export type GraphTile = Type.Static<typeof GraphTile>;
export type HeadingTapeTile = Type.Static<typeof HeadingTapeTile>;
export type ClockTile = Type.Static<typeof ClockTile>;
export type Tile = Type.Static<typeof Tile>;
