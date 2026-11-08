import { WIND_ROSE_TACK } from './tiles.js';

/**
 * Wind rose performance geometry (ADR-0029), the one definition shared by the editor preview and
 * the firmware (firmware/components/esphelm_runtime/esphelm_wind_rose.h mirrors it;
 * fixtures/wind-rose.cases.json proves they agree). Degrees; the rose is fixed to the bow, so
 * every result is clockwise from the bow in [0, 360).
 */

/** `v` into [0, 360). */
function norm(v: number): number {
  return ((v % 360) + 360) % 360;
}

/** Where `direction` (a compass direction) sits on the rose: clockwise from the bow. */
export function roseRelative(direction: number, heading: number): number {
  return norm(direction - heading);
}

/** True wind angle in (-180, 180]: positive with the wind from starboard. */
export function trueWindAngle(twd: number, heading: number): number {
  const d = roseRelative(twd, heading);
  return d > 180 ? d - 360 : d;
}

/** The tack angle used: SignalK's (by its size) when within min..max, else the fixed one. */
export function tackAngle(
  fromSignalK: number | undefined,
  limits: { min: number; max: number },
  fixed: number,
): number {
  if (fromSignalK === undefined || !Number.isFinite(fromSignalK)) return fixed;
  const a = Math.abs(fromSignalK);
  return a >= limits.min && a <= limits.max ? a : fixed;
}

export interface RoseLaylines {
  /** Upwind (|TWA| < 90): the beat angle is used, else the gybe angle. */
  upwind: boolean;
  /** The tack angle used, in degrees. */
  angle: number;
  /** The heading on starboard tack (wind from starboard), from the bow. */
  starboard: number;
  /** The heading on port tack, from the bow. */
  port: number;
}

/**
 * The laylines: the heading on each tack at the beat angle (upwind) or gybe angle (downwind).
 * `beat` and `gybe` are SignalK's, undefined when missing or stale; `fixed` the tile's angles.
 */
export function roseLaylines(
  twd: number,
  heading: number,
  beat: number | undefined,
  gybe: number | undefined,
  fixed: { beat: number; gybe: number } = {
    beat: WIND_ROSE_TACK.beat.fixed,
    gybe: WIND_ROSE_TACK.gybe.fixed,
  },
): RoseLaylines {
  const twa = trueWindAngle(twd, heading);
  const upwind = Math.abs(twa) < 90;
  const angle = upwind
    ? tackAngle(beat, WIND_ROSE_TACK.beat, fixed.beat)
    : tackAngle(gybe, WIND_ROSE_TACK.gybe, fixed.gybe);
  return { upwind, angle, starboard: norm(twa - angle), port: norm(twa + angle) };
}

/**
 * Where the polar's target true wind angle sits on the rose, on the side the wind comes from
 * (starboard when dead ahead or astern). Undefined unless 0 < |target| < 180.
 */
export function roseTarget(twd: number, heading: number, target: number): number | undefined {
  const t = Math.abs(target);
  if (!(t > 0 && t < 180)) return undefined;
  return norm(trueWindAngle(twd, heading) >= 0 ? t : -t);
}
