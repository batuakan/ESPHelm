import type { CenterZeroSides } from './tiles.js';

/**
 * Centre-zero gauges and bars (ADR-0023), the text shared by the editor preview and the firmware
 * (firmware/components/esphelm_runtime/esphelm_center_zero.h mirrors it;
 * fixtures/center-zero.cases.json proves they agree).
 */

/**
 * `|v|` with `decimals` decimals, rounding halves up: floor(x + 0.5), written out so the C++ copy
 * rounds identically (toFixed and printf disagree on ties such as 12.5).
 */
function magnitude(v: number, decimals: number): string {
  const s = 10 ** decimals;
  return (Math.floor(Math.abs(v) * s + 0.5) / s).toFixed(decimals);
}

/** Half the symmetric scale: it runs from -M to M, so zero is always in the middle. */
export function centerZeroSpan(min: number, max: number): number {
  return Math.max(Math.abs(min), Math.abs(max));
}

/**
 * A value's text on a centre-zero scale, and its side. portStarboard: the magnitude and "P" or
 * "S"; plusMinus: signed ("+8.2", "-3.0"). A value that rounds to zero has no side or sign.
 * `decimals` absent: 1, as for other tiles.
 */
export function centerZeroText(
  n: number,
  decimals: number | undefined,
  sides: CenterZeroSides,
): { text: string; side: '' | 'P' | 'S' } {
  const text = magnitude(n, decimals ?? 1);
  if (Number(text) === 0) return { text, side: '' };
  if (sides === 'plusMinus') return { text: `${n < 0 ? '-' : '+'}${text}`, side: '' };
  return { text, side: n < 0 ? 'P' : 'S' };
}

/**
 * A tick label at `v` on a centre-zero scale of half-span `m`: no decimals when the whole scale
 * spans 20 or more, else one (as plain gauges); magnitudes for portStarboard, signed for plusMinus.
 */
export function centerZeroTick(v: number, m: number, sides: CenterZeroSides): string {
  const text = magnitude(v, 2 * m >= 20 ? 0 : 1);
  if (sides === 'portStarboard' || Number(text) === 0) return text;
  return `${v < 0 ? '-' : '+'}${text}`;
}
