// The firmware's position formatter (esphelm_position.h) must reproduce
// fixtures/position.cases.json exactly, like formatPosition does (position.test.ts). Cases whose
// value isn't two numbers are about the JSON shape, which the widget checks before calling it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { FIXTURES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ position test (TS/C++ agreement NOT verified) ***\n',
  );
}

interface PositionCase {
  value: unknown;
  format: string;
  decimals?: number;
  expected: { lat: string; lon: string } | null;
}

const FORMATS: Record<string, string> = { ddm: 'DDM', dms: 'DMS', dd: 'DD', decimal: 'DECIMAL' };
const cstr = (s: string) => JSON.stringify(s); // JSON escapes are valid C++ for this charset (° stays UTF-8)

describe.skipIf(!compiler)('firmware position formatter (esphelm_position.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-position-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case with two numbers', () => {
    const all = (
      JSON.parse(readFileSync(join(FIXTURES, 'position.cases.json'), 'utf8')) as {
        cases: PositionCase[];
      }
    ).cases;
    const numeric = all.filter((c) => {
      const v = c.value as { latitude?: unknown; longitude?: unknown } | null;
      return (
        v !== null &&
        typeof v === 'object' &&
        typeof v.latitude === 'number' &&
        typeof v.longitude === 'number'
      );
    });
    expect(numeric.length).toBeGreaterThan(15);
    const rows = numeric.map((c) => {
      const v = c.value as { latitude: number; longitude: number };
      const ok = c.expected !== null;
      return `{${v.latitude}, ${v.longitude}, esphelm::position::Format::${FORMATS[c.format]}, ${c.decimals ?? -1}, ${ok}, ${cstr(c.expected?.lat ?? '')}, ${cstr(c.expected?.lon ?? '')}}`;
    });
    const src = join(dir, 'position_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include "esphelm_position.h"
struct Case { double lat, lon; esphelm::position::Format f; int d; bool ok; const char *elat, *elon; };
static const Case CASES[] = {
${rows.join(',\n')}
};
int main() {
  int failures = 0;
  for (const auto &c : CASES) {
    std::string lat, lon;
    const bool ok = esphelm::position::format(c.lat, c.lon, c.f, c.d, lat, lon);
    if (ok != c.ok || (ok && (lat != c.elat || lon != c.elon))) {
      std::printf("FAIL %.10g %.10g: got %d \\"%s\\" \\"%s\\"\\n", c.lat, c.lon, ok, lat.c_str(), lon.c_str());
      ++failures;
    }
  }
  std::printf("%d cases, %d failures\\n", (int) (sizeof(CASES) / sizeof(CASES[0])), failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'position_test');
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
    expect(out).toMatch(/ 0 failures/);
  });
});
