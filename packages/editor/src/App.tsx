// ESPHelm editor: pick a display, edit the pages of its layout with live values (grids of
// tiles; wind roses are tiles with centre slots), Save & send. One layout per display (created
// on first save).
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CHART_DEFAULTS,
  DEFAULT_FONT_LINE_HEIGHTS,
  TEMPLATES,
  TILE_TYPES,
  validateLayout,
  type Layout,
  type Page,
  type ChartPage,
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
  moveTile,
  movePage,
  newLayoutFor,
  removePage,
  removeTile,
  renamePage,
  resizeTile,
  setGrid,
  setTileConfig,
  targetForPointer,
  tilePaths,
  pageTiles,
  updateChartPage,
  updateSettings,
  updateSlot,
  updateTile,
  type SlotName,
} from './layoutOps';
import { SettingsDrawer } from './components/SettingsDrawer';
import { GridCanvas, type NewTileDrag } from './components/GridCanvas';
import { PageTabs } from './components/PageTabs';
import { FooterPreview } from './components/Previews';
import { DeviceList, TileLibrary } from './components/Sidebar';
import { ChartDrawer, SLOT_TITLES, TileDrawer } from './components/TileDrawer';
import { ChartPreview } from './components/ChartPreview';
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
  slot?: SlotName;
}

/** SignalK paths a page shows (what the live preview subscribes to). */
function pagePaths(page: Page | undefined): string[] {
  if (!page) return [];
  if (page.kind === 'chart') {
    const c = { ...CHART_DEFAULTS, ...page.config };
    const anchor = page.anchor ?? CHART_DEFAULTS.anchor;
    return [c.positionPath, c.headingPath, ...(anchor ? [c.anchorPositionPath, c.anchorRadiusPath, c.anchorAlarmPath] : [])];
  }
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

export function App(props: { api?: Api; live?: () => LiveSource }) {
  const api = useMemo(() => props.api ?? createApi(), [props.api]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [devices, setDevices] = useState<Device[]>([]);
  const [paths, setPaths] = useState<PathInfo[]>([]);
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
    api.charts().then(setCharts, () => undefined);
    const loadPaths = () => api.paths().then(setPaths, () => undefined);
    void loadPaths();
    const timer = setInterval(loadPaths, 15000);
    return () => clearInterval(timer);
  }, [api, refreshDevices]);

  // Load (or start) the layout of the selected display.
  useEffect(() => {
    setSelection(undefined);
    setPageIndex(0);
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
  const grid = page?.kind === 'grid' ? page : undefined;
  const chartPage: ChartPage | undefined = page?.kind === 'chart' ? page : undefined;
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
    edit(r.layout);
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

  const tile = selection ? grid?.tiles.find((t) => t.id === selection.id) : undefined;
  const chartSelected = !!chartPage && selection?.id === chartPage.id;
  const drawerOpen = !!tile || chartSelected;
  const display = device?.hello.display ?? { width: 480, height: 480 };
  const largeDisplay = Math.min(display.width, display.height) >= 600;
  const tileBox = (t: Tile) => (layout ? tilePixels(display, layout, index, t) : { width: 0, height: 0 });
  const tilePx = (t: Tile) => {
    const { width, height } = tileBox(t);
    return Math.min(width, height);
  };
  const fontLines = device?.hello.fontLineHeights ?? DEFAULT_FONT_LINE_HEIGHTS;
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
                const first = added?.kind === 'chart' ? added : pageTiles(added)[0];
                showPage(r.index, first ? { id: first.id } : undefined);
              }}
              onAddTemplate={(id) => {
                const t = template(id);
                if (!t) return;
                const r = addTemplatePages(layout, t, index);
                edit(r.layout);
                showPage(r.index);
              }}
              onApplyTemplate={(id) => {
                const t = template(id);
                if (!t) return;
                edit(applyTemplate(layout, t));
                showPage(0);
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
            />
            {
              <div className="page-bar">
                {grid && (
                <label>
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
                <div
                  className="display-theme"
                  role="group"
                  aria-label="Display theme"
                  title="The display's colours; sent to the display with Save & send"
                >
                  <span>Display theme</span>
                  {(['day', 'night'] as const).map((t) => (
                    <button
                      key={t}
                      className={`small ${layout.theme === t ? 'on' : ''}`}
                      aria-pressed={layout.theme === t}
                      onClick={() => edit({ ...layout, theme: t })}
                    >
                      {t === 'day' ? 'Day' : 'Night'}
                    </button>
                  ))}
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
                  {device?.hello.display.width}×{device?.hello.display.height}
                </span>
              </div>
            }
            <div className="display-frame" data-theme-preview={layout.theme}>
              {grid && (
                <GridCanvas
                  page={grid}
                  aspect={aspectFor(device, layout)}
                  values={shownValues}
                  selectedId={tile?.id}
                  selectedSlot={selection?.slot}
                  roseTier={(t) => roseTier(tilePx(t))}
                  autopilotTier={(t) => autopilotTier(tileBox(t))}
                  textSize={(t) =>
                    t.type === 'value'
                      ? valueTextSize(
                          fontLines,
                          tileBox(t),
                          t,
                          t.path ? formatValue(shownValues.get(t.path), t.unit, t.decimals) : undefined,
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
              {chartPage && (
                <ChartPreview
                  page={chartPage}
                  chart={charts.find((c) => c.identifier === chartPage.chart)}
                  values={shownValues}
                  width={display.width}
                  height={Math.round(display.height * (layout.pages.length > 1 ? 0.89 : 1))}
                  night={layout.theme === 'night'}
                  onSelect={() => setSelection({ id: chartPage.id })}
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
          paths={paths}
          values={shownValues}
          onChange={(patch) => edit(updateSettings(layout, patch))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {chartPage && chartSelected && layout && (
        <ChartDrawer
          key={chartPage.id}
          page={chartPage}
          charts={charts}
          supported={supported.has('chart')}
          paths={paths}
          values={shownValues}
          onChange={(patch) => edit(updateChartPage(layout, index, patch))}
          onClose={() => setSelection(undefined)}
        />
      )}
      {tile && layout && (
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
                : undefined
          }
          openSlot={selection?.slot}
          onChange={(patch) => edit(updateTile(layout, index, tile.id, patch))}
          onConfig={(patch) => edit(setTileConfig(layout, index, tile.id, patch))}
          onSlot={(slot, patch) => edit(updateSlot(layout, index, tile.id, slot, patch))}
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

function autopilotHint(box: { width: number; height: number }, known: boolean): string {
  const where = known ? 'on this display' : 'on a 480×480 display';
  return `About ${box.width}×${box.height} px ${where}: ${AUTOPILOT_TIER_TEXT[autopilotTier(box)]}.`;
}

function aspectFor(device: { hello: { display: { width: number; height: number } } } | undefined, layout: Layout) {
  if (!device) return 1;
  // The footer takes a strip at the bottom of the display when there are several pages.
  const footer = layout.pages.length > 1 ? 0.11 : 0;
  return device.hello.display.width / (device.hello.display.height * (1 - footer));
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
  const text = /^\/pages\/\d+\/chart$/.test(pointer)
    ? 'choose a chart'
    : (PROBLEM_TEXT[code] ?? `${code} at ${pointer}`);
  const page = target ? layout.pages[target.page] : undefined;
  const where = [
    layout.pages.length > 1 && page ? (page.title ?? page.id) : undefined,
    target?.tileId,
    target?.slot ? SLOT_TITLES[target.slot] : undefined,
  ].filter(Boolean);
  return where.length > 0 ? `${where.join(', ')}: ${text}` : text;
}
