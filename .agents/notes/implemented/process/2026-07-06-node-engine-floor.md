# Agent Note: Require patched supported Node branches

Status: implemented

English | [中文](2026-07-06-node-engine-floor.zh.md)

## Problem

The Node 22 branch of the root `engines.node` range is a contract for the installed workspace, not only for the runtime APIs the harness source calls directly. It must be no lower than package `engines.node` declarations for dependencies the workspace installs on that branch; otherwise `pnpm install --engine-strict` fails at an advertised LTS version, and non-strict installs run outside a dependency's supported runtime.

## Decision

The [October 2026 Node security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) fixes CVE-2026-111497 at 22.23.4, 24.22.1 and 26.12.1. Each supported major has its own bounded range; an open `>=24.22.1` would still admit vulnerable Node 26 releases. The root and Landlock package manifests share those floors, strict engine checking rejects unsafe installs, and `.node-version` selects Node 24.22.2 for deployment work. Wine provisioning resolves the exact primary pin without treating it as a major or falling back to an older cached release. The former Node 24.9 loader test cannot remain in the supported matrix because that binary is vulnerable. Updating metadata does not replace a running Node process or a distributed executable; deployments and executable releases require independent version evidence.

Set `engines.node` to `^22.23.4 || ^24.22.1 || ^26.12.1` and test keyless CI on `['22.23.4', '24.22.1', 26]`. The primary Node 24 jobs own the complete typecheck and unit coverage inventory; every version runs focused source-worker, Zstandard, source-launch, and [jsdom storage](../testing/2026-07-30-vitest-jsdom-webstorage-ownership.md) smokes without repeating that inventory. The real-API e2e workflow stays on Node 24 because it exercises API integration rather than the runtime floor.

Two Node features gate the source runtime:

- **`node:sqlite`** — `packages/storage/storage-sqlite` does a top-level `import { DatabaseSync } from 'node:sqlite'`, and the optional Session-query provider loads it on first search. The module dropped its `--experimental-sqlite` flag requirement at **22.13** (LTS) and **23.4** (Current); before those, importing it throws at load.
- **Native TypeScript type-stripping** — the built-mode `apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts` smoke boots the test-support `.ts` driver under plain `node` (no tsx) and loads the `.ts` test adapter (`cli-mock-llm.ts`). Type-stripping is the default from **22.18** (LTS) and **23.6** (Current); before those it needs `--experimental-strip-types`.

Those source features clear on the 22.x line at **22.18**, but the installed Pi adapter dependency raises the advertised LTS floor. `@workspacealberta/wa-llm-pi-ai` depends on `@earendil-works/pi-ai@0.79.3`, whose package declares `engines.node >=22.19.0`, so that dependency requires at least **22.19**; the security floor is **22.23.4**. The 24.x branch starts at **24.22.1**. The disjoint range excludes Node 23 entirely: Node 23.0–23.5 still has at least one flagged source feature, and the 23 line is non-LTS/EOL, so advertising `>=23.6` would add a dead release line and a CI leg no deployment should use.

`@types/node` remains pinned to the 22.x line (`^22.20.0`) to match the LTS support line: reaching for a Node 23+/24+/25+ API fails `tsc` on every machine and in the typecheck gate, rather than compiling clean and surviving to a runtime failure only a floor matrix leg could catch. The whole tree typechecks clean against the Node 22 type API, so the pin costs nothing.

## Consequences

- The advertised LTS branch no longer undercuts the Pi adapter dependency floor.
- CI proves the patched floors with Node 22.23.4 and 24.22.1, keeps primary coverage on Node 24.22.2, and exercises Node 26 as the next even line; focused compatibility smokes run on all three versions.
- The built-mode smoke needs no version-conditional flag: at 22.19 type-stripping is already the default, so the example-owned TypeScript driver stays a plain `node fixture.ts` path.
- A future dependency or source API that raises the runtime floor must move `engines.node`, the compatibility matrix, and this Agent Note in the same change.

## Alternatives considered

- **Keep `^22.18.0 || >=24.0.0`.** Rejected: it advertises an LTS version lower than the Pi adapter dependency floor. `@earendil-works/pi-ai@0.79.3` requires `>=22.19.0`.
- **Downgrade or pin `@earendil-works/pi-ai` to preserve the 22.18 advertised range.** Rejected: the current Pi adapter dependency is part of the intended workspace, and 22.19 is still inside the Node 22 LTS line.
- **Floor `>=22.13` (the `node:sqlite` boundary) plus `--experimental-strip-types` in the built-bin smoke on 22.13–22.17.** Rejected: it adds a version-conditional test flag for one narrow range and dresses up an experimental-flag dependency as first-class support. The Pi adapter dependency already requires a higher LTS floor.
- **Open-ended `>=22.19`.** Rejected: it advertises support for Node 23.0–23.5, where `node:sqlite` (until 23.4) or type-stripping (until 23.6) is still flagged.
- **Include Node 23.6+ (`^22.19.0 || >=23.6.0`).** Rejected: 23.6+ does run both source features unflagged, but Node 23 is end-of-life; advertising a dead release line adds a range term and a CI leg for a runtime no deployment should use.
- **Matrix `[22, 24, 26]` instead of pinning `22.19`.** Rejected: floating major-version entries drift upward over time and silently stop exercising the declared LTS floor.
- **Keep `@types/node` ahead of the floor (`^25`).** Rejected: types ahead of the runtime floor let a Node 24/25-only API compile clean and fail only at runtime on 22.x. Pinning `@types/node` to the 22.x line turns that into a compile error everywhere.
