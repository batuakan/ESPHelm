// The editable page: a CSS grid shaped like the display, tiles placed by cell. Pointer Events
// handle mouse and touch alike: drag a tile to move it, drag its corner to resize it, drag a
// tile type from the library onto a free cell. Placement rules live in layoutOps.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { UNITS, type GridPage, type Tile, type TileType, type UnitId } from '@esphelm/schema';
import { fits, type Rect } from '../layoutOps';
import { formatValue } from '../format';

export interface NewTileDrag {
  type: TileType;
  startX: number;
  startY: number;
}

interface Props {
  page: GridPage;
  aspect: number; // display width / height
  values: Map<string, unknown>;
  selectedId: string | undefined;
  problemTileIds: Set<string>;
  newTileDrag: NewTileDrag | null;
  onSelect(id: string | undefined): void;
  onMove(id: string, x: number, y: number): void;
  onResize(id: string, w: number, h: number): void;
  onDropNew(type: TileType, cell: { x: number; y: number }): void;
  onDragNewEnd(): void;
}

type Gesture =
  | { kind: 'move'; id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean }
  | { kind: 'resize'; id: string };

export function GridCanvas(props: Props) {
  const { page, values, selectedId, problemTileIds, newTileDrag } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);

  const cellAt = (clientX: number, clientY: number) => {
    const r = gridRef.current?.getBoundingClientRect();
    if (!r || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return {
      x: Math.min(page.grid.cols - 1, Math.floor(((clientX - r.left) / r.width) * page.grid.cols)),
      y: Math.min(page.grid.rows - 1, Math.floor(((clientY - r.top) / r.height) * page.grid.rows)),
    };
  };

  // Dragging a new tile from the library: track the pointer over the whole window.
  useEffect(() => {
    if (!newTileDrag) return;
    const move = (e: PointerEvent) => {
      const cell = cellAt(e.clientX, e.clientY);
      setPreview(cell ? { ...cell, w: 1, h: 1 } : null);
    };
    const up = (e: PointerEvent) => {
      const cell = cellAt(e.clientX, e.clientY);
      const moved = Math.hypot(e.clientX - newTileDrag.startX, e.clientY - newTileDrag.startY) > 6;
      if (cell && moved) props.onDropNew(newTileDrag.type, cell);
      setPreview(null);
      props.onDragNewEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  const tileById = (id: string) => page.tiles.find((t) => t.id === id);

  const onTileDown = (e: ReactPointerEvent, tile: Tile) => {
    if (e.button !== 0) return;
    const cell = cellAt(e.clientX, e.clientY) ?? { x: tile.x, y: tile.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setGesture({
      kind: 'move',
      id: tile.id,
      dx: cell.x - tile.x,
      dy: cell.y - tile.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    });
  };

  const onHandleDown = (e: ReactPointerEvent, tile: Tile) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setGesture({ kind: 'resize', id: tile.id });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!gesture) return;
    const tile = tileById(gesture.id);
    const cell = cellAt(e.clientX, e.clientY);
    if (!tile || !cell) return;
    if (gesture.kind === 'move') {
      const moved = gesture.moved || Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > 6;
      if (moved !== gesture.moved) setGesture({ ...gesture, moved });
      if (moved) setPreview({ x: cell.x - gesture.dx, y: cell.y - gesture.dy, w: tile.w, h: tile.h });
    } else {
      setPreview({
        x: tile.x,
        y: tile.y,
        w: Math.max(1, cell.x - tile.x + 1),
        h: Math.max(1, cell.y - tile.y + 1),
      });
    }
  };

  const onPointerUp = () => {
    if (!gesture) return;
    if (gesture.kind === 'move' && !gesture.moved) {
      props.onSelect(gesture.id);
    } else if (preview) {
      if (gesture.kind === 'move') props.onMove(gesture.id, preview.x, preview.y);
      else props.onResize(gesture.id, preview.w, preview.h);
    }
    setGesture(null);
    setPreview(null);
  };

  const previewOk = preview ? fits(page, preview, gesture?.id) : false;

  return (
    <div className="canvas-frame" style={{ aspectRatio: String(props.aspect) }}>
      <div
        ref={gridRef}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${page.grid.cols}, 1fr)`,
          gridTemplateRows: `repeat(${page.grid.rows}, 1fr)`,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onSelect(undefined);
        }}
        data-testid="grid"
      >
        {page.tiles.map((tile) => {
          const unit = 'unit' in tile ? (tile.unit as UnitId | undefined) : undefined;
          const decimals = 'decimals' in tile ? (tile.decimals as number | undefined) : undefined;
          const value = tile.path ? formatValue(values.get(tile.path), unit, decimals) : '--';
          const classes = [
            'tile',
            tile.id === selectedId ? 'selected' : '',
            problemTileIds.has(tile.id) ? 'problem' : '',
            gesture?.id === tile.id && preview ? 'dragging' : '',
            tile.type !== 'value' ? 'unsupported' : '',
          ];
          return (
            <div
              key={tile.id}
              className={classes.filter(Boolean).join(' ')}
              style={{
                gridColumn: `${tile.x + 1} / span ${tile.w}`,
                gridRow: `${tile.y + 1} / span ${tile.h}`,
              }}
              onPointerDown={(e) => onTileDown(e, tile)}
              onClick={() => props.onSelect(tile.id)}
              data-testid={`tile-${tile.id}`}
            >
              <span className="tile-label">{tile.label || (tile.path ? '' : 'Pick a path')}</span>
              <span className="tile-value">{tile.type === 'value' ? value : tile.type}</span>
              <span className="tile-unit">{unit ? UNITS[unit].label : ''}</span>
              <span
                className="resize-handle"
                aria-label="Resize"
                onPointerDown={(e) => onHandleDown(e, tile)}
              />
            </div>
          );
        })}
        {preview && (
          <div
            className={`drop-preview ${previewOk ? 'ok' : 'bad'}`}
            style={{
              gridColumn: `${preview.x + 1} / span ${preview.w}`,
              gridRow: `${preview.y + 1} / span ${preview.h}`,
            }}
          />
        )}
      </div>
    </div>
  );
}
