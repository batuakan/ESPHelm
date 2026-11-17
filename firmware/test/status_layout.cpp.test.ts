/**
 * Host test of the status page's layout choice (esphelm_status_layout.h): code on top, or the
 * code on the left with the text beside it on wide, short displays. Built with g++.
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
  console.warn('\n*** g++ not found: SKIPPING the firmware status layout test ***\n');
}

describe.skipIf(!compiler)('firmware status page layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-status-layout-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('puts the QR code beside the text on wide, short displays only', () => {
    const exe = join(dir, 'status_layout_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      '-fsanitize=address,undefined',
      `-I${RUNTIME}`,
      join(FIRMWARE, 'test/cpp/status_layout_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);
});
