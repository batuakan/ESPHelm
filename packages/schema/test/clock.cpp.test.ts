// The firmware's clock (esphelm_clock.h) must reproduce fixtures/clock.cases.json, like
// clock.ts does (clock.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { CLOCK_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ clock test (TS/C++ agreement NOT verified) ***\n',
  );
}

const FORMATS: Record<string, string> = { ymd: 'YMD', dmy: 'DMY', mdy: 'MDY', weekday: 'WEEKDAY' };
const at = (iso: string) => Date.parse(iso) / 1000;

describe.skipIf(!compiler)('firmware clock (esphelm_clock.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-clock-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const lines = [
      ...CLOCK_CASES.offsets.map(
        (c) => `check_offset(${JSON.stringify(c.posix)}, ${at(c.utc)}LL, ${c.expected});`,
      ),
      ...CLOCK_CASES.times.map(
        (c) =>
          `check_time(${c.local}LL, ${c.hour12}, ${c.seconds}, ${JSON.stringify(c.expected.text)}, ${JSON.stringify(c.expected.suffix)});`,
      ),
      ...CLOCK_CASES.dates.map(
        (c) =>
          `check_date(${c.local}LL, DateFormat::${FORMATS[c.format]}, ${JSON.stringify(c.expected)});`,
      ),
      ...CLOCK_CASES.iso.map(
        (c) =>
          `check_iso(${JSON.stringify(c.text)}, ${c.expected !== null}, ${c.expected ?? 0}LL);`,
      ),
      // Every rule posixTz writes must parse on the device.
      ...CLOCK_CASES.posix.map((c) => `check_parses(${JSON.stringify(c.expected)});`),
    ];
    const src = join(dir, 'clock_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include <cstring>
#include "esphelm_clock.h"
using namespace esphelm::wallclock;
static int failures = 0;
static void check_offset(const char *posix, int64_t utc, int32_t want) {
  const int32_t got = local_offset(posix, utc);
  if (got != want) {
    std::printf("FAIL offset %s at %lld: %d, want %d\\n", posix, (long long) utc, got, want);
    failures++;
  }
}
static void check_time(int64_t local, bool h12, bool sec, const char *want, const char *want_suffix) {
  char buf[9];
  const char *suffix;
  time_text(local, h12, sec, buf, sizeof(buf), suffix);
  if (std::strcmp(buf, want) != 0 || std::strcmp(suffix, want_suffix) != 0) {
    std::printf("FAIL time %lld: %s %s, want %s %s\\n", (long long) local, buf, suffix, want, want_suffix);
    failures++;
  }
}
static void check_date(int64_t local, DateFormat f, const char *want) {
  char buf[16];
  date_text(local, f, buf, sizeof(buf));
  if (std::strcmp(buf, want) != 0) {
    std::printf("FAIL date %lld: %s, want %s\\n", (long long) local, buf, want);
    failures++;
  }
}
static void check_iso(const char *text, bool ok, int64_t want) {
  int64_t got = 0;
  const bool parsed = parse_iso_utc(text, got);
  if (parsed != ok || (ok && got != want)) {
    std::printf("FAIL iso '%s': %d %lld\\n", text, parsed, (long long) got);
    failures++;
  }
}
static void check_parses(const char *posix) {
  Tz tz;
  if (!parse_tz(posix, tz)) {
    std::printf("FAIL parse %s\\n", posix);
    failures++;
  }
}
int main() {
  ${lines.join('\n  ')}
  for (const char *bad : {"", "CET", "CET-1CEST", "CET-1CEST,M3.5.0", "CET-25", "<+01>-1<+02>,M13.1.0,M1.1.0", "Europe/Stockholm", "<>0", "CET-1:5", "CET-1CEST,M03.5.0,M10.5.0"}) {
    Tz tz;
    if (parse_tz(bad, tz)) {
      std::printf("FAIL accepted '%s'\\n", bad);
      failures++;
    }
  }
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'clock_test');
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
