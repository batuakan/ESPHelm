// The firmware's screen shape (esphelm_shape.h) must reproduce fixtures/shape.cases.json, like
// displayShape() does (shape.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { SHAPE_CASES } from './fixtures.js';

const RUNTIME = join(PACKAGE_ROOT, '../../firmware/components/esphelm_runtime');

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
    '\n*** g++ not found: SKIPPING the C++ screen shape test (TS/C++ agreement NOT verified) ***\n',
  );
}

describe.skipIf(!compiler)('firmware screen shape (esphelm_shape.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-shape-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const lines = SHAPE_CASES.cases.map(
      (c) => `check(${c.width}, ${c.height}, ${JSON.stringify(c.expected)});`,
    );
    const src = join(dir, 'shape_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include <cstring>
#include "esphelm_shape.h"
using namespace esphelm;
static int failures = 0;
static void check(int w, int h, const char *want) {
  const char *got = SHAPE_NAMES[static_cast<int>(display_shape(w, h))];
  if (std::strcmp(got, want) != 0) {
    std::printf("FAIL %dx%d: %s\\n", w, h, got);
    failures++;
  }
}
int main() {
  ${lines.join('\n  ')}
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'shape_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      `-I${RUNTIME}`,
      src,
      '-o',
      exe,
    ]);
    let out: string;
    try {
      out = execFileSync(exe, { encoding: 'utf8' });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? e);
    }
    expect(out).toMatch(/^0 failures/m);
  });
});
