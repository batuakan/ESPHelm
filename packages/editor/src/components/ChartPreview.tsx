// Chart page preview: the chart's own PNG/JPEG tiles, loaded by the browser from its tilemapUrl
// (same server, same login), centred on the live position at the page's zoom, north up, with
// the vessel and the anchor overlay. The display draws the same from RGB565 tiles (ADR-0012).
import { CHART_DEFAULTS, type ChartPage } from '@esphelm/schema';
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
  page: ChartPage;
  chart: ChartInfo | undefined;
  values: Map<string, unknown>;
  /** The chart area on the display, in display pixels. */
  width: number;
  height: number;
  night: boolean;
  onSelect(): void;
}) {
  const { page, chart, values, width: W, height: H } = props;
  const cfg = { ...CHART_DEFAULTS, ...page.config };
  const zoom = page.zoom ?? CHART_DEFAULTS.zoom;
  const anchorOn = page.anchor ?? CHART_DEFAULTS.anchor;
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
        {!page.chart ? 'Choose a chart' : !chart ? `Chart "${page.chart}" not found` : 'This chart cannot be shown on a display'}
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
    const s = Math.max(14, Math.min(W, H) / 22);
    body = (
      <>
        <g className={props.night ? 'chart-tiles night' : 'chart-tiles'}>{tiles}</g>
        {anchor}
        <g transform={`translate(${W / 2} ${H / 2}) rotate(${h})`} className="chart-vessel">
          <polygon points={`0,${-s} ${s * 0.48},${s * 0.64} 0,${s * 0.25} ${-s * 0.48},${s * 0.64}`} />
        </g>
        {(() => {
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
  return (
    <div className="canvas-frame chart-frame" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-preview"
        onClick={props.onSelect}
        role="button"
        aria-label="Chart page settings"
        data-testid={`chart-${page.id}`}
      >
        <rect width={W} height={H} className="chart-bg" />
        {body}
        {anchorOn && alarmOn && (
          <text x={W / 2} y={32} className="chart-alarm">
            ANCHOR ALARM
          </text>
        )}
        <g className="chart-zoom" aria-hidden>
          <rect x={W - 60} y={8} width={52} height={52} rx={10} />
          <text x={W - 34} y={42}>+</text>
          <rect x={W - 60} y={68} width={52} height={52} rx={10} />
          <text x={W - 34} y={102}>-</text>
        </g>
      </svg>
    </div>
  );
}
