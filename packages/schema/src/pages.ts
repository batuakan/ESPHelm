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
 * The only page kind in v1. `kind` stays required so other page kinds (e.g. a full-page chart)
 * can be added later. The wind rose was a page kind until Phase 5b; it is a tile now (ADR-0010).
 */
export const Page = GridPage;
export type Page = GridPage;
