# ADR-0027: Sharing layouts: files, and between displays

Status: **Accepted** (2026-11-05)

## Context
A layout could only be built in the editor, from scratch or from a starter template. There was no way to:
- keep a backup
- give a layout to another boat
- use one display's layout on a second display on the same boat

The plugin already allowed several displays to use one layout. Its layout and device routes check every display that uses a layout before saving.

Your choices:
- **Sharing:** both, a file and between displays.
- **Copy or link:** asked each time.
- **Import:** a list to replace the paths and charts this server doesn't have.

## Decision
Sharing is done entirely in the editor, under a new *Share* menu next to *Templates*. The plugin, the schema and the firmware are unchanged.

- **The file is the layout itself:** plain layout v1 JSON, as the plugin stores it and as the starter templates are.
  - **Validation:** it validates against the published JSON Schema, so it can be checked or edited outside the editor.
  - **File name:** `esphelm-<layout name>.json`.
  - **Contents:** *Export file* saves what the editor shows, including changes not yet sent (the menu says so).
- ***Import file…*** treats the file as untrusted:
  - **Checks:** at most 1 MB, then JSON, then the stored-layout upgrade (`migrateLayout`, for files from before Phase 5b), then the validator the plugin and firmware use. A refused file leaves the layout as it was, and the editor lists up to five errors.
  - **Confirm:** "Replace all pages…".
  - **What changes:** the theme, pages and settings come from the file. The layout keeps this display's id and name, so an import never overwrites another display's layout.
  - **Sending:** like a template, nothing is sent until *Save & send*.
  - **Unsupported tiles:** tiles or pages this display can't show are named. *Save & send* refuses them as before.
- **Replacing what's missing:** after an import, every path not in the server's path list and every chart not in its chart list is listed, with how often it is used.
  - **A replacement:** it applies to every use at once.
  - **Defaults:** a field that used a default is written out, e.g. a heading tape's `cogPath`.
  - **Keep as is:** allowed, because some paths only exist while in use (an autopilot in standby, `environment.sun` without derived-data).
  - **Which paths count:** `layoutPathRefs` (`packages/editor/src/layoutOps.ts`) lists every path a layout reads or writes, with its defaults.
    - **Optional settings:** the clock path counts only with a clock or a screen saver, and the sun path only with *Auto day/night*.
    - **A guard:** a unit test walks the schema for every SignalK path field, so a new path field must be added there.
- ***Use another display's layout…*** lists the other displays that have a layout and asks:
  - **Copy:** its pages come into this display's own layout, under this display's id and name, and are sent with *Save & send*.
  - **Link:** after a warning that unsent changes are lost, the display is assigned the other display's layout at once.
    - **Checks:** the plugin checks compatibility, and both displays then show and edit one layout. The editor says "Shared with …".
    - **Undo:** *Make a separate copy* puts the layout under this display's own id again. The next *Save & send* stores it there and reassigns the display.

## Consequences
- **Boats on other servers:** a layout made for one boat works on another after its paths are replaced, without editing JSON.
- **The same tile everywhere:** a linked layout is edited once for several displays. The plugin refuses a save that doesn't fit every one of them (as it already did).
- **Old layouts:** a display's own layout stays stored, unused, after it links to another. *Make a separate copy* reuses its id, so nothing piles up per display.
- **Not done:**
  - **Sharing through the phone's share sheet (Web Share):** it needs HTTPS, and the editor is usually on plain HTTP on the boat's network.
  - **A library of layouts** that aren't tied to a display.
  - **Remapping the paths** when copying from a display on the same server (it uses this server's paths already).
