import Type from 'typebox';
import { DataItem, Id, Label, SkPath } from './primitives.js';
import { Tile } from './tiles.js';

/** A page of tiles placed on a cols x rows grid. */
export const GridPage = Type.Object(
  {
    kind: Type.Literal('grid'),
    id: Id,
    title: Type.Optional(Label),
    grid: Type.Object(
      {
        cols: Type.Integer({ minimum: 1 }),
        rows: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    tiles: Type.Array(Tile, { minItems: 1, errorCode: 'EMPTY_PAGE' }),
  },
  { additionalProperties: false },
);
export type GridPage = Type.Static<typeof GridPage>;

/**
 * Full-page widgets draw a fixed design (e.g. a wind rose) and expose named slots at
 * predetermined positions; each slot shows a user-chosen DataItem.
 */
const WindRoseSlots = Type.Object(
  {
    center1: Type.Optional(DataItem),
    center2: Type.Optional(DataItem),
    center3: Type.Optional(DataItem),
  },
  { additionalProperties: false, errorCode: 'UNKNOWN_SLOT' },
);

export const WindRosePage = Type.Object(
  {
    kind: Type.Literal('widget'),
    widget: Type.Literal('wind_rose'),
    id: Id,
    title: Type.Optional(Label),
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
export type WindRosePage = Type.Static<typeof WindRosePage>;

/** Defaults for omitted wind_rose config fields (standard SignalK paths). */
export const WIND_ROSE_DEFAULTS = {
  apparentAngle: 'environment.wind.angleApparent',
  trueDirection: 'environment.wind.directionTrue',
  heading: 'navigation.headingTrue',
  showTrueWind: true,
} as const;

/** Every full-page widget, keyed by its `widget` value, with its slot names. */
export const PAGE_WIDGETS = {
  wind_rose: { schema: WindRosePage, slots: Object.keys(WindRoseSlots.properties) },
} as const;
export type PageWidget = keyof typeof PAGE_WIDGETS;

export const WidgetPage = Type.Union([WindRosePage]);
export type WidgetPage = Type.Static<typeof WidgetPage>;

export const Page = Type.Union([GridPage, WindRosePage]);
export type Page = Type.Static<typeof Page>;
