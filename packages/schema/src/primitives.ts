import Type from 'typebox';
import { UNIT_IDS } from './generated/units.js';

/**
 * `errorCode` is an annotation keyword (registered with Ajv in validate.ts) that maps a failing
 * schema to a stable error code. Firmware reuses the same codes in its logs.
 */

/** Lowercase identifier for layouts, pages and tiles. */
export const Id = Type.String({
  pattern: '^[a-z0-9][a-z0-9_-]*$',
  errorCode: 'INVALID_ID',
  description:
    'Lowercase ASCII identifier: a-z, 0-9, "_" and "-", starting with a letter or digit.',
});

/** A SignalK chart identifier (resources API): URL-safe, case kept. */
export const ChartId = Type.String({
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
  errorCode: 'INVALID_ID',
  description: 'SignalK chart identifier: letters, digits, ".", "_" and "-".',
});

/** Printable ASCII plus the degree sign: the glyphs compiled into the firmware fonts. */
export const LABEL_PATTERN = '^[\\x20-\\x7E\\u00B0]*$';

/** Text shown on the display. Only glyphs compiled into the firmware fonts: ASCII and the degree sign. */
export const Label = Type.String({
  pattern: LABEL_PATTERN,
  errorCode: 'INVALID_LABEL',
  description: 'Printable ASCII plus the degree sign (U+00B0).',
});

/** SignalK path relative to vessels.self, e.g. "navigation.speedOverGround". No wildcards in v1. */
export const SkPath = Type.String({
  pattern: '^[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*$',
  errorCode: 'INVALID_PATH',
  description: 'Dot-separated SignalK path relative to vessels.self, without wildcards.',
});

/** Display unit id from units.json. */
export const UnitId = Type.Unsafe<(typeof UNIT_IDS)[number]>({
  type: 'string',
  enum: [...UNIT_IDS],
  errorCode: 'UNKNOWN_UNIT',
  description: 'Display unit id from units.json; the value is converted from SignalK SI units.',
});
export type UnitId = (typeof UNIT_IDS)[number];

/** Fixed number of decimals for numeric display. */
export const Decimals = Type.Integer({ minimum: 0, maximum: 6 });

/** A value bound to one SignalK path and how to show it. */
export const DataItem = Type.Object(
  {
    path: SkPath,
    unit: Type.Optional(UnitId),
    decimals: Type.Optional(Decimals),
    label: Type.Optional(Label),
    staleAfter: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        description: 'Seconds without an update before the value is shown as stale.',
      }),
    ),
  },
  { additionalProperties: false },
);
export type DataItem = Type.Static<typeof DataItem>;
