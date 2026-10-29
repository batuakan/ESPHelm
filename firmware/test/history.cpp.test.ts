/**
 * Host test of the firmware's value history store (value_history.cpp, ADR-0018), built with g++.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const FIRMWARE = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(FIRMWARE, 'components/esphelm_runtime');
const CASES = join(FIRMWARE, '../packages/schema/fixtures/history.cases.json');

type HistoryCase =
  | {
      kind: 'mean';
      values: number[];
      wrap: [number, number];
      expected: number | null;
      note: string;
    }
  | {
      kind: 'unwrap';
      v: number;
      centre: number;
      wrap: [number, number];
      expected: number;
      note: string;
    };

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
  console.warn('\n*** g++ not found: SKIPPING the firmware value history test ***\n');
}

describe.skipIf(!compiler)('firmware value history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-history-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('buckets, carries forward, wraps and keeps history across a reconfigure', () => {
    const exe = join(dir, 'history_test');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      `-I${RUNTIME}`,
      join(RUNTIME, 'value_history.cpp'),
      join(FIRMWARE, 'test/cpp/history_test.cpp'),
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^0 failures/m);
  }, 60000);

  it('reproduces the shared circular cases (fixtures/history.cases.json)', () => {
    const cases = (JSON.parse(readFileSync(CASES, 'utf8')) as { cases: HistoryCase[] }).cases;
    const rows = cases.map((c) =>
      c.kind === 'mean'
        ? `{true, {${c.values.join(', ')}}, ${c.values.length}, 0, 0, ${c.wrap[0]}, ${c.wrap[1]}, ${c.expected ?? 'NAN'}}`
        : `{false, {}, 0, ${c.v}, ${c.centre}, ${c.wrap[0]}, ${c.wrap[1]}, ${c.expected}}`,
    );
    const src = join(dir, 'history_cases.cpp');
    writeFileSync(
      src,
      `#include <cmath>
#include <cstdio>
#include "value_history.h"
struct Case { bool mean; double values[8]; size_t n; double v, centre, wmin, wmax, expected; };
static const Case CASES[] = {
${rows.join(',\n')}
};
int main() {
  int failures = 0;
  for (const auto &c : CASES) {
    const double got = c.mean ? esphelm::circular_mean(c.values, c.n, c.wmin, c.wmax)
                              : esphelm::unwrap_around(c.v, c.centre, c.wmin, c.wmax);
    const bool ok = std::isnan(c.expected) ? std::isnan(got) : std::fabs(got - c.expected) < 1e-6;
    if (!ok) {
      std::printf("FAIL %s: got %.9g, expected %.9g\\n", c.mean ? "mean" : "unwrap", got, c.expected);
      ++failures;
    }
  }
  std::printf("%d cases, %d failures\\n", (int) (sizeof(CASES) / sizeof(CASES[0])), failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'history_cases');
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      `-I${RUNTIME}`,
      src,
      '-o',
      exe,
    ]);
    const out = execFileSync(exe, { encoding: 'utf8' });
    expect(out).toMatch(/^\d+ cases, 0 failures/m);
    expect(Number(/^(\d+) cases/m.exec(out)?.[1])).toBe(cases.length);
  }, 60000);
});
