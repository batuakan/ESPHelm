// The firmware's centre-zero text (esphelm_center_zero.h) must reproduce
// fixtures/center-zero.cases.json, like centerZeroText()/centerZeroTick() do (centerZero.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { CENTER_ZERO_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ centre-zero test (TS/C++ agreement NOT verified) ***\n',
  );
}

const SIDES: Record<string, string> = { portStarboard: 'PORT_STARBOARD', plusMinus: 'PLUS_MINUS' };
const cstr = (s: string) => JSON.stringify(s);

describe.skipIf(!compiler)('firmware centre-zero text (esphelm_center_zero.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-cz-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const { text, ticks, spans } = CENTER_ZERO_CASES;
    const lines = [
      ...text.map(
        (c) =>
          `check_text(${c.n}, ${c.decimals ?? -1}, Sides::${SIDES[c.sides]}, ${cstr(c.expected.text)}, ${cstr(c.expected.side)});`,
      ),
      ...ticks.map(
        (c) => `check_tick(${c.v}, ${c.m}, Sides::${SIDES[c.sides]}, ${cstr(c.expected)});`,
      ),
      ...spans.map((c) => `check_span(${c.min}, ${c.max}, ${c.expected});`),
    ];
    const src = join(dir, 'cz_test.cpp');
    writeFileSync(
      src,
      `#include <cmath>
#include <cstdio>
#include <cstring>
#include "esphelm_center_zero.h"
using namespace esphelm::center_zero;
static int failures = 0;
static void check_text(double n, int d, Sides s, const char *want, const char *want_side) {
  const char *side;
  const std::string got = text(n, d, s, side);
  if (got != want || std::strcmp(side, want_side) != 0) {
    std::printf("FAIL text %g: \\"%s\\" \\"%s\\"\\n", n, got.c_str(), side);
    failures++;
  }
}
static void check_tick(double v, double m, Sides s, const char *want) {
  const std::string got = tick(v, m, s);
  if (got != want) {
    std::printf("FAIL tick %g: \\"%s\\"\\n", v, got.c_str());
    failures++;
  }
}
static void check_span(double min, double max, double want) {
  if (std::fabs(span(min, max) - want) > 1e-12) {
    std::printf("FAIL span %g %g\\n", min, max);
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
    const exe = join(dir, 'cz_test');
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
