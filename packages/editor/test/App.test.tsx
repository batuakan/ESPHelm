// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Hello, Layout } from '@esphelm/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { createApi, type Device, type FirmwareImage, type PathInfo } from '../src/api';
import { layoutIdFor, pageTiles } from '../src/layoutOps';
import { exportFile } from '../src/share';
import type { LiveSource, ValueListener } from '../src/live';

const FIXTURES = join(__dirname, '../../schema/fixtures');
const p4 = JSON.parse(readFileSync(join(FIXTURES, 'hello/valid/p4.json'), 'utf8')) as Hello;

/** In-memory stand-in for the plugin's editor API, recording requests. */
function fakeServer(devices: Device[], firmware: FirmwareImage[] = []) {
  const layouts = new Map<string, Layout>();
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const paths: PathInfo[] = [
    { path: 'navigation.speedOverGround', units: 'm/s', description: 'Speed over ground', zones: null, value: 2.5, timestamp: null },
    { path: 'environment.depth.belowTransducer', units: 'm', description: null, zones: null, value: 12.4, timestamp: null },
  ];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const path = url.replace('/plugins/esphelm/api', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    requests.push({ method, path, body });
    if (path === '/devices') return json(devices);
    if (path === '/paths') return json(paths);
    if (path === '/charts')
      return json([
        { identifier: 'sea', name: 'Sea chart', format: 'png', tilemapUrl: '/tiles/sea/{z}/{x}/{y}.png', supported: true },
        { identifier: 'vec', name: 'Vector chart', format: 'pbf', tilemapUrl: '/v/{z}/{x}/{y}', supported: false },
      ]);
    if (path === '/widgets')
      return json({
        tiles: ['value', 'gauge', 'bar', 'switch', 'position', 'wind_rose', 'autopilot', 'graph', 'heading_tape', 'clock', 'engine'],
        tileSlots: { wind_rose: ['center1', 'center2', 'center3'] },
        units: {},
      });
    if (path === '/firmware') return json(firmware);
    const upd = /^\/devices\/(.+)\/update$/.exec(path);
    if (upd && method === 'POST') {
      const d = devices.find((x) => x.id === decodeURIComponent(upd[1] ?? ''))!;
      const buildId = (body as { buildId: string }).buildId;
      d.update = { request: 'r1', buildId, version: '0.5.0', state: 'requested', at: '2026-10-25T10:00:00Z' };
      d.updateAvailable = null;
      return json({ device: d }, 202);
    }
    const dev = /^\/devices\/(.+)$/.exec(path);
    if (dev && method === 'PUT') {
      const d = devices.find((x) => x.id === decodeURIComponent(dev[1] ?? ''))!;
      Object.assign(d, body);
      return json({ device: d, warnings: [] });
    }
    const lay = /^\/layouts\/(.+)$/.exec(path);
    if (lay && method === 'PUT') {
      layouts.set((body as Layout).id, body as Layout);
      return json({ id: (body as Layout).id, etag: '"e1"', bytes: 100, warnings: [] });
    }
    if (lay) return layouts.has(lay[1]!) ? json(layouts.get(lay[1]!)) : json({ error: 'UNKNOWN_LAYOUT' }, 404);
    return json({ error: 'NOT_FOUND' }, 404);
  };
  return { api: createApi(fetchImpl), requests, layouts };
}

function fakeLive() {
  const listeners = new Set<ValueListener>();
  let paths: string[] = [];
  const source: LiveSource = {
    setPaths: (p) => {
      paths = p;
    },
    onValue: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    close: () => undefined,
  };
  return {
    factory: () => source,
    emit: (path: string, value: unknown) => act(() => listeners.forEach((l) => l(path, value))),
    paths: () => paths,
  };
}

const device = (state: 'pending' | 'adopted'): Device => ({
  id: p4.deviceId,
  state,
  hello: p4,
  firstSeen: '2026-10-25T10:00:00Z',
  lastSeen: '2026-10-25T10:00:00Z',
  servedEtag: null,
});

afterEach(cleanup);

// jsdom renders of the whole editor take 1-2 s each, and more while the C++ contract tests compile
// in parallel; the 5 s default made the longest ones flaky.
describe('editor', { timeout: 20000 }, () => {
  it('adopts a pending display', async () => {
    const server = fakeServer([device('pending')]);
    render(<App api={server.api} live={fakeLive().factory} />);
    const list = await screen.findByRole('region', { name: 'Displays' });
    fireEvent.click(within(list).getByRole('button', { name: 'Adopt' }));
    await waitFor(() =>
      expect(server.requests).toContainEqual({ method: 'PUT', path: `/devices/${p4.deviceId}`, body: { state: 'adopted' } }),
    );
    expect((await screen.findByRole('status')).textContent).toMatch(/adopted/);
  });

  it('builds a tile with the path picker, blocks invalid labels, and saves & sends', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);

    // A new display starts with an empty page: Save & send is disabled until it has a tile.
    const save = await screen.findByRole('button', { name: 'Save & send' });
    await screen.findByText('Add at least one tile.');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // One page still has a footer: its title and the settings menu button, no page buttons.
    const footer = screen.getByLabelText('Display footer');
    expect(footer.textContent).not.toMatch(/1\/1|</);
    expect(within(footer).getByTitle('Settings on the display')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    await screen.findByText(/tile-1: pick a SignalK path/);

    // Pick a path: the unit defaults to knots for a speed.
    fireEvent.change(screen.getByLabelText('Search SignalK paths'), { target: { value: 'speed' } });
    fireEvent.click(screen.getByRole('option', { name: /navigation.speedOverGround/ }));
    expect((screen.getByLabelText('Display unit') as HTMLSelectElement).value).toBe('kn');
    // Units offered are only those that fit m/s.
    const options = within(screen.getByLabelText('Display unit')).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options).toEqual(['', 'mps', 'kn', 'kmh', 'mph']);

    // Live values are subscribed and shown converted.
    expect(live.paths()).toEqual(['navigation.speedOverGround']);
    live.emit('navigation.speedOverGround', 5.0);
    within(screen.getByTestId('tile-tile-1')).getByText('9.7');

    // A label with a glyph the display lacks is flagged and blocks sending.
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Fahrt ä' } });
    await screen.findByText(/tile-1: the label has characters/);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'SOG' } });
    await screen.findByText('No problems');
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(save);
    await screen.findByText(/Sent to/);
    const layoutId = `display-${p4.deviceId}`;
    expect(server.layouts.get(layoutId)).toEqual({
      version: 1,
      id: layoutId,
      theme: 'night',
      pages: [
        {
          kind: 'grid',
          id: 'main',
          title: 'Main',
          grid: { cols: 2, rows: 2 },
          tiles: [{ type: 'value', id: 'tile-1', x: 0, y: 0, w: 1, h: 1, path: 'navigation.speedOverGround', unit: 'kn', label: 'SOG' }],
        },
      ],
    });
    expect(server.requests).toContainEqual({
      method: 'PUT',
      path: `/devices/${p4.deviceId}`,
      body: { layoutId },
    });
  });

  it('adds a wind-rose page, fills a slot and saves both pages', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));

    // A wind rose page is a 1x1 grid with one rose tile, selected right away.
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wind rose page' }));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Wind');
    expect(screen.getByLabelText('Display footer').textContent).toMatch(/Wind 2\/2/);
    expect(live.paths()).toEqual([
      'environment.wind.angleApparent',
      'environment.wind.directionTrue',
      'navigation.headingTrue',
    ]);
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    // 720x720 display, 1x1 grid, footer: a full-size rose.
    expect(within(drawer).getByText(/^About \d+ px on this display: full/)).toBeTruthy();

    // Tapping a slot on the rose opens that slot's section in the drawer.
    fireEvent.click(screen.getByTestId('slot-wind-1-rose-center1'));
    const section = within(drawer).getByTestId('slot-section-center1');
    expect((section as HTMLDetailsElement).open).toBe(true);
    fireEvent.change(within(section).getByLabelText('Search SignalK paths'), {
      target: { value: 'depth' },
    });
    fireEvent.click(within(section).getByRole('option', { name: /belowTransducer/ }));
    fireEvent.change(within(section).getByLabelText('Label'), { target: { value: 'Depth' } });
    live.emit('environment.depth.belowTransducer', 4.25);
    within(screen.getByTestId('slot-wind-1-rose-center1')).getByText('4.3');
    within(screen.getByTestId('slot-wind-1-rose-center1')).getByText('Depth m');

    // Rename and reorder: the rose page becomes the first page.
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Sailing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move page left' }));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Sailing', 'Main']);

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    const saved = server.layouts.get(`display-${p4.deviceId}`)!;
    expect(saved.pages.map((p) => [p.id, p.title, pageTiles(p).map((t) => t.type)])).toEqual([
      ['wind-1', 'Sailing', ['wind_rose']],
      ['main', 'Main', ['value']],
    ]);
    expect(pageTiles(saved.pages[0])[0]).toMatchObject({
      slots: { center1: { path: 'environment.depth.belowTransducer', unit: 'm', label: 'Depth' } },
    });
  });

  it('sets a corner value on a wind rose', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wind rose page' }));
    fireEvent.click(screen.getByTestId('tile-wind-1-rose'));
    fireEvent.click(screen.getByTestId('slot-wind-1-rose-topLeft'));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    const section = within(drawer).getByTestId('slot-section-topLeft');
    expect((section as HTMLDetailsElement).open).toBe(true);
    expect(section.textContent).toMatch(/Top left corner/);
    fireEvent.change(within(section).getByLabelText('Search SignalK paths'), { target: { value: 'depth' } });
    fireEvent.click(within(section).getByRole('option', { name: /belowTransducer/ }));
    live.emit('environment.depth.belowTransducer', 7.44);
    within(screen.getByTestId('slot-wind-1-rose-topLeft')).getByText('7.4');
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(pageTiles(server.layouts.get(`display-${p4.deviceId}`)!.pages[1])[0]).toMatchObject({
      slots: { topLeft: { path: 'environment.depth.belowTransducer', unit: 'm' } },
    });
  });

  it('adds a wind rose tile next to other tiles and warns when it is small', async () => {
    const server = fakeServer([device('adopted')]);
    render(<App api={server.api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Wind rose/ }));
    let drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    // 2x2 of a 4x4 grid at 720: about 330 px, full.
    expect(within(drawer).getByText(/full/)).toBeTruthy();
    const resize = within(screen.getByTestId('tile-rose-1')).getByLabelText('Resize');
    expect(resize).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(screen.getByRole('button', { name: /Wind rose/ }));
    drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    // The second rose only gets 1x1 (about 150 px): compact or pointers only.
    expect(within(drawer).getByText(/compact|pointers only/)).toBeTruthy();
    expect(within(screen.getByTestId('grid')).getAllByTestId(/^rose-rose-/)).toHaveLength(2);
  });

  it('edits gauge range and zones and flags a zone outside the range', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /Gauge/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }));
    expect((screen.getByLabelText('Zone 1 from') as HTMLInputElement).value).toBe('9.6');
    expect((screen.getByLabelText('Zone 1 state') as HTMLSelectElement).value).toBe('alarm');
    await screen.findByText('No problems');
    fireEvent.change(screen.getByLabelText('Zone 1 to'), { target: { value: '20' } });
    await screen.findByText(/tile-1: a zone lies outside min..max/);
    fireEvent.change(screen.getByLabelText('Zone 1 to'), { target: { value: '12' } });
    await screen.findByText('No problems');
    live.emit('navigation.speedOverGround', 5.0);
    within(screen.getByTestId('tile-tile-1')).getByText(/9.7 kn/);

    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]).toMatchObject({
      tiles: [{ type: 'gauge', min: 0, max: 12, zones: [{ from: 9.6, to: 12, state: 'alarm' }] }],
    });
  });

  it('makes a gauge centre zero: symmetric range, side text, plus/minus, and saves it', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /Gauge/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('Centre zero'));
    expect((screen.getByLabelText('Minimum') as HTMLInputElement).value).toBe('-10');
    await screen.findByText('No problems');
    const tile = screen.getByTestId('tile-tile-1');
    live.emit('navigation.speedOverGround', -2.5); // -4.9 kn: port side
    within(tile).getByText('4.9 kn P');
    expect(tile.querySelector('.cz-fill.side-port')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Sides'), { target: { value: 'plusMinus' } });
    within(tile).getByText('-4.9 kn');
    // Min not below zero: the layout is refused.
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '0' } });
    await screen.findByText(/centre-zero scale needs min below 0/);
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '-10' } });
    await screen.findByText('No problems');

    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]).toMatchObject({
      tiles: [{ type: 'gauge', min: -10, max: 10, centerZero: true, sides: 'plusMinus' }],
    });
  });

  it('starts from a template after confirming', async () => {
    const server = fakeServer([device('adopted')]);
    render(<App api={server.api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Engine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Engine']);
    await screen.findByText('No problems');
    // One engine tile (ADR-0032) with the RPM arc and its oil, fuel and coolant gauges.
    expect(screen.getByTestId('engine-engine-p0')).toBeTruthy();
    expect(within(screen.getByTestId('grid')).getAllByText('RPM')).toHaveLength(1);
  });

  it('adds an autopilot next to other tiles; modes and size hint', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Autopilot/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    // 2x2 of the 2x2 grid on 720x720: controls.
    expect(within(drawer).getByText(/course and mode buttons/)).toBeTruthy();
    expect([...live.paths()].sort()).toEqual([
      'navigation.headingMagnetic',
      'steering.autopilot.state',
      'steering.autopilot.target',
    ]);
    fireEvent.click(within(drawer).getByRole('checkbox', { name: 'WIND' }));
    live.emit('steering.autopilot.state', 'auto');
    live.emit('steering.autopilot.target', Math.PI);
    const preview = screen.getByTestId('autopilot-pilot-1');
    within(preview).getByText('AUTO', { selector: '.ap-state' });
    expect(preview.textContent).toMatch(/TGT 180°/);
    expect(within(preview).queryByText('WIND')).toBeNull();
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(pageTiles(server.layouts.get(`display-${p4.deviceId}`)!.pages[0])).toEqual([
      { type: 'autopilot', id: 'pilot-1', x: 0, y: 0, w: 2, h: 2, modes: ['auto', 'route'] },
    ]);

    // Shrunk to one cell of a 3x3 grid it would be status only.
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '3' } });
    expect(within(drawer).getByText(/course and mode buttons/)).toBeTruthy(); // still 2x2
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Autopilot page' }));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Autopilot');
  });

  it('keeps the whole-layout controls in the layout bar, the grid size with the page', async () => {
    const server = fakeServer([device('adopted')]);
    render(<App api={server.api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    const bar = screen.getByRole('toolbar', { name: 'Layout' });
    for (const name of ['Templates', 'Share', 'Display settings'])
      expect(within(bar).getByRole('button', { name })).toBeTruthy();
    expect(within(bar).getByRole('group', { name: 'Display theme' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Pages' });
    expect(within(tabs).queryByRole('button', { name: 'Templates' })).toBeNull();
    expect(within(bar).queryByLabelText('Columns')).toBeNull();
    expect(screen.getByLabelText('Columns').closest('.page-tools')).toBeTruthy();
    // A layout bar menu opens, and opening the other one closes it.
    fireEvent.click(within(bar).getByRole('button', { name: 'Templates' }));
    expect(screen.getByRole('menu', { name: 'Start from template' })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Share' }));
    expect(screen.queryByRole('menu', { name: 'Start from template' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Share layout' })).toBeTruthy();
  });

  it('sets the display theme in the layout, and the preview follows it', async () => {
    const server = fakeServer([device('adopted')]);
    render(<App api={server.api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    const group = screen.getByRole('group', { name: 'Display theme' });
    const frame = () => screen.getByTestId('grid').closest('.display-frame') as HTMLElement;
    expect(frame().dataset.themePreview).toBe('night'); // new layouts start at night
    // The editor's own theme does not change the display's.
    fireEvent.click(screen.getByRole('button', { name: 'light theme' }));
    expect(frame().dataset.themePreview).toBe('night');
    fireEvent.click(within(group).getByRole('button', { name: 'Day' }));
    expect(frame().dataset.themePreview).toBe('day');
    expect(within(group).getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.theme).toBe('day');
    // The dark theme (ADR-0034).
    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));
    expect(frame().dataset.themePreview).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await waitFor(() => expect(server.layouts.get(`display-${p4.deviceId}`)!.theme).toBe('dark'));
  });

  it('offers the dark theme only to displays that render it', async () => {
    const d = device('adopted');
    d.hello = { ...p4, capabilities: { touch: true, put: true, backlight: true } };
    render(<App api={fakeServer([d]).api} live={fakeLive().factory} />);
    const group = await screen.findByRole('group', { name: 'Display theme' });
    const dark = within(group).getByRole('button', { name: 'Dark' }) as HTMLButtonElement;
    expect(dark.disabled).toBe(true);
    expect(dark.title).toMatch(/Update this display's firmware/);
    expect((within(group).getByRole('button', { name: 'Day' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a mono display in black and white, without colour choices (ADR-0035)', async () => {
    const d = device('adopted');
    d.hello = {
      ...p4,
      display: { width: 400, height: 300, rotation: 0, kind: 'mono' },
      widgets: ['value', 'bar', 'clock', 'position'],
      capabilities: { touch: false, put: true, darkTheme: true },
    };
    const server = fakeServer([d]);
    const { container } = render(<App api={server.api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    expect(within(drawer).queryByLabelText('Colour')).toBeNull();
    within(drawer).getByText('Zones by value');
    expect(container.querySelector('.display-frame')?.getAttribute('data-display-kind')).toBe('mono');
    const group = screen.getByRole('group', { name: 'Display theme' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Plain', 'Inverted']);
    fireEvent.click(within(group).getByRole('button', { name: 'Inverted' }));
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.theme).toBe('dark');
  });

  it('keeps colour choices for a colour display', async () => {
    const { container } = render(<App api={fakeServer([device('adopted')]).api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    within(drawer).getByLabelText('Colour');
    within(drawer).getByText('Colour by value');
    expect(container.querySelector('.display-frame')?.hasAttribute('data-display-kind')).toBe(false);
    const group = screen.getByRole('group', { name: 'Display theme' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Day', 'Dark', 'Night']);
  });

  it('adds a chart page (a chart tile), picks a chart and previews it at the position', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chart page' }));
    await screen.findByText(/Chart, chart-1-map: choose a chart/);
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    const select = within(drawer).getByLabelText('Chart') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.disabled])).toEqual([
      ['', true],
      ['sea', false],
      ['vec', true],
    ]);
    fireEvent.change(select, { target: { value: 'sea' } });
    fireEvent.change(within(drawer).getByLabelText('Zoom'), { target: { value: '12' } });
    expect(live.paths()).toEqual([
      'navigation.position',
      'navigation.headingTrue',
      'navigation.anchor.position',
      'navigation.anchor.maxRadius',
      'notifications.navigation.anchor',
    ]);
    live.emit('navigation.position', { latitude: 60.15, longitude: 24.95 });
    const preview = screen.getByTestId('chart-chart-1-map');
    const hrefs = [...preview.querySelectorAll('image')].map((i) => i.getAttribute('href'));
    // z12 at 60.15N 24.95E is tile 2331/1186.
    expect(hrefs).toContain('/tiles/sea/12/2331/1186.png');
    expect(preview.textContent).toMatch(/60\.1500 N\s+24\.9500 E\s+z12/);
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[1]).toEqual({
      kind: 'grid',
      id: 'chart-1',
      title: 'Chart',
      grid: { cols: 1, rows: 1 },
      tiles: [{ type: 'chart', id: 'chart-1-map', x: 0, y: 0, w: 1, h: 1, chart: 'sea', zoom: 12 }],
    });
  });

  it('adds a position tile, previews the live position in each format and saves it', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Position/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    expect(live.paths()).toEqual(['navigation.position']);
    live.emit('navigation.position', { latitude: 60.15, longitude: 24.95 });
    const preview = screen.getByTestId('position-pos-1');
    expect(preview.textContent).toBe("60° 09.000' N024° 57.000' E");
    // Every format shows an example from the live value.
    within(drawer).getByText(/60\.15000° N\s+24\.95000° E/);
    fireEvent.click(within(drawer).getByLabelText('Degrees, minutes and seconds'));
    expect(preview.textContent).toBe('60° 09\' 00.0" N024° 57\' 00.0" E');
    fireEvent.change(within(drawer).getByLabelText('Decimals'), { target: { value: '2' } });
    expect(preview.textContent).toBe('60° 09\' 00.00" N024° 57\' 00.00" E');
    live.emit('navigation.position', { latitude: 'nowhere' });
    expect(preview.textContent).toBe('--');
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]).toMatchObject({
      tiles: [{ type: 'position', id: 'pos-1', w: 2, h: 1, label: 'Position', format: 'dms', decimals: 2 }],
    });
  });

  it('adds a graph tile: window, fixed range, a zone, the history counter, and saves it', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Graph/ }));
    fireEvent.change(screen.getByLabelText('Search SignalK paths'), { target: { value: 'depth' } });
    fireEvent.click(screen.getByRole('option', { name: /environment.depth.belowTransducer/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    within(drawer).getByText(/Recording 1 value in this layout/);
    live.emit('environment.depth.belowTransducer', 2.5);
    const tile = screen.getByTestId('tile-graph-1');
    within(tile).getByRole('img', { name: 'Graph' });
    expect(within(tile).getByText('2.5 m').className).not.toMatch(/value-zone/);

    fireEvent.change(within(drawer).getByLabelText('Window'), { target: { value: '1h' } });
    fireEvent.click(within(drawer).getByLabelText('Fixed range'));
    fireEvent.change(within(drawer).getByLabelText('Maximum'), { target: { value: '20' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add zone' }));
    fireEvent.change(within(drawer).getByLabelText('Zone 1 to'), { target: { value: '3' } });
    // At 2.5 m the value is in the alarm zone.
    expect(within(tile).getByText('2.5 m').className).toMatch(/value-zone-alarm/);

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]).toMatchObject({
      tiles: [
        {
          type: 'graph',
          id: 'graph-1',
          w: 2,
          h: 1,
          path: 'environment.depth.belowTransducer',
          unit: 'm',
          window: '1h',
          min: 0,
          max: 20,
          zones: [{ to: 3, state: 'alarm' }],
        },
      ],
    });
  });

  it('adds an engine tile: live needles, a slot icon and range, and saves it', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Engine/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    expect([...live.paths()].sort()).toEqual([
      'propulsion.p0.oilPressure',
      'propulsion.p0.revolutions',
      'propulsion.p0.temperature',
      'tanks.fuel.0.currentLevel',
    ]);
    const preview = screen.getByTestId('engine-engine-1');
    expect(preview.querySelectorAll('.needle')).toHaveLength(0); // no values yet
    within(preview).getByText('x100');
    live.emit('propulsion.p0.revolutions', 30); // 1800 rpm
    live.emit('propulsion.p0.oilPressure', 350000);
    expect(preview.querySelectorAll('.needle')).toHaveLength(2);
    expect(preview.querySelectorAll('.icon')).toHaveLength(3);

    fireEvent.click(within(drawer).getByText('Left gauge'));
    const left = within(drawer).getByTestId('slot-section-left');
    fireEvent.change(within(left).getByLabelText('Icon of the left gauge'), { target: { value: 'none' } });
    fireEvent.change(within(left).getByLabelText('Maximum'), { target: { value: '8' } });
    // No icon: the label instead, where one of the display's fonts fits the slot (not at this size).
    expect(preview.querySelectorAll('.icon')).toHaveLength(2);
    fireEvent.click(within(within(drawer).getByTestId('slot-section-right')).getByText('Empty this slot'));

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    const saved = pageTiles(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]!)[0] as {
      slots: Record<string, Record<string, unknown>>;
    };
    expect(saved).toMatchObject({ type: 'engine', id: 'engine-1', w: 2, h: 2, max: 5000 });
    expect(Object.keys(saved.slots)).toEqual(['left', 'bottom']);
    expect(saved.slots.left).toMatchObject({ max: 8 });
    expect(saved.slots.left).not.toHaveProperty('icon');
  });

  it("hints an engine tile's empty corners with a +, which opens that corner", async () => {
    render(<App api={fakeServer([device('adopted')]).api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Engine/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    for (const name of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
      const plus = screen.getByTestId(`slot-engine-1-${name}`);
      expect(plus.tagName).toBe('BUTTON');
      expect(plus.textContent).toBe('+');
    }
    const corner = screen.getByTestId('slot-engine-1-bottomRight');
    fireEvent.click(corner);
    expect((within(drawer).getByTestId('slot-section-bottomRight') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByTestId('slot-engine-1-bottomRight').className).toMatch(/\bselected\b/);
  });

  it('puts a value in an engine tile corner, shown where it fits outside the arc', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Engine/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    const section = within(drawer).getByTestId('slot-section-topLeft');
    expect(section.textContent).toMatch(/Top left corner/);
    fireEvent.change(within(section).getByLabelText('Search SignalK paths'), { target: { value: 'depth' } });
    fireEvent.click(within(section).getByRole('option', { name: /belowTransducer/ }));
    live.emit('environment.depth.belowTransducer', 7.44);
    const corner = screen.getByTestId('slot-engine-1-topLeft');
    within(corner).getByText('7.4');
    within(corner).getByText('m');
    // A tap on it opens its section.
    fireEvent.click(within(drawer).getByText('Revolutions (the large arc)'));
    fireEvent.click(corner);
    expect((within(drawer).getByTestId('slot-section-topLeft') as HTMLDetailsElement).open).toBe(true);
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(pageTiles(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]!)[0]).toMatchObject({
      slots: { topLeft: { path: 'environment.depth.belowTransducer', unit: 'm' } },
    });
  });

  it('adds a heading tape: live heading, markers, the true/magnetic hint, and saves it', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Heading tape/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    expect(live.paths()).toEqual([
      'navigation.headingTrue',
      'navigation.courseOverGroundTrue',
      'navigation.course.calcValues.bearingTrue',
      'steering.autopilot.target',
    ]);
    const preview = screen.getByTestId('tape-tape-1');
    expect(within(preview).getByText('--')).toBeTruthy();
    live.emit('navigation.headingTrue', (355 * Math.PI) / 180);
    live.emit('navigation.courseOverGroundTrue', (10 * Math.PI) / 180);
    within(preview).getByText('355°T');
    within(preview).getByText('N'); // north is on the tape
    expect(preview.querySelector('.tape-marker.cog')).not.toBeNull();
    expect(preview.querySelector('.tape-marker.bearing')).toBeNull(); // no value: not drawn

    fireEvent.click(within(drawer).getByLabelText('Bearing to the next waypoint'));
    fireEvent.click(within(drawer).getByLabelText('Autopilot target'));
    fireEvent.change(within(drawer).getByLabelText('Span'), { target: { value: '60' } });
    expect(within(drawer).queryByText(/off by the magnetic variation/)).toBeNull();
    // A magnetic heading with a true COG: the drawer says they disagree.
    const headingSearch = within(drawer).getByLabelText('Search Heading');
    fireEvent.change(headingSearch, { target: { value: 'navigation.headingMagnetic' } });
    fireEvent.keyDown(headingSearch, { key: 'Enter' });
    within(drawer).getByText(/The heading is magnetic; the course over ground isn't/);

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]).toMatchObject({
      tiles: [
        {
          type: 'heading_tape',
          id: 'tape-1',
          w: 2,
          h: 1,
          span: 60,
          markers: ['cog'],
          config: { headingPath: 'navigation.headingMagnetic' },
        },
      ],
    });
  });

  it('adds a clock: no paths, its formats, a time zone and the screen saver, and saves them', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Clock/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    expect(live.paths()).toEqual([]); // the display's own clock
    const preview = screen.getByTestId('clock-clock-1');
    expect(preview.querySelector('.clock-time')?.textContent).toMatch(/^\d\d:\d\d$/);
    expect(preview.querySelector('.clock-date')?.textContent).toMatch(/^\d{4}-\d\d-\d\d$/);
    fireEvent.click(within(drawer).getByLabelText('12-hour clock'));
    fireEvent.click(within(drawer).getByLabelText('Wed 4 Nov'));
    expect(preview.querySelector('.clock-suffix')?.textContent).toMatch(/^(AM|PM)$/);
    expect(preview.querySelector('.clock-date')?.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);

    fireEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    const settings = screen.getByRole('complementary', { name: 'Display settings' });
    expect(within(settings).queryByLabelText('Screen saver')).toBeNull(); // only with a timeout
    fireEvent.change(within(settings).getByLabelText('Screen timeout'), { target: { value: '120' } });
    fireEvent.change(within(settings).getByLabelText('Screen saver'), { target: { value: 'both' } });
    fireEvent.change(within(settings).getByLabelText('Screen saver brightness'), { target: { value: '8' } });
    fireEvent.change(within(settings).getByLabelText('Time zone'), { target: { value: 'Europe/Stockholm' } });
    within(settings).getByText(/\(UTC\+0[12]:00\)/);

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    const saved = server.layouts.get(`display-${p4.deviceId}`)!;
    expect(saved.pages[0]).toMatchObject({
      tiles: [{ type: 'clock', id: 'clock-1', w: 1, h: 1, show: 'both', hour12: true, dateFormat: 'weekday' }],
    });
    expect(saved.settings).toEqual({
      screenTimeout: 120,
      screenSaver: 'both',
      screenSaverBrightness: 8,
      timeZone: { name: 'Europe/Stockholm', posix: '<+01>-1<+02>,M3.5.0,M10.5.0/3' },
    });
  });

  it('colours a value tile: fixed colour, open-ended zones over it, and saves both', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.change(screen.getByLabelText('Search SignalK paths'), { target: { value: 'speed' } });
    fireEvent.click(screen.getByRole('option', { name: /navigation.speedOverGround/ }));
    const drawer = screen.getByRole('complementary', { name: 'Tile settings' });
    live.emit('navigation.speedOverGround', 5.0); // 9.7 kn
    const number = within(screen.getByTestId('tile-tile-1')).getByText('9.7');
    expect(number.className).not.toMatch(/value-(color|zone)/);

    fireEvent.change(within(drawer).getByLabelText('Colour'), { target: { value: 'blue' } });
    expect(number.className).toMatch(/value-color-blue/);

    // A zone with only a lower bound ("8 kn or more"): it wins over the colour.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add zone' }));
    fireEvent.change(within(drawer).getByLabelText('Zone 1 to'), { target: { value: '' } });
    fireEvent.change(within(drawer).getByLabelText('Zone 1 from'), { target: { value: '8' } });
    fireEvent.change(within(drawer).getByLabelText('Zone 1 state'), { target: { value: 'warn' } });
    expect(number.className).toMatch(/value-zone-warn/);
    live.emit('navigation.speedOverGround', 3.0); // 5.8 kn: below the zone, the colour again
    expect(within(screen.getByTestId('tile-tile-1')).getByText('5.8').className).toMatch(/value-color-blue/);

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[0]).toMatchObject({
      tiles: [{ type: 'value', id: 'tile-1', color: 'blue', zones: [{ from: 8, state: 'warn' }] }],
    });
    const saved = (server.layouts.get(`display-${p4.deviceId}`)!.pages[0] as { tiles: { zones: object[] }[] })
      .tiles[0]!.zones[0]!;
    expect('to' in saved).toBe(false); // a cleared bound is left out, not kept as undefined
  });

  it('edits the display settings and sends them with the layout', async () => {
    const d = { ...device('adopted'), layoutId: `display-${p4.deviceId}` };
    const server = fakeServer([d]);
    const { settings: _s, ...twoPages } = JSON.parse(
      readFileSync(join(FIXTURES, 'valid/settings.json'), 'utf8'),
    ) as Layout;
    void _s;
    server.layouts.set(d.layoutId, { ...twoPages, id: d.layoutId });
    render(<App api={server.api} live={fakeLive().factory} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Display settings' }));
    const drawer = screen.getByRole('complementary', { name: 'Display settings' });
    // The P4 can dim its backlight: no warning, sliders enabled.
    expect(within(drawer).queryByText(/can't dim its backlight/)).toBeNull();
    fireEvent.change(within(drawer).getByLabelText('Day brightness'), { target: { value: '80' } });
    fireEvent.change(within(drawer).getByLabelText('Night brightness'), { target: { value: '10' } });
    fireEvent.change(within(drawer).getByLabelText('Start page'), { target: { value: 'second' } });
    fireEvent.click(within(drawer).getByLabelText('Auto day/night'));
    fireEvent.change(within(drawer).getByLabelText('Screen timeout'), { target: { value: '120' } });
    // The P4 has a speaker (ADR-0033).
    expect(within(drawer).queryByText(/has no speaker/)).toBeNull();
    fireEvent.change(within(drawer).getByRole('slider', { name: 'Volume' }), { target: { value: '35' } });
    fireEvent.click(within(drawer).getByLabelText('Touch sounds'));
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(d.layoutId)!.settings).toEqual({
      brightness: { day: 80, night: 10 },
      startPage: 'second',
      autoTheme: 'sun',
      screenTimeout: 120,
      sound: { volume: 35, touch: false },
    });
  });

  it('says when a display cannot dim its backlight', async () => {
    const d = device('adopted');
    d.hello = { ...p4, capabilities: { touch: true, put: true } };
    render(<App api={fakeServer([d]).api} live={fakeLive().factory} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Display settings' }));
    const drawer = screen.getByRole('complementary', { name: 'Display settings' });
    within(drawer).getByText(/can't dim its backlight/);
    expect((within(drawer).getByLabelText('Day brightness') as HTMLInputElement).disabled).toBe(true);
  });

  it('says when a display has no speaker', async () => {
    const d = device('adopted');
    d.hello = { ...p4, capabilities: { touch: true, put: true, backlight: true } };
    render(<App api={fakeServer([d]).api} live={fakeLive().factory} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Display settings' }));
    const drawer = screen.getByRole('complementary', { name: 'Display settings' });
    within(drawer).getByText(/has no speaker/);
    expect((within(drawer).getByRole('slider', { name: 'Volume' }) as HTMLInputElement).disabled).toBe(true);
    expect((within(drawer).getByLabelText('Touch sounds') as HTMLInputElement).disabled).toBe(true);
  });

  it('greys out tile types the display cannot render', async () => {
    const d = device('adopted');
    d.hello = { ...p4, widgets: ['value'] };
    render(<App api={fakeServer([d]).api} live={fakeLive().factory} />);
    const library = await screen.findByRole('region', { name: 'Tiles' });
    await waitFor(() =>
      expect((within(library).getByRole('button', { name: /Gauge/ }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect((within(library).getByRole('button', { name: /Value/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists the tile types alphabetically', async () => {
    render(<App api={fakeServer([device('adopted')]).api} live={fakeLive().factory} />);
    const library = await screen.findByRole('region', { name: 'Tiles' });
    await waitFor(() => expect(within(library).getAllByRole('button').length).toBeGreaterThan(5));
    const names = within(library)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names[0]).toMatch(/^Autopilot/);
  });

  it('shows a login hint when SignalK refuses the editor API', async () => {
    const api = createApi(async () => new Response('Unauthorized', { status: 401 }));
    render(<App api={api} live={fakeLive().factory} />);
    expect((await screen.findByRole('link', { name: 'Log in' })).getAttribute('href')).toBe('/admin/#/login');
  });
});

describe('sharing layouts (ADR-0027)', { timeout: 20000 }, () => {
  const own = layoutIdFor(p4.deviceId);
  const cockpitLayout: Layout = {
    version: 1,
    id: 'display-cockpit',
    name: 'Cockpit',
    theme: 'day',
    pages: [
      {
        kind: 'grid',
        id: 'battery',
        title: 'Battery',
        grid: { cols: 1, rows: 1 },
        tiles: [{ type: 'value', id: 'volts', x: 0, y: 0, w: 1, h: 1, path: 'electrical.batteries.house.voltage', label: 'House' }],
      },
    ],
  };
  const cockpit = (): Device => ({
    ...device('adopted'),
    id: 'cockpit',
    name: 'Cockpit',
    hello: { ...p4, deviceId: 'cockpit' },
    layoutId: 'display-cockpit',
  });
  const withCockpit = () => {
    const server = fakeServer([{ ...device('adopted'), name: 'Helm' }, cockpit()]);
    server.layouts.set('display-cockpit', cockpitLayout);
    return server;
  };
  const openShare = async () =>
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }, { timeout: 5000 }));
  const lastLayoutPut = (server: ReturnType<typeof fakeServer>) =>
    server.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/layouts/')).at(-1)?.body as Layout | undefined;

  it('imports a file under this display’s id, remaps a missing path, and sends it', async () => {
    const server = withCockpit();
    render(<App api={server.api} live={fakeLive().factory} />);
    await openShare();
    const file = new File([exportFile(cockpitLayout).text], 'esphelm-cockpit.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Layout file'), { target: { files: [file] } });
    const confirm = await screen.findByRole('dialog', { name: 'Import layout' });
    within(confirm).getByText(/“Cockpit”/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Replace' }));

    const remap = await screen.findByRole('dialog', { name: 'Replace paths' });
    fireEvent.click(within(remap).getByRole('button', { name: 'Replace with: electrical.batteries.house.voltage' }));
    fireEvent.change(within(remap).getByLabelText('Search Replace with'), { target: { value: 'depth' } });
    fireEvent.click(within(remap).getByRole('option', { name: /environment.depth.belowTransducer/ }));
    fireEvent.click(within(remap).getByRole('button', { name: 'Replace 1' }));
    expect(screen.queryByRole('dialog', { name: 'Replace paths' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await waitFor(() => expect(lastLayoutPut(server)).toBeDefined());
    const sent = lastLayoutPut(server)!;
    expect(sent.id).toBe(own);
    expect(sent.name).toBe('Helm');
    expect(sent.theme).toBe('day');
    expect(pageTiles(sent.pages[0])[0]).toMatchObject({ path: 'environment.depth.belowTransducer', label: 'House' });
  });

  it('refuses a file that is not a layout', async () => {
    render(<App api={withCockpit().api} live={fakeLive().factory} />);
    await openShare();
    const file = new File(['{"version":1}'], 'notes.json');
    fireEvent.change(screen.getByLabelText('Layout file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/notes.json was not imported/));
    expect(screen.queryByRole('dialog', { name: 'Import layout' })).toBeNull();
  });

  it('copies another display’s layout as its own', async () => {
    const server = withCockpit();
    render(<App api={server.api} live={fakeLive().factory} />);
    await openShare();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cockpit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('tab', { name: 'Battery' });
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await waitFor(() => expect(lastLayoutPut(server)?.id).toBe(own));
    expect(server.requests).toContainEqual({ method: 'PUT', path: `/devices/${p4.deviceId}`, body: { layoutId: own } });
  });

  it('links to another display’s layout, and makes a separate copy again', async () => {
    const server = withCockpit();
    render(<App api={server.api} live={fakeLive().factory} />);
    await openShare();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cockpit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: 'PUT',
        path: `/devices/${p4.deviceId}`,
        body: { layoutId: 'display-cockpit' },
      }),
    );
    await screen.findByText(/Shared with Cockpit/);
    await screen.findByRole('tab', { name: 'Battery' });

    await openShare();
    fireEvent.click(screen.getByRole('menuitem', { name: /Make a separate copy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await waitFor(() => expect(lastLayoutPut(server)?.id).toBe(own));
    expect(server.layouts.get('display-cockpit')).toEqual(cockpitLayout);
  });
});

describe('firmware updates', { timeout: 20000 }, () => {
  const image: FirmwareImage = {
    buildId: 'ab'.repeat(32),
    version: '0.5.0',
    board: p4.board,
    kind: 'color',
    format: 'esp32',
    size: 3_500_000,
    md5: '0'.repeat(32),
    sha256: '1'.repeat(64),
    source: 'upload',
    added: '2026-10-25T10:00:00Z',
    devices: [p4.deviceId],
  };

  it('offers a newer image on the display and asks before it restarts', async () => {
    const d = { ...device('adopted'), updateAvailable: { buildId: image.buildId, version: '0.5.0' } };
    const server = fakeServer([d], [image]);
    render(<App api={server.api} live={fakeLive().factory} />);
    const list = await screen.findByRole('region', { name: 'Displays' });
    fireEvent.click(await within(list).findByRole('button', { name: 'Update to 0.5.0' }));
    expect(within(list).getByText('The display restarts.')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: 'POST',
        path: `/devices/${p4.deviceId}/update`,
        body: { buildId: image.buildId },
      }),
    );
    await within(list).findByText('Update to 0.5.0 waits for the display');
  });

  it('lists images and installs one from the dialog', async () => {
    const server = fakeServer([device('adopted')], [image]);
    render(<App api={server.api} live={fakeLive().factory} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Firmware' }));
    const dialog = await screen.findByRole('dialog', { name: 'Firmware' });
    await within(dialog).findByText('0.5.0');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await within(dialog).findByText(/is updating to 0.5.0/);
  });

  it('shows why an update failed', async () => {
    const d: Device = {
      ...device('adopted'),
      update: {
        request: 'r1',
        buildId: image.buildId,
        version: '0.5.0',
        state: 'failed',
        error: 'the image is damaged (MD5 mismatch)',
        at: '2026-10-25T10:00:00Z',
      },
    };
    render(<App api={fakeServer([d]).api} live={fakeLive().factory} />);
    expect((await screen.findByText(/Update to 0.5.0 failed/)).textContent).toMatch(/MD5 mismatch/);
  });
});
