# Agent Note: Workspace Alberta procurement procedures

Status: implemented

English | [中文](2026-09-07-wa-procurement-two-clocks.zh.md)

## Problem

Procurement corrections must improve repeatable work without turning customer history into global instructions. Missing qualification evidence can otherwise become a false rejection, while a task agent that rewrites its own instructions bypasses review.

## Decision

The [deployment reference](../../../../WORKSPACE_ALBERTA.md#procurement-two-files-two-clocks) uses two skill entrypoints under the harness's existing project discovery root. The base owns procurement procedure and resources; the separately invoked improver proposes one concern through a human-merged PR. The improver is hidden from the harness model catalog and reads the base as review input. It does not become part of tender-task instructions.

Unknown mandatory filters produce uncertain fit; verified disqualification produces low fit. Primary evidence controls deadlines and amendments. The scheduler owns cursors and unaddressed signal IDs, while temporary summaries and private feedback remain outside git. Overlapping collection and PR deduplication provide a bounded fallback when durable scheduler metadata is unavailable.

## Alternatives considered

**A committed last-signal file.** It risks publishing private feedback and becoming a third durable memory source. Temporary run storage and scheduler bookkeeping preserve the distinction between procedure and customer history.

**A new agent-loop learning subsystem.** Existing skill discovery and an independent scheduler can carry this procedure without changing core runtime behavior. Prompt instructions express review policy; a restricted automation identity is required to enforce it.

**Treat missing bonding as low fit.** Unknown capacity or requirements do not establish ineligibility. The rubric reserves low fit for a verified mismatch.

## Consequences

The repository ships procedures and deployment instructions, not a tender-feed subscriber or fleet updater. The schedule requires an available execution host and GitHub access. Synthetic examples support manual procedure review; they do not establish model compliance. No assembled application prompt, runtime package, or default provider changes, so no new runtime transcript snapshot applies. Live tender behavior and review-identity restrictions require deployment verification.
