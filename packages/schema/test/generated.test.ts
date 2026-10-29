import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, renderAll } from '../scripts/render.js';

describe('generated artifacts', async () => {
  const rendered = await renderAll();
  it.each(Object.keys(rendered))('%s is up to date (run `npm run generate`)', (rel) => {
    expect(readFileSync(join(PACKAGE_ROOT, rel), 'utf8')).toBe(rendered[rel]);
  });
});
