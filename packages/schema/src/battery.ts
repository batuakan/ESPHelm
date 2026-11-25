/**
 * Battery tile text and rows (ADR-0046), the one definition shared by the editor preview and the
 * firmware (firmware/components/esphelm_runtime/esphelm_battery.h mirrors it;
 * fixtures/battery.cases.json proves they agree).
 */
import { BATTERY_FIT } from './tiles.js';

/** Below this many amperes either way the battery is idle, neither charging nor discharging. */
export const BATTERY_IDLE_CURRENT = 0.1;
/** Longer than this (99 days) is not a time remaining worth showing: an idle battery's estimate. */
export const BATTERY_MAX_TIME_LEFT = 99 * 86400;

export type BatteryState = 'charging' | 'discharging' | 'idle';

/** Time until empty: "< 1 min", "45 min", "3 h 05", "2 d 4 h"; "" when unknown, negative or over 99 days. */
export function timeLeft(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
  if (seconds < 0 || seconds > BATTERY_MAX_TIME_LEFT) return '';
  const s = Math.floor(seconds);
  if (s < 60) return '< 1 min';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Charging, discharging or idle from the current in amperes (positive charges unless inverted); null when unknown. */
export function batteryState(
  current: number | null | undefined,
  invert: boolean,
): BatteryState | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  const c = invert ? -current : current;
  if (c > BATTERY_IDLE_CURRENT) return 'charging';
  if (c < -BATTERY_IDLE_CURRENT) return 'discharging';
  return 'idle';
}

/**
 * A charger's mode for the display: "bulk" or "charging bulk" becomes "Bulk". "" for none,
 * "unknown", "other", text over 20 characters or with characters the fonts lack (not printable ASCII).
 */
export function chargingModeText(mode: unknown): string {
  if (typeof mode !== 'string') return '';
  let m = mode.trim();
  if (/^charging /i.test(m)) m = m.slice('charging '.length).trim();
  if (m.length === 0 || m.length > 20 || !/^[\x20-\x7E]+$/.test(m)) return '';
  if (/^(unknown|other)$/i.test(m)) return '';
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/**
 * The tile's state line: "Charging: Bulk" or "Charging"; "14 h 20 left" or "Discharging"; the
 * charger's mode or "Idle"; without a current, the time left or the mode, else "".
 */
export function batteryStatus(
  state: BatteryState | null,
  secondsLeft: number | null | undefined,
  mode: unknown,
): string {
  const m = chargingModeText(mode);
  const t = timeLeft(secondsLeft);
  switch (state) {
    case 'charging':
      return m ? `Charging: ${m}` : 'Charging';
    case 'discharging':
      return t ? `${t} left` : 'Discharging';
    case 'idle':
      return m || 'Idle';
    default:
      return t ? `${t} left` : m;
  }
}

/** Which rows a battery tile shows and how tall they are, in device pixels. */
export interface BatteryRows {
  /** Line height of the rows' font. */
  line: number;
  /** The caption row above the battery (label, voltage). */
  caption: boolean;
  /** Below the battery: current and power, the state line, solar. */
  power: boolean;
  status: boolean;
  solar: boolean;
  /** Where the battery's band starts below the content top, and how tall it is. */
  top: number;
  height: number;
}

/**
 * Rows for a content box of `width` x `height` (device pixels) with the font line heights `ladder`
 * (full fonts only), of the rows the tile has (`want`): the rows' font is the largest at most
 * BATTERY_FIT.linePercent % of the height that fits BATTERY_FIT.lineWidths times in the width; rows
 * are dropped (solar, status, power, then the caption) while the battery's band would be under
 * BATTERY_FIT.minBody.
 */
export function batteryRows(
  width: number,
  height: number,
  ladder: readonly number[],
  want: { caption: boolean; power: boolean; status: boolean; solar: boolean },
): BatteryRows {
  const sorted = [...ladder].sort((a, b) => a - b);
  let line = sorted[0] ?? 0;
  for (const l of sorted) {
    if (l * 100 <= height * BATTERY_FIT.linePercent && l * BATTERY_FIT.lineWidths <= width)
      line = l;
  }
  const rows = { ...want };
  const order = ['solar', 'status', 'power', 'caption'] as const;
  const count = () => order.filter((k) => rows[k]).length;
  for (const k of order) {
    if (height - count() * line >= BATTERY_FIT.minBody) break;
    rows[k] = false;
  }
  const n = count();
  return { line, ...rows, top: rows.caption ? line : 0, height: height - n * line };
}
