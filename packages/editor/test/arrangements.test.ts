import { validateLayout, type GridPage, type Layout } from '@esphelm/schema';
import { describe, expect, it } from 'vitest';
import {
  arrangeFor,
  arrangedPage,
  dropArrangement,
  inShape,
  showOnShape,
} from '../src/arrangements';
import {
  addTemplatePages,
  addTile,
  gridPage,
  moveTile,
  removeTile,
  resizeTile,
  setGrid,
  targetForPointer,
  updateTile,
} from '../src/layoutOps';

const value = (id: string, x: number, y: number) =>
  ({ type: 'value', id, x, y, w: 1, h: 1, path: 'navigation.speedOverGround' }) as const;

/** A 2x1 page of two tiles, without arrangements. */
function twoTiles(): Layout {
  return {
    version: 1,
    id: 'l',
    theme: 'day',
    pages: [
      {
        kind: 'grid',
        id: 'p',
        grid: { cols: 2, rows: 1 },
        tiles: [value('a', 0, 0), value('b', 1, 0)],
      },
    ],
  };
}

const page = (l: Layout | null): GridPage => {
  const p = l && gridPage(l, 0);
  if (!p) throw new Error('no grid page');
  return p;
};
const must = (l: Layout | null): Layout => {
  if (!l) throw new Error('not possible');
  return l;
};
const valid = (l: Layout | null) => expect(l && validateLayout(l).errors).toEqual([]);

describe('arrangements (ADR-0028)', () => {
  it('a shape without its own arrangement edits the default', () => {
    const moved = inShape(twoTiles(), 0, 'portrait', (l) => setGrid(l, 0, 3, 1));
    expect(page(moved).grid).toEqual({ cols: 3, rows: 1 });
    expect(page(moved).arrangements).toBeUndefined();
  });

  it('arranging for a shape copies the default, or turns it', () => {
    const copied = arrangeFor(twoTiles(), 0, 'landscape', false);
    expect(page(copied).arrangements?.landscape).toEqual({
      grid: { cols: 2, rows: 1 },
      tiles: [
        { id: 'a', x: 0, y: 0, w: 1, h: 1 },
        { id: 'b', x: 1, y: 0, w: 1, h: 1 },
      ],
    });
    const turned = arrangeFor(twoTiles(), 0, 'portrait', true);
    expect(page(turned).arrangements?.portrait?.grid).toEqual({ cols: 1, rows: 2 });
    expect(page(turned).arrangements?.portrait?.tiles[1]).toEqual({
      id: 'b',
      x: 0,
      y: 1,
      w: 1,
      h: 1,
    });
    valid(turned);
  });

  it("edits in a shape's arrangement leave the default alone", () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    const grown = inShape(own, 0, 'portrait', (l) => setGrid(l, 0, 1, 3));
    const moved = grown && inShape(grown, 0, 'portrait', (l) => moveTile(l, 0, 'b', 0, 2));
    const big = moved && inShape(moved, 0, 'portrait', (l) => resizeTile(l, 0, 'a', 1, 2));
    const p = page(big);
    expect(p.grid).toEqual({ cols: 2, rows: 1 });
    expect(p.tiles.map((t) => [t.id, t.x, t.y, t.w, t.h])).toEqual([
      ['a', 0, 0, 1, 1],
      ['b', 1, 0, 1, 1],
    ]);
    expect(p.arrangements?.portrait).toEqual({
      grid: { cols: 1, rows: 3 },
      tiles: [
        { id: 'a', x: 0, y: 0, w: 1, h: 2 },
        { id: 'b', x: 0, y: 2, w: 1, h: 1 },
      ],
    });
    valid(big);
  });

  it('a move that collides in the arrangement is refused', () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    expect(inShape(own, 0, 'portrait', (l) => moveTile(l, 0, 'b', 0, 0))).toBeNull();
  });

  it("tile settings changed through the shape's view reach the page's tiles", () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    const labelled = inShape(own, 0, 'portrait', (l) => updateTile(l, 0, 'a', { label: 'SOG' }));
    expect(page(labelled).tiles[0]).toMatchObject({ id: 'a', label: 'SOG', x: 0, y: 0 });
  });

  it('removing a tile in an arrangement hides it there only; showing it puts it back', () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    const hidden = inShape(own, 0, 'portrait', (l) => removeTile(l, 0, 'a'));
    expect(page(hidden).tiles.map((t) => t.id)).toEqual(['a', 'b']);
    expect(page(hidden).arrangements?.portrait?.tiles.map((t) => t.id)).toEqual(['b']);
    expect(arrangedPage(page(hidden), 'portrait').tiles.map((t) => t.id)).toEqual(['b']);
    valid(hidden);
    const shown = showOnShape(hidden!, 0, 'portrait', 'a');
    expect(page(shown).arrangements?.portrait?.tiles).toEqual([
      { id: 'b', x: 0, y: 1, w: 1, h: 1 },
      { id: 'a', x: 0, y: 0, w: 1, h: 1 },
    ]);
    valid(shown);
  });

  it('showing a hidden tile on a full arrangement adds a row', () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    const hidden = inShape(own, 0, 'portrait', (l) => removeTile(l, 0, 'a'));
    const full = hidden && inShape(hidden, 0, 'portrait', (l) => setGrid(l, 0, 1, 1));
    const fullMoved = full && inShape(full, 0, 'portrait', (l) => moveTile(l, 0, 'b', 0, 0));
    const shown = fullMoved && showOnShape(fullMoved, 0, 'portrait', 'a');
    expect(page(shown).arrangements?.portrait?.grid).toEqual({ cols: 1, rows: 2 });
    valid(shown);
  });

  it('a tile added in an arrangement is placed in the default too, with a new row when full', () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    const grown = inShape(own, 0, 'portrait', (l) => setGrid(l, 0, 1, 3));
    let id = '';
    const added = inShape(grown!, 0, 'portrait', (l) => {
      const r = addTile(l, 0, 'value');
      id = r?.id ?? '';
      return r?.layout ?? null;
    });
    const p = page(added);
    expect(p.arrangements?.portrait?.tiles.find((t) => t.id === id)).toEqual({
      id,
      x: 0,
      y: 2,
      w: 1,
      h: 1,
    });
    expect(p.grid).toEqual({ cols: 2, rows: 2 });
    expect(p.tiles.find((t) => t.id === id)).toMatchObject({ x: 0, y: 1, w: 1, h: 1 });
    // Only the new tile's path is missing: the editor asks for one.
    expect(validateLayout(added!).errors.map((e) => e.code)).toEqual(['INVALID_PATH']);
  });

  it('deleting a tile from the default removes its placements, and an emptied arrangement', () => {
    const own = must(arrangeFor(twoTiles(), 0, 'portrait', true));
    const hidden = inShape(own, 0, 'portrait', (l) => removeTile(l, 0, 'a'));
    const deleted = removeTile(hidden!, 0, 'b');
    expect(page(deleted).tiles.map((t) => t.id)).toEqual(['a']);
    expect(page(deleted).arrangements).toBeUndefined();
  });

  it('dropping an arrangement goes back to the default', () => {
    const both = arrangeFor(arrangeFor(twoTiles(), 0, 'portrait', true)!, 0, 'landscape', false);
    const one = dropArrangement(both!, 0, 'portrait');
    expect(Object.keys(page(one).arrangements ?? {})).toEqual(['landscape']);
    const none = dropArrangement(one!, 0, 'landscape');
    expect(page(none).arrangements).toBeUndefined();
    expect(dropArrangement(none!, 0, 'landscape')).toBeNull();
  });

  it('template pages renamed on the way in keep their arrangements', () => {
    const template = arrangeFor(twoTiles(), 0, 'portrait', true)!;
    const r = addTemplatePages(twoTiles(), template);
    const p = page({ ...r.layout, pages: [r.layout.pages[r.index]!] });
    expect(p.tiles.map((t) => t.id)).toEqual(['a-1', 'b-1']);
    expect(p.arrangements?.portrait?.tiles.map((t) => t.id)).toEqual(['a-1', 'b-1']);
    valid(r.layout);
  });

  it('a problem pointer into an arrangement names the shape and the tile', () => {
    const own = arrangeFor(twoTiles(), 0, 'portrait', true)!;
    expect(targetForPointer(own, '/pages/0/arrangements/portrait/tiles/1')).toEqual({
      page: 0,
      shape: 'portrait',
      tileId: 'b',
    });
    expect(targetForPointer(own, '/pages/0/arrangements/portrait/tiles')).toEqual({
      page: 0,
      shape: 'portrait',
    });
  });
});
