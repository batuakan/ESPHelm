import { TEMPLATES, validateLayout, type GridPage, type Layout } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import {
  pageTiles,
  updateChartPage,
  addPage,
  addTemplatePages,
  addTile,
  applyTemplate,
  fits,
  movePage,
  removePage,
  renamePage,
  setTileConfig,
  tilePaths,
  targetForPointer,
  updateSlot,
  gridPage,
  layoutIdFor,
  moveTile,
  newLayoutFor,
  removeTile,
  resizeTile,
  setGrid,
  updateSettings,
  updateTile,
} from '../src/layoutOps';

const device = { id: '3A2B1C0D-ef01-2345-0ba2-a1b2c3d4e5f6', name: 'Helm' };
const page = (l: Layout) => gridPage(l, 0) as GridPage;

function withTiles(n: number): Layout {
  let l = newLayoutFor(device);
  for (let i = 0; i < n; i++) l = addTile(l, 0, 'value')!.layout;
  return l;
}

describe('newLayoutFor', () => {
  it('creates a valid-id layout whose only problem is the empty page', () => {
    const l = newLayoutFor(device);
    expect(l.id).toBe('display-3a2b1c0d-ef01-2345-0ba2-a1b2c3d4e5f6');
    expect(l.id).toBe(layoutIdFor(device.id));
    expect(validateLayout(l).errors.map((e) => e.code)).toEqual(['EMPTY_PAGE']);
  });
});

describe('addTile', () => {
  it('fills free cells row by row with unique ids, then refuses', () => {
    const l = withTiles(4);
    expect(page(l).tiles.map((t) => [t.id, t.x, t.y])).toEqual([
      ['tile-1', 0, 0],
      ['tile-2', 1, 0],
      ['tile-3', 0, 1],
      ['tile-4', 1, 1],
    ]);
    expect(addTile(l, 0, 'value')).toBeNull();
  });

  it('adds at a requested cell only if it is free', () => {
    const l = withTiles(1);
    expect(addTile(l, 0, 'value', { x: 0, y: 0 })).toBeNull();
    expect(page(addTile(l, 0, 'value', { x: 1, y: 1 })!.layout).tiles[1]).toMatchObject({
      x: 1,
      y: 1,
    });
  });

  it('starts tiles without a path, which the validator reports', () => {
    const l = withTiles(1);
    expect(validateLayout(l).errors).toEqual([
      expect.objectContaining({ code: 'INVALID_PATH', pointer: '/pages/0/tiles/0/path' }),
    ]);
  });
});

describe('move and resize', () => {
  it('moves into free space and refuses overlaps or leaving the grid', () => {
    const l = withTiles(2); // tile-1 (0,0), tile-2 (1,0)
    expect(moveTile(l, 0, 'tile-1', 1, 0)).toBeNull();
    expect(moveTile(l, 0, 'tile-1', 2, 0)).toBeNull();
    expect(page(moveTile(l, 0, 'tile-1', 0, 1)!).tiles[0]).toMatchObject({ x: 0, y: 1 });
  });

  it('resizes up to free space', () => {
    const l = withTiles(1);
    expect(page(resizeTile(l, 0, 'tile-1', 2, 2)!).tiles[0]).toMatchObject({ w: 2, h: 2 });
    expect(resizeTile(l, 0, 'tile-1', 3, 1)).toBeNull();
    const two = withTiles(2);
    expect(resizeTile(two, 0, 'tile-1', 2, 1)).toBeNull();
  });

  it('fits() ignores the tile being moved', () => {
    const l = withTiles(1);
    expect(fits(page(l), { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    expect(fits(page(l), { x: 0, y: 0, w: 1, h: 1 }, 'tile-1')).toBe(true);
  });
});

describe('editing', () => {
  it('updates and clears tile fields', () => {
    let l = withTiles(1);
    l = updateTile(l, 0, 'tile-1', {
      path: 'navigation.speedOverGround',
      unit: 'kn',
      label: 'SOG',
    });
    expect(validateLayout(l).ok).toBe(true);
    l = updateTile(l, 0, 'tile-1', { unit: undefined });
    expect(page(l).tiles[0]).not.toHaveProperty('unit');
  });

  it('removes tiles', () => {
    expect(page(removeTile(withTiles(2), 0, 'tile-1')).tiles.map((t) => t.id)).toEqual(['tile-2']);
  });

  it('shrinking the grid leaves tiles in place for the validator to flag', () => {
    let l = updateTile(withTiles(4), 0, 'tile-4', {});
    for (const id of ['tile-1', 'tile-2', 'tile-3', 'tile-4'])
      l = updateTile(l, 0, id, { path: 'navigation.speedOverGround' });
    l = setGrid(l, 0, 1, 2);
    const codes = validateLayout(l).errors.map((e) => [
      e.code,
      targetForPointer(l, e.pointer)?.tileId,
    ]);
    expect(codes).toEqual([
      ['TILE_OUT_OF_GRID', 'tile-2'],
      ['TILE_OUT_OF_GRID', 'tile-4'],
    ]);
  });
});

describe('targetForPointer', () => {
  it('maps tile, slot and page pointers', () => {
    let l = withTiles(2);
    l = addPage(l, 'wind_rose').layout;
    expect(targetForPointer(l, '/pages/0/tiles/1/label')).toEqual({ page: 0, tileId: 'tile-2' });
    expect(targetForPointer(l, '/pages/0/tiles/1')).toEqual({ page: 0, tileId: 'tile-2' });
    expect(targetForPointer(l, '/pages/0/tiles')).toEqual({ page: 0 });
    expect(targetForPointer(l, '/pages/1/tiles/0/slots/center2/path')).toEqual({
      page: 1,
      tileId: 'wind-1-rose',
      slot: 'center2',
    });
    expect(targetForPointer(l, '/pages/1/tiles/0/slots/elsewhere')).toEqual({
      page: 1,
      tileId: 'wind-1-rose',
    });
    expect(targetForPointer(l, '/pages/7')).toBeUndefined();
    expect(targetForPointer(l, '/theme')).toBeUndefined();
  });
});

const ok = (l: Layout) => validateLayout(l).errors;

describe('pages', () => {
  const base = () => {
    let l = withTiles(1);
    l = updateTile(l, 0, 'tile-1', { path: 'navigation.speedOverGround' });
    return l;
  };

  it('adds grid and wind-rose pages after the current one with unique ids', () => {
    let l = base();
    const rose = addPage(l, 'wind_rose', 0);
    expect(rose.index).toBe(1);
    l = rose.layout;
    // A wind rose page is a 1x1 grid holding one rose tile.
    expect(l.pages[1]).toMatchObject({
      kind: 'grid',
      id: 'wind-1',
      grid: { cols: 1, rows: 1 },
      tiles: [{ type: 'wind_rose', id: 'wind-1-rose', x: 0, y: 0, w: 1, h: 1, slots: {} }],
    });
    expect(ok(l)).toEqual([]); // an empty rose is valid (slots are optional)
    const grid = addPage(l, 'grid', 0);
    expect(grid.index).toBe(1);
    expect(grid.layout.pages.map((p) => p.id)).toEqual(['main', 'page-1', 'wind-1']);
    expect(ok(grid.layout).map((e) => e.code)).toEqual(['EMPTY_PAGE']);
  });

  it('tiles on another page get layout-wide unique ids', () => {
    let l = addPage(base(), 'grid').layout;
    l = addTile(l, 1, 'gauge')!.layout;
    expect(gridPage(l, 1)!.tiles[0]!.id).toBe('tile-2');
    expect(addTile(l, 0, 'value', { x: 0, y: 0 })).toBeNull(); // taken on page 0
    expect(gridPage(l, 0)!.tiles).toHaveLength(1);
  });

  it('moves, renames and removes pages; never the last one', () => {
    let l = addPage(base(), 'wind_rose').layout;
    expect(movePage(l, 0, -1)).toBeNull();
    expect(movePage(l, 1, 1)).toBeNull();
    l = movePage(l, 1, -1)!;
    expect(l.pages.map((p) => p.id)).toEqual(['wind-1', 'main']);
    l = renamePage(l, 1, 'Speeds');
    expect(l.pages[1]!.title).toBe('Speeds');
    l = renamePage(l, 1, '');
    expect(l.pages[1]).not.toHaveProperty('title');
    l = removePage(l, 0)!;
    expect(l.pages.map((p) => p.id)).toEqual(['main']);
    expect(removePage(l, 0)).toBeNull();
  });

  it('places wind rose tiles 2x2 where that fits, else 1x1', () => {
    let l = base(); // tile-1 at (0,0) of 2x2
    l = setGrid(l, 0, 3, 3);
    const big = addTile(l, 0, 'wind_rose', { x: 1, y: 0 })!;
    expect(gridPage(big.layout, 0)!.tiles[1]).toMatchObject({ id: 'rose-1', w: 2, h: 2 });
    const small = addTile(big.layout, 0, 'wind_rose', { x: 0, y: 2 })!;
    expect(gridPage(small.layout, 0)!.tiles[2]).toMatchObject({ id: 'rose-2', w: 1, h: 1 });
    expect(ok(small.layout)).toEqual([]);
  });

  it('adds autopilot tiles and pages, with config and modes on the tile', () => {
    let l = setGrid(base(), 0, 3, 3);
    const r = addTile(l, 0, 'autopilot', { x: 1, y: 0 })!;
    expect(gridPage(r.layout, 0)!.tiles[1]).toEqual({
      type: 'autopilot',
      id: 'pilot-1',
      x: 1,
      y: 0,
      w: 2,
      h: 2,
    });
    l = r.layout;
    expect(tilePaths(gridPage(l, 0)!.tiles[1]!)).toEqual([
      'steering.autopilot.state',
      'steering.autopilot.target',
      'navigation.headingMagnetic',
    ]);
    l = setTileConfig(l, 0, 'pilot-1', { headingPath: 'navigation.headingTrue' });
    l = updateTile(l, 0, 'pilot-1', { modes: ['auto', 'route'], label: 'Pilot' });
    expect(gridPage(l, 0)!.tiles[1]).toMatchObject({
      config: { headingPath: 'navigation.headingTrue' },
      modes: ['auto', 'route'],
      label: 'Pilot',
    });
    l = setTileConfig(l, 0, 'pilot-1', { headingPath: undefined });
    expect(gridPage(l, 0)!.tiles[1]).not.toHaveProperty('config');
    expect(ok(l)).toEqual([]);

    const page = addPage(l, 'autopilot');
    expect(page.layout.pages[page.index]).toMatchObject({
      title: 'Autopilot',
      grid: { cols: 1, rows: 1 },
      tiles: [{ type: 'autopilot', id: 'pilot-2-ap', w: 1, h: 1 }],
    });
    expect(ok(page.layout)).toEqual([]);
  });

  it('edits wind-rose slots and config on the tile', () => {
    let l = addPage(base(), 'wind_rose').layout;
    const id = 'wind-1-rose';
    const rose = () => pageTiles(l.pages[1])[0] as Record<string, unknown>;
    l = updateSlot(l, 1, id, 'center1', { label: 'SOG' });
    expect(ok(l)).toEqual([
      expect.objectContaining({
        code: 'INVALID_PATH',
        pointer: '/pages/1/tiles/0/slots/center1/path',
      }),
    ]);
    l = updateSlot(l, 1, id, 'center1', { path: 'navigation.speedOverGround', unit: 'kn' });
    expect(ok(l)).toEqual([]);
    expect(rose()).toMatchObject({
      slots: { center1: { path: 'navigation.speedOverGround', unit: 'kn', label: 'SOG' } },
    });
    l = updateSlot(l, 1, id, 'center1', { unit: undefined });
    expect((rose().slots as Record<string, object>).center1).not.toHaveProperty('unit');
    l = updateSlot(l, 1, id, 'center1', null);
    expect(rose()).toMatchObject({ slots: {} });

    l = setTileConfig(l, 1, id, { heading: 'navigation.headingMagnetic', showTrueWind: false });
    expect(rose()).toMatchObject({
      config: { heading: 'navigation.headingMagnetic', showTrueWind: false },
    });
    expect(tilePaths(rose() as never)).toEqual([
      'environment.wind.angleApparent',
      'environment.wind.directionTrue',
      'navigation.headingMagnetic',
    ]);
    l = setTileConfig(l, 1, id, { heading: undefined, showTrueWind: undefined });
    expect(rose()).not.toHaveProperty('config');
    expect(ok(l)).toEqual([]);
    // Slot and config edits leave other tiles alone.
    expect(updateSlot(l, 0, 'tile-1', 'center1', { path: 'x.y' })).toEqual(l);
  });
});

describe('chart pages', () => {
  it('adds a chart page that asks for its chart, then edits it', () => {
    let l = withTiles(1);
    l = updateTile(l, 0, 'tile-1', { path: 'navigation.speedOverGround' });
    const r = addPage(l, 'chart');
    l = r.layout;
    expect(l.pages[r.index]).toEqual({ kind: 'chart', id: 'chart-1', title: 'Chart', chart: '' });
    expect(validateLayout(l).errors.map((e) => [e.code, e.pointer])).toEqual([
      ['INVALID_ID', '/pages/1/chart'],
    ]);
    expect(targetForPointer(l, '/pages/1/chart')).toEqual({ page: 1 });
    l = updateChartPage(l, 1, {
      chart: 'sea',
      zoom: 13,
      anchor: false,
      config: { headingPath: 'navigation.headingMagnetic' },
    });
    expect(l.pages[1]).toEqual({
      kind: 'chart',
      id: 'chart-1',
      title: 'Chart',
      chart: 'sea',
      zoom: 13,
      anchor: false,
      config: { headingPath: 'navigation.headingMagnetic' },
    });
    l = updateChartPage(l, 1, { zoom: undefined, config: { headingPath: undefined } });
    expect(l.pages[1]).toEqual({
      kind: 'chart',
      id: 'chart-1',
      title: 'Chart',
      chart: 'sea',
      anchor: false,
    });
    expect(validateLayout(l).errors).toEqual([]);
    // Tile operations leave chart pages alone; chart edits leave grid pages alone.
    expect(addTile(l, 1, 'value')).toBeNull();
    expect(updateChartPage(l, 0, { chart: 'x' })).toEqual(l);
    expect(pageTiles(l.pages[1])).toEqual([]);
  });
});

describe('templates', () => {
  it('every starter layout copies in valid, renaming taken ids', () => {
    let l: Layout = { ...newLayoutFor(device), pages: [] };
    for (const t of Object.values(TEMPLATES)) {
      l = addTemplatePages(l, t).layout;
      l = addTemplatePages(l, t).layout; // twice: every id collides the second time
    }
    expect(ok(l)).toEqual([]);
    expect(l.pages).toHaveLength(Object.keys(TEMPLATES).length * 2);
    expect(l.pages.map((p) => p.id).slice(0, 2)).toEqual(['wind', 'wind-1']);
  });

  it('applying a template replaces pages and theme but keeps the layout id', () => {
    const l = applyTemplate(withTiles(1), TEMPLATES.energy!);
    expect(l.id).toBe(layoutIdFor(device.id));
    expect(l.pages).toEqual(TEMPLATES.energy!.pages);
    expect(l.pages).not.toBe(TEMPLATES.energy!.pages);
    expect(ok(l)).toEqual([]);
  });
});

describe('display settings', () => {
  const twoPages = (): Layout => ({
    version: 1,
    id: 'l',
    theme: 'day',
    pages: [
      {
        kind: 'grid',
        id: 'a',
        grid: { cols: 1, rows: 1 },
        tiles: [
          { type: 'value', id: 't1', x: 0, y: 0, w: 1, h: 1, path: 'navigation.speedOverGround' },
        ],
      },
      {
        kind: 'grid',
        id: 'b',
        grid: { cols: 1, rows: 1 },
        tiles: [
          { type: 'value', id: 't2', x: 0, y: 0, w: 1, h: 1, path: 'navigation.speedThroughWater' },
        ],
      },
    ],
  });

  it('merges brightness and drops fields set to undefined', () => {
    let l = updateSettings(twoPages(), { brightness: { day: 80 }, screenTimeout: 60 });
    l = updateSettings(l, { brightness: { night: 10 } });
    expect(l.settings).toEqual({ brightness: { day: 80, night: 10 }, screenTimeout: 60 });
    l = updateSettings(l, {
      brightness: { day: undefined, night: undefined },
      screenTimeout: undefined,
    });
    expect(l).not.toHaveProperty('settings');
    expect(validateLayout(l).ok).toBe(true);
  });

  it('forgets the start page when that page is removed or the pages are replaced', () => {
    const l = updateSettings(twoPages(), { startPage: 'b', autoTheme: 'sun' });
    expect(removePage(l, 1)!.settings).toEqual({ autoTheme: 'sun' });
    expect(validateLayout(removePage(l, 1)!).ok).toBe(true);
    expect(removePage(l, 0)!.settings?.startPage).toBe('b');
    expect(applyTemplate(l, { ...twoPages(), pages: [twoPages().pages[0]!] }).settings).toEqual({
      autoTheme: 'sun',
    });
  });
});
