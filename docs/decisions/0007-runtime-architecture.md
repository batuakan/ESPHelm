# ADR-0007: Firmware runtime architecture

Status: **Accepted** (Phase 3, 2026-10-25)

## Context
The display must render layouts that arrive at runtime as untrusted JSON (golden rule 2), keep working offline (rule 3), and coexist with ESPHome's own `lvgl:` component.

Phase 0 established:
- LVGL runs single-threaded in `LvglComponent::loop()`, with no lock.
- ESPHome pages can be added but not removed.
- `lv_conf.h` only enables the widgets the YAML uses.
- SignalK WebSocket callbacks run on the esp_websocket_client task.

## Decision
1. **Owned container.** YAML declares one page holding a full-size `obj` (`esphelm_container`). The runtime builds and destroys everything inside it (`lv_obj_clean`) and never touches ESPHome's page list. It enables the LVGL features it needs (`label`, `grid`, `font`) through `lvgl.defines.add_lv_use()` at config validation, with a build-flag fallback if that internal API moves.
2. **One thread for LVGL and state.** Every `lv_*` call, every SignalK callback and every state change runs in the ESPHome main loop:
   - ESPHomeSignalK queues incoming messages from its transport task and dispatches them in `SignalK::loop()`.
   - HTTP (hello, layout) runs on a worker: a FreeRTOS task on ESP-IDF, a thread on host. It exchanges requests and results with the loop through a mutex-protected mailbox and nothing else.
3. **The parser validates the whole contract.** `layout_parser.cpp` is pure C++ on ArduinoJson. It checks every v1 field, including tile types and widgets this firmware can't render, with the same error codes and JSON pointers as `validateLayout()`. That's verified on every fixture plus mutations by `firmware/test/parser.cpp.test.ts`. Deliberate differences:
   - Unknown fields are ignored, for forward compatibility within a major.
   - `INVALID_JSON` and `CAPACITY_EXCEEDED` exist only on the device.
4. **Rendering is separate from capability.** The firmware renders what `hello.widgets` advertises (Phase 3: `value` on the first grid page). Anything else that passes validation gets a placeholder tile rather than failing, because the plugin shouldn't send it.
5. **Persistence and fallback.** A fetched layout is persisted to `cur` only after it parsed and rendered. It's promoted to `lkg` after 30 s on screen. Boot order is `cur`, then `lkg`, then a status page. A rejected layout never replaces what is shown.
6. **Server is authoritative when reachable.** If hello reports pending or no layout, the device clears what it shows. If the server is unreachable, the cached layout stays up, with values going stale.

## Consequences
- The renderer can grow widget by widget without touching the parser, store or protocol.
- Memory: about 2 KB of LVGL objects per `value` tile on the 64-bit host build (24 tiles = 49 KB). The device numbers are in `docs/firmware-runtime.md`.
- There is no boot-loop counter yet. A layout that crashes the renderer, as opposed to failing validation, would be re-shown from `cur` on every boot. That's planned for Phase 6.
- On the host the device id is ESPHomeSignalK's fixed placeholder, which keeps tests deterministic.
