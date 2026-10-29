/**
 * Upgrade layouts stored before Phase 5b, when the wind rose was a page kind
 * (`{ kind: "widget", widget: "wind_rose", id, title?, config?, slots }`). Each such page becomes
 * a 1x1 grid page with one wind_rose tile carrying the same config and slots (ADR-0010).
 * The validator does not accept the old shape; only the plugin calls this, on stored layouts.
 * Input is untrusted JSON: anything it does not recognise is returned unchanged.
 */
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function migrateLayout(input: unknown): { layout: unknown; changed: boolean } {
  if (!isObject(input) || !Array.isArray(input.pages)) return { layout: input, changed: false };
  const pages: unknown[] = input.pages;
  const isOldRose = (p: unknown) => isObject(p) && p.kind === 'widget' && p.widget === 'wind_rose';
  if (!pages.some(isOldRose)) return { layout: input, changed: false };

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

  const migrated = pages.map((p) => {
    if (!isOldRose(p)) return p;
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
    return { kind: 'grid', ...page, grid: { cols: 1, rows: 1 }, tiles: [tile] };
  });
  return { layout: { ...input, pages: migrated }, changed: true };
}
