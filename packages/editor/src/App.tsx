// ESPHelm editor (Phase 4 MVP): pick a display, edit the first grid page of its layout with
// live values, Save & send. One layout per display (created on first save).
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { TILE_TYPES, validateLayout, type Layout, type TileType } from '@esphelm/schema';
import { ApiError, createApi, type Api, type Device, type PathInfo } from './api';
import { createLiveSource, type LiveSource } from './live';
import {
  addTile,
  gridPage,
  gridPageIndex,
  moveTile,
  newLayoutFor,
  removeTile,
  resizeTile,
  setGrid,
  tileIdForPointer,
  updateTile,
} from './layoutOps';
import { GridCanvas, type NewTileDrag } from './components/GridCanvas';
import { DeviceList, TileLibrary } from './components/Sidebar';
import { TileDrawer } from './components/TileDrawer';

export type Theme = 'light' | 'dark' | 'night';

interface Status {
  kind: 'info' | 'ok' | 'error';
  text: string;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('esphelm.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'night') return saved;
  } catch {
    // storage unavailable
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function App(props: { api?: Api; live?: () => LiveSource }) {
  const api = useMemo(() => props.api ?? createApi(), [props.api]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [devices, setDevices] = useState<Device[]>([]);
  const [paths, setPaths] = useState<PathInfo[]>([]);
  const [catalog, setCatalog] = useState<string[]>(Object.keys(TILE_TYPES));
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [savedJson, setSavedJson] = useState<string>('');
  const [selectedTile, setSelectedTile] = useState<string | undefined>();
  const [values, setValues] = useState<Map<string, unknown>>(new Map());
  const [status, setStatus] = useState<Status | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTileDrag, setNewTileDrag] = useState<NewTileDrag | null>(null);

  const device = devices.find((d) => d.id === deviceId);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.needsLogin) setNeedsLogin(true);
    setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await api.devices();
      setDevices(list);
      setNeedsLogin(false);
      return list;
    } catch (e) {
      fail(e);
      return [];
    }
  }, [api, fail]);

  // Initial load; paths refresh every 15 s (new sources appear while the editor is open).
  useEffect(() => {
    void refreshDevices().then((list) => {
      if (list.length > 0) setDeviceId((cur) => cur ?? list.find((d) => d.state === 'adopted')?.id ?? list[0]?.id);
    });
    api.widgets().then((w) => setCatalog(w.tiles), () => undefined);
    const loadPaths = () => api.paths().then(setPaths, () => undefined);
    void loadPaths();
    const timer = setInterval(loadPaths, 15000);
    return () => clearInterval(timer);
  }, [api, refreshDevices]);

  // Load (or start) the layout of the selected display.
  useEffect(() => {
    setSelectedTile(undefined);
    if (!device) {
      setLayout(null);
      return;
    }
    let cancelled = false;
    const start = (l: Layout) => {
      if (cancelled) return;
      setLayout(l);
      setSavedJson(device.layoutId ? JSON.stringify(l) : '');
    };
    if (device.layoutId) api.layout(device.layoutId).then(start, (e) => (fail(e), start(newLayoutFor(device))));
    else start(newLayoutFor({ id: device.id, name: device.name }));
    return () => {
      cancelled = true;
    };
    // Reload only when another display (or its assignment) is selected.
  }, [deviceId, device?.layoutId]);

  // Live preview: subscribe to the paths on the page.
  const [live, setLive] = useState<LiveSource | null>(null);
  useEffect(() => {
    const source = (props.live ?? createLiveSource)();
    setLive(source);
    const off = source.onValue((path, value) =>
      setValues((prev) => {
        const next = new Map(prev);
        next.set(path, value);
        return next;
      }),
    );
    return () => {
      off();
      source.close();
    };
  }, [props.live]);
  const page = layout ? gridPage(layout) : undefined;
  useEffect(() => {
    live?.setPaths(page ? page.tiles.map((t) => t.path).filter(Boolean) : []);
  }, [live, page]);
  // Until live values arrive, show the server's latest ones.
  const shownValues = useMemo(() => {
    const m = new Map<string, unknown>(paths.map((p) => [p.path, p.value]));
    values.forEach((v, k) => m.set(k, v));
    return m;
  }, [paths, values]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('esphelm.theme', theme);
    } catch {
      // storage unavailable
    }
  }, [theme]);

  const validation = useMemo(() => (layout ? validateLayout(layout) : null), [layout]);
  const problems = validation?.errors ?? [];
  const problemTileIds = useMemo(
    () => new Set(problems.map((p) => (layout ? tileIdForPointer(layout, p.pointer) : undefined)).filter(Boolean) as string[]),
    [problems, layout],
  );
  const supported = useMemo(() => new Set(device?.hello.widgets ?? []), [device]);
  const dirty = layout !== null && JSON.stringify(layout) !== savedJson;

  const edit = (next: Layout | null, failText?: string) => {
    if (next) {
      setLayout(next);
      setStatus(null);
    } else if (failText) {
      setStatus({ kind: 'info', text: failText });
    }
  };

  const add = (type: TileType, at?: { x: number; y: number }) => {
    if (!layout) return;
    const r = addTile(layout, type, at);
    if (!r) return edit(null, 'No free cell there. Make the grid bigger or move a tile.');
    edit(r.layout);
    setSelectedTile(r.id);
  };

  const adopt = async (id: string) => {
    try {
      await api.updateDevice(id, { state: 'adopted' });
      await refreshDevices();
      setDeviceId(id);
      setStatus({ kind: 'ok', text: 'Display adopted. Design its page and press Save & send.' });
    } catch (e) {
      fail(e);
    }
  };

  const save = async () => {
    if (!layout || !device) return;
    setSaving(true);
    try {
      const saved = await api.saveLayout(layout);
      let warnings = saved.warnings;
      if (device.layoutId !== layout.id) {
        const r = await api.updateDevice(device.id, { layoutId: layout.id });
        warnings = [...warnings, ...r.warnings];
      }
      setSavedJson(JSON.stringify(layout));
      await refreshDevices();
      setStatus({
        kind: warnings.length > 0 ? 'info' : 'ok',
        text:
          `Sent to ${device.name ?? device.hello.board}.` +
          (warnings.length > 0 ? ` Warning: ${warnings.map((w) => w.message).join('; ')}` : ''),
      });
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const tile = page?.tiles.find((t) => t.id === selectedTile);
  const canSave = !!layout && device?.state === 'adopted' && problems.length === 0 && !saving;

  return (
    <div className={`app ${tile ? 'has-drawer' : ''}`}>
      <header className="topbar">
        <h1>ESPHelm</h1>
        <label className="device-select">
          <span className="sr-only">Display</span>
          <select value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value || undefined)} aria-label="Display">
            {devices.length === 0 && <option value="">No displays</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {(d.name ?? d.hello.board) + (d.state === 'pending' ? ' (pending)' : '')}
              </option>
            ))}
          </select>
        </label>
        <div className="themes" role="group" aria-label="Theme">
          {(['light', 'dark', 'night'] as Theme[]).map((t) => (
            <button
              key={t}
              className={theme === t ? 'on' : ''}
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              aria-label={`${t} theme`}
            >
              {t === 'light' ? 'Day' : t === 'dark' ? 'Dark' : 'Night'}
            </button>
          ))}
        </div>
        <button className="primary save" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Sending…' : dirty || !device?.layoutId ? 'Save & send' : 'Sent ✓'}
        </button>
      </header>

      {needsLogin && (
        <div className="banner error">
          Log in to SignalK as an administrator to edit displays.{' '}
          <a href="/admin/#/login" target="_top">
            Log in
          </a>
        </div>
      )}
      {status && <div className={`banner ${status.kind}`} role="status">{status.text}</div>}

      <div className="sidebar">
        <DeviceList devices={devices} selectedId={deviceId} onSelect={setDeviceId} onAdopt={(id) => void adopt(id)} />
        <TileLibrary
          types={catalog}
          supported={supported}
          onAdd={(t) => add(t)}
          onDragStart={(type, e: ReactPointerEvent) => setNewTileDrag({ type, startX: e.clientX, startY: e.clientY })}
        />
      </div>

      <main className="workspace">
        {device?.state === 'pending' && (
          <div className="banner info">
            This display is waiting to be adopted.{' '}
            <button className="small" onClick={() => void adopt(device.id)}>
              Adopt
            </button>
          </div>
        )}
        {layout && page ? (
          <>
            <div className="page-bar">
              <strong>{page.title ?? page.id}</strong>
              <label>
                grid{' '}
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={page.grid.cols}
                  onChange={(e) => edit(setGrid(layout, Math.max(1, Number(e.target.value)), page.grid.rows))}
                  aria-label="Columns"
                />
                ×
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={page.grid.rows}
                  onChange={(e) => edit(setGrid(layout, page.grid.cols, Math.max(1, Number(e.target.value))))}
                  aria-label="Rows"
                />
              </label>
              <span className="device-size">
                {device?.hello.display.width}×{device?.hello.display.height}
              </span>
            </div>
            <GridCanvas
              page={page}
              aspect={device ? device.hello.display.width / device.hello.display.height : 1}
              values={shownValues}
              selectedId={selectedTile}
              problemTileIds={problemTileIds}
              newTileDrag={newTileDrag}
              onSelect={setSelectedTile}
              onMove={(id, x, y) => edit(moveTile(layout, id, x, y), 'That spot is taken.')}
              onResize={(id, w, h) => edit(resizeTile(layout, id, w, h), 'Not enough room to grow there.')}
              onDropNew={(type, cell) => add(type, cell)}
              onDragNewEnd={() => setNewTileDrag(null)}
            />
            <section className="problems" aria-label="Problems">
              {problems.length === 0 ? (
                <span className="ok">No problems</span>
              ) : (
                <ul>
                  {problems.map((p) => {
                    const id = tileIdForPointer(layout, p.pointer);
                    return (
                      <li key={`${p.pointer}|${p.code}`}>
                        <button className="link" onClick={() => id && setSelectedTile(id)}>
                          {describeProblem(p.code, p.pointer, id)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className="hint">{devices.length === 0 ? 'Waiting for a display.' : 'Select a display.'}</p>
        )}
        {layout && gridPageIndex(layout) > 0 && (
          <p className="hint">This editor edits the first grid page; other pages are kept as they are.</p>
        )}
      </main>

      {tile && layout && (
        <TileDrawer
          key={tile.id}
          tile={tile}
          paths={paths}
          values={shownValues}
          supported={supported.has(tile.type)}
          onChange={(patch) => edit(updateTile(layout, tile.id, patch))}
          onDelete={() => {
            edit(removeTile(layout, tile.id));
            setSelectedTile(undefined);
          }}
          onClose={() => setSelectedTile(undefined)}
        />
      )}
    </div>
  );
}

const PROBLEM_TEXT: Record<string, string> = {
  EMPTY_PAGE: 'Add at least one tile.',
  INVALID_PATH: 'pick a SignalK path',
  INVALID_LABEL: 'the label has characters the display cannot show',
  TILE_OUT_OF_GRID: 'does not fit the grid; move it or make the grid bigger',
  TILE_OVERLAP: 'overlaps another tile',
  UNKNOWN_UNIT: 'unknown unit',
  OUT_OF_RANGE: 'a number is out of range',
  INVALID_RANGE: 'max must be greater than min',
};

function describeProblem(code: string, pointer: string, tileId: string | undefined): string {
  const text = PROBLEM_TEXT[code] ?? `${code} at ${pointer}`;
  return tileId ? `${tileId}: ${text}` : text;
}
