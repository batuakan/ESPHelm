// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Hello, Layout } from '@esphelm/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { createApi, type Device, type PathInfo } from '../src/api';
import { pageTiles } from '../src/layoutOps';
import type { LiveSource, ValueListener } from '../src/live';

const FIXTURES = join(__dirname, '../../schema/fixtures');
const p4 = JSON.parse(readFileSync(join(FIXTURES, 'hello/valid/p4.json'), 'utf8')) as Hello;

/** In-memory stand-in for the plugin's editor API, recording requests. */
function fakeServer(devices: Device[]) {
  const layouts = new Map<string, Layout>();
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const paths: PathInfo[] = [
    { path: 'navigation.speedOverGround', units: 'm/s', description: 'Speed over ground', value: 2.5, timestamp: null },
    { path: 'environment.depth.belowTransducer', units: 'm', description: null, value: 12.4, timestamp: null },
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
        tiles: ['value', 'gauge', 'bar', 'switch', 'wind_rose', 'autopilot'],
        tileSlots: { wind_rose: ['center1', 'center2', 'center3'] },
        units: {},
      });
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

  it('starts from a template after confirming', async () => {
    const server = fakeServer([device('adopted')]);
    render(<App api={server.api} live={fakeLive().factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Engine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Engine']);
    await screen.findByText('No problems');
    expect(within(screen.getByTestId('grid')).getAllByText(/RPM|Coolant|Oil/)).toHaveLength(3);
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
  });

  it('adds a chart page, picks a chart and previews it at the position', async () => {
    const server = fakeServer([device('adopted')]);
    const live = fakeLive();
    render(<App api={server.api} live={live.factory} />);
    await screen.findByText('Add at least one tile.');
    fireEvent.click(screen.getByRole('button', { name: /^Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chart page' }));
    await screen.findByText(/Chart: choose a chart/);
    const drawer = screen.getByRole('complementary', { name: 'Chart settings' });
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
    const preview = screen.getByTestId('chart-chart-1');
    const hrefs = [...preview.querySelectorAll('image')].map((i) => i.getAttribute('href'));
    // z12 at 60.15N 24.95E is tile 2331/1186.
    expect(hrefs).toContain('/tiles/sea/12/2331/1186.png');
    expect(preview.textContent).toMatch(/60\.1500 N\s+24\.9500 E\s+z12/);
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(`display-${p4.deviceId}`)!.pages[1]).toEqual({
      kind: 'chart',
      id: 'chart-1',
      title: 'Chart',
      chart: 'sea',
      zoom: 12,
    });
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
    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    expect(server.layouts.get(d.layoutId)!.settings).toEqual({
      brightness: { day: 80, night: 10 },
      startPage: 'second',
      autoTheme: 'sun',
      screenTimeout: 120,
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

  it('shows a login hint when SignalK refuses the editor API', async () => {
    const api = createApi(async () => new Response('Unauthorized', { status: 401 }));
    render(<App api={api} live={fakeLive().factory} />);
    expect((await screen.findByRole('link', { name: 'Log in' })).getAttribute('href')).toBe('/admin/#/login');
  });
});
