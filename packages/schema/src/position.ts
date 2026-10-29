/**
 * GPS position text, the one definition shared by the editor preview and the firmware
 * (firmware/components/esphelm_runtime/esphelm_position.h mirrors it; fixtures/position.cases.json
 * proves they agree). Integer arithmetic on rounded units, so both give the same digits and
 * rounding carries into the next unit (never 60' or 60").
 */

export const POSITION_FORMATS = ['ddm', 'dms', 'dd', 'decimal'] as const;
export type PositionFormat = (typeof POSITION_FORMATS)[number];

/** Decimals of the last part (minutes, seconds or degrees) when a tile sets none. */
export const POSITION_DEFAULT_DECIMALS: Record<PositionFormat, number> = {
  ddm: 3,
  dms: 1,
  dd: 5,
  decimal: 6,
};

export const POSITION_FORMAT_NAMES: Record<PositionFormat, string> = {
  ddm: 'Degrees and decimal minutes',
  dms: 'Degrees, minutes and seconds',
  dd: 'Decimal degrees',
  decimal: 'Signed decimal',
};

const pad = (n: number, width: number) => String(n).padStart(width, '0');
/** floor(x + 0.5), written out so the C++ copy rounds identically (Math.round differs at 0.49999999999999994). */
const round = (x: number) => Math.floor(x + 0.5);

/** `units` counts 10^-decimals of the last part; prints its integer part padded and the fraction. */
function fixed(units: number, scale: number, decimals: number, width: number): string {
  const whole = Math.floor(units / scale);
  return decimals > 0 ? `${pad(whole, width)}.${pad(units % scale, decimals)}` : pad(whole, width);
}

function part(
  v: number,
  format: PositionFormat,
  decimals: number,
  degWidth: number,
  hemi: string,
): string {
  const scale = 10 ** decimals;
  const abs = Math.abs(v);
  switch (format) {
    case 'ddm': {
      const units = round(abs * 60 * scale);
      const perDeg = 60 * scale;
      const deg = Math.floor(units / perDeg);
      return `${pad(deg, degWidth)}° ${fixed(units - deg * perDeg, scale, decimals, 2)}' ${hemi}`;
    }
    case 'dms': {
      const units = round(abs * 3600 * scale);
      const perDeg = 3600 * scale;
      const perMin = 60 * scale;
      const deg = Math.floor(units / perDeg);
      const rest = units - deg * perDeg;
      const min = Math.floor(rest / perMin);
      return `${pad(deg, degWidth)}° ${pad(min, 2)}' ${fixed(rest - min * perMin, scale, decimals, 2)}" ${hemi}`;
    }
    case 'dd':
      return `${fixed(round(abs * scale), scale, decimals, 1)}° ${hemi}`;
    case 'decimal': {
      const units = round(abs * scale);
      return `${v < 0 && units > 0 ? '-' : ''}${fixed(units, scale, decimals, 1)}`;
    }
  }
}

/**
 * The two lines a position tile shows, or null when `value` isn't a position (an object with a
 * finite latitude in -90..90 and longitude in -180..180): the tile then shows "--".
 */
export function formatPosition(
  value: unknown,
  format: PositionFormat = 'ddm',
  decimals?: number,
): { lat: string; lon: string } | null {
  const p = value as { latitude?: unknown; longitude?: unknown } | null;
  if (typeof p !== 'object' || p === null) return null;
  const { latitude: lat, longitude: lon } = p;
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  )
    return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const d = Math.min(6, Math.max(0, Math.trunc(decimals ?? POSITION_DEFAULT_DECIMALS[format])));
  return {
    lat: part(lat, format, d, 2, lat < 0 ? 'S' : 'N'),
    lon: part(lon, format, d, 3, lon < 0 ? 'W' : 'E'),
  };
}
