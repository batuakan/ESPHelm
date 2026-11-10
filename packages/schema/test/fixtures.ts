import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValueZone } from '../src/index.js';
import { PACKAGE_ROOT } from '../scripts/render.js';

export interface ExpectedError {
  code: string;
  pointer: string;
}

export interface InvalidFixture {
  name: string;
  description: string;
  expect: ExpectedError[];
  document: unknown;
}

export const FIXTURES = join(PACKAGE_ROOT, 'fixtures');

function readDir(rel: string): { name: string; json: unknown }[] {
  const dir = join(FIXTURES, rel);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f, json: JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown }));
}

export function validFixtures(rel: string): { name: string; json: unknown }[] {
  return readDir(rel);
}

/** Invalid fixtures wrap the document under `key` ("layout" or "hello") next to the expectations. */
export function invalidFixtures(rel: string, key: 'layout' | 'hello'): InvalidFixture[] {
  return readDir(rel).map(({ name, json }) => {
    const f = json as { description: string; expect: ExpectedError[] } & Record<string, unknown>;
    return { name, description: f.description, expect: f.expect, document: f[key] };
  });
}

export function unitCases(): { si: number; unit: string; expected: number }[] {
  const file = JSON.parse(readFileSync(join(FIXTURES, 'units.cases.json'), 'utf8')) as {
    cases: { si: number; unit: string; expected: number }[];
  };
  return file.cases;
}

export interface ValueZoneCase {
  n: number;
  zones: ValueZone[];
  expected: ValueZone['state'] | null;
  note: string;
}

export interface ServerZoneCase {
  note: string;
  zones: unknown;
  unit?: string;
  range?: { min: number; max: number };
  expected: { from?: number; to?: number; state: string }[];
}

export function serverZoneCases(): ServerZoneCase[] {
  const file = JSON.parse(readFileSync(join(FIXTURES, 'server-zones.cases.json'), 'utf8')) as {
    cases: ServerZoneCase[];
  };
  return file.cases;
}

export function valueZoneCases(): ValueZoneCase[] {
  const file = JSON.parse(readFileSync(join(FIXTURES, 'value-zones.cases.json'), 'utf8')) as {
    cases: ValueZoneCase[];
  };
  return file.cases;
}

/** Heading tape geometry cases (ADR-0022), shared by the TS and C++ tests. */
export interface TapeCases {
  marks: {
    note: string;
    heading: number;
    span: number;
    width: number;
    expected: { deg: number; x: number; kind: string; label?: string }[];
  }[];
  markers: {
    note: string;
    value: number;
    heading: number;
    span: number;
    width: number;
    expected: { x: number; off: number };
  }[];
}

export const TAPE_CASES = JSON.parse(
  readFileSync(join(FIXTURES, 'heading-tape.cases.json'), 'utf8'),
) as TapeCases;

/** Engine tile geometry cases (ADR-0032), shared by the TS and C++ tests. */
export interface EngineCases {
  scales: {
    note: string;
    min: number;
    max: number;
    radius: number;
    expected: {
      step: number;
      divisor: number;
      ticks: { value: number; kind: 'minor' | 'medium' | 'major'; label?: string }[];
    };
  }[];
  angles: {
    gauge: 'rpm' | 'left' | 'right' | 'bottom';
    value: number;
    min: number;
    max: number;
    expected: number;
  }[];
}

export const ENGINE_CASES = JSON.parse(
  readFileSync(join(FIXTURES, 'engine.cases.json'), 'utf8'),
) as EngineCases;

/** Wind rose performance cases (ADR-0029), shared by the TS and C++ tests. */
export interface RoseCases {
  laylines: {
    note: string;
    twd: number;
    heading: number;
    beat?: number;
    gybe?: number;
    fixed?: { beat: number; gybe: number };
    expected: { upwind: boolean; angle: number; starboard: number; port: number };
  }[];
  targets: {
    note: string;
    twd: number;
    heading: number;
    target: number;
    expected: number | null;
  }[];
}

export const ROSE_CASES = JSON.parse(
  readFileSync(join(FIXTURES, 'wind-rose.cases.json'), 'utf8'),
) as RoseCases;

/** Centre-zero text cases (ADR-0023), shared by the TS and C++ tests. */
export interface CenterZeroCases {
  text: { n: number; decimals?: number; sides: string; expected: { text: string; side: string } }[];
  ticks: { v: number; m: number; sides: string; expected: string }[];
  spans: { min: number; max: number; expected: number }[];
}

export const CENTER_ZERO_CASES = JSON.parse(
  readFileSync(join(FIXTURES, 'center-zero.cases.json'), 'utf8'),
) as CenterZeroCases;

/** Clock cases (ADR-0024), shared by the TS and C++ tests. */
export interface ClockCases {
  offsets: { zone?: string; posix: string; utc: string; expected: number }[];
  times: {
    local: number;
    hour12: boolean;
    seconds: boolean;
    expected: { text: string; suffix: string };
  }[];
  dates: { local: number; format: string; expected: string }[];
  iso: { text: string; expected: number | null }[];
  posix: { zone: string; year: number; expected: string }[];
}

export const CLOCK_CASES = JSON.parse(
  readFileSync(join(FIXTURES, 'clock.cases.json'), 'utf8'),
) as ClockCases;
