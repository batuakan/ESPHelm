/**
 * Host test of the black-and-white threshold of mono builds (esphelm_mono.h, ADR-0035),
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
  console.warn('\n*** g++ not found: SKIPPING the firmware mono test ***\n');
}

describe.skipIf(!compiler)('firmware mono threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-mono-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('turns every RGB565 pixel black or white by its brightness', () => {
    const exe = join(dir, 'mono_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      '-fsanitize=address,undefined',
      `-I${RUNTIME}`,
      join(FIRMWARE, 'test/cpp/mono_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);
});
