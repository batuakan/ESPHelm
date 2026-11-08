// The firmware's wind rose performance geometry (esphelm_wind_rose.h) must reproduce
// fixtures/wind-rose.cases.json, like roseLaylines()/roseTarget() do (windRose.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { ROSE_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ wind rose test (TS/C++ agreement NOT verified) ***\n',
  );
}

describe.skipIf(!compiler)('firmware wind rose geometry (esphelm_wind_rose.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-rose-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const laylines = ROSE_CASES.laylines.map((c) => {
      const e = c.expected;
      const fixed = c.fixed ?? { beat: 45, gybe: 150 };
      return `check_laylines(${c.twd}, ${c.heading}, ${c.beat !== undefined}, ${c.beat ?? 0}, ${c.gybe !== undefined}, ${c.gybe ?? 0}, ${fixed.beat}, ${fixed.gybe}, ${e.upwind}, ${e.angle}, ${e.starboard}, ${e.port});`;
    });
    const targets = ROSE_CASES.targets.map(
      (c) =>
        `check_target(${c.twd}, ${c.heading}, ${c.target}, ${c.expected !== null}, ${c.expected ?? 0});`,
    );
    const src = join(dir, 'rose_test.cpp');
    writeFileSync(
      src,
      `#include <cmath>
#include <cstdio>
#include "esphelm_wind_rose.h"
using namespace esphelm::wind_rose;
static int failures = 0;
static bool near(double a, double b) { return std::fabs(a - b) <= 1e-3; }
static void check_laylines(double twd, double h, bool bk, double b, bool gk, double g, int fb, int fg, bool up,
                           double angle, double stbd, double port) {
  const Laylines l = laylines(twd, h, bk, b, gk, g, fb, fg);
  if (l.upwind != up || !near(l.angle, angle) || !near(l.starboard, stbd) || !near(l.port, port)) {
    std::printf("FAIL laylines %g %g: %d %.3f %.3f %.3f\\n", twd, h, l.upwind, l.angle, l.starboard, l.port);
    failures++;
  }
}
static void check_target(double twd, double h, double t, bool has, double want) {
  double got = 0;
  const bool ok = target(twd, h, t, got);
  if (ok != has || (has && !near(got, want))) {
    std::printf("FAIL target %g %g %g: %d %.3f\\n", twd, h, t, ok, got);
    failures++;
  }
}
int main() {
  ${laylines.join('\n  ')}
  ${targets.join('\n  ')}
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'rose_test');
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
