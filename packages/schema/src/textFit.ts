import { TEXT_FIT } from './tiles.js';

/**
 * The editor's estimate of the font a value tile's number gets on the device (ADR-0017). The
 * device measures its real glyphs; this uses Roboto's proportions to the line height (the
 * runtime's only font), so a preview can be a pixel or two off but picks the same sizes in
 * practice. Fonts are named by their line height in device pixels (hello.fontLineHeights).
 */

/** Roboto: line height 1.172 em, digits 0.5625 em wide and 0.711 em tall, "." 0.264 em. */
const EM_PER_LINE = 1 / 1.172;
const DIGIT_WIDTH = 0.5625;
const DIGIT_HEIGHT = 0.711;
const NARROW_WIDTH = 0.27; // . , : - and space
const OTHER_WIDTH = 0.6;

/** Line heights of the default 480×480 build's fonts (firmware/fonts.yaml), smallest first. */
export const DEFAULT_FONT_LINE_HEIGHTS: readonly number[] = [26, 38, 56, 75, 113];
/** Line heights of the default 480×480 build's digits-only fonts. */
export const DEFAULT_DIGIT_FONT_LINE_HEIGHTS: readonly number[] = [150, 225];

/** The number a value tile sizes its font for: "88" plus its decimals (wider values step down). */
export function valueSample(decimals: number): string {
  const digits = '8'.repeat(TEXT_FIT.sampleDigits);
  return decimals > 0 ? `${digits}.${'8'.repeat(decimals)}` : digits;
}

/** Estimated width in pixels of `text` in the font with line height `line`. */
export function textWidth(text: string, line: number): number {
  const em = line * EM_PER_LINE;
  let w = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') w += DIGIT_WIDTH;
    else if ('.,:- '.includes(ch)) w += NARROW_WIDTH;
    else w += OTHER_WIDTH;
  }
  return Math.ceil(w * em);
}

/** Font size (em) in pixels of the font with line height `line`. */
export function fontSize(line: number): number {
  return line * EM_PER_LINE;
}

/** Estimated height in pixels of a digit in the font with line height `line`. */
export function digitHeight(line: number): number {
  return Math.ceil(line * EM_PER_LINE * DIGIT_HEIGHT);
}

/** Caption and unit font for a number in font `line`: at most companionPercent of it. */
export function companionLine(ladder: readonly number[], line: number): number {
  const sorted = [...ladder].sort((a, b) => a - b);
  let best = sorted[0] ?? line;
  for (const l of sorted) if (l * 100 <= line * TEXT_FIT.companionPercent) best = l;
  return best;
}

export interface ValueTextFit {
  /** Line height of the number's font. */
  value: number;
  /** Line height of the caption and unit font. */
  caption: number;
}

/** Characters a formatted number can contain: what the digits-only fonts have. */
export const DIGIT_GLYPHS = '0123456789.-';

/** Whether `text` can be drawn in a digits-only font. */
export function isNumericText(text: string): boolean {
  for (const ch of text) if (!DIGIT_GLYPHS.includes(ch)) return false;
  return true;
}

/**
 * The largest number font whose sample fits the tile's content box (device pixels), with the
 * caption line above and the unit line below when the tile has them; the smallest otherwise.
 * `digits` are the digits-only fonts (hello.digitFontLineHeights): the number may use them while
 * its text is numeric; captions never do. With `text` (the value shown), a value wider than the
 * sample, or a non-numeric one in a digits-only font, steps down as the device does; the caption
 * keeps its size.
 */
export function fitValueText(
  ladder: readonly number[],
  box: { width: number; height: number },
  opts: {
    decimals: number;
    caption: boolean;
    unit: boolean;
    text?: string;
    digits?: readonly number[];
  },
): ValueTextFit {
  const full = [...ladder].sort((a, b) => a - b);
  // One list of both kinds; a full font wins over a digits-only one of the same line height.
  const fonts = [
    ...full.map((line) => ({ line, digits: false })),
    ...(opts.digits ?? [])
      .filter((line) => !full.includes(line))
      .map((line) => ({ line, digits: true })),
  ].sort((a, b) => a.line - b.line);
  const sample = valueSample(opts.decimals);
  const text = opts.text;
  for (let i = fonts.length - 1; i >= 0; i--) {
    const value = fonts[i]!.line;
    const caption = companionLine(full, value);
    const bands = (opts.caption ? caption : 0) + (opts.unit ? caption : 0);
    if (textWidth(sample, value) <= box.width && digitHeight(value) + bands <= box.height) {
      let j = i;
      if (text !== undefined) {
        const numeric = isNumericText(text);
        while (
          j > 0 &&
          ((fonts[j]!.digits && !numeric) ||
            (text.length > sample.length && textWidth(text, fonts[j]!.line) > box.width))
        )
          j--;
      }
      return { value: fonts[j]!.line, caption };
    }
  }
  const value = full[0] ?? 0;
  return { value, caption: value };
}
