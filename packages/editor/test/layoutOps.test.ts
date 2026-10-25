import { validateLayout, type GridPage, type Layout } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import {
  addTile,
  fits,
  gridPage,
  layoutIdFor,
  moveTile,
  newLayoutFor,
  removeTile,
  resizeTile,
  setGrid,
  tileIdForPointer,
  updateTile,
} from '../src/layoutOps';

const device = { id: '3A2B1C0D-ef01-2345-0ba2-a1b2c3d4e5f6', name: 'Helm' };
const page = (l: Layout) => gridPage(l) as GridPage;

function withTiles(n: number): Layout {
  let l = newLayoutFor(device);
  for (let i = 0; i < n; i++) l = addTile(l, 'value')!.layout;
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
    expect(addTile(l, 'value')).toBeNull();
  });

  it('adds at a requested cell only if it is free', () => {
    const l = withTiles(1);
    expect(addTile(l, 'value', { x: 0, y: 0 })).toBeNull();
    expect(page(addTile(l, 'value', { x: 1, y: 1 })!.layout).tiles[1]).toMatchObject({
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
    expect(moveTile(l, 'tile-1', 1, 0)).toBeNull();
    expect(moveTile(l, 'tile-1', 2, 0)).toBeNull();
    expect(page(moveTile(l, 'tile-1', 0, 1)!).tiles[0]).toMatchObject({ x: 0, y: 1 });
  });

  it('resizes up to free space', () => {
    const l = withTiles(1);
    expect(page(resizeTile(l, 'tile-1', 2, 2)!).tiles[0]).toMatchObject({ w: 2, h: 2 });
    expect(resizeTile(l, 'tile-1', 3, 1)).toBeNull();
    const two = withTiles(2);
    expect(resizeTile(two, 'tile-1', 2, 1)).toBeNull();
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
    l = updateTile(l, 'tile-1', { path: 'navigation.speedOverGround', unit: 'kn', label: 'SOG' });
    expect(validateLayout(l).ok).toBe(true);
    l = updateTile(l, 'tile-1', { unit: undefined });
    expect(page(l).tiles[0]).not.toHaveProperty('unit');
  });

  it('removes tiles', () => {
    expect(page(removeTile(withTiles(2), 'tile-1')).tiles.map((t) => t.id)).toEqual(['tile-2']);
  });

  it('shrinking the grid leaves tiles in place for the validator to flag', () => {
    let l = updateTile(withTiles(4), 'tile-4', {});
    for (const id of ['tile-1', 'tile-2', 'tile-3', 'tile-4'])
      l = updateTile(l, id, { path: 'navigation.speedOverGround' });
    l = setGrid(l, 1, 2);
    const codes = validateLayout(l).errors.map((e) => [e.code, tileIdForPointer(l, e.pointer)]);
    expect(codes).toEqual([
      ['TILE_OUT_OF_GRID', 'tile-2'],
      ['TILE_OUT_OF_GRID', 'tile-4'],
    ]);
  });
});

describe('tileIdForPointer', () => {
  it('maps tile pointers and ignores others', () => {
    const l = withTiles(2);
    expect(tileIdForPointer(l, '/pages/0/tiles/1/label')).toBe('tile-2');
    expect(tileIdForPointer(l, '/pages/0/tiles/1')).toBe('tile-2');
    expect(tileIdForPointer(l, '/pages/0/tiles')).toBeUndefined();
    expect(tileIdForPointer(l, '/theme')).toBeUndefined();
  });
});
