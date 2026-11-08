// How a display is mounted (ADR-0028): the layout's settings.rotation turns the picture, and the
// layout is designed for the turned screen. The editor previews it at that size at once, before
// Save & send, from the size the display reports (as turned by the layout it shows now).
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

type Size = { width: number; height: number };

const turned = ({ width, height }: Size, degrees: number): Size =>
  degrees % 180 === 0 ? { width, height } : { width: height, height: width };

/**
 * The screen a layout with this rotation gets on the display: its panel's own size (hello's,
 * turned back) turned by the rotation. A display that can't turn keeps its own size.
 */
export function shownSize(
  hello: { display: Size & { rotation?: number }; capabilities: { rotation?: boolean } },
  rotation: number | undefined,
): Size {
  const panel = turned(hello.display, hello.display.rotation ?? 0);
  return hello.capabilities.rotation === true ? turned(panel, rotation ?? 0) : panel;
}

/** A screen's shape; one side 1.25 times the other or more is not square. */
export function screenShape({ width, height }: Size): 'landscape' | 'portrait' | 'square' {
  if (width * 4 >= height * 5) return 'landscape';
  if (height * 4 >= width * 5) return 'portrait';
  return 'square';
}
