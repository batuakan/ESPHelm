// Left column: displays (pending ones can be adopted) and the tile library.
import { useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { TileType } from '@esphelm/schema';
import type { Device } from '../api';

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
}) {
  return (
    <section className="panel devices" aria-label="Displays">
      <h2>Displays</h2>
      {props.devices.length === 0 && (
        <p className="hint">No display has said hello yet. Power one on and approve it in SignalK.</p>
      )}
      <ul>
        {props.devices.map((d) => (
          <li key={d.id} className={d.id === props.selectedId ? 'selected' : ''}>
            <button className="device" onClick={() => props.onSelect(d.id)}>
              <span className={`dot ${d.state}`} aria-hidden />
              <span className="device-name">{d.name ?? d.hello.board ?? d.id}</span>
              <span className="device-meta">
                {d.hello.display.width}×{d.hello.display.height} · {d.state}
              </span>
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
          </li>
        ))}
      </ul>
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
