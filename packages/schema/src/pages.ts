import Type from 'typebox';
import { Id, Label } from './primitives.js';
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
 * Page kinds, discriminated by `kind`. The wind rose (until Phase 5b, ADR-0010) and the chart
 * (until ADR-0030) were page kinds; both are tiles now, and migrateLayout converts old pages.
 */
export const PAGE_KINDS = { grid: GridPage } as const;
export const Page = Type.Union([GridPage]);
export type Page = Type.Static<typeof Page>;
