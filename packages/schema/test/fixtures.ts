import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
