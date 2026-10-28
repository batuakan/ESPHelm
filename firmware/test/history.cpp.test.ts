/**
 * Host test of the firmware's value history store (value_history.cpp, ADR-0018), built with g++.
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
  console.warn('\n*** g++ not found: SKIPPING the firmware value history test ***\n');
}

describe.skipIf(!compiler)('firmware value history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-history-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('buckets, carries forward, wraps and keeps history across a reconfigure', () => {
    const exe = join(dir, 'history_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      `-I${RUNTIME}`,
      join(RUNTIME, 'value_history.cpp'),
      join(FIRMWARE, 'test/cpp/history_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);
});
