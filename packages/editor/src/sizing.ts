// Approximate pixel size of a tile on the display, from the display's resolution (hello) and the
// runtime's fixed geometry (renderer.cpp): page area padding 8, grid gaps 8, tile padding 10,
// and a footer of about 11 % of the height when the layout has several pages. Used for the
// wind rose and autopilot size hints; the display decides from the cell it actually gets.
import { AUTOPILOT_FIT, WIND_ROSE_FIT, type Layout, type Tile } from '@esphelm/schema';

const AREA_PAD = 8;
const GAP = 8;
const TILE_PAD = 10;
const FOOTER_SHARE = 0.11;

export interface DisplaySize {
  width: number;
  height: number;
}

/** Content width and height of `tile` on page `pageIndex`, in display pixels. */
export function tilePixels(
  display: DisplaySize,
  layout: Layout,
  pageIndex: number,
  tile: Pick<Tile, 'w' | 'h'>,
): { width: number; height: number } {
  const page = layout.pages[pageIndex];
  const cols = page?.kind === 'grid' ? page.grid.cols : 1;
  const rows = page?.kind === 'grid' ? page.grid.rows : 1;
  const height = display.height * (layout.pages.length > 1 ? 1 - FOOTER_SHARE : 1);
  const cellW = (display.width - 2 * AREA_PAD - GAP * (cols - 1)) / cols;
  const cellH = (height - 2 * AREA_PAD - GAP * (rows - 1)) / rows;
  return {
    width: Math.max(0, Math.floor(cellW * tile.w + GAP * (tile.w - 1) - 2 * TILE_PAD)),
    height: Math.max(0, Math.floor(cellH * tile.h + GAP * (tile.h - 1) - 2 * TILE_PAD)),
  };
}

export type RoseTier = 'full' | 'compact' | 'pointers';

/** What the display draws for a wind rose of shorter side `px` (WIND_ROSE_FIT). */
export function roseTier(px: number): RoseTier {
  if (px >= WIND_ROSE_FIT.full) return 'full';
  if (px >= WIND_ROSE_FIT.compact) return 'compact';
  return 'pointers';
}

export const ROSE_TIER_TEXT: Record<RoseTier, string> = {
  full: 'full: compass card, heading, centre values, and corner values where they fit',
  compact: 'compact: no tick labels or heading; as many centre values as fit',
  pointers: 'pointers only; too small for centre values',
};

export type AutopilotTier = 'controls' | 'status';

/** Whether the display shows an autopilot's buttons at this content size (AUTOPILOT_FIT). */
export function autopilotTier(px: { width: number; height: number }): AutopilotTier {
  return px.width >= AUTOPILOT_FIT.controlsWidth && px.height >= AUTOPILOT_FIT.controlsHeight
    ? 'controls'
    : 'status';
}

export const AUTOPILOT_TIER_TEXT: Record<AutopilotTier, string> = {
  controls: 'course and mode buttons',
  status: 'status only; too small for safe controls (make it bigger to steer from here)',
};
