# ADR-0028: Mounting rotation

Status: **Accepted** (2026-11-08)

## Context
- **No rotation:** a display mounted sideways or upside down had no way to turn its picture, and `hello.display.rotation` was always 0.
- **Screens of other shapes:** a 1280×800 panel can be mounted landscape or portrait.
- **A first attempt was dropped:** per-shape arrangements in every page (a grid per square, landscape and portrait shape), with the rotation as an everyday setting on the display (closed PR #14). It made the layout format, the firmware and the editor much more complex for a case that doesn't happen: a display stays the way it was installed. Moving it means designing its layout again.

## Decision
**The rotation is a design-time setting of the layout:** `settings.rotation`, 0, 90, 180 or 270 degrees clockwise, absent meaning 0. The layout is designed for the turned screen.
- **Set in the editor:** *Display settings → Mounted*. The preview turns at once, before *Save & send*: the editor takes the panel's own size from `hello` (turned back by the rotation the display reports) and turns it by the layout's rotation.
- **Delivered with the layout,** like the other display settings (ADR-0015): validated, cached and applied offline, with no new endpoint.
- **On the display:** the runtime turns the screen to the layout's rotation just before it builds the layout's page, so a cached layout boots turned and a layout without the setting turns it back to 0. A change closes an open panel or history popup and sends a new `hello` with the turned `width` and `height` and the `rotation`.
- **ESPHome does the turning:** `LvglComponent::set_rotation()` turns the picture and the touch coordinates. A board allows it with `lvgl: rotation: 0` in its YAML; the runtime then sets `USE_ESPHELM_ROTATION` and reports `capabilities.rotation: true` in `hello`. A board that can't turn ignores the setting (logged once), and the editor says so instead of offering it.
- **One grid per page,** stretched to the screen as before; there are no per-shape variants.
- **Linked layouts** (ADR-0027) share the rotation with everything else, so two displays mounted differently shouldn't share one. The editor warns before linking displays whose screens have different shapes (one side at least 1.25 times the other: landscape or portrait, else square) and suggests *Copy*.

## Consequences
- **Small change:** one optional, additive setting (schema stays v1; older firmware ignores it) and one optional `hello` capability.
- **Memory:** software rotation needs a second draw buffer (`lv_alloc_draw_buf`, as large as LVGL's). On the P4 it lives in PSRAM and the PPA does the turning.
- **Boards:**
  - **On:** the P4, the Guition 4848S040 (PSRAM) and the SDL builds.
  - **Off:** the C3 and the cheap yellow display, which have no PSRAM: a second buffer would cost internal RAM they don't have to spare. The CYD is turned to landscape by its panel instead (`hardware/esp32-2432s028r.yaml`).
- **Not done:** one layout that adapts to several shapes; a different rotation per linked display.
