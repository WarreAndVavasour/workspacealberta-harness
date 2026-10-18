# Agent Note: Read-only 1Password runtime credentials

Status: implemented

English | [中文](2026-10-01-onepassword-runtime-source.zh.md)

## Problem

The workspaceAlberta deployment promises centralized secret storage while the generic credential provider persists keys and plugin records locally and accepts environment fallbacks. Browser startup also requires a signing-secret record; API-key injection alone cannot satisfy the deployment requirement.

## Decision

The [product overlay](../../../../workspace-alberta.patch.yml) selects a read-only mode in the existing credential provider. Both reference names and plugin record addresses map to 1Password field URIs. Per-operation CLI reads capture values in memory with bounded time and output; neither CLI output nor parser source enters diagnostics. Startup validates all mapped fields and records. Generic local compositions retain their existing behavior.

The provider forbids credential writes before invoking mutations and disables native provider environment/file discovery. Browser startup reads a preprovisioned signing record instead of creating a local secret. Ordinary child environments omit `OP_*` authentication. Diagnostic config exports mask literal credential fields, and the existing source-ownership check rejects literals in product overlays.

## Alternatives considered

`op run` injects API keys into the host environment but does not centralize durable browser or OAuth records. A remote read followed by an item edit cannot satisfy the existing cross-process mutation guarantee; the runtime therefore offers no 1Password writes. Removing generic credential mode would break unrelated supported compositions without improving this deployment.

## Consequences

Operators must provision the browser signing record and approve CLI access before delivery. Key changes reach the next operation without local persistence. Vault failure prevents activation; API-key UI writes and OAuth record mutations are refused. Optional integrations with independent credential sources and the backup service require explicit cutover review. [Operator setup](../../../../docs/ops/ONEPASSWORD.md) owns the procedure and access gaps. Focused tests exercise the actual subprocess protocol using synthetic fields; authenticated vault access is separate delivery evidence.

The [credential-layer decision](2026-08-04-credentials-yaml-and-user-environment-layer.md) and [record-format decision](2026-08-13-credential-records-and-authorization-flows.md) remain active for generic compositions; this mode partially supersedes their application to the product overlay.
