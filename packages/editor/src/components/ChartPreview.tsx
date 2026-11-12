// Chart tile preview: the chart's own PNG/JPEG tiles, loaded by the browser from its tilemapUrl
// (same server, same login), centred on the live position at the tile's zoom, north up, with
// the vessel and the anchor overlay, drawn at the tile's size on the display and for its size
// tier (CHART_FIT). The display draws the same from RGB565 tiles (ADR-0012, ADR-0030).
import { CHART_DEFAULTS, CHART_FIT, type ChartTile } from '@esphelm/schema';
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
    const h = typeof heading === 'number' ? heading * RAD : 0;
    const s = Math.max(small ? 10 : 18, shorter / 16);
    body = (
      <>
        <g className={props.night ? 'chart-tiles night' : 'chart-tiles'}>{tiles}</g>
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
