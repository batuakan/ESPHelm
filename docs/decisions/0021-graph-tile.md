# ADR-0021: Graph tile

Status: **Accepted** (2026-11-03)

## Context
You asked for a graph tile: a value's recent trend on the page itself, such as depth shoaling, the barometer falling or the battery draining. Until now a trend was only visible in the history popup, after tapping a value tile that records (ADR-0018, ADR-0019).

The display already records values (`ValueHistory`) and draws them (the popup). A second recorder would cost memory and could disagree with the popup.

## Decision
- **A view on the existing recorder.** A `graph` tile records its value under its tile id, exactly as a value tile with `history: true` does, and draws one window of it.
  - **It always records:** there is no `history` field.
  - **Limits:** it counts against the same limits (6 values without PSRAM, 48 with), in `historySeries()` order. A graph over the limit shows "No history on this display", and the log names it.
  - **Separate entries:** a graph and a value tile on the same path record separately.
- **Fields:**
  - **DataItem:** path, unit, decimals, label, staleAfter.
  - **`window`:** `10m` (default), `1h` or `6h`. A display without PSRAM keeps 10 min and 1 h only, so `6h` shows 1 h there (`graphWindowIndex()`, mirrored by the widget).
  - **`min`/`max`:** a fixed y axis. Both are needed (`INVALID_RANGE`), and the line is clipped at its edges. Absent, the axis follows the points, as in the popup.
  - **`zones`:** value zones (open ends allowed). They're drawn as faint bands and colour the live value. The server's zones replace them, with the value tile rules (ADR-0020).
- **Drawing (`widget_graph.cpp`):**
  - **Layout:** caption and live value on top; the window's 120 points below, newest on the right; gaps break the line.
  - **Axis labels:** from `GRAPH_FIT.axisHeight` (120 px) of content height it also shows its y range, the window's start and "now". Smaller tiles draw the line only. The editor's size hint says which.
  - **Angles:** drawn around their circular mean, like the popup. With a fixed axis they stay in the unit's range instead, matching its labels.
- **Redraws:** only when a point of its window closes (`ValueHistory::appended()`: every 5 s, 30 s or 3 min). The header value follows the usual 250 ms throttle. Nothing redraws per value.
- **A tap** opens the history popup on the value, for the other windows and min/max. There's no sparkline mark, since a graph is obviously tappable.
- **Shared code:** the popup's range and unwrap logic moved to `prepare_graph()` in `value_history.h`. The popup and the tile use it, and the g++ history test covers it. Every popup golden stayed pixel-identical.
- **Widget purity:** CLAUDE.md §6 says a widget is a pure function of (config, value, theme). A graph is a function of (config, its own recorded series, theme). It reads `ValueHistory` through `WidgetEnv::history` and still knows no other widget.
- **Within schema v1:** a new tile type. The plugin refuses to assign a layout with a graph to a display whose hello doesn't list `graph` (`UNSUPPORTED_WIDGET`), as for other tile types.

## Consequences
- **Memory per graph:**
  - **Recording:** the recorded value, 4,320 B with PSRAM or 2,880 B without.
  - **On screen:** while its page is shown, about 8.8 KB of LVGL objects and its 1.9 KB point buffer. The graph page of `fixtures/valid/graph.json`, four graphs and two zones, takes 35,152 B on the 64-bit host build.
- **Build cost** (against `main`): flash +6.5 KB on both boards (P4 3,314,862 → 3,321,402 B; C3 1,429,386 → 1,435,932 B, 77.9 → 78.3 %). Static RAM is unchanged. LVGL's chart widget was already in, for the popup.
- **After a reboot a graph is empty:** "Collecting..." until two points have closed (10 s in the 10 min window), and a 6 h graph takes 6 h to fill.
- **Known limits:** a spread over 180° within one window still jumps, as in the popup. An angle zone across north isn't drawn.
