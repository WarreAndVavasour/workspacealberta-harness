# Agent Note: Workspace Alberta npm and CLI identity cutover

Status: implemented

English | [中文](2026-09-07-workspace-alberta-npm-identity-cutover.zh.md)

## Problem

The product ships as Workspace Alberta / Warre & Vavasour, but first-party npm names, TypeScript specifiers, and the operator CLI still used the DeepSeek Harness identity (DeepSeek-scoped `dsh-*` packages, root `dsh-root`, bin `dsh`). Operators and package consumers could not treat this repository as an independent product.

## Decision

The first-party npm scope is `@workspacealberta`. Former DeepSeek-scoped `dsh-<name>` packages are `@workspacealberta/wa-<name>`; the CLI package is `@workspacealberta/wa`; the workspace root is `@workspacealberta/wa-root`. Vendored Cordis packages keep their unprefixed names under the same scope (`@workspacealberta/cordis`, and the other eight mapped names in [docs/rescope.md](../../../../docs/rescope.md)). Packages that already used `@workspacealberta` without a `dsh-` prefix (`ui-alberta-grid`, `web-search-cohere`) keep those names.

The user-facing and systemd-facing CLI is `wa` (`pnpm wa`, `apps/cli` bin, Commander program name, release family id `wa`, tag prefix `wa-v`). The `dsh` key inside package manifests remains the profile/bundle metadata field the loader already reads; renaming it would be a separate on-disk format change. Environment variables such as `DSH_HOME` stay so existing Pi units keep resolving `~/.workspaceAlberta`.

Product docs (`README.md`, `WORKSPACE_ALBERTA.md`, `CONTRIBUTING.md`, `BRAND_GUIDELINES.md`, `AGENTS.md`, `workspace-alberta.patch.yml`, `workspace-alberta-apc.patch.yml`) describe Workspace Alberta as the product, not as a DeepSeek Harness profile or patch layer. The APC launcher starts `pnpm wa`. MIT copyright and third-party notices remain the legal attribution home.

Archived Agent Notes are not rewritten: they are hash-sealed historical snapshots, and `.rgignore` already excludes that tree from repository search. `LICENSE*` and `THIRD_PARTY*` files keep upstream copyright strings.

## Alternatives considered

**Keep `@workspacealberta/dsh-*` and only change the npm scope.** Rejected because the product directive forbids shipping a DSH package family. The `dsh-` → `wa-` prefix is the mechanical counterpart of the CLI rename and keeps one consistent first-party family.

**Use `@warre-vavasour/` or drop the `wa-` prefix on every package.** Rejected: `@workspacealberta` was already live on Cohere search and Alberta Grid packages, and stripping `dsh-` without a replacement collides with short names such as `session` and `web`. New first-party packages continue to use `@workspacealberta/wa-<pkg>` unless they already have a product-specific name.

**Rename `DSH_*` environment variables and the `dsh` manifest metadata key in the same change.** Rejected: those are runtime and on-disk contracts for deployed units and profile bundles. This cutover is identity and import resolution, not a home-directory or bundle-format bump.

**Rewrite archived Agent Notes so a DeepSeek-scope search is empty even with `--no-ignore`.** Rejected: the archive seal forbids content edits, and the documented success search already excludes that tree via `.rgignore`.

## Consequences

Every first-party import, `package.json` name, tsconfig path, and `cordis.yml` plugin row must use `@workspacealberta`. `pnpm install` and `pnpm run build` must resolve the new names. Operators type `wa`, not `dsh`. `publishOrder` honours install edges independently of package-name visit order, so already-scoped packages such as `ui-alberta-grid` that sort before `wa-*` cannot invert a host-apiproxy → api-remotes install edge. Issue policy talks to the current GitHub repository (`GITHUB_REPOSITORY`), not a hardcoded upstream pair. A later change that wants `DSH_HOME` or `manifest.dsh` renamed needs its own format/version decision and a fleet migration.
