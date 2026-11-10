// The firmware's alarm tone rule (esphelm_sound.h) must reproduce fixtures/sound.cases.json, like
// alarmSound() does (sound.test.ts).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import type { AlarmLevel } from '../src/index.js';
import { SOUND_CASES } from './fixtures.js';

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
    '\n*** g++ not found: SKIPPING the C++ alarm tone test (TS/C++ agreement NOT verified) ***\n',
  );
}

const level = (l: AlarmLevel | null) => `Level::${l === null ? 'NONE' : l.toUpperCase()}`;
const action = (a: string) =>
  a === 'none'
    ? 'Action::NONE, Level::NONE'
    : a === 'stop'
      ? 'Action::STOP, Level::NONE'
      : `Action::PLAY, ${level(a as AlarmLevel)}`;

describe.skipIf(!compiler)('firmware alarm tones (esphelm_sound.h)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-sound-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reproduces every shared case', () => {
    const lines = SOUND_CASES.cases.map((c) => {
      const i = c.input;
      return `check(${JSON.stringify(c.name)}, {${level(i.level)}, ${i.generation}u, ${i.online}, ${level(i.playing)}, ${i.playedGeneration}u, ${i.lastStartMs}u, ${i.nowMs}u}, ${action(c.expected)});`;
    });
    const src = join(dir, 'sound_test.cpp');
    writeFileSync(
      src,
      `#include <cstdio>
#include "esphelm_sound.h"
using namespace esphelm::sound;
static int failures = 0;
static void check(const char *name, const Input &in, Action want, Level want_play) {
  Level play;
  const Action got = alarm_sound(in, play);
  if (got != want || play != want_play) {
    std::printf("FAIL %s: %d %d\\n", name, static_cast<int>(got), static_cast<int>(play));
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
    const exe = join(dir, 'sound_test');
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
