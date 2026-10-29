# ADR-0001: TypeBox as the schema source of truth

Status: **Accepted** (Phase 1, 2026-10-24) · Resolves CLAUDE.md open question #4

## Context
The layout schema is the contract between three parties: the plugin (validates on save and serve), the editor (forms and validation), and the firmware (C++ validation of untrusted JSON). The firmware can't run TS, so the artifact that crosses the boundary is **JSON Schema** plus generated C++ (the unit table now; enums later). Candidates: zod and TypeBox.

## Decision
Define the schema in **TypeBox** in `packages/schema`, using the **`typebox` 1.x package** (pinned `1.3.36`; `import Type from 'typebox'`). TypeBox 1.0 moved to the `typebox` name; `@sinclair/typebox` 0.34 is the legacy line. Export:
- TS types via `Type.Static<>`,
- JSON Schema (TypeBox 1.x objects are plain JSON Schema with no symbol keys; verified), published as `schema/layout.schema.json` and `schema/hello.schema.json`,
- generated C++ (`generated/esphelm_units.h`) for `esphelm_runtime`.

Validate with Ajv 8 (`ajv@8.20.0`, strict mode) in the plugin and in the contract tests. A custom annotation keyword `errorCode` carries stable error codes.

## Consequences
- Constraints (`pattern`, `minimum`, enums) are expressed once and appear losslessly in JSON Schema. There are no size/count limits in v1 (decision 2026-10-24, see `docs/layout-schema.md`).
- zod 4's `z.toJSONSchema()` would also work, but it adds a conversion layer whose fidelity for refinements/transforms we would need to police. TypeBox avoids that.
- Consumers validating the published schema in strict mode must register the `errorCode` keyword. Non-strict validators ignore it.
- Editor form ergonomics are slightly less fluent than zod. That's acceptable.
