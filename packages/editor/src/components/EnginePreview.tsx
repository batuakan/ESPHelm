// Engine tile preview (ADR-0032): the same geometry and icons the firmware draws, from
// @esphelm/schema's engine.ts, in display pixels (the tile's size on the display), so line widths,
// the size tiers (ENGINE_FIT) and which corner values fit match.
import {
  ENGINE_FIT,
  ENGINE_GEOMETRY,
  ENGINE_ICONS,
  UNITS,
  engineAngle,
  engineFont,
  DEFAULT_FONT_LINE_HEIGHTS,
  engineScale,
  toDisplay,
  type EngineGauge,
  type EngineCornerName,
  type EngineIconShape,
  type EngineSlot,
  type EngineTile,
  type Zone,
} from '@esphelm/schema';
import type { ReactElement } from 'react';
import { formatValue } from '../format';
import { ENGINE_CORNERS, ENGINE_SLOTS, type SlotName } from '../layoutOps';

const G = ENGINE_GEOMETRY;

function at(c: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

/** An arc stroke whose outer edge is at `r` (as LVGL draws it), between two angles in either order. */
function arcPath(c: number, r: number, w: number, a1: number, a2: number): string {
  const [from, to] = a1 <= a2 ? [a1, a2] : [a2, a1];
  const rm = r - w / 2;
  const [x1, y1] = at(c, rm, from);
  const [x2, y2] = at(c, rm, to);
  return `M${x1} ${y1}A${rm} ${rm} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function wedge(c: number, deg: number, base: number, tip: number, half: number): string {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const pts = [
    [c + ux * base - uy * half, c + uy * base + ux * half],
    [c + ux * base + uy * half, c + uy * base - ux * half],
    [c + ux * tip, c + uy * tip],
  ];
  return pts.map((p) => p.join(',')).join(' ');
}

function numberOf(value: unknown, unit: EngineSlot['unit']): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return unit ? toDisplay(value, unit) : value;
}

function inAlarm(v: number, zones: Zone[] | undefined): boolean {
  return (zones ?? []).some((z) => v >= z.from && v <= z.to && (z.state === 'alarm' || z.state === 'emergency'));
}

/** An icon's contours as one path, filled with the nonzero rule like the firmware's mask. */
function Icon(props: { shape: EngineIconShape; x: number; y: number; side: number; className: string }) {
  const { x, y, side } = props;
  const d = props.shape
    .map((c) => {
      const pts: string[] = [];
      for (let i = 0; i + 1 < c.length; i += 2) pts.push(`${x + c[i]! * side} ${y + c[i + 1]! * side}`);
      return `M${pts.join('L')}Z`;
    })
    .join('');
  return <path d={d} fillRule="nonzero" className={props.className} />;
}

/** Roboto's line height is about 1.17 times its size, and its average character half its size. */
const LINE_PER_SIZE = 1.17;
const CHAR_PER_SIZE = 0.55;

/**
 * The line height a corner value is shown in, or undefined when it doesn't fit: as the display's
 * CornerValues::layout(), the label font, else the small one (the display's two smallest full
 * fonts), whose box (value over caption) has its inner corner outside the circle of radius `r`.
 * With `open` (a bottom corner of the engine tile), a box whose top is at least `open.below`
 * under the centre need only clear radius `open.r`.
 */
export function engineCornerLine(
  width: number,
  height: number,
  r: number,
  ladder: readonly number[],
  caption: string,
  open?: { below: number; r: number },
): number | undefined {
  const sorted = [...ladder].sort((a, b) => a - b);
  const small = sorted[0];
  if (small === undefined) return undefined;
  const label = sorted[1] ?? small;
  const captionW = (caption.length * small * CHAR_PER_SIZE) / LINE_PER_SIZE;
  for (const line of [label, small]) {
    const bw = Math.max(Math.floor((line * 12) / 5), captionW);
    const x = width / 2 - bw;
    const y = height / 2 - (line + small);
    const dist = Math.hypot(x, y);
    const clear = dist >= r || (open !== undefined && y >= open.below && dist >= open.r);
    if (x >= 0 && y >= 0 && clear) return line;
  }
  return undefined;
}

export function EnginePreview(props: {
  tile: EngineTile;
  values: Map<string, unknown>;
  /** The tile's size on the display, in pixels. */
  box: { width: number; height: number };
  /** The display's full fonts' line heights (hello.fontLineHeights); text only where one fits. */
  fontLines?: readonly number[];
  onSelectSlot?(slot: SlotName): void;
}) {
  const { tile } = props;
  const W = Math.max(16, Math.round(props.box.width));
  const H = Math.max(16, Math.round(props.box.height));
  const d = Math.min(W, H);
  const R = d / 2;
  const c = R;
  const slotsOn = d >= ENGINE_FIT.slots;
  const ladder = props.fontLines ?? DEFAULT_FONT_LINE_HEIGHTS;
  const labelLine = engineFont(ladder, R * G.rpm.labelLine);
  const slotLine = engineFont(ladder, R * G.slotLabelLine);
  const labelsOn = d >= ENGINE_FIT.labels && labelLine !== undefined;
  const scale = engineScale(tile.min, tile.max, R);
  // Roboto's line height is about 1.17 times its size.
  const font = (labelLine ?? 0) / 1.17;
  const parts: ReactElement[] = [];

  if (slotsOn) {
    for (const name of ENGINE_SLOTS) {
      const s = tile.slots[name];
      if (!s) continue;
      const gauge: EngineGauge = name;
      const g = name === 'bottom' ? G.bottom : G.side;
      const r = R * g.radius;
      const a = (v: number) => engineAngle(gauge, v, s.min, s.max);
      (s.zones ?? []).forEach((z, i) =>
        parts.push(
          <path key={`${name}-z${i}`} className={`band zone-${z.state}`} strokeWidth={R * g.bandWidth} d={arcPath(c, r, R * g.bandWidth, a(z.from), a(z.to))} />,
        ),
      );
      parts.push(<path key={`${name}-track`} className="track" strokeWidth={Math.max(1, R * g.trackWidth)} d={arcPath(c, r, R * g.trackWidth, a(s.min), a(s.max))} />);
      for (let i = 0; i < G.slotTicks; i++) {
        const deg = a(s.min) + ((a(s.max) - a(s.min)) * i) / (G.slotTicks - 1);
        // From the track's inner edge inward, so no tick crosses the arc.
        const [x1, y1] = at(c, r - R * g.trackWidth, deg);
        const [x2, y2] = at(c, r - R * g.trackWidth - R * g.tickLength, deg);
        parts.push(<line key={`${name}-t${i}`} className="tick" strokeWidth={Math.max(1, R * g.tickWidth)} x1={x1} y1={y1} x2={x2} y2={y2} />);
      }
      const box = G.icons[name];
      const side = R * box.size;
      const n = numberOf(props.values.get(s.path), s.unit);
      const live = n !== undefined;
      if (s.icon && s.icon !== 'none') {
        parts.push(
          <Icon key={`${name}-icon`} shape={ENGINE_ICONS[s.icon]} x={c + R * box.x - side / 2} y={c + R * box.y - side / 2} side={side} className={live ? 'icon' : 'icon stale'} />,
        );
      } else if (s.label && slotLine !== undefined) {
        parts.push(
          <text key={`${name}-label`} x={c + R * box.x} y={c + R * box.y} fontSize={slotLine / 1.17} className={live ? 'slot-label' : 'slot-label stale'}>
            {s.label}
          </text>,
        );
      }
      if (live)
        parts.push(<polygon key={`${name}-needle`} className="needle" points={wedge(c, a(n), R * g.needleBase, R * g.needleTip, R * g.needleHalfWidth)} />);
    }
  }

  const a = (v: number) => engineAngle('rpm', v, tile.min, tile.max);
  (tile.zones ?? []).forEach((z, i) =>
    parts.push(<path key={`rpm-z${i}`} className={`band zone-${z.state}`} strokeWidth={R * G.rpm.bandWidth} d={arcPath(c, R * G.rpm.bandRadius, R * G.rpm.bandWidth, a(z.from), a(z.to))} />),
  );
  for (const t of scale.ticks) {
    const len = t.kind === 'major' ? G.rpm.majorLength : t.kind === 'medium' ? G.rpm.mediumLength : G.rpm.minorLength;
    const w = t.kind === 'major' ? G.rpm.majorWidth : t.kind === 'medium' ? G.rpm.mediumWidth : G.rpm.minorWidth;
    const [x1, y1] = at(c, R * G.rpm.tickOuter, a(t.value));
    const [x2, y2] = at(c, R * (G.rpm.tickOuter - len), a(t.value));
    parts.push(<line key={`rpm-t${t.value}`} className={inAlarm(t.value, tile.zones) ? 'tick alarm' : 'tick'} strokeWidth={Math.max(1, R * w)} x1={x1} y1={y1} x2={x2} y2={y2} />);
    if (labelsOn && t.label !== undefined) {
      const [lx, ly] = at(c, R * G.rpm.labelRadius, a(t.value));
      parts.push(
        <text key={`rpm-l${t.value}`} x={lx} y={ly} fontSize={font} className="tick-label">
          {t.label}
        </text>,
      );
    }
  }
  const title = tile.label || (tile.unit ? UNITS[tile.unit].label : '');
  if (labelsOn) {
    const y = c + R * G.rpm.unitY;
    if (title)
      parts.push(<text key="title" x={c} y={y} fontSize={font} className="engine-title">{title}</text>);
    if (scale.divisor === 100)
      parts.push(<text key="x100" x={c} y={y + (labelLine ?? 0)} fontSize={font} className="engine-title">x100</text>);
  }
  const rpm = numberOf(props.values.get(tile.path), tile.unit);
  if (rpm !== undefined)
    parts.push(<polygon key="rpm-needle" className="needle" points={wedge(c, a(rpm), R * G.rpm.needleBase, R * G.rpm.needleTip, R * G.rpm.needleHalfWidth)} />);

  // Corner values: with the slots, each where it fits outside the RPM arc, as on the display.
  const small = Math.min(...ladder);
  const corners = slotsOn
    ? ENGINE_CORNERS.flatMap((name: EngineCornerName, i) => {
        const item = tile.slots[name];
        if (!item) return [];
        const caption = [item.label, item.unit ? UNITS[item.unit].label : ''].filter(Boolean).join(' ');
        const right = i % 2 === 1;
        const bottom = i >= 2;
        const open = bottom ? { below: R * G.corners.openBelow, r: R * G.corners.bottomRadius + 2 } : undefined;
        const line = engineCornerLine(W, H, R + 2, ladder, caption, open);
        if (line === undefined) return [];
        const x = right ? W : 0;
        const top = bottom ? H - line - small : 0;
        const raw = item.path ? props.values.get(item.path) : undefined;
        const live = raw !== undefined && raw !== null;
        return [
          <g
            key={name}
            role="button"
            aria-label={`Slot ${name}`}
            data-testid={`slot-${tile.id}-${name}`}
            className={`corner-value ${right ? 'right' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              props.onSelectSlot?.(name);
            }}
          >
            <text x={x} y={top + line / 2} fontSize={line / LINE_PER_SIZE} className={live ? 'value' : 'value stale'}>
              {live ? formatValue(raw, item.unit, item.decimals) : '--'}
            </text>
            <text x={x} y={top + line + small / 2} fontSize={small / LINE_PER_SIZE} className="caption">
              {caption}
            </text>
          </g>,
        ];
      })
    : [];

  return (
    <span className="tile-graphic engine-tile" data-testid={`engine-${tile.id}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="engine">
        <g transform={`translate(${(W - d) / 2} ${(H - d) / 2})`} aria-hidden>
          {parts}
        </g>
        {corners}
      </svg>
    </span>
  );
}
