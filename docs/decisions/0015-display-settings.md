# ADR-0015: Display settings carried by the layout

Status: **Accepted** (Phase 6, 2026-10-25)

## Context
You asked for brightness, start page, automatic day/night and a screen timeout. Until now these were fixed: the theme in the layout, brightness and timeout in the board's YAML (the P4 package switched off after 45 s), and the start page was always the first page.

## Decision
- **Where:** an optional `settings` block in the layout (schema v1, additive). With one layout per display, the settings are validated, cached and applied offline like the rest of the layout, with no second protocol. A layout without `settings` behaves as before.
- **Brightness** `day` / `night` in % follows the theme shown. It needs a dimmable `light` given to the runtime as `backlight:` in YAML. The hello reports `capabilities.backlight`, so the editor shows the brightness controls only when they work.
- **Start page:** shown at boot, and when a layout arrives with a different start page. An edit that keeps the start page keeps the page you're on.
- **Auto day/night** (`autoTheme: sun`): the night theme while `environment.sun` (the derived-data plugin) is `dusk` or `night`; otherwise the layout's theme. The page is rebuilt on a switch, which happens about twice a day. Without a value, the layout's theme stays.
- **Day/night on the display** (added 2026-10-26): holding the footer's page title for one second switches the theme on the display itself. The choice lives in RAM: it holds until `environment.sun` changes (with `autoTheme: sun`) or a layout with a different theme arrives, and a restart forgets it. No schema change; single-page layouts have no footer, so they can't be switched this way.
- **Screen timeout:**
  - After `screenTimeout` s without a touch (minimum 10, 0 = never), the runtime turns the backlight off and puts a black cover on LVGL's system layer.
  - The first touch only wakes the screen: the cover catches it, or on the P4, the board YAML resumes LVGL before the touch reaches it. So waking never presses a button.
  - A new `alarm` or `emergency` notification wakes the screen (ADR-0014).
  - The P4 config removes the hardware package's own `on_idle`, so there is a single timeout.

## Consequences
- Settings are per layout. Two displays sharing a layout share their settings.
- Without a backlight (SDL, boards without dimming), the timeout still blanks the screen with the cover, and brightness is ignored.
- While the screen is off, LVGL keeps updating values under the cover (except on the P4, where the board YAML pauses LVGL), so they are current on wake.
- Times count only touches as activity. A display that's only looked at, never touched, switches off. Pick 0 (never) for a helm display that must stay on.
