// Pages arranged per screen shape (ADR-0028). The editor shows and edits a page as the selected
// display's shape arranges it: its own arrangement when the page has one, else the default (the
// page's grid and the tiles' own x/y/w/h). The usual tile operations run on that view; inShape()
// writes their result back into the arrangement.
import { pageArrangement, type GridPage, type Layout, type Shape } from '@esphelm/schema';
import { firstFreeCell, gridPage } from './layoutOps';

export const SHAPE_TITLES: Record<Shape, string> = {
  square: 'Square',
  landscape: 'Landscape',
  portrait: 'Portrait',
};

/** The page as a display of this shape shows it, as a plain grid page (no arrangements). */
export function arrangedPage(page: GridPage, shape: Shape): GridPage {
  const a = pageArrangement(page, shape);
  const { arrangements: _arrangements, ...rest } = page;
  void _arrangements;
  return {
    ...rest,
    grid: a.grid,
    tiles: a.tiles.map(({ tile, x, y, w, h }) => ({ ...tile, x, y, w, h })),
  };
}

function withPageAt(layout: Layout, index: number, page: GridPage): Layout {
  return { ...layout, pages: layout.pages.map((p, i) => (i === index ? page : p)) };
}

/**
 * Run a tile or grid operation on page `index` as this shape shows it. Without an arrangement of
 * its own for the shape, that is the default and the operation runs as it is. With one, positions
 * and the grid go to the arrangement and tile settings to the page's tiles; a tile the operation
 * removed is hidden on this shape only, and a tile it added is also placed in the default (its
 * first free cell, or a new row below).
 */
export function inShape(
  layout: Layout,
  index: number,
  shape: Shape,
  op: (layout: Layout) => Layout | null,
): Layout | null {
  const page = gridPage(layout, index);
  if (!page?.arrangements?.[shape]) return op(layout);
  const out = op(withPageAt(layout, index, arrangedPage(page, shape)));
  const edited = out && gridPage(out, index);
  if (!out || !edited) return null;
  const before = new Map(page.tiles.map((t) => [t.id, t]));
  const editedById = new Map(edited.tiles.map((t) => [t.id, t]));
  let grid = page.grid;
  let tiles = page.tiles.map((t) => {
    const e = editedById.get(t.id);
    return e ? { ...e, x: t.x, y: t.y, w: t.w, h: t.h } : t;
  });
  for (const added of edited.tiles.filter((t) => !before.has(t.id))) {
    let cell = firstFreeCell({ ...page, grid, tiles });
    if (!cell) {
      cell = { x: 0, y: grid.rows };
      grid = { ...grid, rows: grid.rows + 1 };
    }
    tiles = [...tiles, { ...added, ...cell, w: 1, h: 1 }];
  }
  return withPageAt(out, index, {
    ...page,
    grid,
    tiles,
    arrangements: {
      ...page.arrangements,
      [shape]: {
        grid: edited.grid,
        tiles: edited.tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
      },
    },
  });
}

/**
 * Give page `index` an arrangement of its own for this shape, starting from the default:
 * as it is, or turned (rows become columns, so a landscape page starts a portrait one).
 */
export function arrangeFor(
  layout: Layout,
  index: number,
  shape: Shape,
  turned: boolean,
): Layout | null {
  const page = gridPage(layout, index);
  if (!page) return null;
  const grid = turned ? { cols: page.grid.rows, rows: page.grid.cols } : page.grid;
  const tiles = page.tiles.map(({ id, x, y, w, h }) =>
    turned ? { id, x: y, y: x, w: h, h: w } : { id, x, y, w, h },
  );
  return withPageAt(layout, index, {
    ...page,
    arrangements: { ...page.arrangements, [shape]: { grid, tiles } },
  });
}

/** Drop this shape's arrangement: the shape shows the default again. */
export function dropArrangement(layout: Layout, index: number, shape: Shape): Layout | null {
  const page = gridPage(layout, index);
  if (!page?.arrangements?.[shape]) return null;
  const { [shape]: _dropped, ...rest } = page.arrangements;
  void _dropped;
  const { arrangements: _all, ...plain } = page;
  void _all;
  return withPageAt(
    layout,
    index,
    Object.keys(rest).length > 0 ? { ...page, arrangements: rest } : plain,
  );
}

/** Show a tile this shape hides, at the first free cell of its arrangement (or a new row). */
export function showOnShape(
  layout: Layout,
  index: number,
  shape: Shape,
  id: string,
): Layout | null {
  const page = gridPage(layout, index);
  const own = page?.arrangements?.[shape];
  if (!page || !own || own.tiles.some((t) => t.id === id) || !page.tiles.some((t) => t.id === id))
    return null;
  const view = arrangedPage(page, shape);
  let grid = own.grid;
  let cell = firstFreeCell(view);
  if (!cell) {
    cell = { x: 0, y: grid.rows };
    grid = { ...grid, rows: grid.rows + 1 };
  }
  return withPageAt(layout, index, {
    ...page,
    arrangements: {
      ...page.arrangements,
      [shape]: { grid, tiles: [...own.tiles, { id, ...cell, w: 1, h: 1 }] },
    },
  });
}
