import type { GridPage } from './pages.js';
import type { Tile } from './tiles.js';

/**
 * Screen shapes (ADR-0028). A grid page can arrange its tiles once per shape; a display uses the
 * arrangement for its own shape, measured from its screen after rotation, or else the page's
 * default arrangement. The firmware has the same rule (esphelm_sizes.h SHAPE_RATIO_PERCENT).
 */
export const SHAPES = ['square', 'landscape', 'portrait'] as const;
export type Shape = (typeof SHAPES)[number];

/** A screen is landscape when its width is at least this share of its height (portrait the other way). */
export const SHAPE_FIT = { ratioPercent: 125 } as const;

/** The shape of a width x height screen: 480x480 and 800x720 are square, 1280x800 landscape. */
export function displayShape(width: number, height: number): Shape {
  if (width * 100 >= height * SHAPE_FIT.ratioPercent) return 'landscape';
  if (height * 100 >= width * SHAPE_FIT.ratioPercent) return 'portrait';
  return 'square';
}

/** Where a page's tiles go on one shape. */
export interface PageArrangement {
  /** True when the page has an arrangement of its own for the shape (else the default). */
  own: boolean;
  grid: { cols: number; rows: number };
  /** The placed tiles, in the page's tile order. */
  tiles: { tile: Tile; x: number; y: number; w: number; h: number }[];
  /** Tiles of the page this shape doesn't show. */
  hidden: Tile[];
}

/** The arrangement a display of this shape shows: the shape's own, else the page's default. */
export function pageArrangement(page: GridPage, shape: Shape): PageArrangement {
  const own = page.arrangements?.[shape];
  if (!own) {
    return {
      own: false,
      grid: page.grid,
      tiles: page.tiles.map((tile) => ({ tile, x: tile.x, y: tile.y, w: tile.w, h: tile.h })),
      hidden: [],
    };
  }
  const at = new Map(own.tiles.map((p) => [p.id, p]));
  const tiles: PageArrangement['tiles'] = [];
  const hidden: Tile[] = [];
  for (const tile of page.tiles) {
    const p = at.get(tile.id);
    if (p) tiles.push({ tile, x: p.x, y: p.y, w: p.w, h: p.h });
    else hidden.push(tile);
  }
  return { own: true, grid: own.grid, tiles, hidden };
}
