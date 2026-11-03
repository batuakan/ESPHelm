// The firmware's heading tape geometry (esphelm_heading_tape.h) must reproduce
// fixtures/heading-tape.cases.json, like tapeMarks()/tapeX() do (headingTape.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { TAPE_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ heading tape test (TS/C++ agreement NOT verified) ***\n',
  );
}

const KINDS: Record<string, string> = { minor: 'MINOR', medium: 'MEDIUM', major: 'MAJOR' };

describe.skipIf(!compiler)('firmware heading tape geometry (esphelm_heading_tape.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-tape-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const marks = TAPE_CASES.marks.map((c, i) => {
      const ticks = c.expected
        .map(
          (t) =>
            `{${t.deg}, ${t.x}, Kind::${KINDS[t.kind]}, ${t.label !== undefined}, ${JSON.stringify(t.label ?? '')}}`,
        )
        .join(', ');
      return `static const Want T${i}[] = {${ticks}};\n  check_marks(${c.heading}, ${c.span}, ${c.width}, T${i}, ${c.expected.length});`;
    });
    const markers = TAPE_CASES.markers.map(
      (c) =>
        `check_x(${c.value}, ${c.heading}, ${c.span}, ${c.width}, ${c.expected.x}, ${c.expected.off});`,
    );
    const src = join(dir, 'tape_test.cpp');
    writeFileSync(
      src,
      `#include <cmath>
#include <cstdio>
#include <cstring>
#include "esphelm_heading_tape.h"
using namespace esphelm::heading_tape;
struct Want { int deg; double x; Kind kind; bool labelled; const char *label; };
static int failures = 0;
static void check_marks(double h, double span, double w, const Want *want, size_t n) {
  Tick got[MAX_TICKS];
  const size_t count = marks(h, span, w, got);
  if (count != n) {
    std::printf("FAIL %g %g %g: %u ticks, want %u\\n", h, span, w, (unsigned) count, (unsigned) n);
    failures++;
    return;
  }
  for (size_t i = 0; i < n; i++) {
    char buf[4];
    const char *text = got[i].labelled ? label(got[i].deg, buf) : "";
    if (got[i].deg != want[i].deg || std::fabs(got[i].x - want[i].x) > 1e-3 || got[i].kind != want[i].kind ||
        got[i].labelled != want[i].labelled || std::strcmp(text, want[i].label) != 0) {
      std::printf("FAIL %g %g %g tick %u: %d %.3f %s\\n", h, span, w, (unsigned) i, got[i].deg, got[i].x, text);
      failures++;
    }
  }
}
static void check_x(double v, double h, double span, double w, double x, int off) {
  const Position p = tape_x(v, h, span, w);
  if (std::fabs(p.x - x) > 1e-3 || p.off != off) {
    std::printf("FAIL marker %g at %g: %.3f %d\\n", v, h, p.x, p.off);
    failures++;
  }
}
int main() {
  ${marks.join('\n  ')}
  ${markers.join('\n  ')}
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'tape_test');
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
