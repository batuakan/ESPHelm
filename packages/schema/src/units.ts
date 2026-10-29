import { QUANTITIES, UNITS, UNIT_IDS, type UnitDef, type UnitId } from './generated/units.js';

// UnitId (schema + type) is exported from primitives.ts.
export { QUANTITIES, UNITS, UNIT_IDS, type UnitDef };

/** Values within this fraction of the wrap span below the upper bound snap to the lower bound. */
export const WRAP_EPSILON = 1e-9;

export function isUnitId(id: string): id is UnitId {
  return Object.prototype.hasOwnProperty.call(UNITS, id);
}

/**
 * Convert a SignalK SI value to a display unit: si * factor + offset, then wrap into
 * [wrap[0], wrap[1]). Mirrored exactly by esphelm::units::to_display in generated/esphelm_units.h.
 */
export function toDisplay(si: number, unit: UnitId): number {
  const u = UNITS[unit];
  let v = si * u.factor + u.offset;
  if (u.wrap) {
    const [min, max] = u.wrap;
    const span = max - min;
    v = v - span * Math.floor((v - min) / span);
    if (max - v < WRAP_EPSILON * span) v = min;
  }
  return v;
}

/** Convert a display value back to SI (no wrapping). Used for PUT values and editor input. */
export function fromDisplay(display: number, unit: UnitId): number {
  const u = UNITS[unit];
  return (display - u.offset) / u.factor;
}

/**
 * Quantity (key of QUANTITIES) for a SignalK `meta.units` string, e.g. "m/s" -> "speed".
 * Undefined for units ESPHelm has no display units for.
 */
export function quantityForSignalKUnits(units: string | undefined): string | undefined {
  if (units === undefined) return undefined;
  return Object.entries(QUANTITIES).find(([, q]) => q.signalk === units)?.[0];
}

/** Display units that fit a path with the given SignalK `meta.units` (empty if unknown). */
export function unitsForSignalKUnits(units: string | undefined): readonly UnitId[] {
  const quantity = quantityForSignalKUnits(units);
  return quantity ? (QUANTITIES[quantity]?.units ?? []) : [];
}
