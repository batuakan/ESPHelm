import { HISTORY } from './tiles.js';

/**
 * Value history helpers (ADR-0018), mirrored in the firmware's history popup. A value tile
 * records unless its `history` is false.
 */

/** Whether a value tile records its history (absent means on). */
export function historyEnabled(tile: { history?: boolean }): boolean {
  return tile.history !== false;
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
