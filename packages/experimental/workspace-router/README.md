# @workspacealberta/wa-experimental-workspace-router

English | [中文](README.zh.md)

An opt-in Jev decision tree for WorkspaceAlberta procurement requests. The `workspace_route` tool selects one existing MCP operation, checks explicit inputs and known tender references, and returns a recommendation or executes through the harness's guarded ToolRuntime. The [Agent Note](../../../.agents/notes/implemented/feature/2026-09-19-jev-workspace-decisions.md) explains ownership and tradeoffs.

## Configuration

The plugin requires `tools`, an exact name for each of `search`, `match`, `details`, `deadlines` and `bid_room`; `minConfidence`, a threshold for each operation; and `referenceConfidence`. Thresholds range from zero to one and have no defaults. Select them from labeled deployment evaluations: confidence describes the answer distribution, not permission or correctness. `mode` defaults to `recommend`; `execute` permits one guarded child call. A selected unavailable tool fails visibly in either mode.

`apiKeyRef` defaults to `TYPESAFE_API_KEY` and resolves through `ctx.credentials` on activation and each call. `baseURL` defaults to `https://api.typesafe.ai`, `model` to `jev-latest`, and `timeoutMs` to 10000. Inference makes one attempt with no automatic retry. Cancellation or unloading aborts inference and drains active work. Credential values never enter questions or session records.

`maxRequestBytes` defaults to 32768 for the complete Jev request; `maxResultBytes` defaults to 65536 for the returned JSON. `maxReferences` defaults to 32 and cannot exceed 254. `maxEvidenceAgeMs` defaults to 900000. Oversized input fails before inference. An oversized child result reports that the action may have completed; check its artifacts before retrying.

## Decision behavior

The caller supplies the user's request and explicit keywords, business profile, source, horizon, limit or retrieved references. References include their exact identifier, title and retrieval time in Unix milliseconds. Jev receives this state and simultaneous Choice questions for operation and, when candidates exist, reference selection. Only the selected branch's reference answer affects the decision. The router copies identifiers and business facts; it does not generate missing arguments.

Search requires keywords; matching requires a profile description; details and bid-room analysis require one confidently selected, fresh reference. Ambiguity or missing inputs returns `clarify`. Low confidence, general or compound requests, service failure and malformed responses return `fallback` for the reasoning model. These outcomes dispatch no procurement tool. Accepted calls preserve configured source, days and limit only on operations that support them.

The session records the complete secret-free inference request and policy before inference, relevant validated answers and decision before dispatch, and any settled child result. Load the `/invariant` companion with the invariant registry to enforce that order. Logs persist only when the composition includes a session persistence provider.

## Setup tutorial

1. Configure `TYPESAFE_API_KEY`, `DEEPSEEK_API_KEY` and `WORKSPACEALBERTA_MCP_URL` in the local environment or root `.env`. The MCP endpoint must expose the five existing WorkspaceAlberta tools. Add endpoint authentication to the MCP client configuration if your server requires it.
2. Set `WORKSPACE_ROUTER_THRESHOLDS` to a JSON object containing the five operation thresholds, and `WORKSPACE_ROUTER_REFERENCE_CONFIDENCE` to the reference threshold. Missing values fail configuration validation.
3. Load [the headless overlay](../../../examples/headless-agent/workspace-router.cordis.yml) with the [headless example](../../../examples/headless-agent/README.md). Ask the agent to call `workspace_route` with a concrete procurement request. Inspect the returned recommendation and recorded evidence before changing `mode` to `execute`.

For a development trace through the repository's Loader driver, run from the repository root:

```sh
node --import tsx/esm examples/headless-agent/tests/fixtures/headless-driver.ts examples/headless-agent/workspace-router.cordis.yml "Use workspace_route to search for steel fabrication opportunities. Keywords: steel fabrication."
```

This prints the example's test JSONL stream. The focused live classifier check is `pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/workspace-router/tests/jev.e2e.ts`; it skips without `TYPESAFE_API_KEY` and reports selections, confidence, latency and token usage for synthetic labeled requests. This small smoke set does not calibrate deployment thresholds or calculate cost.

## Model Experience

### Routing tool and auxiliary questions

#### What the model sees

The reasoning model sees the [workspace_route tool schema](../../../docs/tool-catalog.md#workspacealbertawa-experimental-workspace-router) and JSON with `decision`, available evidence and any child `execution`. It asks for missing information, continues reasoning, presents a recommendation or summarizes the executed result without repeating it. Jev sees the supplied request and state plus bounded Choice questions. Generic UI rendering shows the same JSON; there is no terminal or diff view.

#### Token effect

The tool schema adds a fixed cost to each reasoning request while enabled; its result appends to conversation history. Each call adds one auxiliary inference request containing explicit state and independent questions, bounded by `maxRequestBytes`. Relevant model usage is recorded with the decision.

#### KV Cache effect

The reasoning model's tool schema stays stable while the plugin is loaded. Router results append after the reusable prefix. Jev receives changing state and candidate options; the plugin makes no auxiliary cache-reuse guarantee.

## Known Limitations and Deferred Work

- This private prototype is excluded from release bundles. It is an explicit tool, not an automatic conversation classifier, and neither edits the agent loop nor changes the WorkspaceAlberta server.
- It does not score tender eligibility, retrieve evidence itself, extract free-form arguments or guarantee exactly-once MCP effects across retries. Caller-supplied retrieval times must be trustworthy.
- The caller's request, profile and reference titles go to the configured TypeSafe endpoint. Live Jev quality, latency, cost and production thresholds require deployment evaluation; keyless tests establish routing and lifecycle behavior only.
