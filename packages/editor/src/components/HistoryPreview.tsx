// Mock of the display's history popup (ADR-0018): what a tap on a value tile opens. The display
// draws the values it recorded since boot; this draws an example curve around the live value,
// in the layout's display theme, with the same windows and axis labels.
import { useState } from 'react';
import { HISTORY, UNITS, axisLabels, toDisplay, type Layout, type ValueTile } from '@esphelm/schema';

/** Example points of window `w`: a slow wave plus a ripple, with a gap, around `base`. */
export function exampleCurve(base: number, w: number): (number | null)[] {
  const amp = Math.max(Math.abs(base) * 0.2, 1);
  return Array.from({ length: HISTORY.points }, (_, k) =>
    k >= 70 && k < 78
      ? null
      : base + amp * (Math.sin(k / (12 + 8 * w)) * 0.8 + 0.15 * Math.sin(k / 2.5)),
  );
}

export function HistoryPreview(props: {
  tile: ValueTile;
  value: unknown;
  theme: Layout['theme'];
  onClose(): void;
}) {
  const { tile } = props;
  const [win, setWin] = useState(0);
  const decimals = tile.decimals ?? 1;
  const unit = tile.unit ? UNITS[tile.unit].label : '';
  const live =
    typeof props.value === 'number' && Number.isFinite(props.value)
      ? tile.unit
        ? toDisplay(props.value, tile.unit)
        : props.value
      : undefined;
  const points = exampleCurve(live ?? 6, win);
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
  const windows = HISTORY.windows;
  const axis = axisLabels(windows[win]!.seconds);

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
          <span className="history-caption">{tile.label || tile.path}</span>
          <button className="history-close" onClick={props.onClose} aria-label="Close history">
            X
          </button>
        </div>
        <div className="history-row">
          <span className="history-value">
            {live === undefined ? '--' : fmt(live)}
            {unit && ` ${unit}`}
          </span>
          <span className="history-minmax">
            min {fmt(min)}
            <br />
            max {fmt(max)}
          </span>
        </div>
        <div className="history-graph">
          <div className="history-y">
            <span>{fmt(hi)}</span>
            <span>{fmt((hi + lo) / 2)}</span>
            <span>{fmt(lo)}</span>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="history-plot">
            {(tile.zones ?? []).map((z, i) => {
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
          {axis.map((a) => (
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
