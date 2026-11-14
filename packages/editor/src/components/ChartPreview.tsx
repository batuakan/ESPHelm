// Chart tile preview: the chart's own PNG/JPEG tiles, loaded by the browser from its tilemapUrl
// (same server, same login), centred on the live position at the tile's zoom, north up, with
// the vessel, the anchor overlay and the active route with the next waypoint (ADR-0037), drawn
// at the tile's size on the display and for its size tier (CHART_FIT). The display draws the same from RGB565 tiles (ADR-0012, ADR-0030).
import { CHART_DEFAULTS, CHART_FIT, edgeArrow, type ChartTile } from '@esphelm/schema';
import type { ReactElement } from 'react';
import type { ChartInfo } from '../api';

const TILE = 256;
const RAD = 180 / Math.PI;

interface LatLon {
  latitude: number;
  longitude: number;
}

function asPosition(v: unknown): LatLon | undefined {
  const p = v as Partial<LatLon> | undefined;
  return p && typeof p.latitude === 'number' && typeof p.longitude === 'number' ? (p as LatLon) : undefined;
}

/** Fractional Web-Mercator tile coordinates (as the firmware computes them). */
export function lonLatToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

export function tileHref(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{-y}', String(2 ** z - 1 - y))
    .replace('{y}', String(y));
}

export function ChartPreview(props: {
  tile: ChartTile;
  chart: ChartInfo | undefined;
  values: Map<string, unknown>;
  /** The tile on the display, in display pixels. */
  width: number;
  height: number;
  night: boolean;
  /** The active route's points as the display gets them: [lat, lon, index] (ADR-0037). */
  route?: [number, number, number][];
}) {
  const { tile, chart, values } = props;
  const W = Math.max(1, Math.round(props.width));
  const H = Math.max(1, Math.round(props.height));
  const shorter = Math.min(W, H);
  const small = shorter < CHART_FIT.buttons;
  const cfg = { ...CHART_DEFAULTS, ...tile.config };
  const zoom = tile.zoom ?? CHART_DEFAULTS.zoom;
  const anchorOn = tile.anchor ?? CHART_DEFAULTS.anchor;
  const pos = asPosition(values.get(cfg.positionPath));
  const heading = values.get(cfg.headingPath);
  const anchorPos = asPosition(values.get(cfg.anchorPositionPath));
  const radius = values.get(cfg.anchorRadiusPath);
  const alarm = values.get(cfg.anchorAlarmPath) as { state?: string } | undefined;
  const alarmOn = !!alarm?.state && alarm.state !== 'normal' && alarm.state !== 'nominal';
  const routeOn = tile.route ?? CHART_DEFAULTS.route;
  const active = values.get(cfg.activeRoutePath) as
    | { pointIndex?: unknown; pointTotal?: unknown; reverse?: unknown }
    | null
    | undefined;
  const nextPos = asPosition((values.get(cfg.nextPointPath) as { position?: unknown } | null | undefined)?.position);
  const prevPos = asPosition(
    (values.get(cfg.previousPointPath) as { position?: unknown } | null | undefined)?.position,
  );
  const distance = values.get(cfg.distancePath);

  let body: ReactElement;
  if (!chart || !chart.supported || !chart.tilemapUrl) {
    body = (
      <text x={W / 2} y={H / 2} className="chart-message">
        {!tile.chart ? 'Choose a chart' : !chart ? `Chart "${tile.chart}" not found` : 'This chart cannot be shown on a display'}
      </text>
    );
  } else if (!pos) {
    body = (
      <text x={W / 2} y={H / 2} className="chart-message">
        Waiting for a position ({cfg.positionPath})
      </text>
    );
  } else {
    const c = lonLatToTile(pos.latitude, pos.longitude, zoom);
    // Display pixel of the vessel = view centre; global tile pixel of the view's top left:
    const x0 = c.x * TILE - W / 2;
    const y0 = c.y * TILE - H / 2;
    const n = 2 ** zoom;
    const tiles: ReactElement[] = [];
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++) {
        const wx = ((tx % n) + n) % n;
        tiles.push(
          <image
            key={`${tx}/${ty}`}
            href={tileHref(chart.tilemapUrl, zoom, wx, ty)}
            x={tx * TILE - x0}
            y={ty * TILE - y0}
            width={TILE}
            height={TILE}
            preserveAspectRatio="none"
          />,
        );
      }
    }
    let anchor: ReactElement | null = null;
    if (anchorOn && anchorPos) {
      const a = lonLatToTile(anchorPos.latitude, anchorPos.longitude, zoom);
      const ax = a.x * TILE - x0;
      const ay = a.y * TILE - y0;
      const mpp = (156543.03392 * Math.cos((pos.latitude * Math.PI) / 180)) / n;
      anchor = (
        <g className={`chart-anchor ${alarmOn ? 'alarm' : ''}`}>
          {typeof radius === 'number' && radius > 0 && <circle cx={ax} cy={ay} r={radius / mpp} className="ring" />}
          <circle cx={ax} cy={ay} r={7} className="mark" />
        </g>
      );
    }
    // The active route and the next waypoint, as the display draws them (chart.cpp).
    const at = (p: LatLon) => {
      const t = lonLatToTile(p.latitude, p.longitude, zoom);
      return { x: t.x * TILE - x0, y: t.y * TILE - y0 };
    };
    let course: ReactElement | null = null;
    if (routeOn && (props.route || nextPos)) {
      const w = Math.max(3, shorter / 160);
      const pts = (props.route ?? []).map(([latitude, longitude, i]) => ({ ...at({ latitude, longitude }), i }));
      const total =
        typeof active?.pointTotal === 'number' ? active.pointTotal : (props.route?.at(-1)?.[2] ?? 0) + 1;
      const index = typeof active?.pointIndex === 'number' ? active.pointIndex : 0;
      const order = (i: number) => (active?.reverse === true ? total - 1 - i : i);
      const legs = pts.slice(1).map((b, k) => {
        const a = pts[k]!;
        const behind = Math.max(order(a.i), order(b.i)) < index;
        return (
          <line
            key={k}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={behind ? 'leg behind' : 'leg'}
            strokeWidth={behind ? Math.max(2, w - 1) : w}
          />
        );
      });
      const s2 = Math.max(small ? 9 : 12, shorter / 28);
      let marker: ReactElement | null = null;
      if (nextPos) {
        const n = at(nextPos);
        // Clear of the zoom buttons and the position line, as on the display.
        const a = edgeArrow(n.x - W / 2, n.y - H / 2, W, H, small ? s2 * 1.6 : Math.max(48, shorter / 9) + 8 + s2);
        const tip = (ang: number, r: number) =>
          `${a.x + Math.sin(a.angle + ang) * r},${a.y - Math.cos(a.angle + ang) * r}`;
        const nm = typeof distance === 'number' ? distance / 1852 : undefined;
        const lx = a.onScreen ? a.x : a.x - Math.sin(a.angle) * s2 * 2.4;
        const ly = a.onScreen ? a.y + s2 * 1.7 : a.y + Math.cos(a.angle) * s2 * 2.4;
        marker = (
          <g className="chart-waypoint">
            <line x1={W / 2} y1={H / 2} x2={a.x} y2={a.y} className="to-waypoint" />
            {prevPos && (() => {
              const p = at(prevPos);
              return <line x1={p.x} y1={p.y} x2={n.x} y2={n.y} className="leg active" strokeWidth={w * 2} />;
            })()}
            {a.onScreen ? (
              <circle cx={a.x} cy={a.y} r={s2 * 0.8} className="ring" strokeWidth={Math.max(3, shorter / 160)} />
            ) : (
              <>
                <polygon points={`${tip(0, s2 * 1.35)} ${tip(2.45, s2 * 1.05)} ${tip(-2.45, s2 * 1.05)}`} className="outline" />
                <polygon points={`${tip(0, s2)} ${tip(2.45, s2 * 0.7)} ${tip(-2.45, s2 * 0.7)}`} className="arrow" />
              </>
            )}
            {nm !== undefined && shorter >= CHART_FIT.info && (
              <text x={lx} y={ly + 6} className="distance">
                {nm < 10 ? nm.toFixed(2) : nm < 100 ? nm.toFixed(1) : nm.toFixed(0)} nm
              </text>
            )}
          </g>
        );
      }
      course = (
        <>
          <g className="chart-route">
            {legs}
            {pts.map((p, k) => (
              <circle key={k} cx={p.x} cy={p.y} r={w + 2} className="point" strokeWidth={Math.max(2, w - 1)} />
            ))}
          </g>
          {marker}
        </>
      );
    }
    const h = typeof heading === 'number' ? heading * RAD : 0;
    const s = Math.max(small ? 10 : 18, shorter / 16);
    body = (
      <>
        <g className={props.night ? 'chart-tiles night' : 'chart-tiles'}>{tiles}</g>
        {course && <g className={props.night ? 'chart-course night' : 'chart-course'}>{course}</g>}
        {anchor}
        <g transform={`translate(${W / 2} ${H / 2}) rotate(${h})`} className="chart-vessel">
          <polygon points={`0,${-s} ${s * 0.48},${s * 0.64} 0,${s * 0.25} ${-s * 0.48},${s * 0.64}`} />
        </g>
        {shorter >= CHART_FIT.info && (() => {
          const info = `${Math.abs(pos.latitude).toFixed(4)} ${pos.latitude >= 0 ? 'N' : 'S'}  ${Math.abs(pos.longitude).toFixed(4)} ${pos.longitude >= 0 ? 'E' : 'W'}   z${zoom}`;
          const w = info.length * 11 + 24;
          return (
            <g className="chart-info">
              <rect x={W / 2 - w / 2} y={H - 40} width={w} height={30} rx={8} />
              <text x={W / 2} y={H - 18}>
                {info}
              </text>
            </g>
          );
        })()}
      </>
    );
  }
  // The zoom buttons as the display sizes them (at least 48 px, a ninth of the shorter side).
  const b = Math.max(48, shorter / 9);
  return (
    <span
      className={`tile-graphic chart-tile ${anchorOn && alarmOn && small ? 'alarm' : ''}`}
      data-testid={`chart-${tile.id}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-preview" preserveAspectRatio="none" aria-hidden>
        <rect width={W} height={H} className="chart-bg" />
        {body}
        {anchorOn && alarmOn && !small && (
          <text x={W / 2} y={32} className="chart-alarm">
            ANCHOR ALARM
          </text>
        )}
        {!small && (
          <g className="chart-zoom">
            <rect x={W - 8 - b} y={8} width={b} height={b} rx={10} />
            <text x={W - 8 - b / 2} y={8 + b / 2 + 10}>+</text>
            <rect x={W - 8 - b} y={16 + b} width={b} height={b} rx={10} />
            <text x={W - 8 - b / 2} y={16 + b * 1.5 + 10}>-</text>
          </g>
        )}
      </svg>
    </span>
  );
}
