// HTML/SVG approximations of what the display draws (open question 7: verified against the
// SDL screenshots in firmware/test/golden). Values arrive in SI and are converted like the
// firmware does.
import {
  AUTOPILOT_DEFAULTS,
  POSITION_DEFAULTS,
  UNITS,
  formatPosition,
  type PositionTile,
  WIND_ROSE_DEFAULTS,
  toDisplay,
  type DataItem,
  type Layout,
  type AutopilotTile,
  type Tile,
  type WindRoseTile,
  type ValueTile,
  type Zone,
  valueZoneState,
  historyEnabled,
} from '@esphelm/schema';
import { formatValue } from '../format';
import { CENTER_SLOTS, CORNER_SLOTS, type SlotName } from '../layoutOps';
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
}) {
  const { tile, values } = props;
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
          {tile.type === 'value' && historyEnabled(tile) && (
            <svg className="tile-history-mark" viewBox="0 0 20 10" role="img" aria-label="Has history">
              <polyline points="1,9 6,4 12,7 19,1" />
            </svg>
          )}
        </>
      );
  }
}

/** Latitude over longitude, in the tile's format (the same text the display shows). */
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

// Rose geometry in the SVG's 200x200 box, as the firmware draws it (widgets.cpp): ring about
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
    </span>
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
