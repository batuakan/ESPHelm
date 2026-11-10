// The firmware's engine tile geometry (esphelm_engine.h) must reproduce fixtures/engine.cases.json,
// like engineScale()/engineAngle() do (engine.test.ts). The generated esphelm_engine_shapes.h is
// compiled with it, so its icon tables are checked too, and esphelm_icon_raster.h must fill each
// icon to its polygons' area.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { ENGINE_ICON_NAMES, ENGINE_ICONS, signedArea } from '../src/index.js';
import { ENGINE_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ engine test (TS/C++ agreement NOT verified) ***\n',
  );
}

const KINDS: Record<string, string> = { minor: 'MINOR', medium: 'MEDIUM', major: 'MAJOR' };
const GAUGES: Record<string, string> = {
  rpm: 'RPM',
  left: 'LEFT',
  right: 'RIGHT',
  bottom: 'BOTTOM',
};

describe.skipIf(!compiler)('firmware engine geometry (esphelm_engine.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-engine-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', { timeout: 30_000 }, () => {
    const scales = ENGINE_CASES.scales.map((c, i) => {
      const ticks = c.expected.ticks
        .map((t) => `{${t.value}, Kind::${KINDS[t.kind]}, ${JSON.stringify(t.label ?? '')}}`)
        .join(', ');
      return `${c.expected.ticks.length ? `static const Want T${i}[] = {${ticks}};` : `static const Want *T${i} = nullptr;`}
  check_scale(${c.min}, ${c.max}, ${c.radius}, ${c.expected.step}, ${c.expected.divisor}, T${i}, ${c.expected.ticks.length});`;
    });
    const angles = ENGINE_CASES.angles.map(
      (c) =>
        `check_angle(Gauge::${GAUGES[c.gauge]}, ${c.value}, ${c.min}, ${c.max}, ${c.expected});`,
    );
    const parts = ENGINE_ICON_NAMES.flatMap((n, i) =>
      [24, 61, 120].map(
        (side) =>
          `check_icon(${i}, ${ENGINE_ICONS[n].length}, ${side}, ${Math.abs(signedArea(ENGINE_ICONS[n]))});`,
      ),
    );
    const src = join(dir, 'engine_test.cpp');
    writeFileSync(
      src,
      `#include <cmath>
#include <cstdio>
#include <cstring>
#include "esphelm_engine.h"
#include "esphelm_icon_raster.h"
using namespace esphelm::engine;
struct Want { double value; Kind kind; const char *label; };
static int failures = 0;
static void check_scale(double min, double max, double r, double step, int divisor, const Want *want, size_t n) {
  static Scale got;
  scale(min, max, r, got);
  if (got.count != n || std::fabs(got.step - step) > 1e-6 || got.divisor != divisor) {
    std::printf("FAIL scale %g..%g r%g: %u ticks step %g div %d\\n", min, max, r, (unsigned) got.count, got.step, got.divisor);
    failures++;
    return;
  }
  for (size_t i = 0; i < n; i++) {
    char buf[16];
    const char *text = got.ticks[i].kind == Kind::MAJOR ? tick_label(got.ticks[i].value / got.divisor, buf) : "";
    if (std::fabs(got.ticks[i].value - want[i].value) > 1e-3 || got.ticks[i].kind != want[i].kind ||
        std::strcmp(text, want[i].label) != 0) {
      std::printf("FAIL scale %g..%g tick %u: %g %s\\n", min, max, (unsigned) i, got.ticks[i].value, text);
      failures++;
    }
  }
}
static void check_angle(Gauge g, double v, double min, double max, double want) {
  const double a = angle(g, v, min, max);
  if (std::fabs(a - want) > 1e-3) {
    std::printf("FAIL angle %d %g on %g..%g: %g\\n", (int) g, v, min, max, a);
    failures++;
  }
}
// The filled pixels add up to the polygons' area (within 2 %, the antialiased edges' rounding).
static void check_icon(int i, unsigned contours, int side, double area) {
  const esphelm::engine_shapes::Icon &icon = esphelm::engine_shapes::ICONS[i];
  if (icon.count != contours) {
    std::printf("FAIL icon %d: %u contours\\n", i, (unsigned) icon.count);
    failures++;
  }
  std::vector<uint8_t> mask;
  esphelm::icon::rasterize(icon, side, mask);
  double sum = 0;
  for (uint8_t v : mask) sum += v / 255.0;
  const double want = area * side * side;
  if (mask.size() != static_cast<size_t>(side) * side || std::fabs(sum - want) > 0.02 * want + 1) {
    std::printf("FAIL icon %d at %d px: coverage %g, area %g\\n", i, side, sum, want);
    failures++;
  }
}
int main() {
  ${scales.join('\n  ')}
  ${angles.join('\n  ')}
  ${parts.join('\n  ')}
  if (esphelm::engine_shapes::ICON_COUNT != ${ENGINE_ICON_NAMES.length}) failures++;
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'engine_test');
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
