import type { UnitId } from './primitives.js';
import { SERVER_ZONES, type Zone, type ValueZone } from './tiles.js';
import { UNITS } from './units.js';

/**
 * The zones in SignalK metadata (`meta.zones`, in SI) as a tile's zones, in its display unit
 * (ADR-0020). When they are not empty they replace the tile's own. Mirrored in the firmware
 * (esphelm_server_zones.h); fixtures/server-zones.cases.json keeps the two in step.
 */

/** SignalK's alarm states as ESPHelm's zone states; any other state drops the zone. */
const STATES: Record<string, ValueZone['state']> = {
  nominal: 'normal',
  normal: 'normal',
  alert: 'warn',
  warn: 'warn',
  alarm: 'alarm',
  emergency: 'emergency',
};

/** An end of a zone: undefined when missing or null, null when it is not a number. */
function end(v: unknown): number | undefined | null {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A value tile's zones (no `range`: a missing end stays open), or a gauge's or bar's (`range`: a
 * missing end is its min or max, zones are clipped to it). Zones that make no sense are dropped:
 * an unknown state, an end that isn't a number, no ends at all, or `from` not below `to`. Only the
 * first SERVER_ZONES.maxPerPath usable zones of the path count. No wrapping, so an angle zone
 * across north never matches.
 */
export function serverZonesToDisplay(zones: unknown, unit: UnitId | undefined): ValueZone[];
export function serverZonesToDisplay(
  zones: unknown,
  unit: UnitId | undefined,
  range: { min: number; max: number },
): Zone[];
export function serverZonesToDisplay(
  zones: unknown,
  unit: UnitId | undefined,
  range?: { min: number; max: number },
): ValueZone[] {
  if (!Array.isArray(zones)) return [];
  const u = unit ? UNITS[unit] : undefined;
  const display = (si: number) => (u ? si * u.factor + u.offset : si);
  const out: ValueZone[] = [];
  let usable = 0;
  for (const z of zones as unknown[]) {
    if (usable >= SERVER_ZONES.maxPerPath) break;
    if (typeof z !== 'object' || z === null) continue;
    const { lower: rawLower, upper: rawUpper, state: rawState } = z as Record<string, unknown>;
    const lower = end(rawLower);
    const upper = end(rawUpper);
    const state = typeof rawState === 'string' ? STATES[rawState] : undefined;
    if (lower === null || upper === null || !state) continue;
    if (lower === undefined && upper === undefined) continue;
    if (lower !== undefined && upper !== undefined && lower >= upper) continue;
    usable++;
    let from = lower === undefined ? undefined : display(lower);
    let to = upper === undefined ? undefined : display(upper);
    if (range) {
      from = Math.max(from ?? range.min, range.min);
      to = Math.min(to ?? range.max, range.max);
      if (from >= to) continue;
    }
    out.push({
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      state,
    });
  }
  return out;
}
