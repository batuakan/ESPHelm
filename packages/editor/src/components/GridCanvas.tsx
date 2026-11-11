// The editable page: a CSS grid shaped like the display, tiles placed by cell. Pointer Events
// handle mouse and touch alike: drag a tile to move it, drag its corner to resize it, drag a
// tile type from the library onto a free cell. Placement rules live in layoutOps.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { EngineSlotName, GridPage, Tile, TileType } from '@esphelm/schema';
import { fits, type Rect, type SlotName } from '../layoutOps';
import type { AutopilotTier, RoseTier, ValueTextSize } from '../sizing';
import type { ChartInfo } from '../api';
import { TilePreview } from './Previews';

export interface NewTileDrag {
  type: TileType;
  startX: number;
  startY: number;
}

interface Props {
  page: GridPage;
  aspect: number; // display width / height
  values: Map<string, unknown>;
  /** meta.zones by path (ADR-0020). */
  serverZones?: Map<string, unknown>;
  selectedId: string | undefined;
  selectedSlot?: SlotName | EngineSlotName;
  /** Size tier the display will draw a wind rose tile with. */
  roseTier(tile: Tile): RoseTier;
  /** Whether the display will show an autopilot tile's buttons. */
  autopilotTier(tile: Tile): AutopilotTier;
  /** Whether a graph tile has room for its axis labels on the display (GRAPH_FIT). */
  graphAxis(tile: Tile): boolean;
  /** A tile's content width on the display, in pixels (heading tapes draw ticks for it). */
  tileWidth(tile: Tile): number;
  /** The layout's time zone as a POSIX rule, for clock previews; absent: UTC. */
  timeZone?: string;
  /** Chart tiles: the server's charts, a tile's size on the display, and the night theme. */
  charts?: ChartInfo[];
  tileSize?(tile: Tile): { width: number; height: number };
  night?: boolean;
  /** The display's full fonts' line heights (engine tiles show text only where one fits). */
  fontLines?: readonly number[];
  /** Font sizes the display gives a value tile (other tiles keep the preview's own). */
  textSize?(tile: Tile): ValueTextSize | undefined;
  problemTileIds: Set<string>;
  supported: Set<string>;
  newTileDrag: NewTileDrag | null;
  onSelect(id: string | undefined): void;
  onSelectSlot(id: string, slot: SlotName): void;
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
          gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${page.grid.rows}, minmax(0, 1fr))`,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onSelect(undefined);
        }}
        data-testid="grid"
      >
        {page.tiles.map((tile) => {
          const classes = [
            'tile',
            tile.id === selectedId ? 'selected' : '',
            problemTileIds.has(tile.id) ? 'problem' : '',
            gesture?.id === tile.id && preview ? 'dragging' : '',
            props.supported.has(tile.type) ? '' : 'unsupported',
            `tile-type-${tile.type}`,
          ];
          const text = props.textSize?.(tile);
          return (
            <div
              key={tile.id}
              className={classes.filter(Boolean).join(' ')}
              style={
                {
                  gridColumn: `${tile.x + 1} / span ${tile.w}`,
                  gridRow: `${tile.y + 1} / span ${tile.h}`,
                  ...(text && { '--tile-value-size': text.value, '--tile-caption-size': text.caption }),
                } as CSSProperties
              }
              onPointerDown={(e) => onTileDown(e, tile)}
              onClick={() => props.onSelect(tile.id)}
              data-testid={`tile-${tile.id}`}
            >
              <span className="tile-label">
                {tile.type === 'wind_rose' || tile.type === 'chart' || tile.type === 'engine'
                  ? ''
                  : tile.type === 'clock'
                    ? [tile.label, tile.utc ? 'UTC' : ''].filter(Boolean).join(' ')
                    : tile.type === 'autopilot' || tile.type === 'position' || tile.type === 'heading_tape'
                    ? (tile.label ?? '')
                    : tile.label || (tile.path ? '' : 'Pick a path')}
              </span>
              <TilePreview
                tile={tile}
                values={values}
                serverZones={props.serverZones}
                roseTier={tile.type === 'wind_rose' ? props.roseTier(tile) : undefined}
                autopilotTier={tile.type === 'autopilot' ? props.autopilotTier(tile) : undefined}
                graphAxis={tile.type === 'graph' ? props.graphAxis(tile) : undefined}
                tapeWidth={tile.type === 'heading_tape' ? props.tileWidth(tile) : undefined}
                timeZone={tile.type === 'clock' ? props.timeZone : undefined}
                chart={
                  tile.type === 'chart'
                    ? {
                        info: props.charts?.find((c) => c.identifier === tile.chart),
                        ...(props.tileSize?.(tile) ?? { width: 480, height: 480 }),
                        night: props.night ?? false,
                      }
                    : undefined
                }
                engineBox={tile.type === 'engine' ? (props.tileSize?.(tile) ?? { width: 480, height: 480 }) : undefined}
                fontLines={tile.type === 'engine' ? props.fontLines : undefined}
                selectedSlot={
                  tile.id === selectedId && (tile.type === 'wind_rose' || tile.type === 'engine')
                    ? (props.selectedSlot as SlotName | undefined)
                    : undefined
                }
                onSelectSlot={(slot) => props.onSelectSlot(tile.id, slot)}
              />
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
