// CHANGELOG.md at the repository root: one section per release ("## 0.6.0 (2026-12-01)"), whose
// first line names the versions released together ("Firmware 0.6.0 · signalk-esphelm 0.4.0 ·
// @esphelm/schema 1.3.0"). The firmware release (release.yml) puts the section at the top of the
// GitHub release notes, which the SignalK App Store shows as the plugin's changelog; npm.yml
// refuses to publish a package version the changelog doesn't name.
//
//   tsx packages/plugin/scripts/changelog.ts notes <version>   print that release's section
//   tsx packages/plugin/scripts/changelog.ts check-npm         every package version is named
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The section of one release (without its heading), or null when there is none. */
export function releaseSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## ${escape(version)}(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/** True when a released section (not "Unreleased") names `name version`, e.g. "signalk-esphelm 0.4.0". */
export function namesPackage(changelog: string, name: string, version: string): boolean {
  const named = new RegExp(`(^|[\\s·])${escape(name)} ${escape(version)}(?![\\w.-])`, 'm');
  let released = false;
  for (const line of changelog.split(/\r?\n/)) {
    if (/^## /.test(line)) released = !/^## Unreleased/i.test(line);
    else if (released && named.test(line)) return true;
  }
  return false;
}

function main(argv: string[]): number {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const [command, version] = argv;
  if (command === 'notes' && version) {
    const section = releaseSection(changelog, version);
    if (!section) {
      console.error(
        `::error::CHANGELOG.md has no section "## ${version}"; add one before releasing`,
      );
      return 1;
    }
    console.log(section);
    return 0;
  }
  if (command === 'check-npm') {
    let ok = true;
    for (const ws of ['packages/schema', 'packages/plugin']) {
      const pkg = JSON.parse(readFileSync(join(root, ws, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
      };
      if (namesPackage(changelog, pkg.name, pkg.version)) {
        console.log(`CHANGELOG.md names ${pkg.name} ${pkg.version}`);
      } else {
        console.error(
          `::error::CHANGELOG.md doesn't name ${pkg.name} ${pkg.version} in a released section; add it to the release's first line`,
        );
        ok = false;
      }
    }
    return ok ? 0 : 1;
  }
  console.error('usage: changelog.ts notes <version> | check-npm');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
