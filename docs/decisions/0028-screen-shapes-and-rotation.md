# ADR-0028: Screen shapes and rotation

Status: **Accepted** (2026-11-07)

## Context
Layouts are grids, so they already scale with the screen: the firmware stretches a page's grid to whatever it has (`LV_GRID_FR`). That fails on screens of another shape:
- **Stretched pages:** a page made on the square 720 gets tiles twice as wide as high on a 1280×800 screen, and the reverse on a portrait one.
- **Shared layouts:** since ADR-0027 one layout can be linked to several displays, which may differ in shape.
- **No rotation:** a display mounted sideways or upside down had no way to turn its picture, and `hello.display.rotation` was always 0.

Your choices:
- **Scope:** both, screens of other shapes and rotation.
- **Adapting a page:** an arrangement per shape, made in the editor.
- **Rotation:** chosen on the display.

## Decision
**Shapes.** A screen is one of three shapes, decided from its width and height after rotation:
- **landscape:** width ≥ 1.25 × height (1280×800, 1024×600, 800×480)
- **portrait:** height ≥ 1.25 × width (800×1280, 480×800)
- **square:** everything else (480², 720², 800×720)

The rule is `displayShape()` in `packages/schema/src/shape.ts` and `display_shape()` in `esphelm_shape.h`. Its ratio is generated into `esphelm_sizes.h` (`SHAPE_RATIO_PERCENT`), and `fixtures/shape.cases.json` proves the two agree.

**Arrangements.** A grid page may carry `arrangements: { square?, landscape?, portrait? }`. Each arrangement has its own `grid` and places the page's tiles again by id, with `x`, `y`, `w` and `h` only.
- **Settings stay in the tiles:** a tile is configured once, whatever shape shows it.
- **Hidden tiles:** a tile an arrangement doesn't place isn't shown on that shape, e.g. a small portrait screen that drops a less useful value.
- **Default:** a shape without an arrangement shows the page's own `grid` and the tiles' own positions, as before. Existing layouts are unchanged.
- **Compatibility:** the field is optional and additive, so the schema stays v1. Older firmware ignores it and shows the default.
- **Validation:** an unknown tile id (`UNKNOWN_TILE`, new), a tile placed twice (`DUPLICATE_ID`), out of its grid (`TILE_OUT_OF_GRID`), overlapping (`TILE_OVERLAP`), and an arrangement with no tiles (`EMPTY_PAGE`). The firmware parser reports the same codes and pointers.

**The display** measures its screen when it builds a page, picks the shape, and builds only the tiles placed there. Widgets are unchanged: they size from their cell, as before.

**The editor** shows a page as the selected display's shape arranges it:
- **Without an arrangement for this shape,** the bar above the canvas says "Landscape: uses the default arrangement". *Arrange for landscape* starts one from the default, either as it is or turned (rows become columns).
- **With one,** every grid edit goes to it: moves, resizes, the grid size, adding and hiding tiles. Tile settings still go to the tile. The tile drawer offers *Hide on landscape* besides *Delete tile everywhere*, and hidden tiles are listed to show again. *Use the default again* drops the arrangement.
- **A tile added in an arrangement** is also placed in the default, at its first free cell. If the default is full, its grid gets a row and the editor says so.

**Rotation** is chosen on the display: a *Rotation* row (0°, 90°, 180°, 270°) in the settings panel's *Settings* tab.
- **ESPHome does the turning:** `LvglComponent::set_rotation()` turns the picture and the touch coordinates. A board allows it with `lvgl: rotation: 0` in its YAML; the runtime then sets `USE_ESPHELM_ROTATION` and shows the row.
- **Saved on the display,** as an ESPHome preference of its own. It isn't part of the display choices of ADR-0025, which are reconciled against the layout, because a rotation is about how that one display is mounted, and layouts are shared. A factory reset erases it with the rest.
- **At boot** the saved rotation is applied before anything is built for the screen.
- **A change** rebuilds the page (the shape may change with it), the panel and the status screen, and sends a new `hello` with the turned `width` and `height` and the `rotation`, so the editor follows.

## Consequences
- **One layout, several screens:** a linked layout can look right on a square helm display and a landscape chart table display.
- **Mounting:** a display can be turned to suit where it's mounted, and the turned display uses the matching arrangement (a 1280×800 screen turned 90° is portrait).
- **Memory:**
  - **Arrangements:** about 12 bytes per placement on the device, plus an arrangement's grid.
  - **Rotation:** software rotation needs a second draw buffer (`lv_alloc_draw_buf`, as large as LVGL's). On the P4 it lives in PSRAM and the PPA does the turning.
- **Boards:**
  - **On:** rotation is on for the P4 and the SDL builds.
  - **Off on the C3:** its 10 % buffer at 480² would cost about 46 KB more of internal RAM, which it doesn't have to spare.
- **Not done:**
  - **Editing a shape no display of yours has:** the editor follows the selected display's shape. Turning a display to portrait makes the editor follow it.
  - **Per-shape tile settings,** e.g. a bar horizontal in landscape and vertical in portrait.
  - **Rotation from the editor.**
  - **Arrangements in the starter templates.**
