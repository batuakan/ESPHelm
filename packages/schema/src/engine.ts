import { fitContours, flattenSvgPath, type Contours } from './svgPath.js';
import { ENGINE_FIT, type EngineIconName } from './tiles.js';

/**
 * Engine tile geometry (ADR-0032), the one definition shared by the editor preview and the
 * firmware. The arcs, radii and icons are generated into the firmware's esphelm_engine_shapes.h;
 * engineScale() and engineAngle() are mirrored by esphelm_engine.h, and
 * fixtures/engine.cases.json proves they agree.
 *
 * Angles are in degrees clockwise from 3 o'clock (LVGL's convention, y down). Lengths are
 * fractions of R, half the shorter side of the tile's drawing square.
 */

export type EngineGauge = 'rpm' | 'left' | 'right' | 'bottom';

/** Where each gauge's scale starts (its min) and how far it turns to its max (negative: anticlockwise). */
export const ENGINE_ARCS: Record<EngineGauge, { start: number; sweep: number }> = {
  // lower left, over the top, to lower right; open at the bottom
  rpm: { start: 150, sweep: 240 },
  // inside the RPM arc, both rising upward
  left: { start: 120, sweep: 90 },
  right: { start: 60, sweep: -90 },
  // in the RPM arc's open bottom, rising left to right
  bottom: { start: 130, sweep: -80 },
};

/** Radii, lengths and widths as fractions of R, and the slots' icon boxes. */
export const ENGINE_GEOMETRY = {
  rpm: {
    bandRadius: 0.975,
    bandWidth: 0.03,
    tickOuter: 0.95,
    majorLength: 0.13,
    mediumLength: 0.1,
    minorLength: 0.06,
    majorWidth: 0.022,
    mediumWidth: 0.016,
    minorWidth: 0.01,
    labelRadius: 0.7,
    needleTip: 0.93,
    needleBase: 0.58,
    needleHalfWidth: 0.055,
    /** Centre of the unit line ("RPM"); the multiplier ("x100") sits below it. */
    unitY: -0.42,
    /** Tick labels and the title: the largest font with at most this line height; none fits: no text. */
    labelLine: 0.14,
  },
  side: {
    radius: 0.5,
    trackWidth: 0.012,
    bandWidth: 0.035,
    tickLength: 0.06,
    tickWidth: 0.014,
    needleTip: 0.48,
    needleBase: 0.34,
    needleHalfWidth: 0.04,
  },
  bottom: {
    radius: 0.9,
    trackWidth: 0.012,
    bandWidth: 0.035,
    tickLength: 0.06,
    tickWidth: 0.014,
    needleTip: 0.88,
    needleBase: 0.72,
    needleHalfWidth: 0.04,
  },
  /** Centre and side of each slot's icon (or label) box. */
  icons: {
    left: { x: -0.25, y: -0.02, size: 0.17 },
    right: { x: 0.25, y: -0.02, size: 0.17 },
    bottom: { x: 0, y: 0.6, size: 0.17 },
  },
  /** Ticks on a slot's scale: min, the quarters, max. */
  slotTicks: 5,
  /** A slot's label (without an icon): the largest font with at most this line height. */
  slotLabelLine: 0.1,
  /**
   * Corner values show where their box clears the circle of radius R. The RPM arc is open at the
   * bottom: a bottom corner's box whose top is at least `openBelow` under the centre (below the
   * arc's ends and the needle at min) need only clear the bottom gauge's radius `bottomRadius`.
   */
  corners: { openBelow: 0.52, bottomRadius: 0.9 },
} as const;

/**
 * The line height for text of at most `maxLine` pixels: the largest of the display's full fonts
 * (`ladder`, line heights) that fits, or undefined when even the smallest doesn't (no text).
 */
export function engineFont(ladder: readonly number[], maxLine: number): number | undefined {
  let best: number | undefined;
  for (const line of ladder)
    if (line <= maxLine && (best === undefined || line > best)) best = line;
  return best;
}

/** The angle of `value` on a gauge, clamped to its scale; min when the range is empty. */
export function engineAngle(gauge: EngineGauge, value: number, min: number, max: number): number {
  const { start, sweep } = ENGINE_ARCS[gauge];
  const f = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return start + sweep * f;
}

export type EngineTickKind = 'minor' | 'medium' | 'major';

export interface EngineTick {
  value: number;
  kind: EngineTickKind;
  /** Major ticks only: the value divided by the scale's divisor. */
  label?: string;
}

export interface EngineScale {
  /** Between major (labelled) ticks; medium ticks halfway, minor ticks every tenth. */
  step: number;
  /** 100 when the scale reaches 1000 or more (the labels read "x100"), else 1. */
  divisor: number;
  ticks: EngineTick[];
}

/** A tick label: at most 3 decimals, without trailing zeros. */
export function engineTickLabel(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

const EPS = 1e-9;

/**
 * The RPM arc's ticks for a scale min..max drawn at radius `radius` pixels: the smallest step of
 * 1, 2 or 5 times a power of ten that gives at most 8 intervals; minor ticks only when they are
 * ENGINE_FIT.minorTickPx apart or more along the tick ring.
 */
export function engineScale(min: number, max: number, radius: number): EngineScale {
  const span = max - min;
  if (!(span > 0)) return { step: 0, divisor: 1, ticks: [] };
  const k = Math.floor(Math.log10(span / 8));
  let step = 10 * 10 ** k;
  for (const m of [1, 2, 5]) {
    if (span / (m * 10 ** k) <= 8 + EPS) {
      step = m * 10 ** k;
      break;
    }
  }
  const divisor = Math.max(Math.abs(min), Math.abs(max)) >= 1000 ? 100 : 1;
  const minor = step / 10;
  const minorPx =
    (radius * ENGINE_GEOMETRY.rpm.tickOuter * Math.PI * ENGINE_ARCS.rpm.sweep * minor) /
    (180 * span);
  const minors = minorPx >= ENGINE_FIT.minorTickPx;
  const ticks: EngineTick[] = [];
  const first = Math.ceil(min / minor - EPS);
  const last = Math.floor(max / minor + EPS);
  for (let i = first; i <= last; i++) {
    const n = ((i % 10) + 10) % 10;
    const kind: EngineTickKind = n === 0 ? 'major' : n === 5 ? 'medium' : 'minor';
    if (kind === 'minor' && !minors) continue;
    const value = i * minor;
    ticks.push(
      kind === 'major' ? { value, kind, label: engineTickLabel(value / divisor) } : { value, kind },
    );
  }
  return { step, divisor, ticks };
}

/**
 * The slot icons as SVG path data, filled with the nonzero rule in the theme's text colour. They
 * are the ESPHelmv1 assets (modules/assets/oil.svg, fuel.svg, engine_temperature.svg and
 * battery.svg), which are Material Design Icons by Pictogrammers (oil, gas-station,
 * coolant-temperature, car-battery), Apache License 2.0: https://pictogrammers.com/docs/general/license/
 * Each is scaled to fit its box, aspect kept, centred.
 */
export const ENGINE_ICON_PATHS: Record<EngineIconName, string> = {
  oil: 'm 194.23624,219.73021 c 0,0 1.41673,1.53713 1.41673,2.47926 a 1.4167188,1.4167188 0 0 1 -1.41673,1.41672 1.4167188,1.4167188 0 0 1 -1.41673,-1.41672 c 0,-0.94213 1.41673,-2.47926 1.41673,-2.47926 m -11.33374,-4.60433 h 2.83343 a 0.70835941,0.70835941 0 0 1 0.70835,0.70835 0.70835941,0.70835941 0 0 1 -0.70835,0.70835 h -0.70835 v 1.41673 h 1.4167 c 0.52421,0 0.98464,0.28333 1.22546,0.70835 l 4.61143,-2.66342 2.30925,1.33879 c 0.35417,0.19116 0.45336,0.61628 0.2621,0.97045 -0.19839,0.33295 -0.61628,0.45335 -0.97045,0.25515 l -1.48757,-0.8571 -2.58549,4.47681 c -0.24095,0.43211 -0.70838,0.72961 -1.23965,0.72961 h -6.37524 a 1.4167188,1.4167188 0 0 1 -1.4167,-1.4167 v -2.12508 a 1.4167188,1.4167188 0 0 1 1.4167,-1.41673 h 1.41673 v -1.41673 h -0.70835 a 0.70835941,0.70835941 0 0 1 -0.70838,-0.70835 0.70835941,0.70835941 0 0 1 0.70838,-0.70835 m -0.70838,4.25016 v 2.12508 h 6.37524 l 1.45924,-2.52886 -2.45093,1.41672 -0.6446,-1.01294 h -4.73895 m -3.27261,-1.97633 1.21131,-1.2113 c 0.29042,-0.27627 0.72251,-0.27627 0.99878,0 0.27626,0.27627 0.27626,0.70835 0,0.99878 l -1.21131,1.2113 c -0.27626,0.26917 -0.72251,0.26917 -0.99878,0 -0.26917,-0.27627 -0.26917,-0.72251 0,-0.99878 z',
  fuel: 'm 161.52491,214.44304 a 0.57727213,0.52916674 0 0 1 -0.57726,-0.52916 0.57727213,0.52916674 0 0 1 0.57726,-0.52917 0.57727213,0.52916674 0 0 1 0.57726,0.52917 0.57727213,0.52916674 0 0 1 -0.57726,0.52916 m -3.46362,0 h -3.46364 v -2.64584 h 3.46364 m 4.48539,1.18005 0.007,-0.006 -2.14745,-1.96848 -0.61191,0.56092 1.21805,1.11654 c -0.54265,0.1746 -0.92942,0.66674 -0.92942,1.23296 a 1.4431804,1.3229169 0 0 0 1.44318,1.32292 c 0.20771,0 0.39832,-0.0425 0.57727,-0.1112 v 3.8153 a 0.57727213,0.52916674 0 0 1 -0.57727,0.52916 0.57727213,0.52916674 0 0 1 -0.57726,-0.52916 v -2.38126 c 0,-0.58736 -0.51955,-1.05832 -1.15455,-1.05832 h -0.57727 v -3.70418 c 0,-0.58736 -0.51955,-1.05832 -1.15455,-1.05832 h -3.46362 c -0.64078,0 -1.15456,0.47096 -1.15456,1.05832 v 8.46668 h 5.77273 v -3.96876 h 0.8659 v 2.64584 a 1.4431804,1.3229169 0 0 0 1.44318,1.32292 1.4431804,1.3229169 0 0 0 1.44319,-1.32292 v -5.02708 c 0,-0.36514 -0.16167,-0.6985 -0.42142,-0.93664 z',
  temperature:
    'm 194.27446,173.87155 a 1.0583333,1.1043435 0 0 0 -1.05832,1.10433 v 8.83475 c -0.44451,0.34604 -0.70555,0.89085 -0.70555,1.47247 a 1.7638888,1.8405726 0 0 0 1.76387,1.84057 1.7638888,1.8405726 0 0 0 1.76389,-1.84057 c 0,-0.58162 -0.26107,-1.10433 -0.70555,-1.47247 v -1.10433 h 2.82222 v -1.47247 h -2.82222 v -1.47244 h 2.82222 v -1.47247 h -2.82222 v -1.47246 h 2.82222 v -1.47244 h -2.82222 v -0.36814 a 1.0583333,1.1043435 0 0 0 -1.05834,-1.10433 m -8.11387,10.30722 v 1.47244 c 0.47272,0 0.55739,0.15471 0.91016,0.52273 0.35277,0.36811 0.97365,0.94973 1.91205,0.94973 0.9384,0 1.55928,-0.58162 1.91206,-0.94973 0.0776,-0.0885 0.14106,-0.15471 0.20453,-0.22093 v -1.65651 c -0.55739,0.19144 -0.95251,0.5669 -1.20651,0.83194 -0.35277,0.36811 -0.43744,0.52271 -0.91016,0.52271 -0.47272,0 -0.55738,-0.15471 -0.91016,-0.52271 -0.35277,-0.36811 -0.97368,-0.94973 -1.91205,-0.94973 m 11.28888,0 v 1.47244 c 0.47272,0 0.55739,0.15471 0.91016,0.52274 0.35277,0.36811 0.97368,0.94973 1.91205,0.94973 0.9384,0 1.55928,-0.58162 1.91206,-0.94973 0.3528,-0.36814 0.43746,-0.52274 0.91018,-0.52274 v -1.47244 c -0.9384,0 -1.55928,0.58162 -1.91205,0.94973 -0.3528,0.36811 -0.43747,0.52271 -0.91019,0.52271 -0.47272,0 -0.55738,-0.15471 -0.91016,-0.52271 -0.35277,-0.36811 -0.97365,-0.94973 -1.91205,-0.94973 m -5.64445,3.68113 c -0.93838,0 -1.55928,0.58162 -1.91206,0.94973 -0.35277,0.36813 -0.43744,0.52273 -0.91016,0.52273 -0.47272,0 -0.55738,-0.15471 -0.91016,-0.52273 -0.25386,-0.26491 -0.64912,-0.6405 -1.2065,-0.83192 v 1.65651 c 0.0635,0.0662 0.12693,0.13245 0.20453,0.22094 0.35277,0.36811 0.97365,0.94976 1.91205,0.94976 0.9384,0 1.55928,-0.58165 1.91206,-0.94976 0.35277,-0.36811 0.43744,-0.52271 0.91016,-0.52271 0.47272,0 0.55738,0.15471 0.91018,0.52271 0.31043,0.31658 0.81139,0.8025 1.55926,0.92029 0.1128,0.0295 0.2328,0.0295 0.3528,0.0295 0.93837,0 1.55928,-0.58164 1.91205,-0.94975 0.35277,-0.36811 0.43744,-0.52271 0.91016,-0.52271 0.47272,0 0.55739,0.15471 0.91016,0.52271 0.35277,0.36811 0.97368,0.94975 1.91205,0.94975 0.9384,0 1.55928,-0.58164 1.91206,-0.94975 0.0776,-0.0882 0.14106,-0.15472 0.20453,-0.22094 v -1.65651 c -0.55739,0.19144 -0.95248,0.56687 -1.20648,0.83191 -0.3528,0.36814 -0.43747,0.52274 -0.91019,0.52274 -0.47272,0 -0.55738,-0.15471 -0.91016,-0.52274 -0.35277,-0.36811 -0.97365,-0.94973 -1.91205,-0.94973 -0.9384,0 -1.55928,0.58162 -1.91205,0.94973 -0.35278,0.36814 -0.43744,0.52274 -0.91016,0.52274 -0.1552,0 -0.26107,-0.0223 -0.3528,-0.059 -0.1976,-0.0737 -0.3175,-0.21342 -0.55739,-0.46383 -0.35277,-0.36811 -0.97365,-0.94973 -1.91205,-0.94973 z',
  battery:
    'M4,3V6H1V20H23V6H20V3H14V6H10V3H4M3,8H21V18H3V8M15,10V12H13V14H15V16H17V14H19V12H17V10H15M5,12V14H11V12H5Z',
};

/** An icon as closed contours (x, y pairs) in a 0..1 box, y down, filled with the nonzero rule. */
export type EngineIconShape = Contours;

/** The icons flattened to polygons: what the firmware fills and the editor draws. */
export const ENGINE_ICONS: Record<EngineIconName, EngineIconShape> = Object.fromEntries(
  Object.entries(ENGINE_ICON_PATHS).map(([name, d]) => [name, fitContours(flattenSvgPath(d))]),
) as Record<EngineIconName, EngineIconShape>;
