---
description: "The workspace group map: the persistent workspace entity family, durable directory records, and header-validated session membership, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/workspace

English | [中文](README.zh.md)

## Summary

The workspace group provides persistent directory projects and conversation-scoped delivery plans. `workspace` groups sessions under named directories without deleting their histories when a directory project is removed. `project-tools` gives the lead model durable project checkpoints and bounded Jev document intake. Choose these packages for directory navigation, continuing business work, or both; their state has different owners.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`workspace`](workspace/README.md) | Provides named, ordered projects with the sessions that ran in each directory | `ctx.workspaceRegistry` |
| [`project-tools`](project-tools/README.md) | Saves conversation project plans and classifies cited document sections with Jev | tools only |
| [`workspace-router`](workspace-router/README.md) | Recommends or guards one existing procurement operation using Jev | tools only |

-----

<a id="related-documentation"></a>
## Related documentation

- [Procurement routing](../../docs/subsystems/workspace-router.md) — bounded Jev judgments and guarded execution.
- [Workspace subsystem](../../docs/subsystems/workspace.md) — the authoritative feature contract for projects and their sessions.
- [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) — the storage design behind project records.
- [Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md) — how the first start builds projects from session history and how the GUI orders them.
- [Workspace registration deletion decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md) — why removing a project never deletes its folder or sessions.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
