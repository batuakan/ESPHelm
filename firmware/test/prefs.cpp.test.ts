/**
 * Host test of the display's saved brightness and theme choices (display_prefs.cpp, ADR-0025),
 * built with g++.
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
  console.warn('\n*** g++ not found: SKIPPING the firmware display choices test ***\n');
}

describe.skipIf(!compiler)('firmware display choices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-prefs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips, refuses bad records and drops overrides the layout changed', () => {
    const exe = join(dir, 'prefs_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      '-fsanitize=address,undefined',
      `-I${RUNTIME}`,
      join(RUNTIME, 'display_prefs.cpp'),
      join(FIRMWARE, 'test/cpp/prefs_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);
});
