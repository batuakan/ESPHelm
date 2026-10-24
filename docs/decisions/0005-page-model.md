# ADR-0005: Page model: grid pages plus full-page widgets with slots

Status: **Accepted** (Phase 1, 2026-10-24)

## Context
Today's apps fall into two kinds:
- **Composable pages** of independent values (`modules/applications/grid.yaml`, energy, engine): well served by tiles on a grid.
- **Designed pages** whose layout is part of the instrument (wind rose with rotating needles and a centre stack of three values, `wind.yaml:230-233`; chart/anchor; autopilot): these can't be decomposed into grid tiles without losing the design.

You asked for explicit grid cells where appropriate, and for pages like the wind rose to offer **predetermined positions** (e.g. the centre) where the user chooses what to show (apparent wind, depth, …).

## Decision
- `Page` is a discriminated union on `kind`:
  - **`grid`:** `grid: { cols, rows }` plus tiles with explicit `x, y, w, h` in cells (0-based; multi-cell tiles allowed). Resolution agnostic: the device divides its own canvas. Placement is identical at 480² and 720².
  - **`widget`:** a full-page widget chosen by `widget` (v1: `wind_rose`). It has optional `config` (data sources with SignalK defaults) and **named slots** (`center1..3` for the wind rose). Each slot holds a `DataItem` (path, unit, decimals, label), the same shape a `value` tile uses.
- Each full-page widget declares its slot names in the schema. Unknown slots are an error (`UNKNOWN_SLOT`), and empty slots are allowed.
- Semantic rules are enforced by `validateLayout()` and mirrored by firmware: in-grid, no overlap, ids unique across the layout.

## Consequences
- Adding a full-page widget (autopilot, chart_anchor, …) is additive within v1: a new `widget` value with its own config and slots. Firmware that can't render it doesn't list it in `hello.widgets`, and the plugin won't send it.
- The editor shows two page types: a grid canvas, and a fixed preview with clickable slots.
- Free-form positioning (pixel or percentage) is deliberately not supported (golden rule 6).
