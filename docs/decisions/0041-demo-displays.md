# ADR-0041: Demo displays in the plugin

Status: **Accepted** (2026-11-19)

## Context
- **The editor only lists displays that have said hello** (ADR-0003). Someone with SignalK and the plugin but no ESPHelm display yet sees "Waiting for a display." and can't try anything.
- **Every preview depends on the display's hello:**
  - the canvas takes its size and shape;
  - the tile library offers its widgets;
  - the text sizes come from its font ladder;
  - its kind decides between colour and black and white;
  - its capacity gives the size warning.

  A pretend display therefore needs a hello as real firmware would send it.
- **A standalone demo page was not wanted.** That would be the editor with a fake API and simulated data, hosted somewhere. The people this is for already run SignalK, and their own server has the paths and live values.

## Decision
**The plugin adds four demo displays to its device registry:**
- 480x480 colour;
- 720x720 colour, with a speaker;
- 400x300 black and white (buttons, no backlight);
- 320x240 without PSRAM, so no charts.

They are on by default. The plugin setting *Show demo displays in the editor* (`demoDisplays`) turns them off.

- **Hellos as firmware sends them** (`packages/plugin/src/demo.ts`):
  - **Font ladders:** captured from the SDL builds of the same sizes.
  - **Widget lists:** the tile sets' own; a test compares them with `tile_types()` in the C++ sources.
  - **Capacity:** as `compute_capacity_()` derives it.
  - The board is `demo`, the firmware version `demo`, with no build and no `ota`.
- **The records:**
  - Ids are UUID-shaped like real ones, with a fixed prefix (`de300000-0000-4000-8000-`).
  - They are adopted and marked `demo: true`.
  - Their hellos are refreshed at every start, so a plugin update that adds tiles reaches them. Their names and layouts are kept.
  - Turned off, they leave the registry and their layouts stay.
- **They never touch the device side:**
  - A hello with a demo id gets `403 DEMO_DEVICE` (with security off, anyone could send one).
  - Their layout is not served.
  - No version or firmware delta is published for them.
  - The editor API refuses to delete them (turn them off instead) or to update their firmware (`409 DEMO_DEVICE`).
- **The rest is shared with real displays:** compatibility checks, the size warning, and *Copy* or *Link* through *Share* (ADR-0027). When a display arrives, a demo layout moves to it in two clicks.
- **In the editor:**
  - Demo displays are listed after the real ones, in a *Demo* group, with their size and what they lack. The group is open while there is no real display and collapsed once there is one; a click toggles it.
  - A note above the canvas says nothing receives the layout.
  - The save button reads *Save* and *Saved ✓*.
  - The editor opens on a demo only when there is no real display.
- **Names are ASCII** ("Demo 480x480"). A new layout is named after its display, and layout names are display text (ASCII and `°`).

## Consequences
- **A new user can design pages with live values** before buying or flashing anything, and keep them.
- **The demo hellos must follow the firmware.** The widget lists are checked by a test. The font ladders and capacity are copied by hand, so a change to the compiled fonts means updating `demo.ts`.
- **Four extra entries in every editor** until the setting is turned off. Once a real display is registered they take one collapsed line, and the plugin status counts only real displays.
