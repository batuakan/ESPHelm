// Pure editing operations on a layout. Every operation returns a new layout and never
// produces overlapping or out-of-grid tiles; `null` means "not possible here". Grid
// operations take the index of the page they work on. Ids are unique across the whole layout
// (pages and tiles share one namespace, like the validator's DUPLICATE_ID check).
import {
  AUTOPILOT_DEFAULTS,
  POSITION_DEFAULTS,
  WIND_ROSE_DEFAULTS,
  type DataItem,
  type GridPage,
  type Layout,
  type Page,
  type Settings,
  type Tile,
  type TileType,
  type WindRoseTile,
  ROSE_HISTORY_KEYS,
  type RoseHistoryKey,
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

export type SlotName = keyof WindRoseTile['slots'];
/** Centre stack, top to bottom. */
export const CENTER_SLOTS: readonly SlotName[] = ['center1', 'center2', 'center3'];
/** Tile corners, outside the ring. */
export const CORNER_SLOTS: readonly SlotName[] = [
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
];
export const WIND_ROSE_SLOTS: readonly SlotName[] = [...CENTER_SLOTS, ...CORNER_SLOTS];

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

/** Tiles of a page (none for chart pages). */
export function pageTiles(page: Page | undefined): Tile[] {
  return page?.kind === 'grid' ? page.tiles : [];
}

/** Apply `update` to wind-rose tile `id` on page `index`; other tiles are left alone. */
function withRose(
  layout: Layout,
  index: number,
  id: string,
  update: (tile: WindRoseTile) => WindRoseTile,
): Layout {
  return withGrid(layout, index, (p) => ({
    ...p,
    tiles: p.tiles.map((t) => (t.id === id && t.type === 'wind_rose' ? update(t) : t)),
  }));
}

/** SignalK paths a tile shows (what the live preview subscribes to). */
export function tilePaths(tile: Tile): string[] {
  if (tile.type === 'autopilot') {
    // The adjust path is only written to, never shown.
    const cfg = { ...AUTOPILOT_DEFAULTS, ...tile.config };
    return [cfg.statePath, cfg.targetPath, cfg.headingPath];
  }
  if (tile.type === 'position') return [tile.path ?? POSITION_DEFAULTS.path];
  if (tile.type !== 'wind_rose') return [tile.path];
  const cfg = { ...WIND_ROSE_DEFAULTS, ...tile.config };
  return [
    cfg.apparentAngle,
    cfg.trueDirection,
    cfg.heading,
    ...Object.values(tile.slots).map((s) => s.path),
  ];
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
  return new Set(layout.pages.flatMap((p) => [p.id, ...pageTiles(p).map((t) => t.id)]));
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
    case 'position':
      // navigation.position by default, so it shows the boat's position at once.
      return { type, ...place, label: 'Position' };
    case 'wind_rose':
      return { type, ...place, slots: {} };
    case 'autopilot':
      return { type, ...place };
    default:
      return { type: 'value', ...place, path: '' };
  }
}

/**
 * Add a tile to page `index` at `at` (or the first free cell). Tiles are 1x1, except wind
 * roses, which take 2x2 when that fits there.
 */
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
  const prefix =
    type === 'wind_rose'
      ? 'rose'
      : type === 'autopilot'
        ? 'pilot'
        : type === 'position'
          ? 'pos'
          : 'tile';
  const id = nextId(usedIds(layout), prefix);
  const tile = newTile(type, id, cell);
  const big = type === 'wind_rose' || type === 'autopilot';
  if (big && fits(page, { ...cell, w: 2, h: 2 })) {
    tile.w = 2;
    tile.h = 2;
  } else if (type === 'position' && fits(page, { ...cell, w: 2, h: 1 })) {
    tile.w = 2; // two text lines read better wide
  }
  return {
    id,
    layout: withGrid(layout, index, (p) => ({ ...p, tiles: [...p.tiles, tile] })),
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

export type NewPageKind = 'grid' | 'wind_rose' | 'autopilot' | 'chart';

/**
 * Insert a new page after `after` (default: at the end). Returns the new page's index.
 * A wind rose or autopilot page is a 1x1 grid with one such tile filling the screen.
 */
export function addPage(
  layout: Layout,
  kind: NewPageKind,
  after = layout.pages.length - 1,
): { layout: Layout; index: number } {
  const used = usedIds(layout);
  if (kind === 'chart') {
    // The chart starts unset: the validator asks for one until it is picked.
    const page: Page = { kind: 'chart', id: nextId(used, 'chart'), title: 'Chart', chart: '' };
    return insertPages(layout, [page], after);
  }
  if (kind === 'grid') {
    const page: Page = {
      kind: 'grid',
      id: nextId(used, 'page'),
      title: 'Page',
      grid: { cols: 2, rows: 2 },
      tiles: [],
    };
    return insertPages(layout, [page], after);
  }
  const rose = kind === 'wind_rose';
  const id = nextId(used, rose ? 'wind' : 'pilot');
  used.add(id);
  const suffix = rose ? 'rose' : 'ap';
  const tileId = used.has(`${id}-${suffix}`) ? nextId(used, `${id}-${suffix}`) : `${id}-${suffix}`;
  const place = { id: tileId, x: 0, y: 0, w: 1, h: 1 };
  const page: Page = {
    kind: 'grid',
    id,
    title: rose ? 'Wind' : 'Autopilot',
    grid: { cols: 1, rows: 1 },
    tiles: [
      rose
        ? { type: 'wind_rose', ...place, config: { showTrueWind: true }, slots: {} }
        : { type: 'autopilot', ...place },
    ],
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
  const pages = template.pages.map((p): Page =>
    p.kind === 'grid'
      ? { ...p, id: claim(p.id), tiles: p.tiles.map((t) => ({ ...t, id: claim(t.id) })) }
      : { ...p, id: claim(p.id) },
  );
  return insertPages(layout, pages, after);
}

/** Replace all pages (and the theme) with the template's; the layout keeps its id and name. */
export function applyTemplate(layout: Layout, template: Layout): Layout {
  return withValidStartPage({
    ...layout,
    theme: template.theme,
    pages: structuredClone(template.pages),
  });
}

/** Remove a page; the last page cannot be removed (a layout needs one). */
export function removePage(layout: Layout, index: number): Layout | null {
  if (layout.pages.length <= 1 || !layout.pages[index]) return null;
  return withValidStartPage({ ...layout, pages: layout.pages.filter((_, i) => i !== index) });
}

/**
 * Change display settings (ADR-0015). `undefined` removes a field (the display's default
 * applies); a settings block with nothing left is removed, so the layout stays as it was.
 */
export function updateSettings(
  layout: Layout,
  patch: Omit<Partial<Settings>, 'brightness'> & {
    brightness?: Partial<NonNullable<Settings['brightness']>>;
  },
): Layout {
  const merged: Record<string, unknown> = { ...layout.settings, ...patch };
  if (patch.brightness) {
    const b: Record<string, unknown> = { ...layout.settings?.brightness, ...patch.brightness };
    for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
    merged.brightness = Object.keys(b).length > 0 ? b : undefined;
  }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const { settings: _old, ...rest } = layout;
  void _old;
  return Object.keys(merged).length > 0 ? { ...rest, settings: merged as Settings } : rest;
}

/** Drop a start page that is no longer a page of the layout (it would be UNKNOWN_PAGE). */
export function withValidStartPage(layout: Layout): Layout {
  const start = layout.settings?.startPage;
  if (start === undefined || layout.pages.some((p) => p.id === start)) return layout;
  return updateSettings(layout, { startPage: undefined });
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

/**
 * Change a chart page: `chart`, `zoom` and `anchor` at the top, path overrides under `config`.
 * Undefined values fall back to the defaults; an empty config is removed.
 */
export function updateChartPage(
  layout: Layout,
  index: number,
  patch: { chart?: string; zoom?: number; anchor?: boolean; config?: Record<string, unknown> },
): Layout {
  return withPage(layout, index, (p) => {
    if (p.kind !== 'chart') return p;
    const { config, ...top } = patch;
    let next = merge(p, top);
    if (config) {
      const c = merge<Record<string, unknown>>(next.config ?? {}, config);
      next =
        Object.keys(c).length > 0 ? { ...next, config: c } : merge(next, { config: undefined });
    }
    return next;
  });
}

/** Merge into a slot of wind-rose tile `id`; `null` empties the slot. New slots start without a path. */
export function updateSlot(
  layout: Layout,
  index: number,
  id: string,
  slot: SlotName,
  patch: Record<string, unknown> | null,
): Layout {
  return withRose(layout, index, id, (t) => {
    const slots = { ...t.slots };
    if (patch === null) delete slots[slot];
    else slots[slot] = merge<DataItem>(slots[slot] ?? { path: '' }, patch);
    // An emptied slot records nothing any more: drop it from the history list too.
    return patch === null ? withHistory({ ...t, slots }, slot, false) : { ...t, slots };
  });
}

/** `tile` with `name` in its history list or not, in ROSE_HISTORY_KEYS order; [] removes it. */
function withHistory(tile: WindRoseTile, name: RoseHistoryKey, on: boolean): WindRoseTile {
  const names = new Set(tile.history ?? []);
  if (on) names.add(name);
  else names.delete(name);
  const history = ROSE_HISTORY_KEYS.filter((k) => names.has(k));
  return history.length > 0 ? { ...tile, history } : merge(tile, { history: undefined });
}

/** Record a value of wind-rose tile `id` (ADR-0019), or stop recording it. */
export function setRoseHistory(
  layout: Layout,
  index: number,
  id: string,
  name: RoseHistoryKey,
  on: boolean,
): Layout {
  return withRose(layout, index, id, (t) => withHistory(t, name, on));
}

/**
 * Merge into the config of tile `id` (wind rose or autopilot); undefined values fall back to
 * the defaults, and an empty config is removed.
 */
export function setTileConfig(
  layout: Layout,
  index: number,
  id: string,
  patch: Record<string, unknown>,
): Layout {
  return withGrid(layout, index, (p) => ({
    ...p,
    tiles: p.tiles.map((t) => {
      if (t.id !== id || (t.type !== 'wind_rose' && t.type !== 'autopilot')) return t;
      const config = merge<Record<string, unknown>>(t.config ?? {}, patch);
      return Object.keys(config).length > 0
        ? ({ ...t, config } as Tile)
        : merge(t, { config: undefined });
    }),
  }));
}

/** What a validation error points at (e.g. "/pages/0/tiles/2/label"). */
export interface ProblemTarget {
  page: number;
  tileId?: string;
  slot?: SlotName;
}

export function targetForPointer(layout: Layout, pointer: string): ProblemTarget | undefined {
  const m = /^\/pages\/(\d+)(?:\/tiles\/(\d+)(?:\/slots\/([^/]+))?)?(\/|$)/.exec(pointer);
  if (!m) return undefined;
  const index = Number(m[1]);
  const page = layout.pages[index];
  if (!page) return undefined;
  if (m[2] === undefined) return { page: index };
  const tileId = pageTiles(page)[Number(m[2])]?.id;
  const slot = (WIND_ROSE_SLOTS as readonly string[]).includes(m[3] ?? '')
    ? (m[3] as SlotName)
    : undefined;
  return { page: index, tileId, ...(slot ? { slot } : {}) };
}
