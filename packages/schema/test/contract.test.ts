import { describe, expect, it } from 'vitest';
import { TEMPLATES, validateHello, validateLayout } from '../src/index.js';
import { invalidFixtures, validFixtures } from './fixtures.js';

const byPointer = (a: { pointer: string; code: string }, b: { pointer: string; code: string }) =>
  `${a.pointer}|${a.code}`.localeCompare(`${b.pointer}|${b.code}`);

describe('layout fixtures', () => {
  describe.each(validFixtures('valid'))('valid/$name', ({ json }) => {
    it('validates without errors', () => {
      const result = validateLayout(json);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  describe.each(invalidFixtures('invalid', 'layout'))('invalid/$name', (fixture) => {
    it(`is rejected: ${fixture.description}`, () => {
      const result = validateLayout(fixture.document);
      expect(result.ok).toBe(false);
      const got = result.errors.map(({ code, pointer }) => ({ code, pointer })).sort(byPointer);
      expect(got).toEqual([...fixture.expect].sort(byPointer));
    });
  });
});

describe('hello fixtures', () => {
  describe.each(validFixtures('hello/valid'))('hello/valid/$name', ({ json }) => {
    it('validates without errors', () => {
      expect(validateHello(json).errors).toEqual([]);
    });
  });

  describe.each(invalidFixtures('hello/invalid', 'hello'))('hello/invalid/$name', (fixture) => {
    it(`is rejected: ${fixture.description}`, () => {
      const result = validateHello(fixture.document);
      expect(result.ok).toBe(false);
      const got = result.errors.map(({ code, pointer }) => ({ code, pointer })).sort(byPointer);
      expect(got).toEqual([...fixture.expect].sort(byPointer));
    });
  });
});

describe('validator robustness', () => {
  it.each([null, 42, 'layout', true, [], {}])('rejects %j without throwing', (input) => {
    expect(validateLayout(input).ok).toBe(false);
  });

  it('does not run semantic checks on structurally invalid input', () => {
    const result = validateLayout({ version: 1, id: 'x', theme: 'day', pages: [{ kind: 'grid' }] });
    expect(result.ok).toBe(false);
    expect(result.errors.every((e) => e.code === 'MISSING_FIELD')).toBe(true);
  });
});

describe('starter layouts (templates)', () => {
  it.each(Object.entries(TEMPLATES))('%s validates', (_name, layout) => {
    expect(validateLayout(layout).errors).toEqual([]);
  });

  it('ports every legacy app, plus denser layouts for large displays', () => {
    expect(Object.keys(TEMPLATES)).toEqual([
      'wind',
      'grid',
      'energy',
      'engine',
      'switchboard',
      'sailing-720',
      'wind-engine-720',
    ]);
    for (const [name, t] of Object.entries(TEMPLATES))
      expect(t.id.endsWith('-720')).toBe(name.endsWith('-720'));
  });
});
