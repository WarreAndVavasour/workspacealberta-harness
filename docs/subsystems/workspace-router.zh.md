# Workspace 路由器

[English](workspace-router.md) | 中文

私有 [WorkspaceAlberta 路由器](../../packages/experimental/workspace-router/README.md)参考。[配置目录](../config-catalog.md#workspacealbertawa-experimental-workspace-router)维护 `Config`、`DecisionPolicy` 和操作键；[源声明](../../packages/experimental/workspace-router/src/decision.ts)定义经过验证的调用方状态和 Choice 证据。

## 决策

`WorkspaceDecision` 是可辨识联合类型。接受后的 `recommend` 或 `execute` 包含 `reason: 'accepted'`、操作、配置的确切工具名称，以及经过验证的 JSON 参数。`clarify` 或 `fallback` 包含原因及可选操作，不携带可执行参数。建议和执行共享验证逻辑，只有执行会调用现有工具运行时。

## 持久化证据

```ts type-equiv
/** Secret-free record of one router operation. */
interface WorkspaceRouterEvent {
  /** The enclosing workspace_route call. */
  callId: CallId
  /** Request before inference, decision before dispatch, or settled child result. */
  phase: 'request' | 'decision' | 'result'
  /** Full request and policy, decision and raw answers, or child tool result. */
  value: JsonValue
}
```

[`workspace/route` 事件](../persistence-catalog.md#workspaceroute--log-only)仅写入日志。`request` 包含版本 1、完整的辅助请求体和已解析的策略。`decision` 包含所选分支，以及可用时相关且经过验证的答案、模型和用量。`result` 包含已结束的子工具结果，或明确的结果超限诊断。取消可能仅留下请求记录；建议与回退没有子工具结果记录。同一调用 ID 将这些记录关联并规定顺序，TypeScript 和 Python SDK 的事件集合保留这些记录，不改变最终助手响应。
