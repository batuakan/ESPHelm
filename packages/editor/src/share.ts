// Layout files (ADR-0027): export is the layout JSON itself (layout v1, like the starter
// templates); import checks an untrusted file and keeps the display's own layout id and name.
import { migrateLayout, validateLayout, type Layout } from '@esphelm/schema';
import { layoutCharts, layoutPathRefs, withValidStartPage } from './layoutOps';

/** Largest file an import reads. Layouts are a few KB; this only stops a wrong file. */
export const IMPORT_MAX_BYTES = 1024 * 1024;
/** Validation errors listed for a refused file; the rest are counted. */
const ERRORS_SHOWN = 5;
export const IMPORT_TOO_LARGE = 'The file is larger than 1 MB; it is not an ESPHelm layout.';

/** File name and text of an exported layout. */
export function exportFile(layout: Layout): { fileName: string; text: string } {
  const slug =
    (layout.name ?? layout.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'layout';
  return { fileName: `esphelm-${slug}.json`, text: `${JSON.stringify(layout, null, 2)}\n` };
}

export type ImportResult =
  { ok: true; layout: Layout; name?: string } | { ok: false; errors: string[] };

/**
 * Read a layout file for `current`'s display. Layouts from before Phase 5b are upgraded. The
 * result has `current`'s id and name, so an import never replaces another display's layout;
 * `name` is the file's own layout name (if it has one), for the confirm question.
 */
export function parseImport(text: string, current: Layout): ImportResult {
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES)
    return { ok: false, errors: [IMPORT_TOO_LARGE] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: ['The file is not JSON; export a layout from the ESPHelm editor.'],
    };
  }
  const result = validateLayout(migrateLayout(raw).layout);
  if (!result.ok) {
    const shown = result.errors
      .slice(0, ERRORS_SHOWN)
      .map((e) => `${e.pointer || '/'}: ${e.message}`);
    const more = result.errors.length - shown.length;
    return { ok: false, errors: more > 0 ? [...shown, `and ${more} more`] : shown };
  }
  const { id: _id, name, ...rest } = result.value;
  void _id;
  return {
    ok: true,
    ...(name !== undefined ? { name } : {}),
    layout: withValidStartPage({
      ...rest,
      id: current.id,
      ...(current.name !== undefined ? { name: current.name } : {}),
    } as Layout),
  };
}

/** A path or chart an imported layout uses that this server doesn't have. */
export interface MissingRef {
  kind: 'path' | 'chart';
  value: string;
  /** Fields (paths) or chart tiles (charts) that use it. */
  uses: number;
}

/** Paths not in `knownPaths` and charts not in `chartIds`, in the order the layout uses them. */
export function missingRefs(
  layout: Layout,
  knownPaths: Set<string>,
  chartIds: Set<string>,
): MissingRef[] {
  const counts = new Map<string, MissingRef>();
  const count = (kind: MissingRef['kind'], value: string) => {
    const key = `${kind}:${value}`;
    const m = counts.get(key) ?? { kind, value, uses: 0 };
    m.uses++;
    counts.set(key, m);
  };
  for (const r of layoutPathRefs(layout)) if (!knownPaths.has(r.path)) count('path', r.path);
  for (const chart of layoutCharts(layout)) if (!chartIds.has(chart)) count('chart', chart);
  return [...counts.values()];
}
