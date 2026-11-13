// ESPHelm editor: pick a display, edit the pages of its layout with live values (grids of
// tiles; wind roses are tiles with centre slots), Save & send. One layout per display (created
// on first save).
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DEFAULT_DIGIT_FONT_LINE_HEIGHTS,
  DEFAULT_FONT_LINE_HEIGHTS,
  CHART_FIT,
  GRAPH_FIT,
  TEMPLATES,
  TILE_TYPES,
  historyCount,
  validateLayout,
  type Layout,
  type EngineSlotName,
  type Page,
  type Tile,
  type TileType,
} from '@esphelm/schema';
import { ApiError, createApi, type Api, type ChartInfo, type Device, type PathInfo } from './api';
import { formatValue } from './format';
import { createLiveSource, type LiveSource } from './live';
import {
  addPage,
  addTemplatePages,
  addTile,
  applyTemplate,
  layoutIdFor,
  replaceChart,
  replacePath,
  moveTile,
  movePage,
  newLayoutFor,
  removePage,
  removeTile,
  renamePage,
  resizeTile,
  setGrid,
  setRoseHistory,
  setTileConfig,
  targetForPointer,
  tilePaths,
  pageTiles,
  updateChartTile,
  updateSettings,
  withBrowserTimeZone,
  updateSlot,
  updateEngineSlot,
  updateTile,
  type SlotName,
} from './layoutOps';
import { screenShape, shownSize } from './rotation';
import { SettingsDrawer } from './components/SettingsDrawer';
import { GridCanvas, type NewTileDrag } from './components/GridCanvas';
import { LayoutBar } from './components/LayoutBar';
import { PageTabs, pageWidgets } from './components/PageTabs';
import { ImportConfirm, RemapDialog } from './components/ShareDialogs';
import { IMPORT_MAX_BYTES, IMPORT_TOO_LARGE, exportFile, missingRefs, parseImport, type MissingRef } from './share';
import { FooterPreview } from './components/Previews';
import { DeviceList, TileLibrary } from './components/Sidebar';
import { FirmwareDialog } from './components/FirmwareDialog';
import { ChartDrawer, SLOT_TITLES, TileDrawer } from './components/TileDrawer';
import {
  AUTOPILOT_TIER_TEXT,
  ROSE_TIER_TEXT,
  autopilotTier,
  roseTier,
  tilePixels,
  valueTextSize,
} from './sizing';

export type Theme = 'light' | 'dark' | 'night';

/** The selected tile, and for a wind rose optionally one of its slots. */
interface Selection {
  id: string;
  slot?: SlotName | EngineSlotName;
}

/** SignalK paths a page shows (what the live preview subscribes to). */
function pagePaths(page: Page | undefined): string[] {
  if (!page) return [];
  return page.tiles.flatMap(tilePaths).filter(Boolean);
}

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

/** The display theme button's text: a mono display has black on white and inverted. */
function themeLabel(theme: Layout['theme'], mono: boolean): string {
  if (mono) return theme === 'day' ? 'Plain' : 'Inverted';
  return theme === 'day' ? 'Day' : theme === 'dark' ? 'Dark' : 'Night';
}

export function App(props: { api?: Api; live?: () => LiveSource }) {
  const api = useMemo(() => props.api ?? createApi(), [props.api]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [devices, setDevices] = useState<Device[]>([]);
  const [paths, setPaths] = useState<PathInfo[]>([]);
  const serverZones = useMemo(() => new Map(paths.map((p) => [p.path, p.zones])), [paths]);
  const [catalog, setCatalog] = useState<string[]>(Object.keys(TILE_TYPES));
  const [charts, setCharts] = useState<ChartInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [savedJson, setSavedJson] = useState<string>('');
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<Selection | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // One drawer at a time: selecting a tile or page closes the display settings.
  useEffect(() => {
    if (selection) setSettingsOpen(false);
  }, [selection]);
  const [values, setValues] = useState<Map<string, unknown>>(new Map());
  const [status, setStatus] = useState<Status | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTileDrag, setNewTileDrag] = useState<NewTileDrag | null>(null);
  // Layout files (ADR-0027): a checked file waiting for "Replace", then what to remap.
  const [pendingImport, setPendingImport] = useState<{ layout: Layout; name: string; unsupported: string[] } | null>(
    null,
  );
  const [remap, setRemap] = useState<MissingRef[] | null>(null);
  const [firmwareOpen, setFirmwareOpen] = useState(false);

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

  // Initial load; paths refresh every 15 s (new sources appear while the editor is open), the
  // displays every 5 s (new displays appear, and a display turned on its Network tab reports its
  // new size in hello, ADR-0028).
  useEffect(() => {
    void refreshDevices().then((list) => {
      if (list.length > 0) setDeviceId((cur) => cur ?? list.find((d) => d.state === 'adopted')?.id ?? list[0]?.id);
    });
    api.widgets().then((w) => setCatalog(w.tiles), () => undefined);
    api.charts().then(setCharts, () => undefined);
    const loadPaths = () => api.paths().then(setPaths, () => undefined);
    void loadPaths();
    const pathsTimer = setInterval(loadPaths, 15000);
    const pollDevices = () =>
      api.devices().then(
        (list) => setDevices((cur) => (JSON.stringify(cur) === JSON.stringify(list) ? cur : list)),
        () => undefined,
      );
    const devicesTimer = setInterval(pollDevices, 5000);
    return () => {
      clearInterval(pathsTimer);
      clearInterval(devicesTimer);
    };
  }, [api, refreshDevices]);

  // Load (or start) the layout of the selected display.
  useEffect(() => {
    setSelection(undefined);
    setPageIndex(0);
    setPendingImport(null);
    setRemap(null);
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
  const index = layout ? Math.min(pageIndex, layout.pages.length - 1) : 0;
  const page = layout?.pages[index];
  const grid = page;
  useEffect(() => {
    live?.setPaths(pagePaths(page));
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
  const problemTargets = useMemo(
    () => problems.map((p) => ({ problem: p, target: layout ? targetForPointer(layout, p.pointer) : undefined })),
    [problems, layout],
  );
  const problemTileIds = useMemo(
    () =>
      new Set(
        problemTargets.filter((t) => t.target?.page === index && t.target.tileId).map((t) => t.target!.tileId!),
      ),
    [problemTargets, index],
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
    const r = addTile(layout, index, type, at);
    if (!r) return edit(null, 'No free cell there. Make the grid bigger or move a tile.');
    // A first clock gets this computer's time zone, so it shows what the clock on the wall does.
    edit(type === 'clock' ? withBrowserTimeZone(r.layout) : r.layout);
    setSelection({ id: r.id });
  };

  const showPage = (i: number, sel?: Selection) => {
    setPageIndex(i);
    setSelection(sel);
  };

  const template = (id: string) => Object.values(TEMPLATES).find((t) => t.id === id);

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

  // Sharing (ADR-0027).
  const displayName = (d: Device) => d.name ?? d.hello.board ?? d.id;
  const others = device
    ? devices.filter((d) => d.id !== device.id && d.layoutId && d.layoutId !== device.layoutId)
    : [];
  const sharedWith = device?.layoutId
    ? devices.filter((d) => d.id !== device.id && d.layoutId === device.layoutId).map(displayName)
    : [];

  const exportLayout = () => {
    if (!layout) return;
    const { fileName, text } = exportFile(layout);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoked later: the browser reads the URL after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus({ kind: 'ok', text: `Exported ${fileName}.` });
  };

  const importFile = async (file: File) => {
    if (!layout) return;
    // A large file isn't read at all (parseImport checks the size of what it is given too).
    const r =
      file.size > IMPORT_MAX_BYTES
        ? { ok: false as const, errors: [IMPORT_TOO_LARGE] }
        : parseImport(await file.text(), layout);
    if (!r.ok) {
      setStatus({ kind: 'error', text: `${file.name} was not imported. ${r.errors.join('; ')}` });
      return;
    }
    const unsupported = [...new Set(r.layout.pages.flatMap(pageWidgets))].filter((w) => !supported.has(w));
    setPendingImport({ layout: r.layout, name: r.name ?? file.name, unsupported });
  };

  const applyImport = () => {
    if (!pendingImport) return;
    edit(pendingImport.layout);
    showPage(0);
    setPendingImport(null);
    const missing = missingRefs(
      pendingImport.layout,
      new Set(paths.map((p) => p.path)),
      new Set(charts.map((c) => c.identifier)),
    );
    setRemap(missing.length > 0 ? missing : null);
    setStatus({ kind: 'info', text: `Imported “${pendingImport.name}”. Press Save & send to send it to the display.` });
  };

  const applyRemap = (replacements: { kind: MissingRef['kind']; from: string; to: string }[]) => {
    if (!layout) return;
    edit(
      replacements.reduce(
        (l, r) => (r.kind === 'path' ? replacePath(l, r.from, r.to) : replaceChart(l, r.from, r.to)),
        layout,
      ),
    );
    setRemap(null);
  };

  const copyFrom = async (otherId: string) => {
    const other = devices.find((d) => d.id === otherId);
    if (!layout || !device || !other?.layoutId) return;
    try {
      const { id: _id, name: _name, ...pages } = await api.layout(other.layoutId);
      void _id;
      void _name;
      edit({
        ...pages,
        id: layoutIdFor(device.id),
        ...(layout.name !== undefined ? { name: layout.name } : {}),
      });
      showPage(0);
      setStatus({ kind: 'info', text: `Copied the layout of ${displayName(other)}. Press Save & send to send it.` });
    } catch (e) {
      fail(e);
    }
  };

  const linkTo = async (otherId: string) => {
    const other = devices.find((d) => d.id === otherId);
    if (!device || !other?.layoutId) return;
    try {
      const r = await api.updateDevice(device.id, { layoutId: other.layoutId });
      await refreshDevices();
      setStatus({
        kind: r.warnings.length > 0 ? 'info' : 'ok',
        text:
          `${displayName(device)} now shows the layout of ${displayName(other)}.` +
          (r.warnings.length > 0 ? ` Warning: ${r.warnings.map((w) => w.message).join('; ')}` : ''),
      });
    } catch (e) {
      fail(e);
    }
  };

  const tile = selection ? grid?.tiles.find((t) => t.id === selection.id) : undefined;
  const drawerOpen = !!tile;
  // The screen this layout gets: turned by its settings.rotation where the display can (ADR-0028).
  const display = device ? shownSize(device.hello, layout?.settings?.rotation) : { width: 480, height: 480 };
  const largeDisplay = Math.min(display.width, display.height) >= 600;
  // A black-and-white panel (hello.display.kind, ADR-0035): the preview and the choices follow it.
  const mono = device?.hello.display.kind === 'mono';
  const tileBox = (t: Tile) => (layout ? tilePixels(display, layout, index, t) : { width: 0, height: 0 });
  const tilePx = (t: Tile) => {
    const { width, height } = tileBox(t);
    return Math.min(width, height);
  };
  const fontLines = device?.hello.fontLineHeights ?? DEFAULT_FONT_LINE_HEIGHTS;
  // A display that reports its fonts reports its digits-only fonts too (none if it has none).
  const digitLines = device?.hello.fontLineHeights
    ? (device.hello.digitFontLineHeights ?? [])
    : DEFAULT_DIGIT_FONT_LINE_HEIGHTS;
  const canSave = !!layout && device?.state === 'adopted' && problems.length === 0 && !saving;

  return (
    <div className={`app ${drawerOpen ? 'has-drawer' : ''}`}>
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
        <div className="themes" role="group" aria-label="Editor theme" title="Colours of this editor (this browser only)">
          <span className="themes-label">Editor</span>
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
      {firmwareOpen && (
        <FirmwareDialog
          api={api}
          devices={devices}
          displayName={displayName}
          onChanged={() => void refreshDevices()}
          onClose={() => setFirmwareOpen(false)}
        />
      )}

      <div className="sidebar">
        <DeviceList
          devices={devices}
          selectedId={deviceId}
          onSelect={setDeviceId}
          onAdopt={(id) => void adopt(id)}
          onFirmware={() => setFirmwareOpen(true)}
          onUpdate={(id, buildId) =>
            void api.requestUpdate(id, buildId).then(() => refreshDevices(), fail)
          }
          onClearUpdate={(id) => void api.clearUpdate(id).then(() => refreshDevices(), fail)}
        />
        <TileLibrary
          types={catalog}
          supported={supported}
          onAdd={(t) => add(t)}
          onDragStart={(type, e: ReactPointerEvent) => setNewTileDrag({ type, startX: e.clientX, startY: e.clientY })}
        />
      </div>

      <main className="workspace" style={{ '--ratio': display.width / display.height } as CSSProperties}>
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
            <LayoutBar
              supported={supported}
              largeDisplay={largeDisplay}
              onApplyTemplate={(id) => {
                const t = template(id);
                if (!t) return;
                edit(applyTemplate(layout, t));
                showPage(0);
              }}
              share={{
                others: others.map((d) => {
                  const shape = screenShape(d.hello.display);
                  return {
                    id: d.id,
                    name: displayName(d),
                    ...(shape !== screenShape(display)
                      ? { otherShape: `${shape} (${d.hello.display.width}×${d.hello.display.height})` }
                      : {}),
                  };
                }),
                sharedWith,
                dirty,
                onExport: exportLayout,
                onImportFile: (f) => void importFile(f),
                onCopyFrom: (id) => void copyFrom(id),
                onLinkTo: (id) => void linkTo(id),
                ...(device && layout.id !== layoutIdFor(device.id)
                  ? {
                      onSeparate: () => {
                        edit({ ...layout, id: layoutIdFor(device.id) });
                        setStatus({
                          kind: 'info',
                          text: 'Press Save & send to give this display its own copy of the layout.',
                        });
                      },
                    }
                  : {}),
              }}
            >
              <div
                className="display-theme"
                role="group"
                aria-label="Display theme"
                title="The display's colours; sent to the display with Save & send"
              >
                <span>Display theme</span>
                {(mono ? (['day', 'dark'] as const) : (['day', 'dark', 'night'] as const)).map((t) => {
                  // Firmware without the dark theme refuses such a layout and keeps its last
                  // good one (ADR-0034), so it isn't offered for that display.
                  const unsupported =
                    t === 'dark' && device !== undefined && device.hello.capabilities.darkTheme !== true;
                  // A mono display has black on white (day) and inverted (dark; night looks the
                  // same there).
                  const on = layout.theme === t || (mono && t === 'dark' && layout.theme === 'night');
                  return (
                    <button
                      key={t}
                      className={`small ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      disabled={unsupported && layout.theme !== t}
                      title={unsupported ? "Update this display's firmware for the Dark theme" : undefined}
                      onClick={() => edit({ ...layout, theme: t })}
                    >
                      {themeLabel(t, mono)}
                    </button>
                  );
                })}
              </div>
              <button
                className={`small ${settingsOpen ? 'on' : ''}`}
                aria-pressed={settingsOpen}
                onClick={() => {
                  setSelection(undefined);
                  setSettingsOpen((open) => !open);
                }}
                title="Brightness, start page, auto day/night, screen timeout"
              >
                Display settings
              </button>
              <span className="device-size">
                {display.width}×{display.height}
              </span>
            </LayoutBar>
            <PageTabs
              layout={layout}
              index={index}
              supported={supported}
              largeDisplay={largeDisplay}
              onSelect={(i) => showPage(i)}
              onAdd={(kind) => {
                const r = addPage(layout, kind, index);
                edit(r.layout);
                const added = r.layout.pages[r.index];
                const first = pageTiles(added)[0];
                showPage(r.index, first ? { id: first.id } : undefined);
              }}
              onAddTemplate={(id) => {
                const t = template(id);
                if (!t) return;
                const r = addTemplatePages(layout, t, index);
                edit(r.layout);
                showPage(r.index);
              }}
              onRename={(title) => edit(renamePage(layout, index, title))}
              onMove={(delta) => {
                const next = movePage(layout, index, delta);
                if (next) {
                  edit(next);
                  setPageIndex(index + delta);
                }
              }}
              onDelete={() => {
                const next = removePage(layout, index);
                if (next) {
                  edit(next);
                  showPage(Math.max(0, index - 1));
                }
              }}
            >
              {grid && (
                <label className="grid-size">
                  grid{' '}
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={grid.grid.cols}
                    onChange={(e) => edit(setGrid(layout, index, Math.max(1, Number(e.target.value)), grid.grid.rows))}
                    aria-label="Columns"
                  />
                  ×
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={grid.grid.rows}
                    onChange={(e) => edit(setGrid(layout, index, grid.grid.cols, Math.max(1, Number(e.target.value))))}
                    aria-label="Rows"
                  />
                </label>
              )}
            </PageTabs>
            {pendingImport && (
              <ImportConfirm
                name={pendingImport.name}
                unsupported={pendingImport.unsupported}
                onReplace={applyImport}
                onCancel={() => setPendingImport(null)}
              />
            )}
            {remap && (
              <RemapDialog
                missing={remap}
                paths={paths}
                values={shownValues}
                charts={charts}
                onApply={applyRemap}
                onSkip={() => setRemap(null)}
              />
            )}
            <div
              className="display-frame"
              data-theme-preview={layout.theme}
              data-display-kind={mono ? 'mono' : undefined}
            >
              {grid && (
                <GridCanvas
                  page={grid}
                  aspect={aspectFor(device ? display : undefined)}
                  values={shownValues}
                  serverZones={serverZones}
                  selectedId={tile?.id}
                  selectedSlot={selection?.slot}
                  roseTier={(t) => roseTier(tilePx(t))}
                  autopilotTier={(t) => autopilotTier(tileBox(t))}
                  graphAxis={(t) => tileBox(t).height >= GRAPH_FIT.axisHeight}
                  tileWidth={(t) => tileBox(t).width}
                  timeZone={layout.settings?.timeZone?.posix}
                  charts={charts}
                  tileSize={tileBox}
                  night={layout.theme === 'night'}
                  fontLines={fontLines}
                  textSize={(t) =>
                    t.type === 'value'
                      ? valueTextSize(
                          fontLines,
                          tileBox(t),
                          t,
                          t.path ? formatValue(shownValues.get(t.path), t.unit, t.decimals) : undefined,
                          digitLines,
                        )
                      : undefined
                  }
                  problemTileIds={problemTileIds}
                  supported={supported}
                  newTileDrag={newTileDrag}
                  onSelect={(id) => setSelection(id ? { id } : undefined)}
                  onSelectSlot={(id, slot) => setSelection({ id, slot })}
                  onMove={(id, x, y) => edit(moveTile(layout, index, id, x, y), 'That spot is taken.')}
                  onResize={(id, w, h) => edit(resizeTile(layout, index, id, w, h), 'Not enough room to grow there.')}
                  onDropNew={(type, cell) => add(type, cell)}
                  onDragNewEnd={() => setNewTileDrag(null)}
                />
              )}
              <FooterPreview layout={layout} index={index} />
            </div>
            <section className="problems" aria-label="Problems">
              {problems.length === 0 ? (
                <span className="ok">No problems</span>
              ) : (
                <ul>
                  {problemTargets.map(({ problem: p, target }) => (
                    <li key={`${p.pointer}|${p.code}`}>
                      <button
                        className="link"
                        onClick={() => {
                          if (!target) return;
                          showPage(
                            target.page,
                            target.tileId ? { id: target.tileId, slot: target.slot } : undefined,
                          );
                        }}
                      >
                        {describeProblem(layout, p.code, p.pointer, target)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className="hint">{devices.length === 0 ? 'Waiting for a display.' : 'Select a display.'}</p>
        )}
      </main>

      {settingsOpen && layout && (
        <SettingsDrawer
          layout={layout}
          backlight={device?.hello.capabilities.backlight === true}
          canRotate={device?.hello.capabilities.rotation === true}
          sound={device?.hello.capabilities.sound === true}
          paths={paths}
          values={shownValues}
          onChange={(patch) => edit(updateSettings(layout, patch))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {tile?.type === 'chart' && layout && (
        <ChartDrawer
          key={tile.id}
          tile={tile}
          charts={charts}
          supported={supported.has('chart')}
          sizeHint={chartSizeHint(tilePx(tile), !!device)}
          paths={paths}
          values={shownValues}
          onChange={(patch) => edit(updateChartTile(layout, index, tile.id, patch))}
          onDelete={() => {
            edit(removeTile(layout, index, tile.id));
            setSelection(undefined);
          }}
          onClose={() => setSelection(undefined)}
        />
      )}
      {tile && tile.type !== 'chart' && layout && (
        <TileDrawer
          key={tile.id}
          tile={tile}
          paths={paths}
          values={shownValues}
          supported={supported.has(tile.type)}
          sizeHint={
            tile.type === 'wind_rose'
              ? sizeHint(tilePx(tile), !!device)
              : tile.type === 'autopilot'
                ? autopilotHint(tileBox(tile), !!device)
                : tile.type === 'graph'
                  ? graphHint(tileBox(tile), !!device)
                  : undefined
          }
          openSlot={selection?.slot}
          theme={layout.theme}
          mono={mono}
          historyCount={historyCount(layout)}
          onRoseHistory={(name, on) => edit(setRoseHistory(layout, index, tile.id, name, on))}
          onChange={(patch) => edit(updateTile(layout, index, tile.id, patch))}
          onConfig={(patch) => edit(setTileConfig(layout, index, tile.id, patch))}
          onSlot={(slot, patch) => edit(updateSlot(layout, index, tile.id, slot, patch))}
          onEngineSlot={(slot, patch) => edit(updateEngineSlot(layout, index, tile.id, slot, patch))}
          onDelete={() => {
            edit(removeTile(layout, index, tile.id));
            setSelection(undefined);
          }}
          onClose={() => setSelection(undefined)}
        />
      )}
    </div>
  );
}

function sizeHint(px: number, known: boolean): string {
  const where = known ? 'on this display' : 'on a 480×480 display';
  return `About ${px} px ${where}: ${ROSE_TIER_TEXT[roseTier(px)]}.`;
}

function chartSizeHint(px: number, known: boolean): string {
  const where = known ? 'on this display' : 'on a 480×480 display';
  const what =
    px >= CHART_FIT.info
      ? 'the map with zoom buttons and the position line'
      : px >= CHART_FIT.buttons
        ? `the map with zoom buttons; ${CHART_FIT.info} px or more adds the position line`
        : `the map only (an anchor alarm frames it in red); ${CHART_FIT.buttons} px or more adds zoom buttons`;
  return `About ${px} px ${where}: ${what}.`;
}

function autopilotHint(box: { width: number; height: number }, known: boolean): string {
  const where = known ? 'on this display' : 'on a 480×480 display';
  return `About ${box.width}×${box.height} px ${where}: ${AUTOPILOT_TIER_TEXT[autopilotTier(box)]}.`;
}

function graphHint(box: { width: number; height: number }, known: boolean): string {
  const where = known ? 'on this display' : 'on a 480×480 display';
  const what =
    box.height >= GRAPH_FIT.axisHeight
      ? 'the line with its range and time labels'
      : `the line only; ${GRAPH_FIT.axisHeight} px high or more shows its range and time labels`;
  return `About ${box.width}×${box.height} px ${where}: ${what}.`;
}

function aspectFor(display: { width: number; height: number } | undefined) {
  if (!display) return 1;
  // The footer takes a strip at the bottom of the display (ADR-0025: on every layout).
  return display.width / (display.height * 0.89);
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
  INVALID_ZONE: 'a zone ends before it starts',
  ZONE_OUT_OF_RANGE: 'a zone lies outside min..max',
  DUPLICATE_ID: 'the same id is used twice',
};

function describeProblem(
  layout: Layout,
  code: string,
  pointer: string,
  target: ReturnType<typeof targetForPointer>,
): string {
  const page = target ? layout.pages[target.page] : undefined;
  const tile = page?.tiles.find((t) => t.id === target?.tileId);
  const text = /^\/pages\/\d+\/tiles\/\d+\/chart$/.test(pointer)
    ? 'choose a chart'
    : pointer.startsWith('/settings/timeZone')
      ? 'the time zone is not one the display can read: pick it again in Display settings'
    : code === 'INVALID_RANGE' && tile?.type === 'graph' && (tile.min === undefined || tile.max === undefined)
      ? 'a fixed range needs both min and max'
      : code === 'INVALID_RANGE' && pointer.endsWith('/min') && 'centerZero' in (tile ?? {})
        ? 'a centre-zero scale needs min below 0 and max above 0'
        : (PROBLEM_TEXT[code] ?? `${code} at ${pointer}`);
  const where = [
    layout.pages.length > 1 && page ? (page.title ?? page.id) : undefined,
    target?.tileId,
    target?.slot ? SLOT_TITLES[target.slot] : undefined,
  ].filter(Boolean);
  return where.length > 0 ? `${where.join(', ')}: ${text}` : text;
}
