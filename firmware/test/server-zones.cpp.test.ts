/**
 * The firmware's server zones (esphelm_server_zones.h, ADR-0020) must give what
 * serverZonesToDisplay gives for every case in fixtures/server-zones.cases.json, read from a
 * body of GET .../<path>/meta as on the display. Built with g++.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arduinoJsonSrc } from './arduinojson.js';

const FIRMWARE = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(FIRMWARE, 'components/esphelm_runtime');
const CASES = join(FIRMWARE, '../packages/schema/fixtures/server-zones.cases.json');

interface ZoneCase {
  note: string;
  zones: unknown;
  unit?: string;
  range?: { min: number; max: number };
  expected: { from?: number; to?: number; state: string }[];
}
interface DriverLine {
  ok: boolean;
  zones: { from?: number; to?: number; state: number }[];
}
const STATES = ['normal', 'warn', 'alarm', 'emergency'];

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
  console.warn('\n*** g++ not found: SKIPPING the firmware server zones test ***\n');
}

describe.skipIf(!compiler)('firmware server zones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'esphelm-server-zones-'));
  const exe = join(dir, 'server_zones_driver');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeAll(() => {
    execFileSync('g++', [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      `-I${RUNTIME}`,
      `-I${arduinoJsonSrc()}`,
      join(FIRMWARE, 'test/cpp/server_zones_driver.cpp'),
      '-o',
      exe,
    ]);
  }, 120_000);

  function run(entries: unknown[]): DriverLine[] {
    const file = join(dir, 'in.json');
    writeFileSync(file, JSON.stringify(entries));
    return execFileSync(exe, [file], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as DriverLine);
  }

  it('agrees with serverZonesToDisplay on every shared case', () => {
    const { cases } = JSON.parse(readFileSync(CASES, 'utf8')) as { cases: ZoneCase[] };
    expect(cases.length).toBeGreaterThan(10);
    const lines = run(
      cases.map((c) => ({
        // As the server sends it: other keys around the zones.
        body: JSON.stringify({ units: 'm', description: 'x', zones: c.zones, timeout: 1 }),
        ...(c.unit ? { unit: c.unit } : {}),
        ...(c.range ?? {}),
      })),
    );
    cases.forEach((c, i) => {
      const line = lines[i]!;
      expect(line.ok, c.note).toBe(true);
      expect(line.zones.length, c.note).toBe(c.expected.length);
      line.zones.forEach((z, k) => {
        const e = c.expected[k]!;
        expect(STATES[z.state], c.note).toBe(e.state);
        expect(z.from === undefined, c.note).toBe(e.from === undefined);
        expect(z.to === undefined, c.note).toBe(e.to === undefined);
        // ArduinoJson keeps short decimals as floats, as it does for the values themselves.
        if (e.from !== undefined) expect(z.from, c.note).toBeCloseTo(e.from, 4);
        if (e.to !== undefined) expect(z.to, c.note).toBeCloseTo(e.to, 4);
      });
    });
  });

  it('a body it cannot read is refused, one without zones means none', () => {
    const lines = run([
      { body: '{"zones":[{"lower":1,"upper"' },
      { body: 'not json' },
      { body: '[1,2]' },
      { body: '{"units":"m"}' },
    ]);
    expect(lines.map((l) => l.ok)).toEqual([false, false, false, true]);
    expect(lines[3]!.zones).toEqual([]);
  });
});
