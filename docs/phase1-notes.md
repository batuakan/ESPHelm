# Phase 1 notes: the contract

Status: **done, pending your review** · 2026-10-24

## What exists now
- Root TS workspace (npm workspaces): `package.json`, `tsconfig.base.json`, `tsconfig.json` (typecheck everything, no emit), `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`.
  - Pinned: `typescript@6.0.3`, `vitest@5.0.3`, `eslint@10.12.0`, `typescript-eslint@8.71.1`, `prettier@3.9.9`, `tsx@4.23.15`, `@types/node@22.20.5`, `typebox@1.3.36`, `ajv@8.20.0`. All versions were published at least 2 weeks before pinning.
- `packages/schema` (`@esphelm/schema`): layout v1 and hello schemas, `validateLayout` / `validateHello` with stable error codes, the unit table plus TS/C++ generators, fixtures and tests. Reference: `docs/layout-schema.md`.
- ADRs: 0001 updated (`typebox` 1.x), 0005 page model (grid + full-page widgets with slots), 0006 units table.

## Commands
| Command | What it does |
|---|---|
| `npm ci` | install (lockfile committed) |
| `npm run generate` | regenerate units TS/C++, C++ cases and the published JSON Schemas |
| `npm test` | vitest: fixtures, units (TS), C++ units test via g++, generated-files freshness, standalone JSON Schema |
| `npm run typecheck` | `tsc` over src, scripts and tests |
| `npm run lint` | ESLint + Prettier check (YAML/docs/fixtures excluded from Prettier) |
| `npm run build` | emit `packages/schema/dist` (gitignored) |

## Verified
- `npm test`: 5 files, 200 tests pass. The C++ test ran with g++ 13.3. A mutated factor in a scratch copy of the header made it fail, so the test can catch drift.
- `npm run typecheck`, `npm run lint`: clean.
- Built package imported from plain Node ESM (`dist/index.js`) validates `legacy-port.json` and converts units.
- The published `layout.schema.json` works standalone in a fresh strict Ajv. It accepts every valid fixture, and rejects every invalid fixture except the semantic-only ones, which only `validateLayout` can catch (asserted by test).

## Not verified / known gaps
- No firmware parses these layouts yet (Phase 3). The C++ side covers only the unit table so far.
- No check that a unit fits its path's quantity (needs SignalK `meta.units`; editor, Phase 4).
- Semantic checks run only on structurally valid layouts, so a layout with both kinds of problems reports the structural ones first.
- `hello.capacity` fields are defined, but nothing measures them yet. The C3 hello fixture uses illustrative numbers.

## Next (Phase 2)
Plugin skeleton against this contract. First task: the spike confirming that a `signalKApiRoutes` route under `/signalk/v1/api/esphelm/...` is reachable with a read/write device token and is refused without one (ADR-0003).
