// Settings drawers. A DataItem (tile or wind-rose slot) gets: SignalK path (searchable, with
// live value and SI units), display unit (only units that fit the path's quantity), decimals,
// label, stale timeout. Gauges and bars add range, zones and orientation; the wind-rose page
// has its source paths and the true-wind toggle.
import { useMemo, useState, type ReactNode } from 'react';
import {
  LABEL_PATTERN,
  UNIT_IDS,
  UNITS,
  WIND_ROSE_DEFAULTS,
  quantityForSignalKUnits,
  unitsForSignalKUnits,
  type DataItem,
  type Tile,
  type UnitId,
  type WindRosePage,
  type Zone,
} from '@esphelm/schema';
import type { PathInfo } from '../api';
import { preferredUnit } from '../format';
import type { SlotName } from '../layoutOps';

const LABEL_RE = new RegExp(LABEL_PATTERN, 'u');
const ZONE_STATES: Zone['state'][] = ['normal', 'warn', 'alarm', 'emergency'];

type Patch = Record<string, unknown>;

function describe(value: unknown, units: string | null): string {
  if (value === undefined || value === null) return 'no value yet';
  if (typeof value === 'number') return `${Number(value.toPrecision(4))} ${units ?? ''}`.trim();
  if (typeof value === 'object') return 'object';
  return String(value);
}

/** Optional number input: empty clears the field. */
function numberOrUndefined(text: string): number | undefined {
  return text === '' ? undefined : Number(text);
}

/** Searchable SignalK path field. `preferBoolean` lists on/off paths first (switches). */
export function PathPicker(props: {
  path: string;
  paths: PathInfo[];
  values: Map<string, unknown>;
  label?: string;
  placeholder?: string;
  preferBoolean?: boolean;
  onPick(path: string, info: PathInfo | undefined): void;
}) {
  const { path, paths, values } = props;
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(!path);
  const info = paths.find((p) => p.path === path);
  const label = props.label ?? 'SignalK path';

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = paths.filter(
      (p) => !q || p.path.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
    );
    if (props.preferBoolean)
      found.sort(
        (a, b) => Number(typeof b.value === 'boolean') - Number(typeof a.value === 'boolean'),
      );
    return found.slice(0, 40);
  }, [paths, query, props.preferBoolean]);

  const pick = (p: PathInfo | undefined, text: string) => {
    props.onPick(text, p);
    setPicking(false);
    setQuery('');
  };

  return (
    <label className="field">
      <span>{label}</span>
      {picking ? (
        <>
          <input
            autoFocus={!path}
            placeholder={props.placeholder ?? 'Search paths, e.g. speed'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const text = query.trim();
              if (e.key === 'Enter' && text)
                pick(
                  paths.find((p) => p.path === text),
                  text,
                );
              if (e.key === 'Escape' && path) setPicking(false);
            }}
            aria-label={props.label ? `Search ${props.label}` : 'Search SignalK paths'}
          />
          <ul className="path-list" role="listbox">
            {matches.map((p) => (
              <li key={p.path}>
                <button
                  role="option"
                  aria-selected={p.path === path}
                  onClick={(e) => {
                    e.preventDefault();
                    pick(p, p.path);
                  }}
                >
                  <span className="path">{p.path}</span>
                  <span className="now">{describe(values.get(p.path) ?? p.value, p.units)}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="empty">No matching paths. Press Enter to use it anyway.</li>
            )}
          </ul>
        </>
      ) : (
        <button
          className="path-button"
          onClick={(e) => {
            e.preventDefault();
            setPicking(true);
          }}
          aria-label={`${label}: ${path || 'none'}`}
        >
          <span className="path">{path || props.placeholder || 'Pick a path'}</span>
          <span className="now">
            now {describe(values.get(path) ?? info?.value, info?.units ?? null)}
          </span>
        </button>
      )}
    </label>
  );
}

/** Path, unit, decimals, label and stale timeout of a DataItem. */
function DataItemFields(props: {
  item: DataItem;
  paths: PathInfo[];
  values: Map<string, unknown>;
  showFormat: boolean;
  preferBoolean?: boolean;
  onChange(patch: Patch): void;
}) {
  const { item, paths, onChange } = props;
  const info = paths.find((p) => p.path === item.path);
  const fitting = unitsForSignalKUnits(info?.units ?? undefined);
  const unitChoices: readonly UnitId[] = fitting.length > 0 ? fitting : UNIT_IDS;
  const label = item.label ?? '';

  const pick = (path: string, p: PathInfo | undefined) => {
    if (!props.showFormat || !p) return onChange({ path });
    const quantity = quantityForSignalKUnits(p.units ?? undefined);
    const keepUnit = item.unit && unitsForSignalKUnits(p.units ?? undefined).includes(item.unit);
    onChange({ path, unit: keepUnit ? item.unit : preferredUnit(quantity) });
  };

  return (
    <>
      <PathPicker
        path={item.path}
        paths={paths}
        values={props.values}
        preferBoolean={props.preferBoolean}
        onPick={pick}
      />
      {props.showFormat && (
        <>
          <label className="field">
            <span>Unit</span>
            <select
              value={item.unit ?? ''}
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
              value={item.decimals !== undefined ? String(item.decimals) : ''}
              onChange={(e) => onChange({ decimals: numberOrUndefined(e.target.value) })}
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
      {props.showFormat && (
        <label className="field">
          <span>Stale after (s)</span>
          <input
            type="number"
            min={1}
            placeholder="15"
            value={item.staleAfter !== undefined ? String(item.staleAfter) : ''}
            onChange={(e) => onChange({ staleAfter: numberOrUndefined(e.target.value) })}
            aria-label="Stale after seconds"
          />
        </label>
      )}
    </>
  );
}

/** Min/max, zones and (bars) orientation, in display units. */
function RangeFields(props: { tile: Tile & { min: number; max: number }; onChange(p: Patch): void }) {
  const { tile, onChange } = props;
  const zones: Zone[] = 'zones' in tile ? (tile.zones ?? []) : [];
  const setZones = (next: Zone[]) => onChange({ zones: next.length > 0 ? next : undefined });
  const setZone = (i: number, patch: Partial<Zone>) =>
    setZones(zones.map((z, k) => (k === i ? { ...z, ...patch } : z)));
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Min</span>
          <input
            type="number"
            value={String(tile.min)}
            onChange={(e) => onChange({ min: Number(e.target.value) })}
            aria-label="Minimum"
          />
        </label>
        <label className="field">
          <span>Max</span>
          <input
            type="number"
            value={String(tile.max)}
            onChange={(e) => onChange({ max: Number(e.target.value) })}
            aria-label="Maximum"
          />
        </label>
      </div>
      {tile.type === 'bar' && (
        <label className="field">
          <span>Orientation</span>
          <select
            value={tile.orientation ?? 'horizontal'}
            onChange={(e) => onChange({ orientation: e.target.value })}
            aria-label="Orientation"
          >
            <option value="horizontal">horizontal</option>
            <option value="vertical">vertical</option>
          </select>
        </label>
      )}
      <fieldset className="zones">
        <legend>Zones</legend>
        {zones.map((z, i) => (
          <div className="zone-row" key={i}>
            <input
              type="number"
              value={String(z.from)}
              onChange={(e) => setZone(i, { from: Number(e.target.value) })}
              aria-label={`Zone ${i + 1} from`}
            />
            <input
              type="number"
              value={String(z.to)}
              onChange={(e) => setZone(i, { to: Number(e.target.value) })}
              aria-label={`Zone ${i + 1} to`}
            />
            <select
              value={z.state}
              onChange={(e) => setZone(i, { state: e.target.value as Zone['state'] })}
              aria-label={`Zone ${i + 1} state`}
              className={`zone-${z.state}`}
            >
              {ZONE_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              className="icon"
              onClick={() => setZones(zones.filter((_, k) => k !== i))}
              aria-label={`Remove zone ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="small"
          onClick={() =>
            setZones([...zones, { from: tile.max - (tile.max - tile.min) / 5, to: tile.max, state: 'alarm' }])
          }
        >
          Add zone
        </button>
      </fieldset>
    </>
  );
}

function Drawer(props: { title: string; label: string; onClose(): void; children: ReactNode }) {
  return (
    <aside className="drawer" aria-label={props.label}>
      <header className="drawer-head">
        <strong>{props.title}</strong>
        <button className="icon" onClick={props.onClose} aria-label="Close settings">
          ✕
        </button>
      </header>
      {props.children}
    </aside>
  );
}

interface Common {
  paths: PathInfo[];
  values: Map<string, unknown>;
  onClose(): void;
}

export function TileDrawer(
  props: Common & {
    tile: Tile;
    supported: boolean;
    onChange(patch: Patch): void;
    onDelete(): void;
  },
) {
  const { tile, onChange } = props;
  return (
    <Drawer title={tile.label || tile.id} label="Tile settings" onClose={props.onClose}>
      {!props.supported && (
        <p className="warn">This display's firmware cannot show {tile.type} tiles yet.</p>
      )}
      <DataItemFields
        item={tile}
        paths={props.paths}
        values={props.values}
        showFormat={tile.type !== 'switch'}
        preferBoolean={tile.type === 'switch'}
        onChange={onChange}
      />
      {(tile.type === 'gauge' || tile.type === 'bar') && (
        <RangeFields tile={tile} onChange={onChange} />
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete tile
      </button>
    </Drawer>
  );
}

export const SLOT_TITLES: Record<SlotName, string> = {
  center1: 'Centre, top',
  center2: 'Centre, middle',
  center3: 'Centre, bottom',
};

export function SlotDrawer(
  props: Common & {
    slot: SlotName;
    item: DataItem | undefined;
    onChange(patch: Patch | null): void;
  },
) {
  return (
    <Drawer
      title={`${SLOT_TITLES[props.slot]}${props.item?.label ? `: ${props.item.label}` : ''}`}
      label="Slot settings"
      onClose={props.onClose}
    >
      <DataItemFields
        item={props.item ?? { path: '' }}
        paths={props.paths}
        values={props.values}
        showFormat
        onChange={props.onChange}
      />
      {props.item && (
        <button className="danger" onClick={() => props.onChange(null)}>
          Empty this slot
        </button>
      )}
    </Drawer>
  );
}

const ROSE_PATHS: { key: 'apparentAngle' | 'trueDirection' | 'heading'; label: string }[] = [
  { key: 'apparentAngle', label: 'Apparent wind angle' },
  { key: 'trueDirection', label: 'True wind direction' },
  { key: 'heading', label: 'Heading' },
];

export function RoseDrawer(
  props: Common & { page: WindRosePage; onChange(patch: Patch): void },
) {
  const config = props.page.config ?? {};
  const showTrue = config.showTrueWind ?? WIND_ROSE_DEFAULTS.showTrueWind;
  return (
    <Drawer title={props.page.title ?? props.page.id} label="Wind rose settings" onClose={props.onClose}>
      <p className="hint">Tap a centre slot on the rose to choose what it shows.</p>
      {ROSE_PATHS.map(({ key, label }) => (
        <div key={key}>
          <PathPicker
            path={config[key] ?? ''}
            paths={props.paths}
            values={props.values}
            label={label}
            placeholder={`default: ${WIND_ROSE_DEFAULTS[key]}`}
            onPick={(path) => props.onChange({ [key]: path || undefined })}
          />
          {config[key] && (
            <button className="link" onClick={() => props.onChange({ [key]: undefined })}>
              use the default ({WIND_ROSE_DEFAULTS[key]})
            </button>
          )}
        </div>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={showTrue}
          onChange={(e) => props.onChange({ showTrueWind: e.target.checked })}
        />
        Show the true wind pointer
      </label>
    </Drawer>
  );
}
