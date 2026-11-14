// The firmware's chart route maths (esphelm_chart_route.h) must reproduce
// fixtures/chart-route.cases.json, like edgeArrow()/routeId() do (chartRoute.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { CHART_ROUTE_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ chart route test (TS/C++ agreement NOT verified) ***\n',
  );
}

describe.skipIf(!compiler)('firmware chart route (esphelm_chart_route.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-route-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const arrows = CHART_ROUTE_CASES.arrows.map(
      (c) =>
        `check_arrow(${c.dx}, ${c.dy}, ${c.w}, ${c.h}, ${c.inset}, ${c.expected.onScreen}, ${c.expected.x}, ${c.expected.y}, ${c.expected.angle});`,
    );
    const ids = CHART_ROUTE_CASES.ids.map(
      (c) =>
        `check_id(${JSON.stringify(c.href)}, ${c.expected === null ? 'nullptr' : JSON.stringify(c.expected)});`,
    );
    const src = join(dir, 'route_test.cpp');
    writeFileSync(
      src,
      `#include <cmath>
#include <cstdio>
#include <cstring>
#include "esphelm_chart_route.h"
using namespace esphelm::chart_route;
static int failures = 0;
static void check_arrow(double dx, double dy, double w, double h, double inset, bool on, double x, double y, double angle) {
  const EdgeArrow a = edge_arrow(dx, dy, w, h, inset);
  if (a.on_screen != on || std::fabs(a.x - x) > 1e-3 || std::fabs(a.y - y) > 1e-3 || std::fabs(a.angle - angle) > 1e-3) {
    std::printf("FAIL arrow %g %g in %gx%g: %d %.3f %.3f %.3f\\n", dx, dy, w, h, a.on_screen, a.x, a.y, a.angle);
    failures++;
  }
}
static void check_id(const char *href, const char *want) {
  char out[MAX_ID + 1];
  const bool ok = route_id(href, out);
  if (ok != (want != nullptr) || (ok && std::strcmp(out, want) != 0)) {
    std::printf("FAIL id %s: %d %s\\n", href, ok, ok ? out : "");
    failures++;
  }
}
int main() {
  ${arrows.join('\n  ')}
  ${ids.join('\n  ')}
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'route_test');
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
