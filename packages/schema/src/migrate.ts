/**
 * Upgrade stored layouts whose pages became tiles. Each such page becomes a 1x1 grid page (same
 * id and title) with one tile carrying the page's settings:
 * - the wind rose page before Phase 5b (`{ kind: "widget", widget: "wind_rose", id, title?,
 *   config?, slots }`) becomes a wind_rose tile (ADR-0010);
 * - the chart page (`{ kind: "chart", id, title?, chart, zoom?, anchor?, config? }`) becomes a
 *   chart tile (ADR-0030).
 * The validator does not accept the old shapes; the plugin calls this on stored layouts and the
 * editor on imported ones. Input is untrusted JSON: anything it does not recognise is returned
 * unchanged.
 */
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isOldRose = (p: unknown) => isObject(p) && p.kind === 'widget' && p.widget === 'wind_rose';
const isOldChart = (p: unknown) => isObject(p) && p.kind === 'chart';

export function migrateLayout(input: unknown): { layout: unknown; changed: boolean } {
  if (!isObject(input) || !Array.isArray(input.pages)) return { layout: input, changed: false };
  const pages: unknown[] = input.pages;
  if (!pages.some((p) => isOldRose(p) || isOldChart(p))) return { layout: input, changed: false };

  const used = new Set<string>();
  for (const p of pages) {
    if (!isObject(p)) continue;
    if (typeof p.id === 'string') used.add(p.id);
    if (Array.isArray(p.tiles))
      for (const t of p.tiles) if (isObject(t) && typeof t.id === 'string') used.add(t.id);
  }
  const claim = (id: string) => {
    let free = id;
    for (let n = 1; used.has(free); n++) free = `${id}-${n}`;
    used.add(free);
    return free;
  };
  const gridOf = (page: Json, tile: Json) => ({
    kind: 'grid',
    ...page,
    grid: { cols: 1, rows: 1 },
    tiles: [tile],
  });

  const migrated = pages.map((p) => {
    if (isOldRose(p)) {
      const { kind: _kind, widget: _widget, config, slots, ...page } = p as Json;
      void _kind;
      void _widget;
      const tile: Json = {
        type: 'wind_rose',
        id: claim(`${String(page.id)}-rose`),
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      };
      if (config !== undefined) tile.config = config;
      tile.slots = slots ?? {};
      return gridOf(page, tile);
    }
    if (isOldChart(p)) {
      const { kind: _kind, chart, zoom, anchor, config, ...page } = p as Json;
      void _kind;
      const tile: Json = {
        type: 'chart',
        id: claim(`${String(page.id)}-chart`),
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        chart,
      };
      if (zoom !== undefined) tile.zoom = zoom;
      if (anchor !== undefined) tile.anchor = anchor;
      if (config !== undefined) tile.config = config;
      return gridOf(page, tile);
    }
    return p;
  });
  return { layout: { ...input, pages: migrated }, changed: true };
}
