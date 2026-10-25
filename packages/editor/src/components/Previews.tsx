// HTML/SVG approximations of what the display draws (open question 7: verified against the
// SDL screenshots in firmware/test/golden). Values arrive in SI and are converted like the
// firmware does.
import {
  UNITS,
  WIND_ROSE_DEFAULTS,
  toDisplay,
  type DataItem,
  type Layout,
  type Tile,
  type WindRosePage,
  type Zone,
} from '@esphelm/schema';
import { formatValue } from '../format';
import { WIND_ROSE_SLOTS, type SlotName } from '../layoutOps';

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

function zoneFor(n: number | undefined, zones: Zone[] | undefined): string {
  if (n === undefined) return 'stale';
  let state = 'normal';
  for (const z of zones ?? []) if (n >= z.from && n <= z.to) state = z.state;
  return state;
}

// The gauge sweeps 270 degrees, from 225 (bottom left) clockwise to 135 (bottom right).
const GAUGE_START = 225;
const GAUGE_SWEEP = 270;

function GaugePreview({ tile, value }: { tile: Extract<Tile, { type: 'gauge' }>; value: unknown }) {
  const n = displayNumber(value, tile);
  const at = (v: number) => GAUGE_START + GAUGE_SWEEP * clamp01((v - tile.min) / (tile.max - tile.min || 1));
  const [nx, ny] = polar(50, 52, 34, n === undefined ? GAUGE_START : at(n));
  return (
    <span className="tile-graphic">
      <svg viewBox="0 0 100 100" className="gauge" aria-hidden>
        <path className="track" d={arc(50, 52, 40, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} />
        {(tile.zones ?? []).map((z, i) => (
          <path key={i} className={`zone zone-${z.state}`} d={arc(50, 52, 40, at(z.from), at(z.to))} />
        ))}
        {n !== undefined && <line className="needle" x1={50} y1={52} x2={nx} y2={ny} />}
        <text x={50} y={94} className="gauge-value">
          {formatValue(value, tile.unit, tile.decimals)} {tile.unit ? UNITS[tile.unit].label : ''}
        </text>
      </svg>
    </span>
  );
}

function BarPreview({ tile, value }: { tile: Extract<Tile, { type: 'bar' }>; value: unknown }) {
  const n = displayNumber(value, tile);
  const pct = n === undefined ? 0 : 100 * clamp01((n - tile.min) / (tile.max - tile.min || 1));
  const vertical = tile.orientation === 'vertical';
  return (
    <span className={`tile-graphic bar ${vertical ? 'vertical' : ''}`}>
      <span className="bar-track">
        <span
          className={`bar-fill zone-${zoneFor(n, tile.zones)}`}
          style={vertical ? { height: `${pct}%` } : { width: `${pct}%` }}
        />
      </span>
      <span className="bar-value">
        {formatValue(value, tile.unit, tile.decimals)} {tile.unit ? UNITS[tile.unit].label : ''}
      </span>
    </span>
  );
}

function SwitchPreview({ value }: { value: unknown }) {
  const known = typeof value === 'boolean';
  return (
    <span className="tile-graphic switch">
      <span className={`toggle ${value === true ? 'on' : ''}`} />
      <span className="switch-state">{known ? (value ? 'on' : 'off') : '--'}</span>
    </span>
  );
}

export function TilePreview({ tile, value }: { tile: Tile; value: unknown }) {
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
          <span className="tile-value">
            {tile.path ? formatValue(value, tile.unit, tile.decimals) : '--'}
          </span>
          <span className="tile-unit">{tile.unit ? UNITS[tile.unit].label : ''}</span>
        </>
      );
  }
}

const RAD = 180 / Math.PI;
const ROSE_LABELS = [0, 30, 60, 90, 120, 150, 180, 150, 120, 90, 60, 30];

/** The wind-rose page: live pointers and three clickable centre slots. */
export function WindRosePreview(props: {
  page: WindRosePage;
  values: Map<string, unknown>;
  selectedSlot: SlotName | undefined;
  onSelectSlot(slot: SlotName): void;
  onSelectRose(): void;
}) {
  const { page, values } = props;
  const cfg = { ...WIND_ROSE_DEFAULTS, ...page.config };
  const num = (path: string) => {
    const v = values.get(path);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const awa = num(cfg.apparentAngle);
  const twd = num(cfg.trueDirection);
  const hdg = num(cfg.heading);
  const pointer = (deg: number, inner: number, outer: number) => {
    const [x1, y1] = polar(0, 0, 90 * inner, deg);
    const [x2, y2] = polar(0, 0, 90 * outer, deg);
    return { x1, y1, x2, y2 };
  };
  return (
    <div className="rose" data-testid="wind-rose">
      <svg
        viewBox="-100 -100 200 200"
        onClick={props.onSelectRose}
        role="button"
        aria-label="Wind rose settings"
      >
        <circle r={90} className="rose-ring" />
        <path className="zone zone-normal" d={arc(0, 0, 90, 20, 60)} />
        <path className="zone zone-alarm" d={arc(0, 0, 90, 300, 340)} />
        {Array.from({ length: 36 }, (_, i) => {
          const [x1, y1] = polar(0, 0, 90, i * 10);
          const [x2, y2] = polar(0, 0, i % 3 === 0 ? 82 : 86, i * 10);
          return <line key={i} className="rose-tick" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {ROSE_LABELS.map((label, i) => {
          const [x, y] = polar(0, 0, 72, i * 30);
          return (
            <text key={i} x={x} y={y + 3} className="rose-label">
              {label}
            </text>
          );
        })}
        {cfg.showTrueWind && twd !== undefined && hdg !== undefined && (
          <line className="pointer true" {...pointer((twd - hdg) * RAD, 0.64, 0.86)} />
        )}
        {awa !== undefined && <line className="pointer apparent" {...pointer(awa * RAD, 0.64, 0.97)} />}
        <text y={-46} className="rose-heading">
          HDG {hdg === undefined ? '--' : `${Math.round((((hdg * RAD) % 360) + 360) % 360)}°`}
        </text>
      </svg>
      <div className="rose-slots">
        {WIND_ROSE_SLOTS.map((slot) => {
          const item = page.slots[slot];
          return (
            <button
              key={slot}
              className={`rose-slot ${props.selectedSlot === slot ? 'selected' : ''} ${item ? '' : 'empty'}`}
              onClick={() => props.onSelectSlot(slot)}
              aria-label={`Slot ${slot}`}
              data-testid={`slot-${slot}`}
            >
              {item ? (
                <>
                  <span className="slot-value">
                    {item.path ? formatValue(values.get(item.path), item.unit, item.decimals) : '--'}
                  </span>
                  <span className="slot-label">
                    {[item.label, item.unit ? UNITS[item.unit].label : ''].filter(Boolean).join(' ') ||
                      'Pick a path'}
                  </span>
                </>
              ) : (
                <span className="slot-label">+ choose</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The display's page footer (shown when the layout has more than one page). */
export function FooterPreview({ layout, index }: { layout: Layout; index: number }) {
  if (layout.pages.length < 2) return null;
  const page = layout.pages[index];
  return (
    <div className="footer-preview" aria-label="Display footer">
      <span className={`fbtn ${index === 0 ? 'off' : ''}`}>&lt;</span>
      <span>
        {page?.title ?? page?.id} {index + 1}/{layout.pages.length}
      </span>
      <span className={`fbtn ${index + 1 >= layout.pages.length ? 'off' : ''}`}>&gt;</span>
    </div>
  );
}
