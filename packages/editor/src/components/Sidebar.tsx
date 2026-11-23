// Left column: displays (pending ones can be adopted) and the tile library.
import { useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { TileType } from '@esphelm/schema';
import type { Device } from '../api';
import { accessLine, type SignalkDevice } from '../access';

/** The end of a display's id, to match against *Settings → Info → Display → Id* on the display. */
export function shortId(id: string): string {
  const hex = id.replace(/[^0-9a-zA-Z]/g, '');
  return hex.length > 4 ? `…${hex.slice(-4)}` : id;
}

/** Removes the selected display after asking; its SignalK access is revoked too (ADR-0044). */
function RemoveLine(props: { device: Device; onRemove(id: string): void }) {
  const d = props.device;
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div className="device-rename">
        <button className="link" onClick={() => setAsking(true)}>
          Remove display
        </button>
      </div>
    );
  }
  return (
    <div className="device-confirm" role="group" aria-label="Remove display">
      <span>
        Remove {d.name ?? d.hello.board ?? d.id}? Its SignalK access is revoked too: to use it again,
        approve its new access request in SignalK and adopt it here.
      </span>
      <button className="danger small" onClick={() => (setAsking(false), props.onRemove(d.id))}>
        Remove
      </button>
      <button className="small" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  );
}

/** Renames the selected display; an empty name clears it (the board is shown again). */
function RenameLine(props: { device: Device; onRename(id: string, name: string | null): void }) {
  const d = props.device;
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="device-rename">
        <button className="link" onClick={() => setDraft(d.name ?? '')}>
          Rename
        </button>
      </div>
    );
  }
  const done = () => {
    const name = draft.trim();
    setDraft(null);
    if (name !== (d.name ?? '')) props.onRename(d.id, name === '' ? null : name);
  };
  return (
    <form
      className="device-rename"
      onSubmit={(e) => {
        e.preventDefault();
        done();
      }}
    >
      <input
        autoFocus
        value={draft}
        maxLength={40}
        placeholder={d.hello.board}
        aria-label="Display name"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
      />
      <button className="primary small" type="submit">
        Save
      </button>
      <button className="small" type="button" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
  );
}

/** The firmware update line under a display (ADR-0036). */
function UpdateLine(props: {
  device: Device;
  onUpdate(id: string, buildId: string): void;
  onClearUpdate(id: string): void;
}) {
  const d = props.device;
  const [confirming, setConfirming] = useState(false);
  const u = d.update;
  if (u && u.state !== 'done' && u.state !== 'failed') {
    const text =
      u.state === 'requested'
        ? `Update to ${u.version} waits for the display`
        : u.state === 'downloading'
          ? `Downloading ${u.version}…`
          : `Installing ${u.version}; the display restarts`;
    return (
      <div className="device-fw">
        <span className="device-meta">{text}</span>
        {u.state === 'requested' && (
          <button className="small" onClick={() => props.onClearUpdate(d.id)}>
            Cancel
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="device-fw">
      {u?.state === 'failed' && (
        <span className="device-warning" role="status">
          Update to {u.version} failed: {u.error}{' '}
          <button className="link" onClick={() => props.onClearUpdate(d.id)} aria-label="Dismiss">
            ×
          </button>
        </span>
      )}
      {u?.state === 'done' && u.buildId === d.hello.fw.build && (
        <span className="device-meta">Updated to {u.version}</span>
      )}
      {d.updateAvailable &&
        (confirming ? (
          <>
            <span className="device-meta">The display restarts.</span>
            <button
              className="primary small"
              onClick={() => {
                setConfirming(false);
                props.onUpdate(d.id, d.updateAvailable!.buildId);
              }}
            >
              Update
            </button>
            <button className="small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="chip" onClick={() => setConfirming(true)}>
            Update to {d.updateAvailable.version}
          </button>
        ))}
    </div>
  );
}

/** Small line icons (inline SVG: no icon font, and no glyphs missing from system fonts). */
const ICONS: Record<string, JSX.Element> = {
  value: (
    <svg viewBox="0 0 20 20">
      <rect x="2" y="3" width="16" height="14" rx="3" />
      <path d="M6 12h8M6 8h4" />
    </svg>
  ),
  gauge: (
    <svg viewBox="0 0 20 20">
      <path d="M3 14a7 7 0 1 1 14 0" />
      <path d="M10 14l4-5" />
    </svg>
  ),
  bar: (
    <svg viewBox="0 0 20 20">
      <rect x="2" y="7" width="16" height="6" rx="2" />
      <rect x="2" y="7" width="9" height="6" rx="2" className="fill" />
    </svg>
  ),
  switch: (
    <svg viewBox="0 0 20 20">
      <rect x="2" y="6" width="16" height="8" rx="4" />
      <circle cx="14" cy="10" r="2.5" className="fill" />
    </svg>
  ),
  position: (
    <svg viewBox="0 0 20 20">
      <path d="M10 18s-5.5-5.4-5.5-9.5a5.5 5.5 0 0 1 11 0C15.5 12.6 10 18 10 18z" />
      <circle cx="10" cy="8.5" r="2" className="fill" />
    </svg>
  ),
  autopilot: (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="10" r="2" className="fill" />
      <path d="M10 2.5v5M10 12.5v5M2.5 10h5M12.5 10h5" />
    </svg>
  ),
  graph: (
    <svg viewBox="0 0 20 20">
      <path d="M2.5 3v14.5H18" />
      <path d="M5 13l3.5-4 3 2.5L17 5" />
    </svg>
  ),
  heading_tape: (
    <svg viewBox="0 0 20 20">
      <rect x="2" y="6" width="16" height="9" rx="2" />
      <path d="M5 6v3M8 6v2M12 6v2M15 6v3" />
      <path d="M10 3v14" />
    </svg>
  ),
  alarms: (
    <svg viewBox="0 0 20 20">
      <path d="M10 2.5 18 17H2Z" />
      <path d="M10 8v4.5M10 14.6v.4" />
    </svg>
  ),
  battery: (
    <svg viewBox="0 0 20 20">
      <rect x="2" y="6" width="14" height="8" rx="2" />
      <rect x="4" y="8" width="7" height="4" className="fill" />
      <path d="M18 9v2" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  ),
  wind_rose: (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 10l-3.5-5.5" />
      <path d="M10 2.5v2M17.5 10h-2M10 17.5v-2M2.5 10h2" />
    </svg>
  ),
  engine: (
    <svg viewBox="0 0 20 20">
      <path d="M3.5 15.5a7.5 7.5 0 1 1 13 0" />
      <path d="M10 11.5l3.5-4" />
      <path d="M7 12.5a3 3 0 0 1 0-1M13 12.5a3 3 0 0 0 0-1" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 20 20">
      <path d="M2.5 5l5-2 5 2 5-2v12l-5 2-5-2-5 2z" />
      <path d="M7.5 3v12M12.5 5v12" />
    </svg>
  ),
};

const TILE_INFO: Record<string, { title: string }> = {
  value: { title: 'Value' },
  gauge: { title: 'Gauge' },
  bar: { title: 'Bar' },
  switch: { title: 'Switch' },
  position: { title: 'Position' },
  graph: { title: 'Graph' },
  heading_tape: { title: 'Heading tape' },
  clock: { title: 'Clock' },
  alarms: { title: 'Alarms' },
  battery: { title: 'Battery' },
  wind_rose: { title: 'Wind rose' },
  autopilot: { title: 'Autopilot' },
  chart: { title: 'Chart' },
  engine: { title: 'Engine' },
};

export function DeviceList(props: {
  devices: Device[];
  selectedId: string | undefined;
  onSelect(id: string): void;
  onAdopt(id: string): void;
  onRename(id: string, name: string | null): void;
  onFirmware(): void;
  onUpdate(id: string, buildId: string): void;
  onClearUpdate(id: string): void;
  onRemove(id: string): void;
  /** SignalK's approved devices by client id; null when SignalK's list can't be read (ADR-0044). */
  access?: Map<string, SignalkDevice> | null;
}) {
  const real = props.devices.filter((d) => !d.demo);
  const demos = props.devices.filter((d) => d.demo);
  // Open while there is no real display, collapsed once one is registered, unless toggled.
  const [demosToggled, setDemosToggled] = useState<boolean | null>(null);
  const demosOpen = demosToggled ?? real.length === 0;
  const setDemosOpen = (open: boolean) => setDemosToggled(open);
  const row = (d: Device) => (
    <li key={d.id} className={d.id === props.selectedId ? 'selected' : ''}>
      <button className="device" onClick={() => props.onSelect(d.id)}>
        <span className={`dot ${d.state}`} aria-hidden />
        <span className="device-name">{d.name ?? d.hello.board ?? d.id}</span>
        {d.demo ? (
          <span className="device-meta">
            {d.hello.display.width}×{d.hello.display.height}
            {d.hello.display.kind === 'mono' ? ' · black and white' : ''}
            {d.hello.capacity.psram ? '' : ' · no charts'}
          </span>
        ) : (
          <span className="device-meta" title={`Id ${d.id}`}>
            {d.hello.display.width}×{d.hello.display.height} · {d.state} · {d.hello.fw.version} ·{' '}
            <span className="device-id">{shortId(d.id)}</span>
          </span>
        )}
        {!d.demo &&
          (() => {
            const line = accessLine(props.access?.get(d.id)?.tokenExpiry, Date.now());
            return line ? (
              <span className={line.warning ? 'device-warning' : 'device-meta'}>{line.text}</span>
            ) : null;
          })()}
        {d.hello.recovery && (
          <span className="device-warning">
            A layout crashed this display; it shows an older one until you send a changed layout
          </span>
        )}
      </button>
      {d.state === 'pending' && (
        <button className="small" onClick={() => props.onAdopt(d.id)}>
          Adopt
        </button>
      )}
      {d.id === props.selectedId && <RenameLine key={d.id} device={d} onRename={props.onRename} />}
      {d.id === props.selectedId && !d.demo && (
        <RemoveLine key={`remove-${d.id}`} device={d} onRemove={props.onRemove} />
      )}
      {d.state === 'adopted' && (d.update || d.updateAvailable) && (
        <UpdateLine device={d} onUpdate={props.onUpdate} onClearUpdate={props.onClearUpdate} />
      )}
    </li>
  );
  return (
    <section className="panel devices" aria-label="Displays">
      <div className="panel-head">
        <h2>Displays</h2>
        <button className="small" onClick={props.onFirmware} title="Firmware images and updates">
          Firmware
        </button>
      </div>
      {real.length === 0 && (
        <p className="hint">
          No display has said hello yet. Power one on and approve it in SignalK.
          {demos.length > 0 && ' Meanwhile, try the editor on a demo display.'}
        </p>
      )}
      {real.length > 0 && <ul>{real.map(row)}</ul>}
      {demos.length > 0 && (
        <>
          <h3 className="devices-group">
            <button
              className="group-toggle"
              aria-expanded={demosOpen}
              onClick={() => setDemosOpen(!demosOpen)}
              title="Displays that exist only in this editor (ADR-0041)"
            >
              <span className="chevron" aria-hidden>
                {demosOpen ? '▾' : '▸'}
              </span>
              Demo ({demos.length})
            </button>
          </h3>
          {demosOpen && <ul>{demos.map(row)}</ul>}
        </>
      )}
    </section>
  );
}

export function TileLibrary(props: {
  types: string[];
  supported: Set<string>;
  onAdd(type: TileType): void;
  onDragStart(type: TileType, e: ReactPointerEvent): void;
}) {
  const [query, setQuery] = useState('');
  const title = (t: string) => TILE_INFO[t]?.title ?? t;
  // Alphabetical by the name shown, whatever order the display's catalog lists them in.
  const shown = props.types
    .filter((t) => title(t).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => title(a).localeCompare(title(b)));
  return (
    <section className="panel library" aria-label="Tiles">
      <h2>Tiles</h2>
      <input
        className="search"
        placeholder="Search tiles"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search tiles"
      />
      <ul>
        {shown.map((t) => {
          const ok = props.supported.has(t);
          return (
            <li key={t}>
              <button
                className="tile-type"
                disabled={!ok}
                title={ok ? 'Click to add, or drag onto the page' : 'Not supported by this display'}
                onClick={() => props.onAdd(t as TileType)}
                onPointerDown={(e) => ok && props.onDragStart(t as TileType, e)}
              >
                <span className="icon" aria-hidden>
                  {ICONS[t] ?? ICONS.value}
                </span>
                {title(t)}
                {!ok && <span className="na">n/a</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
