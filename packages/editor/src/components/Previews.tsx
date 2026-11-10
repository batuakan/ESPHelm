// HTML/SVG approximations of what the display draws (open question 7: verified against the
// SDL screenshots in firmware/test/golden). Values arrive in SI and are converted like the
// firmware does.
import {
  CLOCK_DEFAULTS,
  clockDate,
  clockTime,
  localOffset,
  type ClockTile,
  AUTOPILOT_DEFAULTS,
  POSITION_DEFAULTS,
  UNITS,
  formatPosition,
  type PositionTile,
  WIND_ROSE_DEFAULTS,
  roseLaylines,
  roseRelative,
  roseTarget,
  toDisplay,
  type DataItem,
  type Layout,
  type AutopilotTile,
  type Tile,
  type WindRoseTile,
  type ValueTile,
  type GraphTile,
  type Zone,
  valueZoneState,
  serverZonesToDisplay,
  historyEnabled,
  roseHistorySeries,
  axisLabels,
  graphWindowIndex,
  HISTORY,
  tapeMarks,
  tapeX,
  centerZeroSpan,
  centerZeroText,
  centerZeroTick,
  type CenterZeroSides,
  type HeadingTapeMarker,
  type HeadingTapeTile,
} from '@esphelm/schema';
import { useEffect, useState } from 'react';
import { formatValue } from '../format';
import { chartRuns, previewPoints, wrapped } from './HistoryPreview';
import { CENTER_SLOTS, CORNER_SLOTS, headingTapeSettings, type SlotName } from '../layoutOps';
import type { ChartInfo } from '../api';
import { ChartPreview } from './ChartPreview';
import { EnginePreview } from './EnginePreview';
import type { AutopilotTier, RoseTier } from '../sizing';

function displayNumber(value: unknown, item: DataItem): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return item.unit ? toDisplay(value, item.unit) : value;
}

const clamp01 = (f: number) => Math.min(1, Math.max(0, f));

/** Point on a circle; `deg` clockwise from 12 o'clock. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${x1} ${y1}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * The tile as the display draws it (ADR-0020): the server's zones for its path replace its own,
 * unless none of them is usable. `serverZones` holds meta.zones by path.
 */
export function withServerZones<T extends Tile>(tile: T, serverZones: Map<string, unknown> | undefined): T {
  if (!serverZones) return tile;
  const t: Tile = tile;
  if (t.type === 'value' || t.type === 'graph') {
    const zones = serverZonesToDisplay(serverZones.get(t.path), t.unit);
    return zones.length > 0 ? { ...tile, zones } : tile;
  }
  if (t.type === 'gauge' || t.type === 'bar' || t.type === 'engine') {
    // An engine's RPM (ADR-0032); its slots keep their own zones.
    const zones = serverZonesToDisplay(serverZones.get(t.path), t.unit, { min: t.min, max: t.max });
    return zones.length > 0 ? { ...tile, zones } : tile;
  }
  return tile;
}

/**
 * Class for a value tile's number, as the display colours it (ADR-0016): a matching zone, else
 * the tile's colour, else none (the theme's text colour). Stale or not a number: none.
 */
export function valueColorClass(tile: ValueTile, value: unknown): string {
  const n = displayNumber(value, tile);
  const state = n === undefined ? undefined : valueZoneState(n, tile.zones);
  if (state) return `value-zone-${state}`;
  return tile.color ? `value-color-${tile.color}` : '';
}

function zoneFor(n: number | undefined, zones: Zone[] | undefined): string {
  if (n === undefined) return 'stale';
  let state = 'normal';
  for (const z of zones ?? []) if (n >= z.from && n <= z.to) state = z.state;
  return state;
}

// The gauge sweeps 270 degrees, from 225 (bottom left) clockwise to 135 (bottom right).
const GAUGE_START = 225;
const GAUGE_SWEEP = 270;

/**
 * A centre-zero scale (ADR-0023): the drawn range (-M..M, else min..max), the value clamped to
 * min..max, its text with unit and side, and the fill's colour class.
 */
function scaleOf(tile: Extract<Tile, { type: 'gauge' | 'bar' }>, value: unknown, n: number | undefined) {
  const cz = tile.centerZero === true;
  const m = cz ? centerZeroSpan(tile.min, tile.max) : 0;
  const lo = cz ? -m : tile.min;
  const hi = cz ? m : tile.max;
  const v = n === undefined ? undefined : Math.min(tile.max, Math.max(tile.min, n));
  const sides: CenterZeroSides = tile.sides ?? 'portStarboard';
  const unit = tile.unit ? UNITS[tile.unit].label : '';
  let text = `${formatValue(value, tile.unit, tile.decimals)} ${unit}`;
  if (cz && n !== undefined) {
    const t = centerZeroText(n, tile.decimals, sides);
    text = `${t.text} ${unit}${t.side ? ` ${t.side}` : ''}`;
  }
  const side = sides === 'plusMinus' ? 'plus' : (v ?? 0) < 0 ? 'port' : 'stbd';
  return { cz, m, lo, hi, v, sides, text, side };
}

function GaugePreview({ tile, value }: { tile: Extract<Tile, { type: 'gauge' }>; value: unknown }) {
  const n = displayNumber(value, tile);
  const s = scaleOf(tile, value, n);
  const at = (v: number) => GAUGE_START + GAUGE_SWEEP * clamp01((v - s.lo) / (s.hi - s.lo || 1));
  const [nx, ny] = polar(50, 52, 34, s.v === undefined ? (s.cz ? at(0) : GAUGE_START) : at(s.v));
  // P and S in the top corners, outside the ring, as on the display.
  const [px, py] = [8, 12];
  const [sx, sy] = [92, 12];
  return (
    <span className="tile-graphic">
      <svg viewBox="0 0 100 100" className="gauge" aria-hidden>
        <path className="track" d={arc(50, 52, 40, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} />
        {(tile.zones ?? []).map((z, i) => (
          <path key={i} className={`zone zone-${z.state}`} d={arc(50, 52, 40, at(z.from), at(z.to))} />
        ))}
        {s.cz && s.v !== undefined && s.v !== 0 && (
          <path
            className={`cz-fill side-${s.side}`}
            d={s.v > 0 ? arc(50, 52, 40, at(0), at(s.v)) : arc(50, 52, 40, at(s.v), at(0))}
          />
        )}
        {s.cz && <line className="cz-zero" x1={50} y1={8} x2={50} y2={16} />}
        {s.cz && (
          <>
            <text x={50} y={24} className="cz-tick">
              {centerZeroTick(0, s.m, s.sides)}
            </text>
            {s.sides === 'portStarboard' && (
              <>
                <text x={px} y={py} className="cz-end side-port">
                  P
                </text>
                <text x={sx} y={sy} className="cz-end side-stbd">
                  S
                </text>
              </>
            )}
          </>
        )}
        {s.v !== undefined && <line className="needle" x1={50} y1={52} x2={nx} y2={ny} />}
        <text x={50} y={94} className="gauge-value">
          {s.text}
        </text>
      </svg>
    </span>
  );
}

/** The state of the last zone `n` falls in (a bar's fill), if any. */
function zoneMatch(n: number | undefined, zones: Zone[] | undefined): Zone['state'] | undefined {
  let state: Zone['state'] | undefined;
  if (n !== undefined) for (const z of zones ?? []) if (n >= z.from && n <= z.to) state = z.state;
  return state;
}

function BarPreview({ tile, value }: { tile: Extract<Tile, { type: 'bar' }>; value: unknown }) {
  const n = displayNumber(value, tile);
  const s = scaleOf(tile, value, n);
  const pct = s.v === undefined ? (s.cz ? 50 : 0) : 100 * clamp01((s.v - s.lo) / (s.hi - s.lo || 1));
  const vertical = tile.orientation === 'vertical';
  // Centre zero fills from the middle; a matching zone's colour wins over the side's.
  const from = s.cz ? Math.min(pct, 50) : 0;
  const size = s.cz ? Math.abs(pct - 50) : pct;
  const zone = zoneMatch(s.v, tile.zones);
  const fill = s.cz && !zone ? `side-${s.side}` : `zone-${zone ?? zoneFor(n, tile.zones)}`;
  return (
    <span className={`tile-graphic bar ${vertical ? 'vertical' : ''}`}>
      <span className="bar-track">
        <span
          className={`bar-fill ${fill}`}
          style={
            vertical
              ? { height: `${size}%`, bottom: `${from}%` }
              : { width: `${size}%`, left: `${from}%` }
          }
        />
        {s.cz && <span className={`bar-zero ${vertical ? 'vertical' : ''}`} />}
        {s.cz && (
          <>
            <span className="bar-end start">{s.sides === 'portStarboard' ? 'P' : '-'}</span>
            <span className="bar-end end">{s.sides === 'portStarboard' ? 'S' : '+'}</span>
          </>
        )}
      </span>
      <span className="bar-value">{s.text}</span>
    </span>
  );
}

function SwitchPreview({ value }: { value: unknown }) {
  const known = typeof value === 'boolean';
  return (
    <span className="tile-graphic switch">
      <span className="switch-box">
        <span className={`toggle ${value === true ? 'on' : ''}`} />
        <span className="switch-state">{known ? (value ? 'on' : 'off') : '--'}</span>
      </span>
    </span>
  );
}

const AP_TITLES: Record<string, string> = {
  auto: 'AUTO',
  wind: 'WIND',
  route: 'TRACK',
  standby: 'STANDBY',
};

/**
 * Autopilot tile, as the display draws it at this size. The buttons are drawings only: the
 * editor never commands the autopilot.
 */
function AutopilotPreview(props: {
  tile: AutopilotTile;
  values: Map<string, unknown>;
  tier: AutopilotTier;
}) {
  const { tile, values } = props;
  const cfg = { ...AUTOPILOT_DEFAULTS, ...tile.config };
  const modes = tile.modes ?? AUTOPILOT_DEFAULTS.modes;
  const state = values.get(cfg.statePath);
  const deg = (path: string) => {
    const v = values.get(path);
    return typeof v === 'number' && Number.isFinite(v)
      ? `${Math.round((((v * RAD) % 360) + 360) % 360)}°`
      : '--';
  };
  const stateText = typeof state === 'string' ? (AP_TITLES[state] ?? state.toUpperCase()) : '--';
  return (
    <span className={`tile-graphic autopilot ap-${props.tier}`} data-testid={`autopilot-${tile.id}`}>
      <span className={`ap-state ${typeof state === 'string' && state !== 'standby' ? 'engaged' : ''}`}>
        {stateText}
      </span>
      <span className="ap-course">
        TGT {deg(cfg.targetPath)} &nbsp; HDG {deg(cfg.headingPath)}
      </span>
      {props.tier === 'controls' && (
        <span className="ap-buttons" aria-hidden>
          <span className="ap-row">
            {['-10', '-1', '+1', '+10'].map((b) => (
              <span key={b} className="ap-btn">
                {b}
              </span>
            ))}
          </span>
          <span className="ap-row">
            {[...modes, 'standby'].map((m) => (
              <span key={m} className={`ap-btn ${m === state ? 'current' : ''}`}>
                {AP_TITLES[m]}
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

export function TilePreview(props: {
  tile: Tile;
  values: Map<string, unknown>;
  roseTier?: RoseTier;
  autopilotTier?: AutopilotTier;
  selectedSlot?: SlotName;
  onSelectSlot?(slot: SlotName): void;
  /** meta.zones by path (ADR-0020). */
  serverZones?: Map<string, unknown>;
  /** Graph only: whether the display has room for its axis labels (GRAPH_FIT). */
  graphAxis?: boolean;
  /** Heading tape only: its width on the display, in pixels (the ticks depend on it). */
  tapeWidth?: number;
  /** Clock only: the layout's time zone as a POSIX rule (settings.timeZone.posix); absent: UTC. */
  timeZone?: string;
  /** Chart only: its chart, the tile's size on the display, and the night theme. */
  chart?: { info: ChartInfo | undefined; width: number; height: number; night: boolean };
  /** Engine only: the tile's size on the display, in pixels, and the display's font ladder. */
  engineBox?: { width: number; height: number };
  fontLines?: readonly number[];
}) {
  const { values } = props;
  const tile = withServerZones(props.tile, props.serverZones);
  if (tile.type === 'autopilot')
    return <AutopilotPreview tile={tile} values={values} tier={props.autopilotTier ?? 'controls'} />;
  if (tile.type === 'wind_rose')
    return (
      <WindRosePreview
        tile={tile}
        values={values}
        tier={props.roseTier ?? 'full'}
        selectedSlot={props.selectedSlot}
        onSelectSlot={props.onSelectSlot}
      />
    );
  if (tile.type === 'position') return <PositionPreview tile={tile} values={values} />;
  if (tile.type === 'graph')
    return <GraphPreview tile={tile} values={values} axis={props.graphAxis ?? true} />;
  if (tile.type === 'heading_tape')
    return <HeadingTapePreview tile={tile} values={values} width={props.tapeWidth ?? 440} />;
  if (tile.type === 'clock') return <ClockPreview tile={tile} timeZone={props.timeZone} />;
  if (tile.type === 'engine')
    return (
      <EnginePreview
        tile={tile}
        values={values}
        box={props.engineBox ?? { width: 480, height: 480 }}
        fontLines={props.fontLines}
        onSelectSlot={props.onSelectSlot}
      />
    );
  if (tile.type === 'chart')
    return (
      <ChartPreview
        tile={tile}
        chart={props.chart?.info}
        values={values}
        width={props.chart?.width ?? 480}
        height={props.chart?.height ?? 480}
        night={props.chart?.night ?? false}
      />
    );
  const value = tile.path ? values.get(tile.path) : undefined;
  switch (tile.type) {
    case 'gauge':
      return <GaugePreview tile={tile} value={value} />;
    case 'bar':
      return <BarPreview tile={tile} value={value} />;
    case 'switch':
      return <SwitchPreview value={value} />;
    default:
      return (
        <>
          <span className={`tile-value ${tile.type === 'value' ? valueColorClass(tile, value) : ''}`}>
            {tile.path ? formatValue(value, tile.unit, tile.decimals) : '--'}
          </span>
          <span className="tile-unit">{tile.unit ? UNITS[tile.unit].label : ''}</span>
          {tile.type === 'value' && historyEnabled(tile) && <HistoryMark />}
        </>
      );
  }
}

/**
 * A graph tile (ADR-0021): the live value top right (its caption is the tile label), an example
 * curve around it in the tile's window, zone bands, and, when the display has room, the y range
 * and the window's start. The display draws what it recorded itself, so the curve is only an
 * example, as in the history mock.
 */
export function GraphPreview(props: { tile: GraphTile; values: Map<string, unknown>; axis: boolean }) {
  const { tile } = props;
  const value = tile.path ? props.values.get(tile.path) : undefined;
  const win = graphWindowIndex(tile, true);
  const decimals = tile.decimals ?? 1;
  const wrap = tile.unit ? UNITS[tile.unit].wrap : undefined;
  const fixed = tile.min !== undefined && tile.max !== undefined;
  // With a fixed axis an angle stays in its range, as its labels are (the display does the same).
  const points = previewPoints({ key: tile.id, title: '', caption: '', unit: tile.unit, value }, win).map((p) =>
    p === null || !fixed || !wrap ? p : p - (wrap[1] - wrap[0]) * Math.floor((p - wrap[0]) / (wrap[1] - wrap[0])),
  );
  const shown = points.filter((p): p is number => p !== null);
  const min = Math.min(...shown);
  const max = Math.max(...shown);
  const pad = (max - min) * 0.1 || 1;
  const lo = fixed ? tile.min! : min - pad;
  const hi = fixed ? tile.max! : max + pad;
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const axisText = (v: number) => (wrap && !fixed ? wrapped(v, wrap, decimals) : v).toFixed(decimals);
  const n = displayNumber(value, tile);
  const state = n === undefined ? undefined : valueZoneState(n, tile.zones);
  const unit = tile.unit ? UNITS[tile.unit].label : '';
  const [start] = axisLabels(HISTORY.windows[win]!.seconds);
  return (
    <span className={`graph-preview ${props.axis ? 'with-axis' : ''}`}>
      <span className={`graph-value ${state ? `value-zone-${state}` : ''}`}>
        {tile.path ? formatValue(value, tile.unit, tile.decimals) : '--'}
        {unit && ` ${unit}`}
      </span>
      {props.axis && (
        <span className="graph-y" aria-hidden>
          <span>{axisText(hi)}</span>
          <span>{axisText(lo)}</span>
        </span>
      )}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="graph-plot" role="img" aria-label="Graph">
        {!(wrap && !fixed) &&
          (tile.zones ?? []).map((z, i) => {
            const top = Math.min(z.to ?? Infinity, hi);
            const bottom = Math.max(z.from ?? -Infinity, lo);
            if (!(bottom < top)) return null;
            return (
              <rect key={i} x={0} width={100} y={y(top)} height={y(bottom) - y(top)} className={`history-band zone-${z.state}`} />
            );
          })}
        {chartRuns(points, lo, hi).map((r, i) => (
          <polyline key={i} points={r} className="history-line" />
        ))}
      </svg>
      {props.axis && (
        <span className="graph-x" aria-hidden>
          <span>{start}</span>
          <span>now</span>
        </span>
      )}
    </span>
  );
}

const TAPE_LETTERS: Record<HeadingTapeMarker, string> = { cog: 'C', bearing: 'W', target: 'A' };

/**
 * A heading tape (ADR-0022) from the same geometry as the display (tapeMarks, tapeX): the heading
 * above, the ticks and labels for the tile's width on the display, the centre line and the
 * markers (COG triangle, waypoint diamond, target notch; arrows at the edge when off the tape).
 */
export function HeadingTapePreview(props: {
  tile: HeadingTapeTile;
  values: Map<string, unknown>;
  width: number;
}) {
  const t = headingTapeSettings(props.tile);
  const deg = (path: string) => {
    const v = props.values.get(path);
    return typeof v === 'number' && Number.isFinite(v) ? toDisplay(v, 'deg') : undefined;
  };
  const heading = deg(t.headingPath);
  const suffix = /Magnetic/.test(t.headingPath) ? 'M' : /True/.test(t.headingPath) ? 'T' : '';
  const W = Math.max(props.width, 40);
  const H = 60;
  const s = 8;
  const ticks = heading === undefined ? [] : tapeMarks(heading, t.span, W);
  return (
    <span className="tape-preview" data-testid={`tape-${props.tile.id}`}>
      <span className={`tape-number ${heading === undefined ? 'stale' : ''}`}>
        {heading === undefined ? '--' : `${Math.round(heading) % 360}°${suffix}`}
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="tape-plot" role="img" aria-label="Heading tape">
        <rect x={0} y={0} width={W} height={H} rx={6} className="tape-band" />
        {ticks.map((k) => {
          const len = k.kind === 'major' ? H * 0.3 : k.kind === 'medium' ? H * 0.2 : H * 0.125;
          return (
            <g key={`${k.deg}-${k.x}`}>
              <line x1={k.x} x2={k.x} y1={0} y2={len} className={`tape-tick ${k.kind}`} />
              {k.label && (
                <text x={k.x} y={H * 0.62} className="tape-label">
                  {k.label}
                </text>
              )}
            </g>
          );
        })}
        {heading !== undefined &&
          t.markers.map((m) => {
            const v = deg(t.paths[m]);
            if (v === undefined) return null;
            const p = tapeX(v, heading, t.span, W);
            const x = Math.min(Math.max(p.x, s), W - s);
            const bottom = H - 2;
            const shape =
              p.off !== 0
                ? (() => {
                    const tip = p.off < 0 ? 2 : W - 2;
                    const back = tip - p.off * s * 1.4;
                    const cy = bottom - s * 0.7;
                    return `${tip},${cy} ${back},${cy - s * 0.7} ${back},${cy + s * 0.7}`;
                  })()
                : m === 'cog'
                  ? `${x},${bottom - s * 1.6} ${x - s},${bottom} ${x + s},${bottom}`
                  : m === 'bearing'
                    ? `${x},${bottom - 2 * s} ${x - s * 0.8},${bottom - s} ${x},${bottom} ${x + s * 0.8},${bottom - s}`
                    : `${x},${s * 1.4} ${x - s},0 ${x + s},0`;
            return (
              <g key={m} className={`tape-marker ${m}`}>
                <polygon points={shape} />
                <text x={p.off === 0 ? x + s * 1.6 : p.off < 0 ? s * 2.6 : W - s * 2.6} y={m === 'target' ? s * 1.4 : bottom}>
                  {TAPE_LETTERS[m]}
                </text>
              </g>
            );
          })}
        <line x1={W / 2} x2={W / 2} y1={0} y2={H} className={`tape-lubber ${heading === undefined ? 'stale' : ''}`} />
      </svg>
    </span>
  );
}

/** The small sparkline that says a tap opens a history graph on the display. */
function HistoryMark(props: { right?: boolean }) {
  return (
    <svg
      className={`tile-history-mark ${props.right ? 'right' : ''}`}
      viewBox="0 0 20 10"
      role="img"
      aria-label="Has history"
    >
      <polyline points="1,9 6,4 12,7 19,1" />
    </svg>
  );
}

/** Latitude over longitude, in the tile's format (the same text the display shows). */
/** Unix seconds now, updated every second. */
function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * A clock tile (ADR-0024): this computer's time in the layout's zone (or UTC), written as the
 * display writes it (clock.ts). The display shows "--" until it has a time from SignalK or
 * its board.
 */
export function ClockPreview(props: { tile: ClockTile; timeZone?: string; now?: number }) {
  const { tile } = props;
  const ticking = useNow();
  const utc = props.now ?? ticking;
  const show = tile.show ?? CLOCK_DEFAULTS.show;
  const local = utc + (tile.utc || !props.timeZone ? 0 : localOffset(props.timeZone, utc));
  const time = clockTime(local, tile.hour12 ?? false, tile.seconds ?? false);
  const date = clockDate(local, tile.dateFormat ?? CLOCK_DEFAULTS.dateFormat);
  return (
    <span className={`tile-clock shows-${show}`} data-testid={`clock-${tile.id}`}>
      {show !== 'date' && (
        <span className="clock-time">
          {time.text}
          {time.suffix && <small className="clock-suffix">{time.suffix}</small>}
        </span>
      )}
      {show !== 'time' && <span className="clock-date">{date}</span>}
    </span>
  );
}

export function PositionPreview(props: { tile: PositionTile; values: Map<string, unknown> }) {
  const { tile } = props;
  const text = formatPosition(
    props.values.get(tile.path ?? POSITION_DEFAULTS.path),
    tile.format ?? POSITION_DEFAULTS.format,
    tile.decimals,
  );
  return (
    <span className="tile-position" data-testid={`position-${tile.id}`}>
      {text ? (
        <>
          <span>{text.lat}</span>
          <span>{text.lon}</span>
        </>
      ) : (
        '--'
      )}
    </span>
  );
}

const RAD = 180 / Math.PI;
const CARD_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Rose geometry in the SVG's 200x200 box, as the firmware draws it (widget_wind_rose.cpp): ring about
// d/15 wide, the compass card band just inside it, markers on the ring.
const R = 96;
const RING = 13;
const CARD_R = R - RING - 3; // outer edge of the card band
const BAND = 12;

/**
 * A wind rose tile in the legacy style: a fixed ring with red/green close-hauled sectors, a
 * compass card turning with the heading, A/T markers, the heading and clickable centre slots,
 * drawn for the tier the display will use at this tile's size (sizing.ts). Slot counts in
 * compact roses depend on the display's fonts, so the preview shows every slot.
 */
export function WindRosePreview(props: {
  tile: WindRoseTile;
  values: Map<string, unknown>;
  tier: RoseTier;
  selectedSlot?: SlotName;
  onSelectSlot?(slot: SlotName): void;
}) {
  const { tile, values, tier } = props;
  const cfg = { ...WIND_ROSE_DEFAULTS, ...tile.config };
  const num = (path: string) => {
    const v = values.get(path);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const awa = num(cfg.apparentAngle);
  const twd = num(cfg.trueDirection);
  const hdg = num(cfg.heading);
  const full = tier === 'full';
  const suffix = cfg.heading.includes('Magnetic') ? 'M' : cfg.heading.includes('True') ? 'T' : '';
  const hdgDeg = hdg === undefined ? 0 : (((hdg * RAD) % 360) + 360) % 360;
  const marker = (deg: number, cls: string, letter: string) => {
    const m = RING * 1.2;
    const [bx, by] = polar(0, 0, R - 1, deg);
    const [tx, ty] = polar(0, 0, R - 1 - m * 1.3, deg);
    const a = (deg * Math.PI) / 180;
    const px = Math.cos(a) * m * 0.62;
    const py = Math.sin(a) * m * 0.62;
    const [lx, ly] = polar(0, 0, R - 1 - m * 0.5, deg);
    return (
      <g className={`marker ${cls}`}>
        <polygon points={`${bx + px},${by + py} ${bx - px},${by - py} ${tx},${ty}`} />
        {full && (
          <text x={lx} y={ly} className="marker-letter">
            {letter}
          </text>
        )}
      </g>
    );
  };
  const slotButton = (slot: SlotName) => {
    const item = tile.slots[slot];
    const corner = CORNER_SLOTS.includes(slot);
    if (corner && !item && props.selectedSlot !== slot) {
      // Empty corners are only hinted, so a rose without corner values looks like the display.
      return (
        <button
          key={slot}
          className={`rose-slot corner corner-${slot} empty`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onSelectSlot?.(slot);
          }}
          aria-label={`Slot ${slot}`}
          data-testid={`slot-${tile.id}-${slot}`}
        >
          <span className="slot-label">+</span>
        </button>
      );
    }
    return (
      <button
        key={slot}
        className={`rose-slot ${corner ? `corner corner-${slot}` : ''} ${props.selectedSlot === slot ? 'selected' : ''} ${item ? '' : 'empty'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.onSelectSlot?.(slot);
        }}
        aria-label={`Slot ${slot}`}
        data-testid={`slot-${tile.id}-${slot}`}
      >
        {item ? (
          <>
            <span className="slot-value">
              {item.path ? formatValue(values.get(item.path), item.unit, item.decimals) : '--'}
            </span>
            <span className="slot-caption">
              {[item.label, item.unit ? UNITS[item.unit].label : ''].filter(Boolean).join(' ') ||
                'Pick a path'}
            </span>
          </>
        ) : (
          <span className="slot-label">+</span>
        )}
      </button>
    );
  };
  return (
    <span className={`tile-graphic rose rose-${tier}`} data-testid={`rose-${tile.id}`}>
      <svg viewBox="-100 -100 200 200" aria-hidden>
        <path className="sector stbd" d={arc(0, 0, R - RING / 2, 20, 60)} style={{ strokeWidth: RING }} />
        <path className="sector port" d={arc(0, 0, R - RING / 2, 300, 340)} style={{ strokeWidth: RING }} />
        {Array.from({ length: full ? 72 : 12 }, (_, i) => {
          const deg = i * (full ? 5 : 30);
          const major = deg % 30 === 0;
          const [x1, y1] = polar(0, 0, R, deg);
          const [x2, y2] = polar(0, 0, R - (major ? RING : RING * 0.75), deg);
          return (
            <line key={i} className={`rose-tick ${major ? 'major' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          );
        })}
        {tier !== 'pointers' && (
          <g transform={`rotate(${-hdgDeg})`}>
            <circle r={CARD_R - BAND / 2} className="rose-card" style={{ strokeWidth: BAND }} />
            {CARD_POINTS.map((p, i) =>
              full || i % 4 === 0 ? (
                <text
                  key={p}
                  className="rose-point"
                  transform={`rotate(${i * 22.5}) translate(0 ${-(CARD_R - BAND / 2)})`}
                >
                  {p}
                </text>
              ) : null,
            )}
          </g>
        )}
        {/* Performance graphics (ADR-0029), under the wind markers, as on the display. */}
        {cfg.showLaylines &&
          twd !== undefined &&
          hdg !== undefined &&
          (() => {
            const deg = (v: number | undefined) => (v === undefined ? undefined : v * RAD);
            const l = roseLaylines(twd * RAD, hdg * RAD, deg(num(cfg.beatAngle)), deg(num(cfg.gybeAngle)), {
              beat: cfg.fixedBeat,
              gybe: cfg.fixedGybe,
            });
            const inner = tier === 'pointers' ? 200 / 6 : CARD_R - BAND;
            return (['starboard', 'port'] as const).map((side) => {
              const [x1, y1] = polar(0, 0, inner, l[side]);
              const [x2, y2] = polar(0, 0, R - 1, l[side]);
              return (
                <line
                  key={side}
                  className={`layline ${side === 'starboard' ? 'stbd' : 'port'}`}
                  data-testid={`layline-${side}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                />
              );
            });
          })()}
        {cfg.showTarget &&
          twd !== undefined &&
          hdg !== undefined &&
          (() => {
            const target = num(cfg.targetAngle);
            const t = target === undefined ? undefined : roseTarget(twd * RAD, hdg * RAD, target * RAD);
            if (t === undefined) return null;
            const [x1, y1] = polar(0, 0, R - RING, t);
            const [x2, y2] = polar(0, 0, R, t);
            return <line className="target-bar" x1={x1} y1={y1} x2={x2} y2={y2} />;
          })()}
        {cfg.showWaypoint &&
          hdg !== undefined &&
          (() => {
            const b = num(cfg.waypointBearing);
            return b === undefined ? null : marker(roseRelative(b * RAD, hdg * RAD), 'waypoint', 'W');
          })()}
        {cfg.showTrueWind && twd !== undefined && hdg !== undefined && marker((twd - hdg) * RAD, 'true', 'T')}
        {awa !== undefined && marker(awa * RAD, 'apparent', 'A')}
      </svg>
      {tier !== 'pointers' && (
        <span className="rose-slots">
          {full && (
            <span className="rose-heading">
              {hdg === undefined ? '--' : Math.round(hdgDeg) % 360}°{suffix}
            </span>
          )}
          {CENTER_SLOTS.map(slotButton)}
        </span>
      )}
      {/* Corners: shown on the display when they fit outside the ring (full tier only). */}
      {full && CORNER_SLOTS.map(slotButton)}
      {/* Something records (ADR-0019): the mark in a free bottom corner, as on the display. */}
      {roseHistorySeries(tile).length > 0 &&
        !(full && tile.slots.bottomLeft && tile.slots.bottomRight) && (
          <HistoryMark right={full && !!tile.slots.bottomLeft} />
        )}
    </span>
  );
}

/**
 * The display's page footer: the page title and the settings menu button (ADR-0025), and with
 * several pages the page buttons and "n/m".
 */
export function FooterPreview({ layout, index }: { layout: Layout; index: number }) {
  const page = layout.pages[index];
  const pages = layout.pages.length > 1;
  return (
    <div className="footer-preview" aria-label="Display footer">
      {pages ? <span className={`fbtn ${index === 0 ? 'off' : ''}`}>&lt;</span> : <span className="fspace" />}
      <span className="ftitle">
        {page?.title ?? page?.id}
        {pages && ` ${index + 1}/${layout.pages.length}`}
      </span>
      <span className="fend">
        <span className="fbtn fmenu" title="Settings on the display">
          <svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true">
            <path d="M1 1h14M1 6h14M1 11h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        {pages && <span className={`fbtn ${index + 1 >= layout.pages.length ? 'off' : ''}`}>&gt;</span>}
      </span>
    </div>
  );
}
