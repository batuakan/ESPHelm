# ADR-0004: Dynamic subscriptions in ESPHomeSignalK (unsubscribe-all + resubscribe)

Status: **Proposed** (Phase 0) · Resolves CLAUDE.md open question #6

## Context
- ESPHomeSignalK subscriptions are compile-time. `subscribe()` appends to a vector (`ESPHomeSignalK/components/signalk/signalk.h:57-65`), and the subscribe message is sent only in `on_connected()` (`signalk.cpp:63-84`). There is no unsubscribe.
- signalk-server 2.17.2/2.19.0 behavior, **verified with a WS probe**:
  - Additional subscribe messages add paths.
  - **A per-path unsubscribe is rejected and the server closes the socket.**
  - Only `{"context":"*","unsubscribe":[{"path":"*"}]}` is supported (`subscriptionmanager.js:82-96`).
  - After it, a new subscribe yields only the new set, with cached values replayed immediately (`:151-154`).
- WebSocket callbacks run in the esp_websocket_client task and touch shared state without locks (`signalk_esp_idf.cpp:55-77`).

## Decision
Extend ESPHomeSignalK (not a second WebSocket client in `esphelm_runtime`):
- **API (main loop only):**
  - `uint32_t add_listener(path, std::function<void(const SignalKValue&)>)`
  - `void remove_listener(uint32_t)`
  - `bool put(path, value, cb)`
  - `bool is_stream_connected()`
  - `const std::string& token()`
- **Subscription set** = static YAML subscribers ∪ dynamic listener paths, ref-counted per path.
  - On a set change, debounce ~200 ms. If only additions, send one subscribe with the added rows. If anything was removed, send unsubscribe-all and then one subscribe with the full set.
  - On reconnect, send the full set (as today).
- **Threading:**
  - The WS task only enqueues raw frames (reassembled using `payload_offset`/`payload_len`) into a bounded queue.
  - Parsing, matching and callbacks happen in `loop()`.
  - Matching uses a `path → listeners` map plus a short wildcard list.
  - Process all `updates[]`, not just `[0]`.
- Also in this change: stop logging tokens and passwords, and bound the HTTP response buffers.

## Consequences
- About 150–250 LOC in ESPHomeSignalK, behind a new API. Existing YAML sensors keep working.
- A brief gap of no data during unsubscribe-all + resubscribe is covered by the server's cache replay.
- Upstream changes affect other ESPHomeSignalK users. They need maintainer sign-off and a rebase decision (the local tree has uncommitted changes, and upstream `main` is 3 commits ahead).
- Rejected alternative: a separate WS connection in `esphelm_runtime`. It would mean two sockets, two auth flows and duplicate code, and it wouldn't fix the race for the legacy sensors.
