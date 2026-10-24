import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';

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
  console.warn(
    '\n*** g++ not found: SKIPPING the C++ unit-table test (TS/C++ agreement NOT verified) ***\n',
  );
}

describe.skipIf(!compiler)('generated C++ unit table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-units-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared conversion case', () => {
    const exe = join(dir, 'units_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      `-I${join(PACKAGE_ROOT, 'generated')}`,
      join(PACKAGE_ROOT, 'test/cpp/units_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/ 0 failures/);
  });
});
