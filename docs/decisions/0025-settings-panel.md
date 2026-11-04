# ADR-0025: Settings and information panel on the display

Status: **Accepted** (2026-11-04)

## Context
You asked for a friendlier way to change things on the display. You also wanted it to show what it knows about itself: its IP, the server's address, how many deltas it has processed, and room for more.

What was there:
- **The only control** was holding the footer's page title for one second to switch day and night (ADR-0015). Nothing on the screen said it was there.
- **Brightness** could only be changed in the editor.
- **One-page layouts** had no footer at all (ADR-0009), so they had no control.

Your choices:
- **The button** goes in the footer, which every layout now has.
- **Changes made on the display** are saved there.

## Decision
- **The footer is always there.**
  - **What it shows:** the page title and a menu button (three bars: the fonts have no symbol glyphs), plus the page buttons and "n/m" when there are several pages.
  - **Replaces:** this amends ADR-0009 (a one-page layout gets a footer too) and ADR-0015 (the long-press is gone).
  - **Editor:** the preview and its size hints reserve the strip on every layout.
- **The panel** (`settings_panel.cpp`) opens from the menu button.
  - **Placement:** a full-screen sheet below the alarm banner, like the history popup. It closes only with its close button.
  - **Tabs** (added after the first P4 check, at your request): *Settings* for the controls and *Info* for the information, with the close button beside them. It opens on *Settings*. Only the tab shown is built. On *Info* the sections sit one under the other and scroll, on every screen (two columns at 720 cut too many values short).
  - **Settings tab:**
    - *Brightness*, a slider for the theme shown. Day is 5–100 %, night 1–100 %, as in the schema. It dims live and is saved when let go. Without a backlight the value is only logged, like the layout's brightness.
    - *Theme:* *Day*, *Night* or *Auto*, where *Auto* is the layout's theme or the sun (`autoTheme`).
    - *Screen off*, when the layout has a screen timeout. It switches off, or to the screen saver, at once.
  - **Info tab,** refreshed once a second while it shows:
    - **Display:** id, board, firmware, screen size, uptime, free memory.
    - **Network:** Wi-Fi network, signal, IP.
    - **SignalK:** server address, stream state, deltas received, messages dropped, the age of the last delta, subscribed paths.
    - **Layout:** name, version (ETag), where it came from, pages, plugin state.
    - **Clock:** UTC time, its source, the time zone.
  - **Delta counters:** they come from ESPHomeSignalK: `deltas_received()`, `messages_dropped()`, `last_delta_ms()` and `subscribed_paths()`.
- **Choices are saved on the display** (`display_prefs.cpp`, LayoutStore `Slot::PREFS`).
  - **What is saved:** a small self-checking record. It holds the brightness override for day, the one for night, the theme choice, and the layout values they were chosen against.
  - **When it applies:** it's read before the first layout is shown, so a reboot keeps the choices.
  - **The editor wins:** when a layout brings a different value for something overridden (another `brightness.night`, `theme` or `autoTheme`), that override is dropped. An unrelated edit keeps it.
  - **The sun:** as before, a choice of day or night lasts until the sun changes. The first sun value after a boot is not a change, so a saved choice survives a restart.
  - **Untrusted input:** a record that doesn't parse, or has a value out of range, is ignored (golden rule 2).
  - **Flash wear:** the record is written when the slider is let go or a button is pressed, never per drag step.

## Consequences
- **Less page height:** a one-page layout loses about 11 % of its height to the footer. Its tiles get smaller, and the editor's size hints follow.
- **The editor doesn't see** what was chosen on the display. The layout keeps its own values, and the display shows its own until the layout's change.
- **Memory:** about 20 LVGL objects with the *Settings* tab open, about 30 with *Info* (four per section), none when closed. The footer gains a button with three bars.
- **Build cost** (against `main` after the clock):
  - **P4:** flash +15.5 KB (3,353,082 → 3,368,618 B), RAM +216 B.
  - **C3:** flash +15.7 KB (1,465,140 → 1,480,876 B, 79.8 → 80.7 %), RAM +216 B.
  - **What it is:** the panel, LVGL's slider, the saved choices and the counters.
- **Test hooks:**
  - `@menu` opens the panel, and `@settings <part>` presses its controls (`tab-settings`, `tab-info`, `day`, `night`, `auto`, `sleep`, `brightness=N`, `close`).
  - `ESPHELM_TEST_INFO=fixed` writes "test" for the values that change by themselves, so screenshots compare.
- **Rollout:** the delta counters are in ESPHomeSignalK's `main` (its PR #12), which the firmware fetches.
