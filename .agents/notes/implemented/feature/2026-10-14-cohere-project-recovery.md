# Agent Note: Native Cohere delivery and durable project checkpoints

Status: implemented

English | [中文](2026-10-14-cohere-project-recovery.zh.md)

## Problem

The corporate deployment selects an OpenAI-compatible route while native Cohere v2 work exists on a separate branch. Tool calls and their replay require one tested deployment path. Long business projects also need state that survives turns instead of depending on a turn-local todo list or a permanently running request.

## Decision

The product overlay selects `cohere-v2-chat` at `https://api.cohere.com/v2`. The recovered adapter translates streamed plans, calls, results and terminal usage through the existing pi-ai seam. HTTP errors retain their status so authentication, rate limits and server failures remain distinguishable. Empty argument streams are valid for tools without parameters; malformed nonempty arguments fail explicitly. Existing MIT notices, 1Password deployment settings and the model route stay intact. Two existing host-build blockers are repaired: the missing release distribution-tag method and a stale license-test import. Prereleases select npm's `next` tag rather than promote `latest`; no package publication occurs in this change.

The deployment-enabled [project tools](../../../../packages/workspace/project-tools/README.md) save complete revision-checked plans in required `workspace/project` session events. The existing persistence service owns disk durability. A missing writer or flush failure is an error; the caller rereads rather than blindly repeating a save or an external action. Task dependencies are acyclic and reference existing tasks and sources. Artifact locations and completion remain reported facts, not independent verification or owner acceptance.

Jev classifies bounded text sections with independent Choice questions in one request. The integration pins `jev-1.14.0`; a deployment must supply its confidence threshold. Exact secret-free requests and responses are logged. Provider credentials stay server-side. The standard deployment uses read-only vault references; `WA_CREDENTIALS_MODE=env` explicitly selects the existing environment/store/.env credential mode when 1Password CLI is unavailable. Both provider keys must be present in the protected service environment; the default read-only vault mode is unchanged. The corporate overlay enables experimental image inspection and optional longer text batches. PNG/JPEG bytes are read through the filesystem provider with a four-MiB cap; their hash, content and exact questions are retained for reconstruction. Images send only the image opt-in header. Larger text requests send the long-context opt-in header only when explicitly requested and above the normal byte cap. Disabled paths fail through the executor. The deployment threshold of 0.9 is provisional review policy, not calibrated authority. This consumer uses existing credential and tool services; it does not add a connection broker or replace guarded tool execution.

## Alternatives considered

**Use only the compatibility endpoint.** This leaves the native v2 implementation outside the deployment being tested and obscures provider-specific stream behaviour.

**Let Jev generate the project plan.** Jev supplies typed judgments. Cohere owns synthesis, tool selection and revising a free-form plan from company evidence.

**Automatically deploy sixteen workers.** The [Cohere study](https://cohere.com/blog/lessons-from-scaling-teams-of-frontier-coding-agents) measures coding tasks. Its planning result supports a controlled RFP experiment, not a production worker count or an assumed cost reduction. Independent section judgments are batched; the optional overlay also mounts read-only `project_explore` workers through the existing subagent tool, limited to two parallel tool calls per step with no recursive or background starts. Workers inherit the Cohere route; an RFP worker benchmark and cheaper-model selection remain separate evaluation work.

## Consequences

The real 473-page RFP smoke exercises 85 Jev batches, image Choice/Noul/Box with the image opt-in header, and a focused versus 100-page long-context comparison. Rounded API probabilities are retained within their two-decimal rounding bound. The first end-to-end attempt also exposed opaque checkpoint parameters; the tool now publishes the complete nested schema and refuses empty task lists. Actual harness tool tests exercise image and larger text requests with the live API. The RFP builder writes four drafts and a populated plan, but source review found unsupported wording and misplaced citations: execution success is not proposal acceptance. A populated checkpoint survives disk reload in keyless coverage; the full RFP run restores its conversation before creating the populated plan.

Live synthetic checks exercise Jev 1.14 classification and a Cohere tool call followed by disk-backed conversation continuation. Keyless checks exercise the real Loader composition, revision conflicts, dependency rejection and cited batch classification. The built CLI records and replays a keyless project checkpoint conversation. A failed Pi chat reports that Cohere rejects a oneOf tool parameter under strict_tools=true; the native adapter leaves strict mode off by default. Direct API probes from the Pi verify Jev credentials and a native Cohere tool call with that schema. The updated harness still needs installation and service verification on the Pi. The SSH policy repair adds the operator's existing GitHub identity to managed SSH hosts without extending root access; it is verified separately from the repository build. Cross-device projects, background scheduling, parser integration, independent artifact verification, labeled threshold calibration and an RFP worker benchmark remain outside the implemented tools. Existing provider-catalog decisions remain active; this note adds a protocol and project behaviour rather than superseding them.
