import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../scripts/render.js';
import { SEMANTIC_CODES } from '../src/index.js';
import { invalidFixtures, validFixtures } from './fixtures.js';

/**
 * The published JSON Schema files must work standalone, as the plugin and editor (or any other
 * tool) will use them: a fresh Ajv in strict mode, with only the `errorCode` annotation registered.
 */
function standalone(file: string) {
  const ajv = new Ajv({ strict: true, allErrors: true });
  ajv.addKeyword({ keyword: 'errorCode', schemaType: 'string' });
  const schema = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'schema', file), 'utf8')) as object;
  return ajv.compile(schema);
}

const semantic = new Set<string>(SEMANTIC_CODES);

describe('published layout.schema.json', () => {
  const validate = standalone('layout.schema.json');

  it.each(validFixtures('valid'))('accepts valid/$name', ({ json }) => {
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
  });

  // Semantic rules (overlaps, ranges, unique ids) are outside JSON Schema: such fixtures pass the
  // schema and are caught only by validateLayout(). Every other invalid fixture must fail here too.
  it.each(invalidFixtures('invalid', 'layout'))(
    'agrees with validateLayout on invalid/$name',
    (f) => {
      const onlySemantic = f.expect.every((e) => semantic.has(e.code));
      expect(validate(f.document)).toBe(onlySemantic);
    },
  );
});

describe('published hello.schema.json', () => {
  const validate = standalone('hello.schema.json');

  it.each(validFixtures('hello/valid'))('accepts hello/valid/$name', ({ json }) => {
    expect(validate(json)).toBe(true);
  });

  it.each(invalidFixtures('hello/invalid', 'hello'))('rejects hello/invalid/$name', (f) => {
    expect(validate(f.document)).toBe(false);
  });
});
