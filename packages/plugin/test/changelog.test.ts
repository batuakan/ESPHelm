import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { namesPackage, releaseSection } from '../scripts/changelog.js';

const SAMPLE = `# Changelog

## Unreleased
- signalk-esphelm 9.9.9 is only planned

## 0.6.0 (2026-12-01)
Firmware 0.6.0 · signalk-esphelm 0.4.0 · @esphelm/schema 1.3.0

### New
- Something

## 0.5.0 (2026-11-20)
Firmware 0.5.0 · signalk-esphelm 0.3.0 · @esphelm/schema 1.2.0
- Older
`;

describe('CHANGELOG.md helpers', () => {
  it('cuts one release section, without its heading', () => {
    expect(releaseSection(SAMPLE, '0.6.0')).toBe(
      'Firmware 0.6.0 · signalk-esphelm 0.4.0 · @esphelm/schema 1.3.0\n\n### New\n- Something',
    );
    expect(releaseSection(SAMPLE, '0.5.0')).toMatch(/- Older$/);
  });

  it('matches the whole version, not a prefix of another', () => {
    expect(releaseSection(SAMPLE, '0.6')).toBeNull();
    expect(releaseSection(SAMPLE, '0.7.0')).toBeNull();
    expect(namesPackage(SAMPLE, 'signalk-esphelm', '0.4')).toBe(false);
    expect(namesPackage(SAMPLE, 'esphelm', '0.4.0')).toBe(false);
  });

  it('finds package versions in released sections only', () => {
    expect(namesPackage(SAMPLE, 'signalk-esphelm', '0.4.0')).toBe(true);
    expect(namesPackage(SAMPLE, '@esphelm/schema', '1.2.0')).toBe(true);
    expect(namesPackage(SAMPLE, 'signalk-esphelm', '9.9.9')).toBe(false);
  });

  it('the repository changelog names the published versions', () => {
    const real = readFileSync(join(__dirname, '../../../CHANGELOG.md'), 'utf8');
    expect(namesPackage(real, 'signalk-esphelm', '0.3.0')).toBe(true);
    expect(namesPackage(real, '@esphelm/schema', '1.2.0')).toBe(true);
    expect(releaseSection(real, '0.5.0')).toMatch(/^Firmware 0\.5\.0/);
  });
});
