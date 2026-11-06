/**
 * Host test of the setup access point password and QR text (esphelm_wifi_setup.h, ADR-0026),
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
  console.warn('\n*** g++ not found: SKIPPING the firmware Wi-Fi setup test ***\n');
}

describe.skipIf(!compiler)('firmware Wi-Fi setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-wifi-setup-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('makes unambiguous passwords and escapes the QR text', () => {
    const exe = join(dir, 'wifi_setup_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      '-fsanitize=address,undefined',
      `-I${RUNTIME}`,
      join(FIRMWARE, 'test/cpp/wifi_setup_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);
});
