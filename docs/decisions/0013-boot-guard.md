# ADR-0013: Boot guard against layouts that crash the display

Status: **Accepted** (Phase 6, 2026-10-25)

## Context
Layouts are validated before they're shown (ADR-0002), so a malformed one is refused and the display keeps the last one that worked. A layout that passes validation but crashes the firmware while it is built or shown (a renderer bug, memory exhaustion inside LVGL) was a different story:
- **Cached layout:** the cached copy is shown at every boot, so the display crashes again at every boot. That's a boot loop.
- **Fetched layout:** a layout that crashes before it's cached loops through the network. Each boot shows the old cached layout, fetches the bad one again, and crashes again.

ESPHome's own safe mode only steps in after 10 failed boots, and it drops the display completely.

## Decision
- A third store record, `boot` (next to `cur` and `lkg`, same self-checking format), holds:
  - the etag of the layout being shown
  - how many times it was shown when the display crashed
  - the etag of a layout to skip
- **Before building** a layout, the runtime records the attempt (count + 1 for the same etag, else 1).
- **After 30 s on screen** (the same point at which it becomes last known good), the attempt is cleared. A refusal, such as running out of memory while building, also clears it.
- **At boot, after a crash**, a pending attempt means:
  - for a layout that isn't the cached one (it was fetched and never cached): skip it at once
  - for the cached layout: try it once more, and skip it after 2 crashes

  On ESP32 a crash is a panic or watchdog reset; power cuts, OTA and requested restarts don't count. On the host build, a clean exit clears the record.
- A skipped layout is refused by its etag, both from the cache and when fetched. The display falls back to the last known good layout, else the status page, which says why.
- The hello reports it as `recovery.skippedLayoutEtag`, and the editor shows a warning for that display. Sending any changed layout gives a new etag, which is tried normally.

## Consequences
- Two writes of a few bytes to flash per layout change (attempt and clear). Changing page doesn't write anything.
- A crash in the first 30 s after a layout change counts against that layout even when something else caused it. The cached layout is only skipped after two such crashes; a fetched one after one, because the cached layout is known to work.
- A crash that happens later (after 30 s) isn't attributed to the layout. That's a different kind of bug and doesn't loop at boot.
- Test hook (host build only): `ESPHELM_TEST_CRASH_ON=<tile id>` aborts while building that tile.
