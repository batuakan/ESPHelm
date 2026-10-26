// Tile settings drawer. A DataItem (a tile or a wind-rose slot) gets: SignalK path (searchable,
// with live value and SI units), display unit (only units that fit the path's quantity),
// decimals, label, stale timeout. Gauges and bars add range, zones and orientation; wind roses
// have three slots, their source paths and the true-wind toggle.
import { useMemo, useState, type ReactNode } from 'react';
import {
  AUTOPILOT_DEFAULTS,
  CHART_DEFAULTS,
  LABEL_PATTERN,
  POSITION_DEFAULT_DECIMALS,
  POSITION_DEFAULTS,
  POSITION_FORMAT_NAMES,
  POSITION_FORMATS,
  formatPosition,
  UNIT_IDS,
  UNITS,
  WIND_ROSE_DEFAULTS,
  quantityForSignalKUnits,
  unitsForSignalKUnits,
  type AutopilotMode,
  type AutopilotTile,
  type ChartPage,
  type DataItem,
  type PositionFormat,
  type PositionTile,
  type Tile,
  type UnitId,
  type WindRoseTile,
  type Zone,
} from '@esphelm/schema';
import type { ChartInfo, PathInfo } from '../api';
import { preferredUnit } from '../format';
import { WIND_ROSE_SLOTS, type SlotName } from '../layoutOps';

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

/** A latitude/longitude object, as navigation.position has. */
const isPosition = (v: unknown) =>
  typeof v === 'object' && v !== null && 'latitude' in v && 'longitude' in v;

/**
 * Searchable SignalK path field. `prefer` lists matching paths first: on/off values (switches)
 * or positions (position tiles).
 */
export function PathPicker(props: {
  path: string;
  paths: PathInfo[];
  values: Map<string, unknown>;
  label?: string;
  placeholder?: string;
  prefer?: 'boolean' | 'position';
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
    const preferred =
      props.prefer === 'boolean'
        ? (v: unknown) => typeof v === 'boolean'
        : props.prefer === 'position'
          ? isPosition
          : undefined;
    if (preferred) found.sort((a, b) => Number(preferred(b.value)) - Number(preferred(a.value)));
    return found.slice(0, 40);
  }, [paths, query, props.prefer]);

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
  prefer?: 'boolean';
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
        prefer={props.prefer}
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
      <LabelField label={label} placeholder="e.g. SOG" onChange={onChange} />
      {props.showFormat && <StaleField staleAfter={item.staleAfter} onChange={onChange} />}
    </>
  );
}

function LabelField(props: { label: string; placeholder: string; onChange(patch: Patch): void }) {
  const { label } = props;
  return (
    <label className="field">
      <span>Label</span>
      <input
        value={label}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange({ label: e.target.value || undefined })}
        aria-label="Label"
        aria-invalid={!LABEL_RE.test(label)}
      />
      {!LABEL_RE.test(label) && (
        <small className="error">Only letters A-Z, digits, punctuation and ° can be shown.</small>
      )}
    </label>
  );
}

function StaleField(props: { staleAfter: number | undefined; onChange(patch: Patch): void }) {
  return (
    <label className="field">
      <span>Stale after (s)</span>
      <input
        type="number"
        min={1}
        placeholder="15"
        value={props.staleAfter !== undefined ? String(props.staleAfter) : ''}
        onChange={(e) => props.onChange({ staleAfter: numberOrUndefined(e.target.value) })}
        aria-label="Stale after seconds"
      />
    </label>
  );
}

/** Shown in the format choices until the path has a value. */
const SAMPLE_POSITION = { latitude: 60.15, longitude: 24.95 };

/** Path, text format (each with an example from the live value), decimals, label, stale time. */
function PositionFields(props: Common & { tile: PositionTile; onChange(patch: Patch): void }) {
  const { tile, onChange } = props;
  const path = tile.path ?? POSITION_DEFAULTS.path;
  const format: PositionFormat = tile.format ?? POSITION_DEFAULTS.format;
  const live = props.values.get(path);
  const example = (f: PositionFormat) => {
    const decimals = f === format ? tile.decimals : undefined;
    return formatPosition(live, f, decimals) ?? formatPosition(SAMPLE_POSITION, f, decimals)!;
  };
  return (
    <>
      <PathPicker
        path={path}
        paths={props.paths}
        values={props.values}
        prefer="position"
        onPick={(p) => onChange({ path: p && p !== POSITION_DEFAULTS.path ? p : undefined })}
      />
      <fieldset className="settings-group" role="radiogroup" aria-label="Format">
        <legend>Format</legend>
        {POSITION_FORMATS.map((f) => {
          const ex = example(f);
          return (
            <label key={f} className="check format-choice">
              <input
                type="radio"
                name={`format-${tile.id}`}
                checked={format === f}
                onChange={() =>
                  onChange({
                    format: f === POSITION_DEFAULTS.format ? undefined : f,
                    // decimals belong to a format: the new one starts at its default
                    decimals: undefined,
                  })
                }
                aria-label={POSITION_FORMAT_NAMES[f]}
              />
              <span>
                {POSITION_FORMAT_NAMES[f]}
                <small className="format-example">
                  {ex.lat}
                  {'  '}
                  {ex.lon}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="field">
        <span>Decimals</span>
        <input
          type="number"
          min={0}
          max={6}
          placeholder={String(POSITION_DEFAULT_DECIMALS[format])}
          value={tile.decimals !== undefined ? String(tile.decimals) : ''}
          onChange={(e) => onChange({ decimals: numberOrUndefined(e.target.value) })}
          aria-label="Decimals"
        />
        <small className="hint">
          Of the {format === 'ddm' ? 'minutes' : format === 'dms' ? 'seconds' : 'degrees'}.
        </small>
      </label>
      <LabelField label={tile.label ?? ''} placeholder="e.g. Position" onChange={onChange} />
      <StaleField staleAfter={tile.staleAfter} onChange={onChange} />
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

export function Drawer(props: { title: string; label: string; onClose(): void; children: ReactNode }) {
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

export const SLOT_TITLES: Record<SlotName, string> = {
  center1: 'Centre, top',
  center2: 'Centre, middle',
  center3: 'Centre, bottom',
  topLeft: 'Top left corner',
  topRight: 'Top right corner',
  bottomLeft: 'Bottom left corner',
  bottomRight: 'Bottom right corner',
};

const ROSE_PATHS: { key: 'apparentAngle' | 'trueDirection' | 'heading'; label: string }[] = [
  { key: 'apparentAngle', label: 'Apparent wind angle' },
  { key: 'trueDirection', label: 'True wind direction' },
  { key: 'heading', label: 'Heading' },
];

/** Wind rose tile: source paths, true-wind pointer, and the three centre slots. */
function RoseFields(
  props: Common & {
    tile: WindRoseTile;
    openSlot: SlotName | undefined;
    onConfig(patch: Patch): void;
    onSlot(slot: SlotName, patch: Patch | null): void;
  },
) {
  const { tile } = props;
  const config = tile.config ?? {};
  const showTrue = config.showTrueWind ?? WIND_ROSE_DEFAULTS.showTrueWind;
  return (
    <>
      {WIND_ROSE_SLOTS.map((slot) => {
        const item = tile.slots[slot];
        return (
          <details
            key={slot}
            className="slot-section"
            open={slot === props.openSlot}
            data-testid={`slot-section-${slot}`}
          >
            <summary>
              {SLOT_TITLES[slot]}
              <span className="now">{item ? item.label || item.path || 'no path yet' : 'empty'}</span>
            </summary>
            <DataItemFields
              item={item ?? { path: '' }}
              paths={props.paths}
              values={props.values}
              showFormat
              onChange={(patch) => props.onSlot(slot, patch)}
            />
            {item && (
              <button className="small" onClick={() => props.onSlot(slot, null)}>
                Empty this slot
              </button>
            )}
          </details>
        );
      })}
      <details className="slot-section">
        <summary>Wind and heading sources</summary>
        {ROSE_PATHS.map(({ key, label }) => (
          <div key={key}>
            <PathPicker
              path={config[key] ?? ''}
              paths={props.paths}
              values={props.values}
              label={label}
              placeholder={`default: ${WIND_ROSE_DEFAULTS[key]}`}
              onPick={(path) => props.onConfig({ [key]: path || undefined })}
            />
            {config[key] && (
              <button className="link" onClick={() => props.onConfig({ [key]: undefined })}>
                use the default ({WIND_ROSE_DEFAULTS[key]})
              </button>
            )}
          </div>
        ))}
      </details>
      <label className="check">
        <input
          type="checkbox"
          checked={showTrue}
          onChange={(e) => props.onConfig({ showTrueWind: e.target.checked })}
        />
        Show the true wind pointer
      </label>
    </>
  );
}

const AUTOPILOT_PATHS: { key: 'statePath' | 'targetPath' | 'adjustPath' | 'headingPath'; label: string }[] = [
  { key: 'statePath', label: 'State (auto, wind, route, standby)' },
  { key: 'targetPath', label: 'Target course' },
  { key: 'adjustPath', label: 'Course adjustment (PUT, degrees)' },
  { key: 'headingPath', label: 'Heading' },
];
const MODE_TITLES: Record<AutopilotMode, string> = { auto: 'AUTO', wind: 'WIND', route: 'TRACK' };

/** Autopilot tile: which modes it offers, its caption, and the SignalK paths it uses. */
function AutopilotFields(
  props: Common & { tile: AutopilotTile; onChange(patch: Patch): void; onConfig(patch: Patch): void },
) {
  const { tile } = props;
  const modes = tile.modes ?? AUTOPILOT_DEFAULTS.modes;
  const config = tile.config ?? {};
  const label = tile.label ?? '';
  const toggle = (m: AutopilotMode, on: boolean) => {
    // Keep the canonical order; the default (all three) is stored as "no modes field".
    const next = (['auto', 'wind', 'route'] as AutopilotMode[]).filter((x) => (x === m ? on : modes.includes(x)));
    props.onChange({ modes: next.length === 3 ? undefined : next });
  };
  return (
    <>
      <fieldset className="modes">
        <legend>Modes it can engage</legend>
        {(['auto', 'wind', 'route'] as AutopilotMode[]).map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={modes.includes(m)} onChange={(e) => toggle(m, e.target.checked)} />
            {MODE_TITLES[m]}
          </label>
        ))}
        <small className="hint">STANDBY is always there. Engaging needs a second, confirming tap on the display.</small>
      </fieldset>
      <label className="field">
        <span>Label</span>
        <input
          value={label}
          placeholder="e.g. Pilot"
          onChange={(e) => props.onChange({ label: e.target.value || undefined })}
          aria-label="Label"
          aria-invalid={!LABEL_RE.test(label)}
        />
        {!LABEL_RE.test(label) && (
          <small className="error">Only letters A-Z, digits, punctuation and ° can be shown.</small>
        )}
      </label>
      <details className="slot-section">
        <summary>Autopilot paths</summary>
        {AUTOPILOT_PATHS.map(({ key, label: title }) => (
          <div key={key}>
            <PathPicker
              path={config[key] ?? ''}
              paths={props.paths}
              values={props.values}
              label={title}
              placeholder={`default: ${AUTOPILOT_DEFAULTS[key]}`}
              onPick={(path) => props.onConfig({ [key]: path || undefined })}
            />
            {config[key] && (
              <button className="link" onClick={() => props.onConfig({ [key]: undefined })}>
                use the default ({AUTOPILOT_DEFAULTS[key]})
              </button>
            )}
          </div>
        ))}
      </details>
    </>
  );
}

const CHART_PATHS: { key: keyof Omit<typeof CHART_DEFAULTS, 'zoom' | 'anchor'>; label: string; anchor?: boolean }[] =
  [
    { key: 'positionPath', label: 'Position' },
    { key: 'headingPath', label: 'Heading' },
    { key: 'anchorPositionPath', label: 'Anchor position', anchor: true },
    { key: 'anchorRadiusPath', label: 'Anchor alarm radius (m)', anchor: true },
    { key: 'anchorAlarmPath', label: 'Anchor alarm notification', anchor: true },
  ];

/** Chart page settings: which chart, zoom, anchor watch, and the paths it follows. */
export function ChartDrawer(
  props: Common & {
    page: ChartPage;
    charts: ChartInfo[];
    supported: boolean;
    onChange(patch: { chart?: string; zoom?: number; anchor?: boolean; config?: Patch }): void;
  },
) {
  const { page, charts } = props;
  const config = page.config ?? {};
  const anchor = page.anchor ?? CHART_DEFAULTS.anchor;
  const known = charts.some((c) => c.identifier === page.chart);
  return (
    <Drawer title={page.title ?? page.id} label="Chart settings" onClose={props.onClose}>
      {!props.supported && <p className="warn">This display can't show charts (it needs PSRAM).</p>}
      <label className="field">
        <span>Chart</span>
        <select
          value={page.chart}
          onChange={(e) => props.onChange({ chart: e.target.value })}
          aria-label="Chart"
        >
          <option value="" disabled>
            {charts.length === 0 ? 'No charts on this SignalK server' : 'Choose a chart'}
          </option>
          {!known && page.chart && <option value={page.chart}>{page.chart} (not on this server)</option>}
          {charts.map((c) => (
            <option key={c.identifier} value={c.identifier} disabled={!c.supported}>
              {c.name}
              {c.supported ? '' : ` (${c.reason ?? `${c.format || 'unknown'} tiles`}, not supported)`}
            </option>
          ))}
        </select>
        {charts.length === 0 && (
          <small className="hint">Install a SignalK charts plugin with raster (PNG/JPEG) charts.</small>
        )}
      </label>
      <label className="field">
        <span>Zoom (1 to 20)</span>
        <input
          type="number"
          min={1}
          max={20}
          placeholder={String(CHART_DEFAULTS.zoom)}
          value={page.zoom !== undefined ? String(page.zoom) : ''}
          onChange={(e) => props.onChange({ zoom: e.target.value === '' ? undefined : Number(e.target.value) })}
          aria-label="Zoom"
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={anchor} onChange={(e) => props.onChange({ anchor: e.target.checked })} />
        Anchor watch (anchor position, alarm radius, alarm)
      </label>
      <details className="slot-section">
        <summary>SignalK paths</summary>
        {CHART_PATHS.filter((p) => anchor || !p.anchor).map(({ key, label }) => (
          <div key={key}>
            <PathPicker
              path={config[key] ?? ''}
              paths={props.paths}
              values={props.values}
              label={label}
              placeholder={`default: ${CHART_DEFAULTS[key]}`}
              onPick={(path) => props.onChange({ config: { [key]: path || undefined } })}
            />
            {config[key] && (
              <button className="link" onClick={() => props.onChange({ config: { [key]: undefined } })}>
                use the default ({CHART_DEFAULTS[key]})
              </button>
            )}
          </div>
        ))}
      </details>
    </Drawer>
  );
}

export function TileDrawer(
  props: Common & {
    tile: Tile;
    supported: boolean;
    /** Wind rose only: how the display will draw it at this size. */
    sizeHint?: string;
    openSlot?: SlotName;
    onChange(patch: Patch): void;
    onConfig(patch: Patch): void;
    onSlot(slot: SlotName, patch: Patch | null): void;
    onDelete(): void;
  },
) {
  const { tile, onChange } = props;
  const title =
    tile.type === 'wind_rose'
      ? 'Wind rose'
      : tile.type === 'autopilot'
        ? 'Autopilot'
        : tile.label || (tile.type === 'position' ? 'Position' : tile.id);
  return (
    <Drawer title={title} label="Tile settings" onClose={props.onClose}>
      {!props.supported && (
        <p className="warn">This display's firmware cannot show {tile.type} tiles yet.</p>
      )}
      {tile.type === 'autopilot' ? (
        <>
          {props.sizeHint && <p className="hint size-hint">{props.sizeHint}</p>}
          <AutopilotFields
            tile={tile}
            paths={props.paths}
            values={props.values}
            onChange={onChange}
            onConfig={props.onConfig}
            onClose={props.onClose}
          />
        </>
      ) : tile.type === 'position' ? (
        <PositionFields
          tile={tile}
          paths={props.paths}
          values={props.values}
          onChange={onChange}
          onClose={props.onClose}
        />
      ) : tile.type === 'wind_rose' ? (
        <>
          {props.sizeHint && <p className="hint size-hint">{props.sizeHint}</p>}
          <RoseFields
            tile={tile}
            paths={props.paths}
            values={props.values}
            openSlot={props.openSlot}
            onConfig={props.onConfig}
            onSlot={props.onSlot}
            onClose={props.onClose}
          />
        </>
      ) : (
        <>
          <DataItemFields
            item={tile}
            paths={props.paths}
            values={props.values}
            showFormat={tile.type !== 'switch'}
            prefer={tile.type === 'switch' ? 'boolean' : undefined}
            onChange={onChange}
          />
          {(tile.type === 'gauge' || tile.type === 'bar') && (
            <RangeFields tile={tile} onChange={onChange} />
          )}
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete tile
      </button>
    </Drawer>
  );
}
