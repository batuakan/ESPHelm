// Battery tile preview (ADR-0046): drawn in the display's pixels as widget_battery.cpp and
// mono_battery.cpp draw it, with the rows batteryRows() keeps and the text battery.ts writes.
import {
  batteryRows,
  batteryState,
  batteryStatus,
  DEFAULT_FONT_LINE_HEIGHTS,
  historyEnabled,
  toDisplay,
  UNITS,
  valueZoneState,
  type BatteryTile,
  type DataItem,
} from '@esphelm/schema';
import { formatValue } from '../format';
import { elide, LINE_PER_SIZE, measure, useDisplayFont } from './Previews';

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const suffix = (item: DataItem | undefined) =>
  item?.unit && UNITS[item.unit].label ? ` ${UNITS[item.unit].label}` : '';

/** A value with the charging sign (positive charges), as battery_values.h writes it. */
function signedText(item: DataItem | undefined, value: unknown, sign: number): string {
  const si = num(value);
  if (!item || si === undefined) return `--${suffix(item)}`;
  const d = item.decimals ?? 1;
  let n = (item.unit ? toDisplay(si, item.unit) : si) * sign;
  if (Math.abs(n) < 0.5 * 10 ** -d) n = 0; // no "-0.0"
  return `${n.toFixed(d)}${suffix(item)}`;
}

/** What a battery tile shows for these values (battery_values.h). */
export function batteryTexts(tile: BatteryTile, values: Map<string, unknown>) {
  const get = (item: DataItem | undefined) => (item?.path ? values.get(item.path) : undefined);
  const sign = tile.invertCurrent ? -1 : 1;
  const soc = num(values.get(tile.path));
  const v = num(get(tile.voltage));
  const a = num(get(tile.current));
  const fmt = (item: DataItem | undefined) =>
    num(get(item)) === undefined ? `--${suffix(item)}` : `${formatValue(get(item), item?.unit, item?.decimals)}${suffix(item)}`;
  let power: string;
  if (tile.power) power = signedText(tile.power, get(tile.power), sign);
  else if (v !== undefined && a !== undefined) {
    let w = v * a * sign;
    if (Math.abs(w) < 0.5) w = 0;
    power = `${w.toFixed(0)} W`;
  } else power = '-- W';
  const mode = tile.chargingModePath ? values.get(tile.chargingModePath) : undefined;
  return {
    live: soc !== undefined,
    fraction: soc === undefined ? 0 : Math.min(1, Math.max(0, soc)),
    display: soc === undefined ? undefined : tile.unit ? toDisplay(soc, tile.unit) : soc,
    percent:
      soc === undefined ? '--' : `${formatValue(soc, tile.unit, tile.decimals)}${tile.unit ? UNITS[tile.unit].label : ''}`,
    voltage: fmt(tile.voltage),
    current: signedText(tile.current, get(tile.current), sign),
    power,
    status: batteryStatus(batteryState(a, tile.invertCurrent === true), num(get(tile.timeRemaining)), mode),
    solar: fmt(tile.solar),
  };
}

/** The largest full font, of line height at most `h`, in which `text` is at most `w` wide (fit_font). */
function fitLine(ladder: readonly number[], text: string, w: number, h: number): number {
  const sorted = [...ladder].sort((x, y) => x - y);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const l = sorted[i]!;
    if (l <= h && measure(text, l) <= w) return l;
  }
  return sorted[0] ?? 26;
}

export function BatteryPreview(props: {
  tile: BatteryTile;
  values: Map<string, unknown>;
  box: { width: number; height: number };
  fontLines?: readonly number[];
}) {
  useDisplayFont();
  const { tile } = props;
  const W = Math.max(1, props.box.width);
  const H = Math.max(1, props.box.height);
  const ladder = props.fontLines ?? DEFAULT_FONT_LINE_HEIGHTS;
  const t = batteryTexts(tile, props.values);
  const showsPower = !!tile.power || (!!tile.voltage && !!tile.current);
  const rows = batteryRows(W, H, ladder, {
    caption: !!tile.label || !!tile.voltage,
    power: !!tile.current || showsPower,
    status: !!tile.current || !!tile.timeRemaining || !!tile.chargingModePath,
    solar: !!tile.solar,
  });
  const line = rows.line;
  // battery_box(): the % beside the outline, the outline at most a little over twice as wide as tall.
  // With history, the % leaves room under it for the mark (MARK_ROOM in widget_battery.cpp).
  const markRoom = historyEnabled(tile) ? 12 : 0;
  const pl = fitLine(ladder, '100%', (W * 40) / 100, rows.height - markRoom);
  const pw = measure('100%', pl);
  const gap = Math.max(6, Math.floor(line / 3));
  const avail = Math.max(20, W - pw - gap);
  const bh = Math.max(12, Math.min(rows.height - 4, Math.floor((avail * 45) / 100)));
  const nubW = Math.max(4, Math.floor(bh / 8));
  const nubH = Math.max(4, Math.floor((bh * 40) / 100));
  const bw = avail - nubW;
  const by = rows.top + Math.floor((rows.height - bh) / 2);
  const border = Math.max(2, Math.floor(bh / 14));
  const inset = border + Math.max(2, Math.floor(border / 2));
  const innerW = Math.max(0, bw - 2 * inset);
  const zone = t.display === undefined ? undefined : valueZoneState(t.display, tile.zones);
  const state = !t.live ? 'stale' : (zone ?? 'normal');
  const size = (l: number) => l / LINE_PER_SIZE;
  let ry = rows.top + rows.height;
  const below: { key: string; left?: string; right?: string; muted?: boolean }[] = [];
  if (rows.power)
    below.push({ key: 'power', left: tile.current ? t.current : undefined, right: showsPower ? t.power : undefined });
  if (rows.status) below.push({ key: 'status', left: t.status });
  if (rows.solar) below.push({ key: 'solar', left: tile.solar?.label || 'Solar', right: t.solar, muted: true });
  return (
    <span
      className={`tile-graphic battery-preview battery-zone-${state}`}
      data-testid={`battery-${tile.id}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`}>
        <rect className="battery-paper" x={0} y={0} width={W} height={H} />
        {rows.caption && tile.label && (
          <text x={0} y={line / 2} fontSize={size(line)} className="battery-muted">
            {elide(tile.label, W / 2, line)}
          </text>
        )}
        {rows.caption && tile.voltage && (
          <text x={W} y={line / 2} fontSize={size(line)} textAnchor="end" className="battery-text">
            {t.voltage}
          </text>
        )}
        <rect
          className="battery-outline"
          x={border / 2}
          y={by + border / 2}
          width={bw - border}
          height={bh - border}
          rx={border * 2}
          strokeWidth={border}
        />
        <rect
          className="battery-nub"
          x={bw}
          y={by + (bh - nubH) / 2}
          width={nubW}
          height={nubH}
          rx={border}
        />
        <rect
          className={`battery-fill zone-${state}`}
          x={inset}
          y={by + inset}
          width={Math.round(innerW * t.fraction)}
          height={Math.max(0, bh - 2 * inset)}
          rx={border}
          data-testid={`battery-fill-${tile.id}`}
        />
        <text
          x={bw + nubW + gap}
          y={by + bh / 2}
          fontSize={size(pl)}
          className={t.live ? 'battery-text' : 'battery-muted'}
        >
          {t.percent}
        </text>
        {historyEnabled(tile) && (
          // The history mark under the %, at the bottom of the battery's band (widget_battery.cpp).
          <polyline
            className="battery-history-mark"
            transform={`translate(${bw + nubW + gap} ${rows.top + rows.height - markRoom})`}
            points="1,9 6,4 12,7 19,1"
            data-testid={`battery-mark-${tile.id}`}
          />
        )}
        {below.map((r) => {
          const y = ry + line / 2;
          ry += line;
          return (
            <g key={r.key}>
              {r.left !== undefined && (
                <text x={0} y={y} fontSize={size(line)} className={r.muted ? 'battery-muted' : 'battery-text'}>
                  {r.key === 'status' ? elide(r.left, W, line) : r.left}
                </text>
              )}
              {r.right !== undefined && (
                <text x={W} y={y} fontSize={size(line)} textAnchor="end" className="battery-text">
                  {r.right}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </span>
  );
}
