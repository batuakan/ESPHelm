# @esphelm/schema

The layout contract of [ESPHelm](https://github.com/batuakan/ESPHelm), the open-source ESP32 multifunction displays for boats: what a display layout and a display's `hello` look like, shared by the SignalK plugin ([`signalk-esphelm`](https://www.npmjs.com/package/signalk-esphelm)), the editor and the firmware.

It contains:

- **TypeBox schemas and TypeScript types** for layouts, pages, tiles, settings and `hello`.
- **Validators** (`validateLayout`, `validateHello`) that return error codes, plus `migrateLayout` for older stored layouts.
- **JSON Schemas** in `schema/` (`layout.schema.json`, `hello.schema.json`), generated from the TypeBox source.
- **The unit table** (`units.json`, SignalK's SI units to display units), the same one the firmware compiles in.
- **Shared geometry and text** for tiles: wind rose, heading tape, engine, centre zero, position, clock, sound.
- **Fixtures** (`fixtures/`, valid and invalid layouts and hellos) and **starter layouts** (`templates/`).

```ts
import { validateLayout } from '@esphelm/schema';

const result = validateLayout(json);
if (!result.ok) console.log(result.errors);
```

The format is described in [docs/layout-schema.md](https://github.com/batuakan/ESPHelm/blob/main/docs/layout-schema.md). Requires Node 22 or later. MIT licensed.
