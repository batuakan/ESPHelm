// Tile settings drawer. A DataItem (a tile or a wind-rose slot) gets: SignalK path (searchable,
// with live value and SI units), display unit (only units that fit the path's quantity),
// decimals, label, stale timeout. Gauges and bars add range, zones, centre zero (ADR-0023) and orientation; wind roses
// have their slots, source paths and the true-wind toggle. Value tiles and wind rose values can
// record their history (ADR-0018, ADR-0019), with a count of what the layout records. Graph
// tiles (ADR-0021) add their window, an optional fixed range and zones; they always record. Heading
// tapes (ADR-0022) have their span, markers and paths.
import { useMemo, useState, type ReactNode } from 'react';
import {
  CLOCK_DATE_FORMATS,
  CLOCK_DEFAULTS,
  clockDate,
  clockTime,
  type ClockDateFormat,
  type ClockShow,
  type ClockTile,
  AUTOPILOT_DEFAULTS,
  CHART_DEFAULTS,
  LABEL_PATTERN,
  POSITION_DEFAULT_DECIMALS,
  POSITION_DEFAULTS,
  POSITION_FORMAT_NAMES,
  POSITION_FORMATS,
  formatPosition,
  GRAPH_WINDOWS,
  HEADING_TAPE_DEFAULTS,
  HEADING_TAPE_MARKERS,
  HISTORY,
  historyEnabled,
  roseHistorySeries,
  serverZonesToDisplay,
  UNIT_IDS,
  UNITS,
  WIND_ROSE_DEFAULTS,
  WIND_ROSE_TACK,
  quantityForSignalKUnits,
  unitsForSignalKUnits,
  type AutopilotMode,
  type AutopilotTile,
  type ChartTile,
  type DataItem,
  type BarTile,
  type EngineSlotName,
  type EngineCornerName,
  type EngineTile,
  type GaugeTile,
  ENGINE_FIT,
  ENGINE_ICON_NAMES,
  type GraphTile,
  type GraphWindow,
  type HeadingTapeMarker,
  type HeadingTapeTile,
  type Layout,
  type PositionFormat,
  type PositionTile,
  type RoseHistoryKey,
  type Tile,
  type UnitId,
  type ValueColor,
  type ValueTile,
  type ValueZone,
  VALUE_COLORS,
  type WindRoseTile,
  type Zone,
} from '@esphelm/schema';
import type { ChartInfo, PathInfo } from '../api';
import { preferredUnit } from '../format';
import { ENGINE_CORNERS, ENGINE_SLOTS, headingTapeSettings, WIND_ROSE_SLOTS, type SlotName } from '../layoutOps';
import { HistoryPreview, type PreviewSeries } from './HistoryPreview';
import { withServerZones } from './Previews';

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

/**
 * Zone rows (from, to, state). With `openEnds` (value tiles) a blank bound means no limit;
 * otherwise both bounds are numbers (gauge and bar zones lie within min..max).
 */
function ZoneList(props: {
  zones: ValueZone[];
  openEnds?: boolean;
  onChange(next: ValueZone[]): void;
  newZone(): ValueZone;
}) {
  const { zones, openEnds, onChange } = props;
  const setZone = (i: number, patch: Partial<ValueZone>) =>
    onChange(
      zones.map((z, k) => {
        if (k !== i) return z;
        const next: ValueZone = { ...z, ...patch };
        // Drop a cleared bound instead of keeping `undefined` in the layout.
        if (next.from === undefined) delete next.from;
        if (next.to === undefined) delete next.to;
        return next;
      }),
    );
  const bound = (v: string) => (openEnds && v.trim() === '' ? undefined : Number(v));
  return (
    <>
      {zones.map((z, i) => (
        <div className="zone-row" key={i}>
          <input
            type="number"
            value={z.from === undefined ? '' : String(z.from)}
            placeholder={openEnds ? 'no limit' : undefined}
            onChange={(e) => setZone(i, { from: bound(e.target.value) })}
            aria-label={`Zone ${i + 1} from`}
          />
          <input
            type="number"
            value={z.to === undefined ? '' : String(z.to)}
            placeholder={openEnds ? 'no limit' : undefined}
            onChange={(e) => setZone(i, { to: bound(e.target.value) })}
            aria-label={`Zone ${i + 1} to`}
          />
          <select
            value={z.state}
            onChange={(e) => setZone(i, { state: e.target.value as Zone['state'] })}
            aria-label={`Zone ${i + 1} state`}
            className={`zone-${z.state}`}
          >
            {ZONE_STATES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <button
            className="icon"
            onClick={() => onChange(zones.filter((_, k) => k !== i))}
            aria-label={`Remove zone ${i + 1}`}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="small" onClick={() => onChange([...zones, props.newZone()])}>
        Add zone
      </button>
    </>
  );
}

/** Day colours of the value colour names, for the swatch (the display's own, ADR-0016). */
const COLOR_SWATCH: Record<ValueColor, string> = {
  blue: '#0a6cd6',
  green: '#1d8a4f',
  yellow: '#a68a00',
  orange: '#d96c00',
  red: '#d32f2f',
  purple: '#8e24aa',
};

/** How many values the layout records, against both kinds of display (historyCount()). */
export interface HistoryCount {
  count: number;
  fitsPsram: boolean;
  fitsNoPsram: boolean;
}

/** What the layout's history costs: a warning once a kind of display can't record it all. */
function HistoryCounter(props: { count: HistoryCount }) {
  const { count, fitsPsram, fitsNoPsram } = props.count;
  const what = `Recording ${count} ${count === 1 ? 'value' : 'values'} in this layout`;
  const text = !fitsPsram
    ? `${what}: too many for any display (${HISTORY.maxValuesPsram} with PSRAM, ${HISTORY.maxValuesNoPsram} on C3/C6). The rest won't record.`
    : !fitsNoPsram
      ? `${what}: fits displays with PSRAM (${HISTORY.maxValuesPsram}), too many for C3/C6 (${HISTORY.maxValuesNoPsram}).`
      : `${what}: fits every display (${HISTORY.maxValuesNoPsram} on C3/C6, ${HISTORY.maxValuesPsram} with PSRAM).`;
  return (
    <p className={fitsNoPsram ? 'hint history-count' : 'warn history-count'} role="status">
      {text}
    </p>
  );
}

/** "Preview graph" and the mock popup it opens. */
function HistoryPreviewButton(props: { series: PreviewSeries[]; theme: Layout['theme'] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="small" disabled={props.series.length === 0} onClick={() => setOpen(true)}>
        Preview graph
      </button>
      {open && (
        <HistoryPreview
          series={props.series}
          theme={props.theme}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Whether the value tile records, so a tap opens its graph on the display (ADR-0018). */
function ValueHistoryField(props: {
  tile: ValueTile;
  value: unknown;
  theme: Layout['theme'];
  count: HistoryCount;
  serverZones: Map<string, unknown>;
  onChange(p: Patch): void;
}) {
  const { tile } = props;
  const on = historyEnabled(tile);
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => props.onChange({ history: e.target.checked ? true : undefined })}
          aria-label="Tap for history"
        />
        Tap for history: record a graph of the last 10 min, 1 h or 6 h
      </label>
      <HistoryCounter count={props.count} />
      <HistoryPreviewButton
        theme={props.theme}
        series={
          on
            ? [
                {
                  key: tile.id,
                  title: tile.label || tile.path,
                  caption: tile.label || tile.path,
                  unit: tile.unit,
                  decimals: tile.decimals,
                  zones: withServerZones(tile, props.serverZones).zones,
                  value: props.value,
                },
              ]
            : []
        }
      />
    </>
  );
}

/** The zones the display takes from the server for this tile (ADR-0020); nothing if none. */
function ServerZones(props: { zones: ValueZone[]; unit?: string }) {
  if (props.zones.length === 0) return null;
  const bound = (v: number | undefined) => (v === undefined ? 'no limit' : String(Math.round(v * 100) / 100));
  return (
    <div className="server-zones" role="group" aria-label="Zones from the SignalK server">
      <small className="hint">From the SignalK server, these replace the zones below:</small>
      <ul>
        {props.zones.map((z, i) => (
          <li key={i}>
            {bound(z.from)} to {bound(z.to)} {props.unit ?? ''}: {z.state}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A value tile's fixed colour and its colour-by-value zones (display units). */
function ValueColorFields(props: { tile: ValueTile; serverZones: unknown; onChange(p: Patch): void }) {
  const { tile, onChange } = props;
  const zones = tile.zones ?? [];
  return (
    <>
      <label className="field">
        <span>Colour</span>
        <span className="field-row color-field">
          <select
            value={tile.color ?? ''}
            onChange={(e) => onChange({ color: e.target.value === '' ? undefined : e.target.value })}
            aria-label="Colour"
          >
            <option value="">theme default</option>
            {VALUE_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span
            className="color-swatch"
            style={{ background: tile.color ? COLOR_SWATCH[tile.color] : 'transparent' }}
            aria-hidden
          />
        </span>
        <small className="hint">At night every colour shows in the night red.</small>
      </label>
      <fieldset className="zones">
        <legend>Colour by value</legend>
        <small className="hint">
          In {tile.unit ?? 'the value as received'}; leave a bound empty for no limit. The last
          matching row wins, over the colour above.
        </small>
        <ServerZones zones={serverZonesToDisplay(props.serverZones, tile.unit)} unit={tile.unit} />
        <ZoneList
          zones={zones}
          openEnds
          onChange={(next) => onChange({ zones: next.length > 0 ? next : undefined })}
          newZone={() => ({ to: 0, state: 'alarm' })}
        />
      </fieldset>
    </>
  );
}

const GRAPH_WINDOW_TEXT: Record<GraphWindow, string> = {
  '10m': '10 min',
  '1h': '1 h',
  '6h': '6 h (displays with PSRAM; 1 h on C3/C6)',
};

/**
 * A graph's window, its optional fixed y axis and its zones (ADR-0021). It always records, so it
 * counts against the history limits.
 */
function GraphFields(props: {
  tile: GraphTile;
  value: unknown;
  theme: Layout['theme'];
  count: HistoryCount;
  serverZones: Map<string, unknown>;
  onChange(p: Patch): void;
}) {
  const { tile, onChange } = props;
  const fixed = tile.min !== undefined || tile.max !== undefined;
  return (
    <>
      <label className="field">
        <span>Window</span>
        <select
          value={tile.window ?? '10m'}
          onChange={(e) => onChange({ window: e.target.value === '10m' ? undefined : e.target.value })}
          aria-label="Window"
        >
          {GRAPH_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {GRAPH_WINDOW_TEXT[w]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={fixed}
          onChange={(e) =>
            onChange(e.target.checked ? { min: 0, max: 10 } : { min: undefined, max: undefined })
          }
          aria-label="Fixed range"
        />
        Fixed range (else it follows the values)
      </label>
      {fixed && (
        <div className="field-row">
          <label className="field">
            <span>Min</span>
            <input
              type="number"
              value={tile.min === undefined ? '' : String(tile.min)}
              onChange={(e) => onChange({ min: numberOrUndefined(e.target.value) })}
              aria-label="Minimum"
            />
          </label>
          <label className="field">
            <span>Max</span>
            <input
              type="number"
              value={tile.max === undefined ? '' : String(tile.max)}
              onChange={(e) => onChange({ max: numberOrUndefined(e.target.value) })}
              aria-label="Maximum"
            />
          </label>
        </div>
      )}
      <fieldset className="zones">
        <legend>Zones</legend>
        <small className="hint">
          In {tile.unit ?? 'the value as received'}; shown as bands behind the line, and they colour
          the value. Leave a bound empty for no limit.
        </small>
        <ServerZones
          zones={serverZonesToDisplay(props.serverZones.get(tile.path), tile.unit)}
          unit={tile.unit}
        />
        <ZoneList
          zones={tile.zones ?? []}
          openEnds
          onChange={(next) => onChange({ zones: next.length > 0 ? next : undefined })}
          newZone={() => ({ to: 0, state: 'alarm' })}
        />
      </fieldset>
      <p className="hint">The display records this value from the moment it starts.</p>
      <HistoryCounter count={props.count} />
      <HistoryPreviewButton
        theme={props.theme}
        series={[
          {
            key: tile.id,
            title: tile.label || tile.path,
            caption: tile.label || tile.path,
            unit: tile.unit,
            decimals: tile.decimals,
            zones: withServerZones(tile, props.serverZones).zones,
            value: props.value,
          },
        ]}
      />
    </>
  );
}

/**
 * A scale's min/max and zones, in display units: gauges, bars, an engine's RPM and its slots.
 * `serverZones` (the path's zones from SignalK metadata, ADR-0020) are shown when given.
 */
function ScaleFields(props: {
  scale: { min: number; max: number; zones?: Zone[]; unit?: UnitId };
  serverZones?: unknown;
  onChange(p: Patch): void;
}) {
  const { scale, onChange } = props;
  const setZones = (next: Zone[]) => onChange({ zones: next.length > 0 ? next : undefined });
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Min</span>
          <input
            type="number"
            value={String(scale.min)}
            onChange={(e) => onChange({ min: Number(e.target.value) })}
            aria-label="Minimum"
          />
        </label>
        <label className="field">
          <span>Max</span>
          <input
            type="number"
            value={String(scale.max)}
            onChange={(e) => onChange({ max: Number(e.target.value) })}
            aria-label="Maximum"
          />
        </label>
      </div>
      <fieldset className="zones">
        <legend>Zones</legend>
        {props.serverZones !== undefined && (
          <ServerZones
            zones={serverZonesToDisplay(props.serverZones, scale.unit, { min: scale.min, max: scale.max })}
            unit={scale.unit}
          />
        )}
        <ZoneList
          zones={scale.zones ?? []}
          onChange={(next) => setZones(next as Zone[])}
          newZone={() => ({ from: scale.max - (scale.max - scale.min) / 5, to: scale.max, state: 'alarm' })}
        />
      </fieldset>
    </>
  );
}

/** Min/max, zones and (bars) orientation, in display units. */
function RangeFields(props: {
  tile: GaugeTile | BarTile;
  serverZones: unknown;
  onChange(p: Patch): void;
}) {
  const { tile, onChange } = props;
  return (
    <>
      <ScaleFields scale={tile} serverZones={props.serverZones} onChange={onChange} />
      <label className="check">
        <input
          type="checkbox"
          checked={tile.centerZero === true}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    centerZero: true,
                    // A centre-zero scale crosses zero; an angle needs -180..180 to go negative.
                    ...(tile.min >= 0 ? { min: -Math.abs(tile.max) } : {}),
                    ...(tile.unit === 'deg' ? { unit: 'deg180' } : {}),
                  }
                : { centerZero: undefined, sides: undefined },
            )
          }
          aria-label="Centre zero"
        />
        Centre zero: fill from zero, for values either side of it (rudder, heel, current)
      </label>
      {tile.centerZero && (
        <label className="field">
          <span>Sides</span>
          <select
            value={tile.sides ?? 'portStarboard'}
            onChange={(e) =>
              onChange({ sides: e.target.value === 'portStarboard' ? undefined : e.target.value })
            }
            aria-label="Sides"
          >
            <option value="portStarboard">Port / starboard (P and S, red and green)</option>
            <option value="plusMinus">Plus / minus (signed)</option>
          </select>
          <small className="hint">
            The scale is drawn symmetric around zero, out to the larger of min and max.
          </small>
        </label>
      )}
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

export const SLOT_TITLES: Record<SlotName | EngineSlotName, string> = {
  left: 'Left gauge',
  right: 'Right gauge',
  bottom: 'Bottom gauge',
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

type RosePerformancePath = 'beatAngle' | 'gybeAngle' | 'waypointBearing' | 'targetAngle';

/** The rose's performance graphics (ADR-0029), each with the paths it reads. */
const ROSE_PERFORMANCE: {
  key: 'showLaylines' | 'showWaypoint' | 'showTarget';
  name: string;
  shape: string;
  paths: { key: RosePerformancePath; label: string }[];
}[] = [
  {
    key: 'showLaylines',
    name: 'Laylines',
    shape: 'green and red lines',
    paths: [
      { key: 'beatAngle', label: 'Beat angle' },
      { key: 'gybeAngle', label: 'Gybe angle' },
    ],
  },
  {
    key: 'showWaypoint',
    name: 'Waypoint',
    shape: 'W marker',
    paths: [{ key: 'waypointBearing', label: 'Bearing to the waypoint' }],
  },
  {
    key: 'showTarget',
    name: 'Target angle',
    shape: 'bar on the ring',
    paths: [{ key: 'targetAngle', label: 'Target true wind angle' }],
  },
];

/** A "record history" checkbox for one wind rose value. */
function RoseHistoryCheck(props: {
  tile: WindRoseTile;
  name: RoseHistoryKey;
  title: string;
  /** Visible text; the slot sections say what the checkbox does instead. */
  text?: string;
  onHistory(name: RoseHistoryKey, on: boolean): void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={(props.tile.history ?? []).includes(props.name)}
        onChange={(e) => props.onHistory(props.name, e.target.checked)}
        aria-label={`History of ${props.title}`}
      />
      {props.text ?? 'Record history (tap the rose for a graph)'}
    </label>
  );
}

/** Wind rose tile: its slots, source paths, true-wind pointer, and which values record. */
function RoseFields(
  props: Common & {
    tile: WindRoseTile;
    openSlot: SlotName | undefined;
    theme: Layout['theme'];
    count: HistoryCount;
    onConfig(patch: Patch): void;
    onSlot(slot: SlotName, patch: Patch | null): void;
    onHistory(name: RoseHistoryKey, on: boolean): void;
  },
) {
  const { tile } = props;
  const config = tile.config ?? {};
  const showTrue = config.showTrueWind ?? WIND_ROSE_DEFAULTS.showTrueWind;
  const recorded: PreviewSeries[] = roseHistorySeries(tile).map((s) => {
    const item = s.name ? tile.slots[s.name as SlotName] : undefined;
    return {
      key: s.key,
      title: s.title,
      caption: s.title,
      unit: s.unit,
      decimals: item ? item.decimals : 0,
      value: props.values.get(s.path),
    };
  });
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
              <RoseHistoryCheck
                tile={tile}
                name={slot}
                title={SLOT_TITLES[slot]}
                onHistory={props.onHistory}
              />
            )}
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
      <fieldset className="modes" data-testid="rose-performance">
        <legend>Performance</legend>
        {ROSE_PERFORMANCE.map(({ key, name, shape }) => (
          <div key={key}>
            <label className="check">
              <input
                type="checkbox"
                checked={config[key] ?? WIND_ROSE_DEFAULTS[key]}
                onChange={(e) => props.onConfig({ [key]: e.target.checked || undefined })}
                aria-label={name}
              />
              {name} ({shape})
            </label>
            {config[key] && key === 'showLaylines' && (
              <>
                <label className="field">
                  <span>Beat angle when SignalK has none (degrees)</span>
                  <input
                    type="number"
                    min={WIND_ROSE_TACK.beat.min}
                    max={WIND_ROSE_TACK.beat.max}
                    placeholder={String(WIND_ROSE_DEFAULTS.fixedBeat)}
                    value={config.fixedBeat !== undefined ? String(config.fixedBeat) : ''}
                    onChange={(e) => props.onConfig({ fixedBeat: numberOrUndefined(e.target.value) })}
                    aria-label="Fixed beat angle"
                  />
                </label>
                <label className="field">
                  <span>Gybe angle when SignalK has none (degrees)</span>
                  <input
                    type="number"
                    min={WIND_ROSE_TACK.gybe.min}
                    max={WIND_ROSE_TACK.gybe.max}
                    placeholder={String(WIND_ROSE_DEFAULTS.fixedGybe)}
                    value={config.fixedGybe !== undefined ? String(config.fixedGybe) : ''}
                    onChange={(e) => props.onConfig({ fixedGybe: numberOrUndefined(e.target.value) })}
                    aria-label="Fixed gybe angle"
                  />
                </label>
              </>
            )}
          </div>
        ))}
        <small className="hint">
          Laylines show the heading on each tack: the beat angle upwind, the gybe angle downwind.
          The angles come from a polar plugin (performance.beatAngle) when one runs. Each graphic
          shows only while its values are fresh.
        </small>
      </fieldset>
      {ROSE_PERFORMANCE.some(({ key }) => config[key]) && (
        <details className="slot-section" data-testid="rose-performance-sources">
          <summary>Performance sources</summary>
          {ROSE_PERFORMANCE.filter(({ key }) => config[key])
            .flatMap(({ paths }) => paths)
            .map((p) => (
              <div key={p.key}>
                <PathPicker
                  path={config[p.key] ?? ''}
                  paths={props.paths}
                  values={props.values}
                  label={p.label}
                  placeholder={`default: ${WIND_ROSE_DEFAULTS[p.key]}`}
                  onPick={(path) => props.onConfig({ [p.key]: path || undefined })}
                />
                {config[p.key] && (
                  <button className="link" onClick={() => props.onConfig({ [p.key]: undefined })}>
                    use the default ({WIND_ROSE_DEFAULTS[p.key]})
                  </button>
                )}
              </div>
            ))}
        </details>
      )}
      {config.showWaypoint &&
        (() => {
          const h = north(config.heading ?? WIND_ROSE_DEFAULTS.heading);
          const b = north(config.waypointBearing ?? WIND_ROSE_DEFAULTS.waypointBearing);
          return h !== undefined && b !== undefined && h !== b ? (
            <p className="warn rose-north">
              The heading is {h}; the waypoint bearing isn't, so the W marker will be off by the
              magnetic variation.
            </p>
          ) : null;
        })()}
      <details className="slot-section" data-testid="rose-history">
        <summary>
          History
          <span className="now">
            {recorded.length === 0 ? 'none' : recorded.map((s) => s.title).join(', ')}
          </span>
        </summary>
        {ROSE_PATHS.map(({ key, label }) => (
          <RoseHistoryCheck
            key={key}
            tile={tile}
            name={key}
            title={label}
            text={label}
            onHistory={props.onHistory}
          />
        ))}
        <p className="hint">
          Tap the rose on the display for their graphs. The slots record from their own sections.
        </p>
      </details>
      <HistoryCounter count={props.count} />
      <HistoryPreviewButton series={recorded} theme={props.theme} />
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

const CLOCK_SHOWS: { key: ClockShow; name: string }[] = [
  { key: 'time', name: 'Time' },
  { key: 'date', name: 'Date' },
  { key: 'both', name: 'Time and date' },
];

/** The examples' instant: Wednesday 4 November 2026, 14:05:09. */
const CLOCK_EXAMPLE = Date.UTC(2026, 10, 4, 14, 5, 9) / 1000;

/** A clock's caption, what it shows and how it writes it (ADR-0024). */
function ClockFields(props: Common & { tile: ClockTile; onChange(patch: Patch): void }) {
  const { tile, onChange } = props;
  const show = tile.show ?? CLOCK_DEFAULTS.show;
  const format = tile.dateFormat ?? CLOCK_DEFAULTS.dateFormat;
  const time = clockTime(CLOCK_EXAMPLE, tile.hour12 ?? false, tile.seconds ?? false);
  return (
    <>
      <LabelField label={tile.label ?? ''} placeholder="e.g. Local time" onChange={onChange} />
      <fieldset className="settings-group" role="radiogroup" aria-label="Shows">
        <legend>Shows</legend>
        {CLOCK_SHOWS.map(({ key, name }) => (
          <label key={key} className="check">
            <input
              type="radio"
              name={`clock-show-${tile.id}`}
              checked={show === key}
              onChange={() => onChange({ show: key === CLOCK_DEFAULTS.show ? undefined : key })}
              aria-label={name}
            />
            {name}
          </label>
        ))}
      </fieldset>
      {show !== 'date' && (
        <fieldset className="settings-group" aria-label="Time">
          <legend>
            Time <small className="format-example">{`${time.text} ${time.suffix}`.trim()}</small>
          </legend>
          <label className="check">
            <input
              type="checkbox"
              checked={tile.hour12 ?? false}
              onChange={(e) => onChange({ hour12: e.target.checked || undefined })}
              aria-label="12-hour clock"
            />
            12-hour clock (AM/PM)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={tile.seconds ?? false}
              onChange={(e) => onChange({ seconds: e.target.checked || undefined })}
              aria-label="Seconds"
            />
            Seconds
          </label>
        </fieldset>
      )}
      {show !== 'time' && (
        <fieldset className="settings-group" role="radiogroup" aria-label="Date format">
          <legend>Date format</legend>
          {CLOCK_DATE_FORMATS.map((f: ClockDateFormat) => (
            <label key={f} className="check">
              <input
                type="radio"
                name={`clock-date-${tile.id}`}
                checked={format === f}
                onChange={() => onChange({ dateFormat: f === CLOCK_DEFAULTS.dateFormat ? undefined : f })}
                aria-label={clockDate(CLOCK_EXAMPLE, f)}
              />
              {clockDate(CLOCK_EXAMPLE, f)}
            </label>
          ))}
        </fieldset>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={tile.utc ?? false}
          onChange={(e) => onChange({ utc: e.target.checked || undefined })}
          aria-label="UTC"
        />
        UTC instead of the layout's time zone
      </label>
      <p className="hint">
        The display sets its clock from SignalK (navigation.datetime, from a GPS) or, if its firmware has one,
        from NTP or HomeAssistant, and keeps time offline. The time zone is in Display settings.
      </p>
    </>
  );
}

const TAPE_MARKERS: {
  key: HeadingTapeMarker;
  name: string;
  shape: string;
  path: 'cogPath' | 'bearingPath' | 'targetPath';
}[] = [
  { key: 'cog', name: 'Course over ground', shape: 'triangle, C', path: 'cogPath' },
  { key: 'bearing', name: 'Bearing to the next waypoint', shape: 'diamond, W', path: 'bearingPath' },
  { key: 'target', name: 'Autopilot target', shape: 'notch, A', path: 'targetPath' },
];

/** True or magnetic, from a path's name; undefined when it doesn't say. */
const north = (path: string) => (/Magnetic/.test(path) ? 'magnetic' : /True/.test(path) ? 'true' : undefined);

/** A heading tape's caption, heading path, span and markers (ADR-0022). */
function HeadingTapeFields(
  props: Common & { tile: HeadingTapeTile; onChange(patch: Patch): void; onConfig(patch: Patch): void },
) {
  const { tile } = props;
  const t = headingTapeSettings(tile);
  const config = tile.config ?? {};
  const toggle = (m: HeadingTapeMarker, on: boolean) => {
    // Keep the canonical order; all three (the default) is stored as "no markers field".
    const next = HEADING_TAPE_MARKERS.filter((x) => (x === m ? on : t.markers.includes(x)));
    props.onChange({ markers: next.length === HEADING_TAPE_MARKERS.length ? undefined : next });
  };
  const headingNorth = north(t.headingPath);
  const mixed = t.markers.filter((m) => {
    const n = north(t.paths[m]);
    return n !== undefined && headingNorth !== undefined && n !== headingNorth;
  });
  return (
    <>
      <LabelField label={tile.label ?? ''} placeholder="e.g. Heading" onChange={props.onChange} />
      <PathPicker
        path={config.headingPath ?? ''}
        paths={props.paths}
        values={props.values}
        label="Heading"
        placeholder={`default: ${HEADING_TAPE_DEFAULTS.headingPath}`}
        onPick={(path) => props.onConfig({ headingPath: path || undefined })}
      />
      <label className="field">
        <span>Span (degrees across the tape)</span>
        <input
          type="number"
          min={30}
          max={180}
          step={10}
          placeholder={String(HEADING_TAPE_DEFAULTS.span)}
          value={tile.span !== undefined ? String(tile.span) : ''}
          onChange={(e) => props.onChange({ span: numberOrUndefined(e.target.value) })}
          aria-label="Span"
        />
      </label>
      <fieldset className="modes">
        <legend>Markers</legend>
        {TAPE_MARKERS.map(({ key, name, shape, path }) => (
          <div key={key}>
            <label className="check">
              <input
                type="checkbox"
                checked={t.markers.includes(key)}
                onChange={(e) => toggle(key, e.target.checked)}
                aria-label={name}
              />
              {name} ({shape})
            </label>
            {t.markers.includes(key) && (
              <PathPicker
                path={config[path] ?? ''}
                paths={props.paths}
                values={props.values}
                label={`${name} path`}
                placeholder={`default: ${HEADING_TAPE_DEFAULTS[path]}`}
                onPick={(p) => props.onConfig({ [path]: p || undefined })}
              />
            )}
          </div>
        ))}
        <small className="hint">A marker shows only while its value is fresh, and as an arrow at the edge when it's off the tape.</small>
      </fieldset>
      {mixed.length > 0 && (
        <p className="warn tape-north">
          The heading is {headingNorth}; the{' '}
          {mixed.map((m) => TAPE_MARKERS.find((x) => x.key === m)?.name.toLowerCase()).join(' and ')} isn't, so
          it will be off by the magnetic variation.
        </p>
      )}
      <StaleField staleAfter={tile.staleAfter} onChange={props.onChange} />
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

/**
 * Chart tile settings (ADR-0030): which chart, zoom, anchor watch, and the paths it follows.
 * Charts on one display share their map tiles, so a second chart of the same chart and zoom
 * costs the display no memory.
 */
export function ChartDrawer(
  props: Common & {
    tile: ChartTile;
    charts: ChartInfo[];
    supported: boolean;
    /** What the display will draw at this size (CHART_FIT). */
    sizeHint: string;
    onChange(patch: { chart?: string; zoom?: number; anchor?: boolean; config?: Patch }): void;
    onDelete(): void;
  },
) {
  const { tile: page, charts } = props;
  const config = page.config ?? {};
  const anchor = page.anchor ?? CHART_DEFAULTS.anchor;
  const known = charts.some((c) => c.identifier === page.chart);
  return (
    <Drawer title="Chart" label="Tile settings" onClose={props.onClose}>
      {!props.supported && <p className="warn">This display can't show charts (it needs PSRAM).</p>}
      <p className="size-hint">{props.sizeHint}</p>
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
      <button className="danger" onClick={props.onDelete}>
        Delete tile
      </button>
    </Drawer>
  );
}

/** The engine tile's slot places, in drawer order (ADR-0032). */
const ENGINE_SLOT_TITLES: Record<EngineSlotName, string> = {
  left: 'Left gauge',
  right: 'Right gauge',
  bottom: 'Bottom gauge',
};

const ENGINE_ICON_TITLES: Record<string, string> = {
  oil: 'Oil can',
  fuel: 'Fuel pump',
  temperature: 'Thermometer',
  battery: 'Battery',
  none: 'None: show the label',
};

/** Engine tile (ADR-0032): the RPM (path, unit, range, zones), its three slot gauges, then its corner values. */
function EngineFields(
  props: Common & {
    tile: EngineTile;
    openSlot: EngineSlotName | EngineCornerName | undefined;
    serverZones: unknown;
    onChange(patch: Patch): void;
    onSlot(slot: EngineSlotName | EngineCornerName, patch: Patch | null): void;
  },
) {
  const { tile } = props;
  return (
    <>
      <details className="slot-section" open={props.openSlot === undefined} data-testid="engine-rpm">
        <summary>
          Revolutions (the large arc)
          <span className="now">{tile.label || tile.path || 'no path yet'}</span>
        </summary>
        <DataItemFields item={tile} paths={props.paths} values={props.values} showFormat onChange={props.onChange} />
        <ScaleFields scale={tile} serverZones={props.serverZones} onChange={props.onChange} />
        <small className="hint">
          Scales from 1000 up are labelled in hundreds ("x100"). Zones colour the band outside the
          ticks; ticks in an alarm zone turn red.
        </small>
      </details>
      {ENGINE_SLOTS.map((slot) => {
        const item = tile.slots[slot];
        return (
          <details
            key={slot}
            className="slot-section"
            open={slot === props.openSlot}
            data-testid={`slot-section-${slot}`}
          >
            <summary>
              {ENGINE_SLOT_TITLES[slot]}
              <span className="now">{item ? item.label || item.path || 'no path yet' : 'empty'}</span>
            </summary>
            {item ? (
              <>
                <DataItemFields
                  item={item}
                  paths={props.paths}
                  values={props.values}
                  showFormat
                  onChange={(patch) => props.onSlot(slot, patch)}
                />
                <ScaleFields scale={item} onChange={(patch) => props.onSlot(slot, patch)} />
                <label className="field">
                  <span>Icon</span>
                  <select
                    value={item.icon ?? 'none'}
                    onChange={(e) => props.onSlot(slot, { icon: e.target.value === 'none' ? undefined : e.target.value })}
                    aria-label={`Icon of the ${ENGINE_SLOT_TITLES[slot].toLowerCase()}`}
                  >
                    {[...ENGINE_ICON_NAMES, 'none'].map((n) => (
                      <option key={n} value={n}>
                        {ENGINE_ICON_TITLES[n]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="small" onClick={() => props.onSlot(slot, null)}>
                  Empty this slot
                </button>
              </>
            ) : (
              <button className="small" onClick={() => props.onSlot(slot, {})}>
                Add a gauge here
              </button>
            )}
          </details>
        );
      })}
      {ENGINE_CORNERS.map((slot) => {
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
      <small className="hint">
        The small gauges show from {ENGINE_FIT.slots} px, the labels from {ENGINE_FIT.labels} px on
        the display. A corner value shows with the small gauges, where it fits outside the large
        arc (a tile wider or taller than square has room). Zones from the SignalK server apply to
        the revolutions only.
      </small>
    </>
  );
}

export function TileDrawer(
  props: Common & {
    /** Any tile but a chart (ChartDrawer). */
    tile: Exclude<Tile, ChartTile>;
    supported: boolean;
    /** Wind rose only: how the display will draw it at this size. */
    sizeHint?: string;
    openSlot?: SlotName | EngineSlotName;
    /** The layout's display theme (the history mock follows it). */
    theme?: Layout['theme'];
    /** What the whole layout records (the history memory counter). */
    historyCount: HistoryCount;
    onRoseHistory(name: RoseHistoryKey, on: boolean): void;
    onChange(patch: Patch): void;
    onConfig(patch: Patch): void;
    onSlot(slot: SlotName, patch: Patch | null): void;
    onEngineSlot(slot: EngineSlotName | EngineCornerName, patch: Patch | null): void;
    onDelete(): void;
  },
) {
  const { tile, onChange } = props;
  const title =
    tile.type === 'wind_rose'
      ? 'Wind rose'
      : tile.type === 'engine'
        ? 'Engine'
        : tile.type === 'autopilot'
        ? 'Autopilot'
        : tile.label ||
          (tile.type === 'position' ? 'Position' : tile.type === 'clock' ? 'Clock' : tile.id);
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
      ) : tile.type === 'clock' ? (
        <ClockFields
          tile={tile}
          paths={props.paths}
          values={props.values}
          onChange={onChange}
          onClose={props.onClose}
        />
      ) : tile.type === 'heading_tape' ? (
        <HeadingTapeFields
          tile={tile}
          paths={props.paths}
          values={props.values}
          onChange={onChange}
          onConfig={props.onConfig}
          onClose={props.onClose}
        />
      ) : tile.type === 'engine' ? (
        <EngineFields
          tile={tile}
          paths={props.paths}
          values={props.values}
          openSlot={
            ([...ENGINE_SLOTS, ...ENGINE_CORNERS] as readonly string[]).includes(props.openSlot ?? '')
              ? (props.openSlot as EngineSlotName | EngineCornerName)
              : undefined
          }
          serverZones={props.paths.find((p) => p.path === tile.path)?.zones}
          onChange={onChange}
          onSlot={props.onEngineSlot}
          onClose={props.onClose}
        />
      ) : tile.type === 'wind_rose' ? (
        <>
          {props.sizeHint && <p className="hint size-hint">{props.sizeHint}</p>}
          <RoseFields
            tile={tile}
            paths={props.paths}
            values={props.values}
            openSlot={(WIND_ROSE_SLOTS as readonly string[]).includes(props.openSlot ?? '') ? (props.openSlot as SlotName) : undefined}
            theme={props.theme ?? 'day'}
            count={props.historyCount}
            onConfig={props.onConfig}
            onSlot={props.onSlot}
            onHistory={props.onRoseHistory}
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
            <RangeFields
              tile={tile}
              serverZones={props.paths.find((p) => p.path === tile.path)?.zones}
              onChange={onChange}
            />
          )}
          {tile.type === 'value' && (
            <ValueColorFields
              tile={tile}
              serverZones={props.paths.find((p) => p.path === tile.path)?.zones}
              onChange={onChange}
            />
          )}
          {tile.type === 'graph' && (
            <>
              {props.sizeHint && <p className="hint size-hint">{props.sizeHint}</p>}
              <GraphFields
                tile={tile}
                value={tile.path ? props.values.get(tile.path) : undefined}
                theme={props.theme ?? 'day'}
                count={props.historyCount}
                serverZones={new Map(props.paths.map((p) => [p.path, p.zones]))}
                onChange={onChange}
              />
            </>
          )}
          {tile.type === 'value' && (
            <ValueHistoryField
              tile={tile}
              value={tile.path ? props.values.get(tile.path) : undefined}
              theme={props.theme ?? 'day'}
              count={props.historyCount}
              serverZones={new Map(props.paths.map((p) => [p.path, p.zones]))}
              onChange={onChange}
            />
          )}
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete tile
      </button>
    </Drawer>
  );
}
