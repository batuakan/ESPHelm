// Pure editing operations on a layout. Every operation returns a new layout and never
// produces overlapping or out-of-grid tiles; `null` means "not possible here". Grid
// operations take the index of the page they work on. Ids are unique across the whole layout
// (pages and tiles share one namespace, like the validator's DUPLICATE_ID check).
import {
  WIND_ROSE_DEFAULTS,
  type DataItem,
  type GridPage,
  type Layout,
  type Page,
  type Tile,
  type TileType,
  type WindRosePage,
} from '@esphelm/schema';

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

export type SlotName = keyof WindRosePage['slots'];
export const WIND_ROSE_SLOTS: readonly SlotName[] = ['center1', 'center2', 'center3'];

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

/** Page `index` if it is a grid page. */
export function gridPage(layout: Layout, index: number): GridPage | undefined {
  const p = layout.pages[index];
  return p?.kind === 'grid' ? p : undefined;
}

function withPage(layout: Layout, index: number, update: (page: Page) => Page): Layout {
  const p = layout.pages[index];
  if (!p) return layout;
  const pages = [...layout.pages];
  pages[index] = update(p);
  return { ...layout, pages };
}

function withGrid(layout: Layout, index: number, update: (page: GridPage) => GridPage): Layout {
  return withPage(layout, index, (p) => (p.kind === 'grid' ? update(p) : p));
}

function withRose(
  layout: Layout,
  index: number,
  update: (page: WindRosePage) => WindRosePage,
): Layout {
  return withPage(layout, index, (p) => (p.kind === 'widget' ? update(p) : p));
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

function usedIds(layout: Layout): Set<string> {
  return new Set(
    layout.pages.flatMap((p) => [p.id, ...(p.kind === 'grid' ? p.tiles.map((t) => t.id) : [])]),
  );
}

function nextId(used: Set<string>, prefix: string): string {
  for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
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

/** Add a 1x1 tile to grid page `index` at `at` (or the first free cell). */
export function addTile(
  layout: Layout,
  index: number,
  type: TileType,
  at?: { x: number; y: number },
): { layout: Layout; id: string } | null {
  const page = gridPage(layout, index);
  if (!page) return null;
  const cell = at && fits(page, { ...at, w: 1, h: 1 }) ? at : at ? null : firstFreeCell(page);
  if (!cell) return null;
  const id = nextId(usedIds(layout), 'tile');
  return {
    id,
    layout: withGrid(layout, index, (p) => ({
      ...p,
      tiles: [...p.tiles, newTile(type, id, cell)],
    })),
  };
}

function placeTile(layout: Layout, index: number, id: string, rect: Rect): Layout | null {
  const page = gridPage(layout, index);
  if (!page || !page.tiles.some((t) => t.id === id) || !fits(page, rect, id)) return null;
  return withGrid(layout, index, (p) => ({
    ...p,
    tiles: p.tiles.map((t) => (t.id === id ? { ...t, ...rect } : t)),
  }));
}

export function moveTile(
  layout: Layout,
  index: number,
  id: string,
  x: number,
  y: number,
): Layout | null {
  const t = gridPage(layout, index)?.tiles.find((tile) => tile.id === id);
  return t ? placeTile(layout, index, id, { x, y, w: t.w, h: t.h }) : null;
}

export function resizeTile(
  layout: Layout,
  index: number,
  id: string,
  w: number,
  h: number,
): Layout | null {
  const t = gridPage(layout, index)?.tiles.find((tile) => tile.id === id);
  return t ? placeTile(layout, index, id, { x: t.x, y: t.y, w, h }) : null;
}

export function removeTile(layout: Layout, index: number, id: string): Layout {
  return withGrid(layout, index, (p) => ({ ...p, tiles: p.tiles.filter((t) => t.id !== id) }));
}

/** Merge `patch` into `target`; undefined values remove the field (e.g. clearing the unit). */
function merge<T>(target: T, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  return next as T;
}

/** Merge settings into a tile. Undefined values remove the field. */
export function updateTile(
  layout: Layout,
  index: number,
  id: string,
  patch: Record<string, unknown>,
): Layout {
  return withGrid(layout, index, (p) => ({
    ...p,
    tiles: p.tiles.map((t) => (t.id === id ? merge(t, patch) : t)),
  }));
}

/** Change the grid size. Tiles that no longer fit stay, and are reported by the validator. */
export function setGrid(layout: Layout, index: number, cols: number, rows: number): Layout {
  return withGrid(layout, index, (p) => ({ ...p, grid: { cols, rows } }));
}

// ---- pages ----

export type NewPageKind = 'grid' | 'wind_rose';

/** Insert a new page after `after` (default: at the end). Returns the new page's index. */
export function addPage(
  layout: Layout,
  kind: NewPageKind,
  after = layout.pages.length - 1,
): { layout: Layout; index: number } {
  const used = usedIds(layout);
  const page: Page =
    kind === 'grid'
      ? {
          kind: 'grid',
          id: nextId(used, 'page'),
          title: 'Page',
          grid: { cols: 2, rows: 2 },
          tiles: [],
        }
      : {
          kind: 'widget',
          widget: 'wind_rose',
          id: nextId(used, 'wind'),
          title: 'Wind',
          config: { showTrueWind: true },
          slots: {},
        };
  return insertPages(layout, [page], after);
}

function insertPages(
  layout: Layout,
  pages: Page[],
  after: number,
): { layout: Layout; index: number } {
  const at = Math.max(0, Math.min(layout.pages.length, after + 1));
  const next = [...layout.pages];
  next.splice(at, 0, ...pages);
  return { layout: { ...layout, pages: next }, index: at };
}

/**
 * Copy the pages of a starter layout in after `after`, renaming any page or tile id that is
 * already taken. Returns the index of the first inserted page.
 */
export function addTemplatePages(
  layout: Layout,
  template: Layout,
  after = layout.pages.length - 1,
): { layout: Layout; index: number } {
  const used = usedIds(layout);
  const claim = (id: string) => {
    const free = used.has(id) ? nextId(used, id) : id;
    used.add(free);
    return free;
  };
  const pages = template.pages.map((p): Page => {
    const id = claim(p.id);
    if (p.kind !== 'grid') return { ...p, id };
    return { ...p, id, tiles: p.tiles.map((t) => ({ ...t, id: claim(t.id) })) };
  });
  return insertPages(layout, pages, after);
}

/** Replace all pages (and the theme) with the template's; the layout keeps its id and name. */
export function applyTemplate(layout: Layout, template: Layout): Layout {
  return { ...layout, theme: template.theme, pages: structuredClone(template.pages) };
}

/** Remove a page; the last page cannot be removed (a layout needs one). */
export function removePage(layout: Layout, index: number): Layout | null {
  if (layout.pages.length <= 1 || !layout.pages[index]) return null;
  return { ...layout, pages: layout.pages.filter((_, i) => i !== index) };
}

/** Move a page by `delta` places; null at either end. */
export function movePage(layout: Layout, index: number, delta: number): Layout | null {
  const to = index + delta;
  if (!layout.pages[index] || to < 0 || to >= layout.pages.length) return null;
  const pages = [...layout.pages];
  const [p] = pages.splice(index, 1);
  pages.splice(to, 0, p as Page);
  return { ...layout, pages };
}

/** Set the title shown in the display's footer; empty removes it (the id is shown). */
export function renamePage(layout: Layout, index: number, title: string): Layout {
  return withPage(layout, index, (p) => merge(p, { title: title || undefined }));
}

/** Merge into a wind-rose slot; `null` empties the slot. A new slot starts without a path. */
export function updateSlot(
  layout: Layout,
  index: number,
  slot: SlotName,
  patch: Record<string, unknown> | null,
): Layout {
  return withRose(layout, index, (p) => {
    const slots = { ...p.slots };
    if (patch === null) delete slots[slot];
    else slots[slot] = merge<DataItem>(slots[slot] ?? { path: '' }, patch);
    return { ...p, slots };
  });
}

/** Merge into a wind-rose page's config; undefined values fall back to the defaults. */
export function setPageConfig(
  layout: Layout,
  index: number,
  patch: Partial<Record<keyof typeof WIND_ROSE_DEFAULTS, unknown>>,
): Layout {
  return withRose(layout, index, (p) => ({ ...p, config: merge(p.config ?? {}, patch) }));
}

/** What a validation error points at (e.g. "/pages/0/tiles/2/label"). */
export interface ProblemTarget {
  page: number;
  tileId?: string;
  slot?: SlotName;
}

export function targetForPointer(layout: Layout, pointer: string): ProblemTarget | undefined {
  const m = /^\/pages\/(\d+)(?:\/(tiles|slots)\/([^/]+))?(\/|$)/.exec(pointer);
  if (!m) return undefined;
  const index = Number(m[1]);
  const page = layout.pages[index];
  if (!page) return undefined;
  if (m[2] === 'tiles' && page.kind === 'grid')
    return { page: index, tileId: page.tiles[Number(m[3])]?.id };
  if (m[2] === 'slots' && (WIND_ROSE_SLOTS as readonly string[]).includes(m[3] ?? ''))
    return { page: index, slot: m[3] as SlotName };
  return { page: index };
}
