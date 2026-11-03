import { HEADING_TAPE_FIT } from './tiles.js';

/**
 * Heading tape geometry (ADR-0022), the one definition shared by the editor preview and the
 * firmware (firmware/components/esphelm_runtime/esphelm_heading_tape.h mirrors it;
 * fixtures/heading-tape.cases.json proves they agree). Degrees and pixels across the tape, whose
 * centre is the heading.
 */

export type TapeTickKind = 'minor' | 'medium' | 'major';

/** One tick on the tape: its compass degree, its x from the tape's left edge, and its label. */
export interface TapeTick {
  deg: number;
  x: number;
  kind: TapeTickKind;
  label?: string;
}

/** `v` into [0, 360). */
function norm(v: number): number {
  return ((v % 360) + 360) % 360;
}

/** Label of a labelled tick: the cardinal points as letters, the rest in degrees. */
export function tapeLabel(deg: number): string {
  const d = norm(deg);
  return d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d);
}

/**
 * The ticks across a tape `width` pixels wide showing `span` degrees around `heading`, left to
 * right: every 30° major and labelled, every 10° medium, every 5° minor. Minor ticks only when
 * they are HEADING_TAPE_FIT.minorTickPx apart or more; every 10° labelled when that's
 * HEADING_TAPE_FIT.label10Px or more, else every 30°.
 */
export function tapeMarks(heading: number, span: number, width: number): TapeTick[] {
  const pxPerDeg = width / span;
  const minors = pxPerDeg * 5 >= HEADING_TAPE_FIT.minorTickPx;
  const tens = pxPerDeg * 10 >= HEADING_TAPE_FIT.label10Px;
  const out: TapeTick[] = [];
  const first = Math.ceil((heading - span / 2) / 5) * 5;
  for (let d = first; d <= heading + span / 2; d += 5) {
    const deg = norm(d);
    const kind: TapeTickKind = deg % 30 === 0 ? 'major' : deg % 10 === 0 ? 'medium' : 'minor';
    if (kind === 'minor' && !minors) continue;
    const x = width / 2 + (d - heading) * pxPerDeg;
    const labelled = kind === 'major' || (tens && kind === 'medium');
    out.push(labelled ? { deg, x, kind, label: tapeLabel(deg) } : { deg, x, kind });
  }
  return out;
}

/**
 * Where a marker at `value` degrees sits on the tape: its x, clamped to the tape, and `off`: -1
 * when it is beyond the left edge, 1 beyond the right edge, 0 on the tape. The shorter way
 * round decides the side, so 10° with the heading at 350° is right of centre.
 */
export function tapeX(
  value: number,
  heading: number,
  span: number,
  width: number,
): { x: number; off: -1 | 0 | 1 } {
  const delta = norm(value - heading + 180) - 180; // [-180, 180)
  if (delta < -span / 2) return { x: 0, off: -1 };
  if (delta > span / 2) return { x: width, off: 1 };
  return { x: width / 2 + (delta * width) / span, off: 0 };
}
