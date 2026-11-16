// The firmware's alarms panel maths (esphelm_alarm_age.h) must reproduce
// fixtures/alarms.cases.json, like alarmAge()/underPrefix() do (alarms.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { ALARMS_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ alarms panel test (TS/C++ agreement NOT verified) ***\n',
  );
}

describe.skipIf(!compiler)('firmware alarms panel (esphelm_alarm_age.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-alarms-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const ages = ALARMS_CASES.ages.map(
      (c) => `check_age(${c.seconds}, ${JSON.stringify(c.expected)});`,
    );
    const prefixes = ALARMS_CASES.prefixes.map(
      (c) => `check_prefix(${JSON.stringify(c.path)}, ${JSON.stringify(c.prefix)}, ${c.expected});`,
    );
    const src = join(dir, 'alarms_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include <cstring>
#include "esphelm_alarm_age.h"
using namespace esphelm::alarm_age;
static int failures = 0;
static void check_age(unsigned s, const char *want) {
  char out[16];
  format(s, out, sizeof(out));
  if (std::strcmp(out, want) != 0) {
    std::printf("FAIL age %u: %s\\n", s, out);
    failures++;
  }
}
static void check_prefix(const char *path, const char *prefix, bool want) {
  if (under_prefix(path, prefix) != want) {
    std::printf("FAIL prefix %s %s\\n", path, prefix);
    failures++;
  }
}
int main() {
  ${ages.join('\n  ')}
  ${prefixes.join('\n  ')}
  std::printf("%d failures\\n", failures);
  return failures == 0 ? 0 : 1;
}
`,
    );
    const exe = join(dir, 'alarms_test');
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
