# Workspace router

English | [中文](workspace-router.zh.md)

Reference for the optional [WorkspaceAlberta router](../../packages/workspace/workspace-router/README.md). The [configuration catalog](../config-catalog.md#workspacealbertawa-workspace-router) owns its `Config`, `DecisionPolicy` and operation keys; [source declarations](../../packages/workspace/workspace-router/src/decision.ts) define validated caller state and Choice evidence.

## Decisions

`WorkspaceDecision` is a discriminated union. An accepted `recommend` or `execute` contains `reason: 'accepted'`, an operation, the exact configured tool name and validated JSON arguments. `clarify` or `fallback` contains a reason and optionally the operation; it carries no executable arguments. Recommendation and execution share validation. Only execution invokes the existing tool runtime.

## Durable evidence

```ts type-equiv
/** Secret-free record of one router operation. */
interface WorkspaceRouterEvent {
  /** The enclosing workspace_route call. */
  callId: ToolCallId
  /** Request before inference, decision before dispatch, or settled child result. */
  phase: 'request' | 'decision' | 'result'
  /** Full request and policy, decision and raw answers, or child tool result. */
  value: JsonValue
}
```

The [`workspace/route` event](../persistence-catalog.md#workspaceroute--log-only) is log-only. `request` contains version 1, the complete auxiliary request body and resolved policy. `decision` contains the chosen branch and relevant validated answers, model and usage when available. `result` contains the settled child result or an explicit oversized-result diagnostic. Cancellation may leave only a request; recommendations and fallbacks have no child-result record. The same call id orders these records, and TypeScript and Python SDK event collections preserve them without changing the final assistant response.
