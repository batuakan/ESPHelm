// Mock of the display's history popup (ADR-0018, ADR-0019): what a tap on a tile that records
// opens. The display draws the values it recorded since boot; this draws an example curve around
// the live value, in the layout's display theme, with the same windows and axis labels. A wind
// rose gets one button per recorded value; angles are drawn around their mean on the circle, as
// on the display, so a curve across north doesn't jump.
import { useState } from 'react';
import {
  HISTORY,
  UNITS,
  axisLabels,
  circularMean,
  toDisplay,
  unwrapAround,
  type Layout,
  type UnitId,
  type ValueZone,
  type Wrap,
} from '@esphelm/schema';

/** One value the mock shows. */
export interface PreviewSeries {
  key: string;
  /** Button text (wind rose values). */
  title: string;
  /** The caption: the label, else the path. */
  caption: string;
  unit?: UnitId;
  decimals?: number;
  zones?: ValueZone[];
  /** The live SignalK value (SI), if any. */
  value: unknown;
}

/** Example points of window `w`: a slow wave plus a ripple, with a gap, around `base`. */
export function exampleCurve(base: number, w: number, amp = Math.max(Math.abs(base) * 0.2, 1)) {
  return Array.from({ length: HISTORY.points }, (_, k) =>
    k >= 70 && k < 78
      ? null
      : base + amp * (Math.sin(k / (12 + 8 * w)) * 0.8 + 0.15 * Math.sin(k / 2.5)),
  );
}

/** Into the wrap range, rounded first so that 359.96 reads 0 (as the display's axis labels). */
function wrapped(v: number, wrap: Wrap, decimals: number): number {
  const s = 10 ** decimals;
  const r = Math.round(v * s) / s;
  const span = wrap[1] - wrap[0];
  return r - span * Math.floor((r - wrap[0]) / span);
}

/**
 * The example points as the display would draw them: an angle's curve swings 10 units either
 * side of the live value, is stored back in its range, then unwrapped around its mean.
 */
export function previewPoints(series: PreviewSeries, w: number): (number | null)[] {
  const wrap = series.unit ? UNITS[series.unit].wrap : undefined;
  const raw = series.value;
  const live =
    typeof raw === 'number' && Number.isFinite(raw)
      ? series.unit
        ? toDisplay(raw, series.unit)
        : raw
      : undefined;
  if (!wrap) return exampleCurve(live ?? 6, w);
  const span = wrap[1] - wrap[0];
  const stored = exampleCurve(live ?? wrap[0], w, 10).map((p) =>
    p === null ? null : p - span * Math.floor((p - wrap[0]) / span),
  );
  const centre = circularMean(
    stored.filter((p): p is number => p !== null),
    wrap,
  );
  return centre === null
    ? stored
    : stored.map((p) => (p === null ? null : unwrapAround(p, centre, wrap)));
}

export function HistoryPreview(props: {
  series: PreviewSeries[];
  theme: Layout['theme'];
  onClose(): void;
}) {
  const [win, setWin] = useState(0);
  const [index, setIndex] = useState(0);
  const series = props.series[index] ?? props.series[0];
  if (!series) return null;
  const decimals = series.decimals ?? 1;
  const unit = series.unit ? UNITS[series.unit].label : '';
  const wrap = series.unit ? UNITS[series.unit].wrap : undefined;
  const live =
    typeof series.value === 'number' && Number.isFinite(series.value)
      ? series.unit
        ? toDisplay(series.value, series.unit)
        : series.value
      : undefined;
  const points = previewPoints(series, win);
  const shown = points.filter((p): p is number => p !== null);
  const min = Math.min(...shown);
  const max = Math.max(...shown);
  const pad = (max - min) * 0.1 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;
  // One polyline per run of points between gaps.
  const runs: string[] = [];
  let run: string[] = [];
  points.forEach((p, k) => {
    if (p === null) {
      if (run.length > 1) runs.push(run.join(' '));
      run = [];
    } else {
      run.push(`${((k / (HISTORY.points - 1)) * 100).toFixed(2)},${y(p).toFixed(2)}`);
    }
  });
  if (run.length > 1) runs.push(run.join(' '));
  const fmt = (v: number) => v.toFixed(decimals);
  const axis = (v: number) => fmt(wrap ? wrapped(v, wrap, decimals) : v);
  const windows = HISTORY.windows;
  const time = axisLabels(windows[win]!.seconds);

  return (
    <div className="history-backdrop" onClick={props.onClose}>
      <div
        className="display-frame history-popup"
        data-theme-preview={props.theme}
        role="dialog"
        aria-label="History preview"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="history-head">
          <span className="history-caption">{series.caption}</span>
          <button className="history-close" onClick={props.onClose} aria-label="Close history">
            X
          </button>
        </div>
        {props.series.length > 1 && (
          <div className="history-series" role="group" aria-label="Recorded values">
            {props.series.map((s, i) => (
              <button
                key={s.key}
                className={i === index ? 'on' : ''}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        <div className="history-row">
          <span className="history-value">
            {live === undefined ? '--' : fmt(live)}
            {unit && ` ${unit}`}
          </span>
          <span className="history-minmax">
            min {axis(min)}
            <br />
            max {axis(max)}
          </span>
        </div>
        <div className="history-graph">
          <div className="history-y">
            <span>{axis(hi)}</span>
            <span>{axis((hi + lo) / 2)}</span>
            <span>{axis(lo)}</span>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="history-plot">
            {!wrap &&
              (series.zones ?? []).map((z, i) => {
                const top = Math.min(z.to ?? Infinity, hi);
                const bottom = Math.max(z.from ?? -Infinity, lo);
                if (!(bottom < top)) return null;
                return (
                  <rect
                    key={i}
                    x={0}
                    width={100}
                    y={y(top)}
                    height={y(bottom) - y(top)}
                    className={`history-band zone-${z.state}`}
                  />
                );
              })}
            <line x1={0} x2={100} y1={50} y2={50} className="history-grid" />
            {runs.map((r, i) => (
              <polyline key={i} points={r} className="history-line" />
            ))}
          </svg>
        </div>
        <div className="history-x">
          {time.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
        <div className="history-windows">
          {windows.map((w, i) => (
            <button
              key={w.label}
              className={i === win ? 'on' : ''}
              aria-pressed={i === win}
              onClick={() => setWin(i)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <small className="history-note">
          Example curve. The display draws what it recorded since it started (6 h only on displays
          with PSRAM).
        </small>
      </div>
    </div>
  );
}
