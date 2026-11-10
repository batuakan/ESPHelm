/**
 * SVG path data flattened to polygons, for the engine tile's icons (ADR-0032): the firmware fills
 * the polygons (nonzero rule) and the editor draws the same polygons, so both show one shape.
 *
 * Supports M L H V C S Q T A Z in both cases. Curves are cut into straight segments.
 */

/** Closed contours, each x, y pairs. */
export type Contours = number[][];

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/y;
const SPACE = /[\s,]*/y;

/** Segments for a cubic or quadratic curve; plenty for icons a few dozen pixels across. */
const CURVE_SEGMENTS = 8;
/** Largest turn of one arc segment, in radians. */
const ARC_STEP = Math.PI / 12;

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  const match = (re: RegExp): string | undefined => {
    re.lastIndex = i;
    const m = re.exec(d);
    if (!m) return undefined;
    i = re.lastIndex;
    return m[0];
  };
  while (true) {
    match(SPACE);
    if (i >= d.length) break;
    const c = match(COMMAND);
    if (c !== undefined) {
      out.push(c);
      continue;
    }
    const n = match(NUMBER);
    if (n === undefined) throw new Error(`svg path: unexpected "${d.slice(i, i + 10)}"`);
    out.push(Number(n));
  }
  return out;
}

/** The points of an endpoint-parameterised elliptical arc after (x1, y1), ending at (x2, y2). */
function arcPoints(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): number[] {
  if (rx === 0 || ry === 0) return [x2, y2];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // SVG 1.1 implementation notes, F.6.5.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(dt) / ARC_STEP));
  const pts: number[] = [];
  for (let i = 1; i < n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    pts.push(cx + cos * ex - sin * ey, cy + sin * ex + cos * ey);
  }
  pts.push(x2, y2);
  return pts;
}

/** Path data as closed polygons, in the path's own coordinates. */
export function flattenSvgPath(d: string): Contours {
  const tokens = tokenize(d);
  const contours: Contours = [];
  let cur: number[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for S and T.
  let lastCubic: [number, number] | undefined;
  let lastQuad: [number, number] | undefined;
  let cmd = '';
  let i = 0;
  const close = () => {
    if (cur.length >= 6) contours.push(cur);
    cur = [];
  };
  const num = (): number => {
    const t = tokens[i++];
    if (typeof t !== 'number') throw new Error(`svg path: number expected after ${cmd}`);
    return t;
  };
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => {
    for (let s = 1; s <= CURVE_SEGMENTS; s++) {
      const t = s / CURVE_SEGMENTS;
      const u = 1 - t;
      cur.push(
        u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
        u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
      );
    }
    lastCubic = [c2x, c2y];
    x = ex;
    y = ey;
  };
  const quad = (qx: number, qy: number, ex: number, ey: number) => {
    for (let s = 1; s <= CURVE_SEGMENTS; s++) {
      const t = s / CURVE_SEGMENTS;
      const u = 1 - t;
      cur.push(u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey);
    }
    lastQuad = [qx, qy];
    x = ex;
    y = ey;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') {
      throw new Error('svg path: a number without a command');
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C !== 'C' && C !== 'S') lastCubic = undefined;
    if (C !== 'Q' && C !== 'T') lastQuad = undefined;
    switch (C) {
      case 'M': {
        close();
        x = ox + num();
        y = oy + num();
        startX = x;
        startY = y;
        cur.push(x, y);
        // Further pairs are lines.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L':
        x = ox + num();
        y = oy + num();
        cur.push(x, y);
        break;
      case 'H':
        x = ox + num();
        cur.push(x, y);
        break;
      case 'V':
        y = oy + num();
        cur.push(x, y);
        break;
      case 'C': {
        const c1x = ox + num();
        const c1y = oy + num();
        const c2x = ox + num();
        const c2y = oy + num();
        cubic(c1x, c1y, c2x, c2y, ox + num(), oy + num());
        break;
      }
      case 'S': {
        const [c1x, c1y] = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        const c2x = ox + num();
        const c2y = oy + num();
        cubic(c1x, c1y, c2x, c2y, ox + num(), oy + num());
        break;
      }
      case 'Q': {
        const qx = ox + num();
        const qy = oy + num();
        quad(qx, qy, ox + num(), oy + num());
        break;
      }
      case 'T': {
        const [qx, qy] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        quad(qx, qy, ox + num(), oy + num());
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const phi = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const ex = ox + num();
        const ey = oy + num();
        cur.push(...arcPoints(x, y, rx, ry, phi, large, sweep, ex, ey));
        x = ex;
        y = ey;
        break;
      }
      case 'Z':
        close();
        x = startX;
        y = startY;
        // A command after Z without M starts at the subpath's start.
        if (typeof tokens[i] === 'number') throw new Error('svg path: a number after Z');
        if (i < tokens.length && String(tokens[i]).toUpperCase() !== 'M') cur.push(x, y);
        break;
      default:
        throw new Error(`svg path: unsupported command ${cmd}`);
    }
  }
  close();
  return contours;
}

/**
 * Contours scaled to fit a 0..1 box with their aspect kept, centred, rounded to `decimals`. A
 * point that repeats its predecessor is dropped.
 */
export function fitContours(contours: Contours, decimals = 4): Contours {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i += 2) {
      x0 = Math.min(x0, c[i]!);
      x1 = Math.max(x1, c[i]!);
      y0 = Math.min(y0, c[i + 1]!);
      y1 = Math.max(y1, c[i + 1]!);
    }
  }
  const s = Math.max(x1 - x0, y1 - y0);
  const dx = (s - (x1 - x0)) / 2;
  const dy = (s - (y1 - y0)) / 2;
  const f = 10 ** decimals;
  const round = (v: number) => Math.round(v * f) / f;
  return contours.map((c) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < c.length; i += 2) {
      const px = round((c[i]! - x0 + dx) / s);
      const py = round((c[i + 1]! - y0 + dy) / s);
      const n = out.length;
      if (n >= 2 && out[n - 2] === px && out[n - 1] === py) continue;
      out.push(px, py);
    }
    // The closing point repeats the first: the fill closes the contour anyway.
    if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1])
      out.splice(-2);
    return out;
  });
}

/** Area covered by contours under the nonzero rule when holes wind against their outline. */
export function signedArea(contours: Contours): number {
  let sum = 0;
  for (const c of contours) {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i += 2) {
      const j = (i + 2) % c.length;
      a += c[i]! * c[j + 1]! - c[j]! * c[i + 1]!;
    }
    sum += a / 2;
  }
  return sum;
}
