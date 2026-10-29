# Agent Note: Refuse Node builds missing the CVE-2026-111497 Brotli fix

Status: implemented

English | [中文](2026-10-29-node-brotli-engine-floor.zh.md)

## Problem

CVE-2026-111497 is an out-of-bounds write in the Brotli decoder bundled with Node.js, and exploitation against unpatched images has been reported. The fixed releases are 22.23.4, 24.22.1, and 26.12.1. Node.js 20, 23, and 25 are end of life and receive no fix. A support range that admits an earlier 22, 24, or 26 build, or that admits Node 25 through an open `>=24` term, lets a deploy run a vulnerable runtime.

## Decision

Root `engines.node` is `^22.23.4 || ^24.22.1 || >=26.12.1`. `^22.23.4` means `>=22.23.4 <23.0.0`. `^24.22.1` means `>=24.22.1 <25.0.0`, which excludes end-of-life Node 25. `>=26.12.1` excludes Node 26.0.0 through 26.12.0 and still admits later majors. The published `@workspacealberta/node-addon-landlock-run` entry and platform packages declare the same range.

The `node-compat` matrix pins `22.23.4` and `24.22.1` and leaves `26` floating so the current 26 release stays under test. Primary jobs keep floating `24`. This repository has no `.nvmrc`, Dockerfile, or Railway image pin. The [feature and dependency floor](2026-07-06-node-engine-floor.md) still requires the 22 line to stay at least 22.19 and disjoint from Node 23; this range satisfies that minimum. `scripts/ci-workflow.spec.ts` rejects a concrete `actions/setup-node` version below those floors.

## Alternatives considered

- **`^22.23.4 || >=24.22.1`.** Rejected: semver treats `>=24.22.1` as every later major, so Node 25 (no fix) and Node 26.0.0–26.12.0 (vulnerable) still match.
- **Keep the Node 24.9 compatibility pin.** Rejected: 24.9 sits inside 24.0–24.11.1, which carries the v1 loader while reporting major 24, and it is below 24.22.1. That loader generation on major 24 is outside the supported range. The Node 22 floor still exercises the v1 loader API, and primary jobs float `24`, which is past 24.12 and past the Brotli fix.
- **Float `22` instead of pinning `22.23.4`.** Rejected: a floating major stops exercising the declared floor. The [feature-floor note](2026-07-06-node-engine-floor.md) rejects the same substitution.

## Consequences

- Installers that honor `engines` refuse an affected Node. This repository does not set `engine-strict`, so a non-strict install can still run; the range is the advertised support line.
- CI no longer provisions Node 22.19 or Node 24.9. The mistagged 24.0–24.11.1 loader is outside the supported range.
- `@types/node` stays on the 22.x line. The security floor does not add a Node 24-only API.
