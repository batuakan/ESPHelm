// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Hello, Layout } from '@esphelm/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { createApi, type Device, type PathInfo } from '../src/api';
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
    if (path === '/widgets')
      return json({ tiles: ['value', 'gauge', 'bar', 'switch'], pageWidgets: { wind_rose: { slots: [] } }, units: {} });
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

describe('editor', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Value/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Value/ }));
    fireEvent.click(await screen.findByRole('option', { name: /navigation.speedOverGround/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wind rose page' }));
    expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/Wind/);
    // The footer preview appears once there are two pages.
    expect(screen.getByLabelText('Display footer').textContent).toMatch(/Wind 2\/2/);
    // The rose subscribes to its default source paths.
    expect(live.paths()).toEqual([
      'environment.wind.angleApparent',
      'environment.wind.directionTrue',
      'navigation.headingTrue',
    ]);

    fireEvent.click(screen.getByTestId('slot-center1'));
    const drawer = screen.getByRole('complementary', { name: 'Slot settings' });
    fireEvent.change(within(drawer).getByLabelText('Search SignalK paths'), { target: { value: 'depth' } });
    fireEvent.click(within(drawer).getByRole('option', { name: /belowTransducer/ }));
    fireEvent.change(within(drawer).getByLabelText('Label'), { target: { value: 'Depth' } });
    live.emit('environment.depth.belowTransducer', 4.25);
    within(screen.getByTestId('slot-center1')).getByText('4.3');
    within(screen.getByTestId('slot-center1')).getByText('Depth m');

    // Rename and reorder: the rose becomes the first page.
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Sailing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move page left' }));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Sailing · rose', 'Main']);

    await screen.findByText('No problems');
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));
    await screen.findByText(/Sent to/);
    const saved = server.layouts.get(`display-${p4.deviceId}`)!;
    expect(saved.pages.map((p) => [p.kind, p.id, p.title])).toEqual([
      ['widget', 'wind-1', 'Sailing'],
      ['grid', 'main', 'Main'],
    ]);
    expect(saved.pages[0]).toMatchObject({
      slots: { center1: { path: 'environment.depth.belowTransducer', unit: 'm', label: 'Depth' } },
    });
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
