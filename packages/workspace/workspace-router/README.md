---
description: "Bounded Jev procurement routing through existing harness tools."
kind: "package-reference"
---

# @workspacealberta/wa-workspace-router

English | [中文](README.zh.md)

## Summary

An opt-in Jev decision tree for WorkspaceAlberta procurement requests. The `workspace_route` tool selects one existing MCP operation, checks explicit inputs and known tender references, and returns a recommendation or executes through the harness's guarded ToolRuntime. The [Agent Note](../../../.agents/notes/implemented/feature/2026-09-19-jev-workspace-decisions.md) explains ownership and tradeoffs.

## Table of Contents

- [Configuration](#configuration)
- [Decision behavior](#decision-behavior)
- [Deployment](#deployment)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## Configuration

The plugin requires `tools`, an exact name for each of `search`, `match`, `details`, `deadlines` and `bid_room`; `minConfidence`, a threshold for each operation; and `referenceConfidence`. Thresholds range from zero to one and have no defaults. Select them from labeled deployment evaluations: confidence describes the answer distribution, not permission or correctness. `mode` defaults to `recommend`; `execute` permits one guarded child call. A selected unavailable tool fails visibly in either mode.

`apiKeyRef` defaults to `TYPESAFE_API_KEY` and resolves through `ctx.credentials` on activation and each call. `baseURL` defaults to `https://api.typesafe.ai`, `model` to `jev-1.14.0`, and `timeoutMs` to 10000. Inference makes one attempt with no automatic retry. Cancellation or unloading aborts inference and drains active work. Credential values never enter questions or session records.

`maxRequestBytes` defaults to 32768 for the complete Jev request; `maxResultBytes` defaults to 65536 for the returned JSON. `maxReferences` defaults to 32 and cannot exceed 254. `maxEvidenceAgeMs` defaults to 900000. Oversized input fails before inference. An oversized child result reports that the action may have completed; check its artifacts before retrying.

<a id="decision-behavior"></a>
## Decision behavior

The caller supplies the user's request and explicit keywords, business profile, source, horizon, limit or retrieved references. References include their exact identifier, title and retrieval time in Unix milliseconds. Jev receives this state and simultaneous Choice questions for operation and, when candidates exist, reference selection. Only the selected branch's reference answer affects the decision. The router copies identifiers and business facts; it does not generate missing arguments.

Search requires keywords; matching requires a profile description; details and bid-room analysis require one confidently selected, fresh reference. Ambiguity or missing inputs returns `clarify`. Low confidence, general or compound requests, service failure and malformed responses return `fallback` for the reasoning model. These outcomes dispatch no procurement tool. Accepted calls preserve configured source, days and limit only on operations that support them. Rounded API probabilities are retained within their two-decimal rounding bound.

The session records the complete secret-free inference request and policy before inference, relevant validated answers and decision before dispatch, and any settled child result. Load the `/invariant` companion with the invariant registry to enforce that order. Logs persist only when the composition includes a session persistence provider.

<a id="deployment"></a>
## Deployment

The corporate `workspace-alberta.patch.yml` mounts this package in recommendation mode beside the existing MCP client and native Cohere v2 adapter. It pins Jev 1.14 and maps the five operations to `mcp__workspace_alberta__*` tools. `TYPESAFE_API_KEY` uses the existing credential provider. The deployment's 0.9 confidence thresholds are provisional review settings, not calibrated permission to act.

`mode: execute` is an explicit deployment choice; it invokes only the selected existing tool through its normal guards. Neither mode fabricates missing inputs. An unavailable selected tool is an error. Generic profiles do not mount the router automatically; the base bundle includes the package for optional composition.

<a id="dev-note"></a>
## Dev Note

The [routing decision](../../../.agents/notes/implemented/feature/2026-09-19-jev-workspace-decisions.md) records the classifier's responsibilities. The [business-planning proposal](../../../.agents/notes/proposed/feature/2026-09-19-jev-business-planning.md) remains proposed.

<a id="model-experience"></a>
## Model Experience

### Routing tool and auxiliary questions

#### What the model sees

The reasoning model sees the [workspace_route tool schema](../../../docs/tool-catalog.md#workspacealbertawa-workspace-router) and JSON with `decision`, available evidence and any child `execution`. It asks for missing information, continues reasoning, presents a recommendation or summarizes the executed result without repeating it. Jev sees the supplied request and state plus bounded Choice questions. Generic UI rendering shows the same JSON; there is no terminal or diff view.

#### Token effect

The tool schema adds a fixed cost to each reasoning request while enabled; its result appends to conversation history. Each call adds one auxiliary inference request containing explicit state and independent questions, bounded by `maxRequestBytes`. Relevant model usage is recorded with the decision.

#### KV Cache effect

The reasoning model's tool schema stays stable while the plugin is loaded. Router results append after the reusable prefix. Jev receives changing state and candidate options; the plugin makes no auxiliary cache-reuse guarantee.


## Known Limitations and Deferred Work

- The package is bundled for optional composition; only the corporate deployment mounts it by default. It is an explicit tool, not an automatic conversation classifier, and neither edits the agent loop nor changes the WorkspaceAlberta server.
- It does not score tender eligibility, retrieve evidence itself, extract free-form arguments or guarantee exactly-once MCP effects across retries. Caller-supplied retrieval times must be trustworthy.
- The caller's request, profile and reference titles go to the configured TypeSafe endpoint. Live Jev quality, latency, cost and production thresholds require deployment evaluation; keyless tests establish routing and lifecycle behavior only.
