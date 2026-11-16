/**
 * Host test of the mono wind rose's geometry (esphelm_rose_geometry.h, ADR-0038): the radii of
 * its parts and the strokes of the marker letters. Built with g++.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const FIRMWARE = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(FIRMWARE, 'components/esphelm_runtime');

function hasCompiler(): boolean {
  try {
    execFileSync('g++', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const compiler = hasCompiler();
if (!compiler) {
  console.warn('\n*** g++ not found: SKIPPING the firmware rose geometry test ***\n');
}

describe.skipIf(!compiler)('firmware mono rose geometry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-rose-geometry-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the rose parts in order and turns the marker letters with the marker', () => {
    const exe = join(dir, 'rose_geometry_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      '-fsanitize=address,undefined',
      `-I${RUNTIME}`,
      join(FIRMWARE, 'test/cpp/rose_geometry_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);
});
