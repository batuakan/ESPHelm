// Settings for the selected tile: SignalK path (searchable, with live value and SI units),
// display unit (only units that fit the path's quantity), decimals, label, stale timeout.
import { useMemo, useState } from 'react';
import {
  LABEL_PATTERN,
  UNIT_IDS,
  UNITS,
  quantityForSignalKUnits,
  unitsForSignalKUnits,
  type Tile,
  type UnitId,
} from '@esphelm/schema';
import type { PathInfo } from '../api';
import { preferredUnit } from '../format';

const LABEL_RE = new RegExp(LABEL_PATTERN, 'u');

interface Props {
  tile: Tile;
  paths: PathInfo[];
  values: Map<string, unknown>;
  supported: boolean;
  onChange(patch: Record<string, unknown>): void;
  onDelete(): void;
  onClose(): void;
}

function describe(value: unknown, units: string | null): string {
  if (value === undefined || value === null) return 'no value yet';
  if (typeof value === 'number') return `${Number(value.toPrecision(4))} ${units ?? ''}`.trim();
  if (typeof value === 'object') return 'object';
  return String(value);
}

export function TileDrawer({ tile, paths, values, supported, onChange, onDelete, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(!tile.path);
  const info = paths.find((p) => p.path === tile.path);
  const fitting = unitsForSignalKUnits(info?.units ?? undefined);
  const unitChoices: readonly UnitId[] = fitting.length > 0 ? fitting : UNIT_IDS;
  const unit = 'unit' in tile ? (tile.unit as UnitId | undefined) : undefined;
  const label = 'label' in tile ? ((tile.label as string | undefined) ?? '') : '';

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return paths
      .filter((p) => !q || p.path.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
      .slice(0, 40);
  }, [paths, query]);

  const pick = (p: PathInfo) => {
    const quantity = quantityForSignalKUnits(p.units ?? undefined);
    const keepUnit = unit && unitsForSignalKUnits(p.units ?? undefined).includes(unit);
    onChange({ path: p.path, unit: keepUnit ? unit : preferredUnit(quantity) });
    setPicking(false);
    setQuery('');
  };

  return (
    <aside className="drawer" aria-label="Tile settings">
      <header className="drawer-head">
        <strong>{label || tile.id}</strong>
        <button className="icon" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </header>
      {!supported && (
        <p className="warn">This display's firmware cannot show {tile.type} tiles yet.</p>
      )}

      <label className="field">
        <span>SignalK path</span>
        {picking ? (
          <>
            <input
              autoFocus
              placeholder="Search paths, e.g. speed"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  const exact = paths.find((p) => p.path === query.trim());
                  if (exact) pick(exact);
                  else {
                    onChange({ path: query.trim() });
                    setPicking(false);
                  }
                }
              }}
              aria-label="Search SignalK paths"
            />
            <ul className="path-list" role="listbox">
              {matches.map((p) => (
                <li key={p.path}>
                  <button role="option" aria-selected={p.path === tile.path} onClick={() => pick(p)}>
                    <span className="path">{p.path}</span>
                    <span className="now">{describe(values.get(p.path) ?? p.value, p.units)}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="empty">No matching paths. Press Enter to use it anyway.</li>}
            </ul>
          </>
        ) : (
          <button className="path-button" onClick={() => setPicking(true)}>
            <span className="path">{tile.path || 'Pick a path'}</span>
            <span className="now">
              now {describe(values.get(tile.path) ?? info?.value, info?.units ?? null)}
            </span>
          </button>
        )}
      </label>

      {tile.type !== 'switch' && (
        <>
          <label className="field">
            <span>Unit</span>
            <select
              value={unit ?? ''}
              onChange={(e) => onChange({ unit: e.target.value || undefined })}
              aria-label="Display unit"
            >
              <option value="">as received{info?.units ? ` (${info.units})` : ''}</option>
              {unitChoices.map((u) => (
                <option key={u} value={u}>
                  {UNITS[u].label || u} ({u})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Decimals</span>
            <input
              type="number"
              min={0}
              max={6}
              placeholder="1"
              value={'decimals' in tile && tile.decimals !== undefined ? String(tile.decimals) : ''}
              onChange={(e) =>
                onChange({ decimals: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              aria-label="Decimals"
            />
          </label>
        </>
      )}

      <label className="field">
        <span>Label</span>
        <input
          value={label}
          placeholder="e.g. SOG"
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          aria-label="Label"
          aria-invalid={!LABEL_RE.test(label)}
        />
        {!LABEL_RE.test(label) && (
          <small className="error">Only letters A-Z, digits, punctuation and ° can be shown.</small>
        )}
      </label>

      {tile.type !== 'switch' && (
        <label className="field">
          <span>Stale after (s)</span>
          <input
            type="number"
            min={1}
            placeholder="15"
            value={'staleAfter' in tile && tile.staleAfter !== undefined ? String(tile.staleAfter) : ''}
            onChange={(e) =>
              onChange({ staleAfter: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            aria-label="Stale after seconds"
          />
        </label>
      )}

      <button className="danger" onClick={onDelete}>
        Delete tile
      </button>
    </aside>
  );
}
