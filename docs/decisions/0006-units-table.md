# ADR-0006: Generated affine unit table with wrap, shared by TS and C++

Status: **Accepted** (Phase 1, 2026-10-24)

## Context
SignalK values are SI, and tiles declare a display unit. CLAUDE.md §3 requires the conversion table to be identical in TS and firmware, with shared fixtures proving it. ESPHomeSignalK's `unit_conversions.*` can't be reused: it has no length conversions in either direction and treats litres as the volume base, where SignalK uses m³ (`docs/phase0-findings.md` §3.6). Angles need two display ranges: headings 0..360, and apparent wind −180..180.

## Decision
- `packages/schema/units.json` is the single source. Each quantity has an SI unit and display units `{ label, factor, offset?, wrap? }`, with `display = si × factor + offset`, wrapped into `[wrap[0], wrap[1])`.
  - Values within `1e-9 × span` below the upper bound snap to the lower bound, so 2π rad shows 0°, not 359.999…°.
- **Two angle units** (your decision): `deg` (wrap 0..360) and `deg180` (wrap −180..180).
- Unit ids are globally unique ASCII identifiers (`kn`, `degC`, `nmi`, …). Labels are ASCII plus `°` (font glyph set).
- `npm run generate` emits `src/generated/units.ts`, `generated/esphelm_units.h` (C++17 `constexpr` table, `find_unit`, `to_display`, `from_display`) and `generated/units_cases.h`. These are committed, and a test fails if they're stale.
- `fixtures/units.cases.json` (59 cases, every unit covered, wrap edges included) runs in vitest and in a g++-compiled host test on every `npm test`. Expected values are derived from unit definitions, not from the table.

## Consequences
- Firmware copies (or references) the generated header. It uses `double` arithmetic, which is cheap at display update rates on P4/S3/C3/C6. If profiling shows a cost, a float variant can be generated.
- Adding a unit means editing JSON, regenerating, and adding at least one case (a test enforces that every unit is covered).
- Unit-vs-path quantity compatibility isn't checked by the schema. The editor checks it against SignalK `meta.units` (Phase 4).
