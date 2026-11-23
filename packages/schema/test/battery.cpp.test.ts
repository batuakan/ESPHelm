// The firmware's battery tile text and rows (esphelm_battery.h) must reproduce
// fixtures/battery.cases.json, like battery.ts does (battery.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { BATTERY_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ battery tile test (TS/C++ agreement NOT verified) ***\n',
  );
}

const STATE: Record<string, string> = {
  charging: 'State::CHARGING',
  discharging: 'State::DISCHARGING',
  idle: 'State::IDLE',
};
const state = (s: string | null) => (s === null ? 'State::UNKNOWN' : STATE[s]!);
const cstr = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : 'nullptr');
const num = (v: number | null) => (v === null ? 'false, 0' : `true, ${v}`);
const b = (v: boolean) => (v ? 'true' : 'false');

describe.skipIf(!compiler)('firmware battery tile (esphelm_battery.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-battery-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const lines = [
      ...BATTERY_CASES.timeLeft.map(
        (c) => `check_time(${num(c.seconds)}, ${JSON.stringify(c.expected)});`,
      ),
      ...BATTERY_CASES.states.map(
        (c) => `check_state(${num(c.current)}, ${b(c.invert)}, ${state(c.expected)});`,
      ),
      // A number is not text: the display never passes it on as a mode.
      ...BATTERY_CASES.modes.map(
        (c) => `check_mode(${cstr(c.mode)}, ${JSON.stringify(c.expected)});`,
      ),
      ...BATTERY_CASES.status.map(
        (c) =>
          `check_status(${state(c.state)}, ${num(c.seconds)}, ${cstr(c.mode)}, ${JSON.stringify(c.expected)});`,
      ),
      ...BATTERY_CASES.rows.map((c, i) => {
        const w = c.want;
        const e = c.expected;
        return `{ const int l[] = {${c.ladder.join(', ')}}; check_rows(${i}, rows(${c.width}, ${c.height}, l, ${c.ladder.length}, ${b(w.caption)}, ${b(w.power)}, ${b(w.status)}, ${b(w.solar)}), ${e.line}, ${b(e.caption)}, ${b(e.power)}, ${b(e.status)}, ${b(e.solar)}, ${e.top}, ${e.height}); }`;
      }),
    ];
    const src = join(dir, 'battery_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include <cstring>
#include "esphelm_battery.h"
using namespace esphelm::battery;
static int failures = 0;
static void check_time(bool has, double s, const char *want) {
  char out[16];
  time_left(has, s, out, sizeof(out));
  if (std::strcmp(out, want) != 0) { std::printf("FAIL time %g: %s\\n", s, out); failures++; }
}
static void check_state(bool has, double c, bool invert, State want) {
  if (state(has, c, invert) != want) { std::printf("FAIL state %g\\n", c); failures++; }
}
static void check_mode(const char *mode, const char *want) {
  char out[24];
  mode_text(mode, out, sizeof(out));
  if (std::strcmp(out, want) != 0) { std::printf("FAIL mode %s: %s\\n", mode ? mode : "null", out); failures++; }
}
static void check_status(State st, bool has, double s, const char *mode, const char *want) {
  char out[40];
  status(st, has, s, mode, out, sizeof(out));
  if (std::strcmp(out, want) != 0) { std::printf("FAIL status: %s\\n", out); failures++; }
}
static void check_rows(int i, Rows r, int line, bool c, bool p, bool st, bool so, int top, int height) {
  if (r.line != line || r.caption != c || r.power != p || r.status != st || r.solar != so || r.top != top ||
      r.height != height) {
    std::printf("FAIL rows %d: %d %d%d%d%d %d %d\\n", i, r.line, r.caption, r.power, r.status, r.solar, r.top, r.height);
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
    const exe = join(dir, 'battery_test');
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
