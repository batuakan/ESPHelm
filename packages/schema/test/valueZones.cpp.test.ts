// The firmware's value-tile zone matching (esphelm_value_zones.h) must give the same state as
// valueZoneState (valueZones.test.ts) for every case in fixtures/value-zones.cases.json.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { valueZoneCases } from './fixtures.js';

const VALUE_ZONE_CASES = valueZoneCases();

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
    '\n*** g++ not found: SKIPPING the C++ value-zone test (TS/C++ agreement NOT verified) ***\n',
  );
}

const STATES: Record<string, string> = {
  normal: 'NORMAL',
  warn: 'WARN',
  alarm: 'ALARM',
  emergency: 'EMERGENCY',
};
// Missing ends are infinite on the device (the parser stores them that way).
const bound = (v: number | undefined, sign: string) => (v === undefined ? `${sign}INF` : String(v));

describe.skipIf(!compiler)('firmware value-zone matching (esphelm_value_zones.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-value-zones-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('gives the same state for every shared case', () => {
    expect(VALUE_ZONE_CASES.length).toBeGreaterThan(10);
    const rows = VALUE_ZONE_CASES.map((c) => {
      const zones = c.zones
        .map((z) => `{${bound(z.from, '-')}, ${bound(z.to, '+')}, ZS::${STATES[z.state]}}`)
        .join(', ');
      const expected = c.expected === null ? -1 : Object.keys(STATES).indexOf(c.expected);
      return `{${c.n}, {${zones}}, ${expected}}`;
    });
    const src = join(dir, 'value_zones_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include <limits>
#include "esphelm_value_zones.h"
using ZS = esphelm::ZoneState;
static const double INF = std::numeric_limits<double>::infinity();
struct Case { double n; std::vector<esphelm::Zone> zones; int expected; };
int main() {
  const Case CASES[] = {
${rows.join(',\n')}
  };
  int failures = 0, count = 0;
  for (const auto &c : CASES) {
    count++;
    ZS s{};
    const int got = esphelm::value_zone_state(c.n, c.zones, s) ? static_cast<int>(s) : -1;
    if (got != c.expected) {
      std::printf("FAIL %g: got %d, expected %d\\n", c.n, got, c.expected);
      ++failures;
    }
  }
  std::printf("%d cases, %d failures\\n", count, failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'value_zones_test');
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
