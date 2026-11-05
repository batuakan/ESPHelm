// Steps after picking a layout file (ADR-0027): confirm the import, then replace the paths and
// charts this server doesn't have.
import { useState } from 'react';
import type { ChartInfo, PathInfo } from '../api';
import type { MissingRef } from '../share';
import { PathPicker } from './TileDrawer';

export function ImportConfirm(props: {
  name: string;
  /** Tiles or pages in the file this display can't show. */
  unsupported: string[];
  onReplace(): void;
  onCancel(): void;
}) {
  return (
    <div className="banner info import-confirm" role="dialog" aria-label="Import layout">
      <span>
        Replace all pages of this display's layout with “{props.name}”? It is sent with Save &amp; send.
        {props.unsupported.length > 0 && ` This display cannot show: ${props.unsupported.join(', ')}.`}
      </span>
      <button className="danger small" onClick={props.onReplace}>
        Replace
      </button>
      <button className="small" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}

const key = (m: MissingRef) => `${m.kind}:${m.value}`;

/** Replacements for the paths and charts an imported layout uses that this server doesn't have. */
export function RemapDialog(props: {
  missing: MissingRef[];
  paths: PathInfo[];
  values: Map<string, unknown>;
  charts: ChartInfo[];
  onApply(replacements: { kind: MissingRef['kind']; from: string; to: string }[]): void;
  onSkip(): void;
}) {
  const [choice, setChoice] = useState<Map<string, string>>(new Map());
  const pick = (m: MissingRef, to: string) => setChoice((prev) => new Map(prev).set(key(m), to));
  const chosen = props.missing
    .map((m) => ({ kind: m.kind, from: m.value, to: choice.get(key(m)) ?? '' }))
    .filter((r) => r.to !== '' && r.to !== r.from);
  const charts = props.charts.filter((c) => c.supported);
  return (
    <section className="panel remap" role="dialog" aria-label="Replace paths">
      <h2>Paths and charts this server doesn't have</h2>
      <p className="hint">
        Pick a replacement for each, or keep it: some paths only appear while in use (an autopilot in
        standby, environment.sun without the derived-data plugin).
      </p>
      <ul>
        {props.missing.map((m) => (
          <li key={key(m)}>
            <code>{m.value}</code>
            <span className="hint">
              {' '}
              {m.uses} {m.kind === 'chart' ? (m.uses === 1 ? 'page' : 'pages') : m.uses === 1 ? 'use' : 'uses'}
            </span>
            {m.kind === 'path' ? (
              <PathPicker
                path={choice.get(key(m)) ?? m.value}
                paths={props.paths}
                values={props.values}
                label="Replace with"
                onPick={(to) => pick(m, to)}
              />
            ) : (
              <label className="field">
                <span>Replace with</span>
                <select value={choice.get(key(m)) ?? ''} onChange={(e) => pick(m, e.target.value)}>
                  <option value="">Keep</option>
                  {charts.map((c) => (
                    <option key={c.identifier} value={c.identifier}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="remap-actions">
        <button className="primary small" disabled={chosen.length === 0} onClick={() => props.onApply(chosen)}>
          Replace {chosen.length > 0 ? chosen.length : ''}
        </button>
        <button className="small" onClick={props.onSkip}>
          Keep as is
        </button>
      </div>
    </section>
  );
}
