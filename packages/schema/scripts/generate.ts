/**
 * Regenerate units tables (TS + C++), the C++ test cases and the published JSON Schemas.
 * Run with `npm run generate`. The output is committed; tests fail if it is stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PACKAGE_ROOT, UNITS_TS, renderAll, renderUnitsTsFile } from './render.js';

function write(rel: string, content: string): void {
  const file = join(PACKAGE_ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${rel}`);
}

// The schema modules import the TS units table, so write it before rendering the rest.
write(UNITS_TS, renderUnitsTsFile());
for (const [rel, content] of Object.entries(await renderAll())) {
  if (rel !== UNITS_TS) write(rel, content);
}
