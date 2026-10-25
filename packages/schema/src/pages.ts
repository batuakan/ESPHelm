import Type from 'typebox';
import { ChartId, Id, Label, SkPath } from './primitives.js';
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
 * A full-page chart (Phase 5d, ADR-0012): map tiles of a SignalK chart centred on the vessel,
 * north up, with the vessel, and the anchor position and alarm radius when `anchor` is on.
 * Only displays with PSRAM render it (they list "chart" in hello.widgets).
 */
export const ChartPage = Type.Object(
  {
    kind: Type.Literal('chart'),
    id: Id,
    title: Type.Optional(Label),
    chart: ChartId,
    zoom: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    anchor: Type.Optional(Type.Boolean()),
    config: Type.Optional(
      Type.Object(
        {
          positionPath: Type.Optional(SkPath),
          headingPath: Type.Optional(SkPath),
          anchorPositionPath: Type.Optional(SkPath),
          anchorRadiusPath: Type.Optional(SkPath),
          anchorAlarmPath: Type.Optional(SkPath),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ChartPage = Type.Static<typeof ChartPage>;

/** Defaults for omitted chart page fields (the paths the legacy chart app uses). */
export const CHART_DEFAULTS = {
  zoom: 15,
  anchor: true,
  positionPath: 'navigation.position',
  headingPath: 'navigation.headingTrue',
  anchorPositionPath: 'navigation.anchor.position',
  anchorRadiusPath: 'navigation.anchor.maxRadius',
  anchorAlarmPath: 'notifications.navigation.anchor',
} as const;

/**
 * Page kinds, discriminated by `kind`. The wind rose was a page kind until Phase 5b; it is a tile
 * now (ADR-0010). Page kinds other than grid are widget names in `hello.widgets` (e.g. "chart").
 */
export const PAGE_KINDS = { grid: GridPage, chart: ChartPage } as const;
export const Page = Type.Union([GridPage, ChartPage]);
export type Page = Type.Static<typeof Page>;
