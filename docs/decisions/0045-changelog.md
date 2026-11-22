# ADR-0045: One changelog, shown in the SignalK App Store

Status: **Accepted** (2026-11-22)

## Context
- **What the App Store shows:** the SignalK App Store (signalk-server's admin UI) has a *Changelog* tab per plugin. signalk-server 2.37 fills it from the **GitHub Releases** of the package's repository (`appstore/detail.js`, its releases feed). It falls back to a `CHANGELOG.md` in the published package only when there are no releases.
  - With neither, the tab says *"The plugin doesn't ship a CHANGELOG.md"*.
  - List items starting with `feat`, `fix` or `BREAKING` are highlighted.
- **What our releases contain:** ESPHelm's GitHub Releases are the firmware releases (`v0.4.0`, `v0.5.0`, ADR-0031). Their notes say how to install firmware, not what changed. So the tab showed install instructions.
- **Three version numbers:** firmware (0.5.0), `signalk-esphelm` (0.3.0) and `@esphelm/schema` (1.2.0). They are released at the same time (#42).

## Decision
- **One file:** a root `CHANGELOG.md`, one section per release (`## 0.6.0 (date)`), headed by the versions released together (`Firmware 0.6.0 · signalk-esphelm 0.4.0 · @esphelm/schema 1.3.0`). Changes go under *New*, *Changed* and *Fixed*, written for boat owners, not as commit messages. Work in progress collects under `## Unreleased`.
- **GitHub release notes:** `release.yml` starts each release's notes with *What changed* (its section) before the firmware table.
  - A tag without a section fails before building.
  - A prerelease may use *Unreleased*.
- **npm:** `npm.yml` refuses to publish a package version that no released section names. It copies `CHANGELOG.md` into both packages, which list it in `files`; the copies are gitignored. That covers the App Store's fallback and anyone reading the package.
- **The helper:** `packages/plugin/scripts/changelog.ts` (`notes <version>`, `check-npm`) does both, with unit tests. Node 22 runs it with `--experimental-strip-types` in `release.yml`, without `npm ci`.

## Consequences
- **When a release goes out:** add its section in the PR that bumps the versions, then tag and publish as before (`docs/plugin-api.md`, `docs/firmware-runtime.md`).
- **Plugin-only releases** (a new `signalk-esphelm` without new firmware) still need a section to publish. But the store shows it only once a GitHub release carries it. Releasing everything together avoids that.
- **Older releases:** v0.4.0 and v0.5.0 have their sections, written afterwards. Their GitHub release notes only change if edited by hand.
