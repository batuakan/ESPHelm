import type { Layout } from './layout.js';
import type { UnitId } from './primitives.js';
import { HISTORY, WIND_ROSE_DEFAULTS, type RoseHistoryKey, type WindRoseTile } from './tiles.js';
import { WRAP_EPSILON } from './units.js';

/**
 * Value history helpers (ADR-0018, ADR-0019), mirrored in the firmware (value_history.h and
 * the history popup). Nothing records unless switched on: `history: true` on a value tile, or
 * the names in a wind rose's `history`.
 */

/** Whether a value tile records its history (absent means off). */
export function historyEnabled(tile: { history?: boolean }): boolean {
  return tile.history === true;
}

/**
 * Button text of a wind rose value in the history popup, when its slot has no label. Mirrored
 * by ROSE_HISTORY_TITLES in the firmware (esphelm_runtime.cpp).
 */
export const ROSE_HISTORY_TITLES: Record<RoseHistoryKey, string> = {
  center1: 'Centre 1',
  center2: 'Centre 2',
  center3: 'Centre 3',
  topLeft: 'Top left',
  topRight: 'Top right',
  bottomLeft: 'Bottom left',
  bottomRight: 'Bottom right',
  apparentAngle: 'AWA',
  trueDirection: 'TWD',
  heading: 'HDG',
};

/** One value that records. `key` is the tile id, or "<tile id>/<name>" for a wind rose value. */
export interface HistorySeries {
  key: string;
  tileId: string;
  name?: RoseHistoryKey;
  title: string;
  path: string;
  unit?: UnitId;
}

/** The values of a wind rose that record, in ROSE_HISTORY_KEYS order (empty slots skipped). */
export function roseHistorySeries(tile: WindRoseTile): HistorySeries[] {
  const out: HistorySeries[] = [];
  const names = new Set(tile.history ?? []);
  for (const name of Object.keys(ROSE_HISTORY_TITLES) as RoseHistoryKey[]) {
    if (!names.has(name)) continue;
    const series = { key: `${tile.id}/${name}`, tileId: tile.id, name };
    if (name === 'apparentAngle' || name === 'trueDirection' || name === 'heading') {
      const path = tile.config?.[name] ?? WIND_ROSE_DEFAULTS[name];
      out.push({ ...series, title: ROSE_HISTORY_TITLES[name], path, unit: 'deg' });
      continue;
    }
    const item = tile.slots[name];
    if (!item) continue;
    out.push({
      ...series,
      title: item.label || ROSE_HISTORY_TITLES[name],
      path: item.path,
      ...(item.unit ? { unit: item.unit } : {}),
    });
  }
  return out;
}

/** Every value the layout records, page by page: what takes the display's history memory. */
export function historySeries(layout: Pick<Layout, 'pages'>): HistorySeries[] {
  const out: HistorySeries[] = [];
  for (const page of layout.pages) {
    if (page.kind === 'chart') continue;
    for (const tile of page.tiles) {
      if (tile.type === 'value' && historyEnabled(tile)) {
        out.push({
          key: tile.id,
          tileId: tile.id,
          title: tile.label || tile.path,
          path: tile.path,
          ...(tile.unit ? { unit: tile.unit } : {}),
        });
      } else if (tile.type === 'wind_rose') {
        out.push(...roseHistorySeries(tile));
      }
    }
  }
  return out;
}

/** How many values the layout records, against the limits of both kinds of board. */
export function historyCount(layout: Pick<Layout, 'pages'>): {
  count: number;
  fitsPsram: boolean;
  fitsNoPsram: boolean;
} {
  const count = historySeries(layout).length;
  return {
    count,
    fitsPsram: count <= HISTORY.maxValuesPsram,
    fitsNoPsram: count <= HISTORY.maxValuesNoPsram,
  };
}

/** Text for a time `seconds` ago on the graph's time axis: minutes below 2 h, else hours. */
export function ageLabel(seconds: number): string {
  if (seconds <= 0) return 'now';
  return seconds < 7200 ? `-${Math.round(seconds / 60)} m` : `-${Math.round(seconds / 3600)} h`;
}

/** The time axis labels of a window, left to right: its start, its middle, now. */
export function axisLabels(seconds: number): [string, string, string] {
  return [ageLabel(seconds), ageLabel(seconds / 2), ageLabel(0)];
}

/** Seconds one point of window `index` covers. */
export function pointSeconds(index: number): number {
  const w = HISTORY.windows[index];
  return w === undefined ? 0 : w.seconds / HISTORY.points;
}

/** A display unit's wrap range, e.g. [0, 360] for degrees. */
export type Wrap = readonly [number, number];

/**
 * Mean of angles in a wrap range, on the circle: 350 and 10 average to 0, not 180. Null when
 * there are none, or when they cancel out (no direction). Mirrored by esphelm::circular_mean
 * (value_history.h); fixtures/history.cases.json holds the shared cases.
 */
export function circularMean(values: readonly number[], wrap: Wrap): number | null {
  const [min, max] = wrap;
  const k = (2 * Math.PI) / (max - min);
  let s = 0;
  let c = 0;
  for (const v of values) {
    s += Math.sin((v - min) * k);
    c += Math.cos((v - min) * k);
  }
  if (values.length === 0 || Math.hypot(s, c) < 1e-9 * values.length) return null;
  const span = max - min;
  const a = Math.atan2(s, c) / k; // -span/2 .. span/2
  const m = a < 0 ? a + span + min : a + min;
  return max - m < WRAP_EPSILON * span ? min : m; // as toDisplay: just below the top is the bottom
}

/**
 * `v` moved by whole turns to within half a turn of `centre` ([centre - span/2, centre + span/2)),
 * so a graph around north runs 350..370 instead of jumping from 359 to 0. Mirrored by
 * esphelm::unwrap_around.
 */
export function unwrapAround(v: number, centre: number, wrap: Wrap): number {
  const span = wrap[1] - wrap[0];
  return v - span * Math.floor((v - centre) / span + 0.5);
}
