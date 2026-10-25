// Value display, matching the firmware renderer (esphelm_runtime.cpp on_value_):
// numbers converted with the shared unit table and fixed decimals (default 1), booleans as
// on/off, strings as-is, anything else "--".
import { QUANTITIES, toDisplay, type UnitId } from '@esphelm/schema';

export function formatValue(
  value: unknown,
  unit: UnitId | undefined,
  decimals: number | undefined,
): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const v = unit ? toDisplay(value, unit) : value;
    return v.toFixed(decimals ?? 1);
  }
  if (typeof value === 'string') return value;
  return '--';
}

/** The display unit chosen when a path is picked (a UX default, not part of the contract). */
const PREFERRED: Record<string, UnitId> = {
  speed: 'kn',
  angle: 'deg',
  angularVelocity: 'degpm',
  temperature: 'degC',
  ratio: 'pct',
  frequency: 'rpm',
  length: 'm',
  volume: 'L',
  flow: 'Lph',
  pressure: 'hPa',
  charge: 'Ah',
  energy: 'kWh',
  power: 'W',
  voltage: 'V',
  current: 'A',
  time: 'min',
};

export function preferredUnit(quantity: string | undefined): UnitId | undefined {
  if (!quantity) return undefined;
  return PREFERRED[quantity] ?? QUANTITIES[quantity]?.si;
}
