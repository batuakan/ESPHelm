import type { ValueZone } from './tiles.js';

/**
 * The zone state a value tile shows for `n` (display units): both ends included, an open end
 * unbounded, the last matching zone wins; undefined when none matches. Mirrored in the firmware
 * (esphelm_value_zones.h); fixtures/value-zones.cases.json keeps the two in step.
 */
export function valueZoneState(
  n: number,
  zones: readonly ValueZone[] | undefined,
): ValueZone['state'] | undefined {
  let state: ValueZone['state'] | undefined;
  for (const z of zones ?? []) {
    if ((z.from === undefined || n >= z.from) && (z.to === undefined || n <= z.to)) state = z.state;
  }
  return state;
}
