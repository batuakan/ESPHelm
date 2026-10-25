// Pure editing operations on a layout. The editor edits the first grid page of the layout
// assigned to the selected display (Phase 4 MVP). Every operation returns a new layout and
// never produces overlapping or out-of-grid tiles; `null` means "not possible here".
import type { GridPage, Layout, Tile, TileType } from '@esphelm/schema';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeviceRef {
  id: string;
  name?: string;
}

/** Layout id for a display's own layout (one layout per display). */
export function layoutIdFor(deviceId: string): string {
  return `display-${deviceId.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}

/** A new, empty layout for a display. Invalid until it has a tile (EMPTY_PAGE). */
export function newLayoutFor(device: DeviceRef): Layout {
  return {
    version: 1,
    id: layoutIdFor(device.id),
    ...(device.name ? { name: device.name } : {}),
    theme: 'night',
    pages: [{ kind: 'grid', id: 'main', title: 'Main', grid: { cols: 2, rows: 2 }, tiles: [] }],
  };
}

/** Index of the grid page the editor works on (the first one), or -1. */
export function gridPageIndex(layout: Layout): number {
  return layout.pages.findIndex((p) => p.kind === 'grid');
}

export function gridPage(layout: Layout): GridPage | undefined {
  const i = gridPageIndex(layout);
  return i < 0 ? undefined : (layout.pages[i] as GridPage);
}

function withPage(layout: Layout, update: (page: GridPage) => GridPage): Layout {
  const i = gridPageIndex(layout);
  if (i < 0) return layout;
  const pages = [...layout.pages];
  pages[i] = update(pages[i] as GridPage);
  return { ...layout, pages };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether `rect` lies inside the grid and overlaps no tile except `ignoreId`. */
export function fits(page: GridPage, rect: Rect, ignoreId?: string): boolean {
  if (rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1) return false;
  if (rect.x + rect.w > page.grid.cols || rect.y + rect.h > page.grid.rows) return false;
  return page.tiles.every((t) => t.id === ignoreId || !overlaps(rect, t));
}

/** First free 1x1 cell, row by row. */
export function firstFreeCell(page: GridPage): { x: number; y: number } | null {
  for (let y = 0; y < page.grid.rows; y++)
    for (let x = 0; x < page.grid.cols; x++) if (fits(page, { x, y, w: 1, h: 1 })) return { x, y };
  return null;
}

function nextTileId(layout: Layout): string {
  const used = new Set(
    layout.pages.flatMap((p) => (p.kind === 'grid' ? p.tiles.map((t) => t.id) : [p.id])),
  );
  for (let n = 1; ; n++) if (!used.has(`tile-${n}`)) return `tile-${n}`;
}

/** Defaults for a new tile of each type; the path starts empty (the editor asks for one). */
function newTile(type: TileType, id: string, at: { x: number; y: number }): Tile {
  const place = { id, x: at.x, y: at.y, w: 1, h: 1 };
  switch (type) {
    case 'gauge':
      return { type, ...place, path: '', min: 0, max: 100 };
    case 'bar':
      return { type, ...place, path: '', min: 0, max: 100 };
    case 'switch':
      return { type, ...place, path: '' };
    default:
      return { type: 'value', ...place, path: '' };
  }
}

/** Add a 1x1 tile at `at` (or the first free cell). */
export function addTile(
  layout: Layout,
  type: TileType,
  at?: { x: number; y: number },
): { layout: Layout; id: string } | null {
  const page = gridPage(layout);
  if (!page) return null;
  const cell = at && fits(page, { ...at, w: 1, h: 1 }) ? at : at ? null : firstFreeCell(page);
  if (!cell) return null;
  const id = nextTileId(layout);
  return {
    id,
    layout: withPage(layout, (p) => ({ ...p, tiles: [...p.tiles, newTile(type, id, cell)] })),
  };
}

function placeTile(layout: Layout, id: string, rect: Rect): Layout | null {
  const page = gridPage(layout);
  if (!page || !page.tiles.some((t) => t.id === id) || !fits(page, rect, id)) return null;
  return withPage(layout, (p) => ({
    ...p,
    tiles: p.tiles.map((t) => (t.id === id ? { ...t, ...rect } : t)),
  }));
}

export function moveTile(layout: Layout, id: string, x: number, y: number): Layout | null {
  const t = gridPage(layout)?.tiles.find((tile) => tile.id === id);
  return t ? placeTile(layout, id, { x, y, w: t.w, h: t.h }) : null;
}

export function resizeTile(layout: Layout, id: string, w: number, h: number): Layout | null {
  const t = gridPage(layout)?.tiles.find((tile) => tile.id === id);
  return t ? placeTile(layout, id, { x: t.x, y: t.y, w, h }) : null;
}

export function removeTile(layout: Layout, id: string): Layout {
  return withPage(layout, (p) => ({ ...p, tiles: p.tiles.filter((t) => t.id !== id) }));
}

/** Merge settings into a tile. Undefined values remove the field (e.g. clearing the unit). */
export function updateTile(layout: Layout, id: string, patch: Record<string, unknown>): Layout {
  return withPage(layout, (p) => ({
    ...p,
    tiles: p.tiles.map((t) => {
      if (t.id !== id) return t;
      const next: Record<string, unknown> = { ...t, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next as unknown as Tile;
    }),
  }));
}

/** Change the grid size. Tiles that no longer fit stay, and are reported by the validator. */
export function setGrid(layout: Layout, cols: number, rows: number): Layout {
  return withPage(layout, (p) => ({ ...p, grid: { cols, rows } }));
}

/** Tile id a validation error points at (e.g. "/pages/0/tiles/2/label"), if any. */
export function tileIdForPointer(layout: Layout, pointer: string): string | undefined {
  const m = /^\/pages\/(\d+)\/tiles\/(\d+)(\/|$)/.exec(pointer);
  if (!m) return undefined;
  const page = layout.pages[Number(m[1])];
  return page?.kind === 'grid' ? page.tiles[Number(m[2])]?.id : undefined;
}
