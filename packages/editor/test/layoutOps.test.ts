import { TEMPLATES, validateLayout, type GridPage, type Layout } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import {
  addPage,
  addTemplatePages,
  addTile,
  applyTemplate,
  fits,
  movePage,
  removePage,
  renamePage,
  setPageConfig,
  targetForPointer,
  updateSlot,
  gridPage,
  layoutIdFor,
  moveTile,
  newLayoutFor,
  removeTile,
  resizeTile,
  setGrid,
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
    expect(targetForPointer(l, '/pages/1/slots/center2/path')).toEqual({
      page: 1,
      slot: 'center2',
    });
    expect(targetForPointer(l, '/pages/1/slots/elsewhere')).toEqual({ page: 1 });
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
    expect(l.pages[1]).toMatchObject({
      kind: 'widget',
      widget: 'wind_rose',
      id: 'wind-1',
      slots: {},
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

  it('edits wind-rose slots and config', () => {
    let l = addPage(base(), 'wind_rose').layout;
    l = updateSlot(l, 1, 'center1', { label: 'SOG' });
    expect(ok(l)).toEqual([
      expect.objectContaining({ code: 'INVALID_PATH', pointer: '/pages/1/slots/center1/path' }),
    ]);
    l = updateSlot(l, 1, 'center1', { path: 'navigation.speedOverGround', unit: 'kn' });
    expect(ok(l)).toEqual([]);
    expect(l.pages[1]).toMatchObject({
      slots: { center1: { path: 'navigation.speedOverGround', unit: 'kn', label: 'SOG' } },
    });
    l = updateSlot(l, 1, 'center1', { unit: undefined });
    expect((l.pages[1] as { slots: Record<string, object> }).slots.center1).not.toHaveProperty(
      'unit',
    );
    l = updateSlot(l, 1, 'center1', null);
    expect(l.pages[1]).toMatchObject({ slots: {} });

    l = setPageConfig(l, 1, { heading: 'navigation.headingMagnetic', showTrueWind: false });
    expect(l.pages[1]).toMatchObject({
      config: { heading: 'navigation.headingMagnetic', showTrueWind: false },
    });
    l = setPageConfig(l, 1, { heading: undefined });
    expect((l.pages[1] as { config: object }).config).toEqual({ showTrueWind: false });
    expect(ok(l)).toEqual([]);
    // Slot and config edits leave grid pages alone.
    expect(updateSlot(l, 0, 'center1', { path: 'x.y' })).toEqual(l);
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
