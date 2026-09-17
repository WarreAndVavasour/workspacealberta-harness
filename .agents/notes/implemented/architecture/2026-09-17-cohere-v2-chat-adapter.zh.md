# Agent Note: Native Cohere v2 Chat adapter

Status: implemented

[English](2026-09-17-cohere-v2-chat-adapter.md) | 中文

## Problem

Workspace Alberta 的默认模型路由是 Cohere Command A+，但 agent loop 是经 pi-ai 的 OpenAI 兼容 Chat Completions 路径（`https://api.cohere.ai/compatibility/v1`）到达它的。那条路径是 Cohere v2 Chat 的有损翻译：工具调用规划、`tool_plan`、thinking 内容、`strict_tools` 和 `message-end` 用量都无法作为一等线上事实保留。现有 [`web-search-cohere`](../../../../packages/web/web-search-cohere/README.md) 提供方已经为搜索综合使用原生 `/v2/chat`，且必须离开 `ctx.llm`；对话循环没有对应的适配器。

## Decision

`@workspacealberta/wa-llm-cohere` 是与 [`llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) 同一 seam 上的一等 `LlmAdapter`。它拥有唯一路由 `cohere-canada`，对流式 `POST {baseURL}/v2/chat` 发请求，并把 Cohere SSE 事件翻译成 harness `StreamChunk` 协议。Workspace Alberta 补丁清空 pi-ai 的 `cohere-canada` profile，使原生适配器成为该路由的唯一所有者；`agent-default-model` 仍保持 `provider: cohere-canada` 和 `model: command-a-plus-05-2026`。

适配器只接受文本。工具 schema 序列化为带 `strict_tools: true`、不带 `tool_choice` 的 v2 function 工具，与搜索提供方对 Command A+ 的约束一致。没有工具调用的助手推理按 thinking 内容块回放；带工具调用的推理按 `tool_plan` 回放。流式 thinking 内容和 `tool-plan-delta` 事件都变成 harness 推理块。citation 事件被忽略。settings 与 credentials 按与 DeepSeek 适配器相同的方式按请求解析。

本适配器不取代[孪生适配器](2026-06-13-twin-llm-adapters.md)。DeepSeek 与 pi-ai 仍是中立性成对实现；Cohere 是面向加拿大默认路由的第三个一等协议实现。

## Alternatives considered

**继续经 pi-ai 使用 OpenAI 兼容网关。** 它已经能启动，也不需要新包，但 Command A+ 的工具使用和 thinking/tool-plan 回传是原生 v2 事实。兼容路径无法重建它们，搜索提供方也因此拒绝了那条路径。

**给 pi-ai 增加 Cohere 协议。** pi-ai 是外部库。一等的 fetch-and-translate 适配器把 Cohere 线上类型、SSE 事件和错误映射留在本仓库，紧挨 cookbook 指定为参考的 DeepSeek 布局。

**与 web-search-cohere 共享客户端。** 搜索提供方的循环是非流式的，记录私有的 `web/cohere-search-llm-request` 事件，且不得依赖 `ctx.llm`。把它折进适配器会把辅助搜索综合调用耦合到对话 seam。

## Consequences

`cohere-canada` 路由不能由两个适配器同时拥有。Workspace Alberta 补丁必须让 pi-ai 休眠（空的 `providers`），否则组合会以 `DUPLICATE_ADAPTER` 失败。已经记录 `provider: cohere-canada` 的现有会话保留该 id；改变的只是它背后的线上协议。图像、`tool_choice` 和 citation 存储仍不在范围内。真实 Command A+ 行为仍需要 `COHERE_API_KEY`；单元测试对着本地 `/v2/chat` 模拟说话。
