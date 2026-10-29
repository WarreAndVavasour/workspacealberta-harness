# Agent Note: Cut the remaining DeepSeek Harness upstream ties

Status: implemented

English | [中文](2026-10-29-cut-upstream-ties.zh.md)

## Problem

After the [identity cutover](2026-09-07-workspace-alberta-npm-identity-cutover.md), the repository still pointed at the DeepSeek Harness project at runtime, in CI, and in package metadata. Nine pull-request checks failed for reasons that traced back to that project:

- `Issue policy` and `Issue lifecycle` minted a token for a GitHub App configured only in the upstream organization (`DSH_ISSUE_APP_*`) and read the upstream Project board.
- `Release (dsh)` passed `--family dsh`, which `scripts/release/families.ts` no longer defines.
- `Dependency layout` rejected three `ui-alberta-grid` peers, and three `wa` release members carried versions outside the family's shared version.
- The Python runtime smoke compared against snapshots that still named `@deepseek-ai/dsh-system-prompt`.
- `E2E` downloaded a bubblewrap build that the Ubuntu archive pool had deleted.

Shipped code also sent `deepseek-harness` as its `User-Agent` product token with an upstream repository URL, every `package.json` `repository.url` named `deepseek-ai/deepseek-harness`, and the Python runtime's node mode looked for the CLI under `@deepseek-ai/dsh`.

## Decision

- Delete `issue-policy.yml`, `issue-lifecycle.yml`, `.github/issue-management/`, its `test:issue-management` script and gate entries, and the matching `ci-workflow.spec.ts` block. A Warre & Vavasour replacement needs its own GitHub App.
- Rename the release family in workflows to `wa` (`--family wa`, `wa-v*` tags, `Release (wa)`, `wa-npm-tarballs`), and align `ui-alberta-grid`, `session-episode-recorder`, and `web-search-cohere` to the family version.
- Keep `@workspacealberta/cordis` as the only peer of `ui-alberta-grid`; the other workspace packages it uses stay dev-only, as `verify-package-dependencies` requires.
- Download bubblewrap from the Launchpad librarian, which keeps every published build, and pin the current security build `0.9.0-1ubuntu0.3`.
- Point every repository URL, User-Agent comment, Python project URL, and documentation link at `github.com/WarreAndVavasour/workspacealberta-harness`; the User-Agent product token is `workspacealberta-harness`.
- Replace `@deepseek-ai` names in snapshots, tests, scripts, and `docs/rescope.md` with their `@workspacealberta` names, and drop the legacy `#deepseek-aidsh-*` anchors that the catalog generators emitted.
- Remove the upstream community block (CDN images, survey form) and documentation-site link from `README.zh.md`.

DeepSeek remains a supported model provider: `api.deepseek.com`, the DeepSeek LLM and search packages, and the real-API e2e workflow are unchanged.

## Alternatives considered

**Rewire the Issue workflows to a Warre & Vavasour GitHub App.** Deferred: no App exists, so the checks would stay red until one is created.

**Rewrite the vendored package provenance in `vendor/README.md` and `THIRD_PARTY_NOTICES.md` to the original upstreams.** Rejected: the recorded commits exist only in the `deepseek-harness` forks of `cordis`, `cosmokit`, and `schemastery`, so another URL would misstate where the vendored source came from. These rows are attribution, not runtime calls.

**Rename `DSH_*` environment variables and internal `dsh` identifiers.** Deferred for the reasons in the identity cutover note: they are runtime and on-disk contracts.

## Consequences

No CI job, runtime request, or package manifest depends on the upstream GitHub organization, npm scope, CDN, or issue bot. The vendored provenance rows, archived Agent Notes, and implemented notes that describe past decisions still mention the upstream project as history.
