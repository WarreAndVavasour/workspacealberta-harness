# Agent Note: Cohere Chat API v2 是 llm-pi-ai 的第一方协议

Status: implemented

[English](2026-09-17-cohere-v2-chat-protocol.md) | 中文

## 问题

workspaceAlberta 桌面需要 Command A+ 在 Cohere 原生 Chat API v2 上做 tool-calling（`POST https://api.cohere.com/v2/chat`，`tools`、`tool_plan`、`tool_calls`、`strict_tools`）。`dsh-llm-pi-ai` 当时可配置的协议只有 pi-ai 的 OpenAI 兼容与 Anthropic factory，因此桌面只能对 `https://api.cohere.ai/compatibility/v1` 说 `openai-completions`。那条 shim 不是 Christian 要求的 agent API；再做一个 `@workspacealberta/llm-cohere` 包则会复制桌面已经在用的适配器、settings 与凭据路径。

搜索必须留在 Exa。把 Cohere 搜索挂到与模型循环相同的密钥上，会把桌面已经离开的每分钟争用重新引进来。

## 决策

`cohere-v2-chat` 是 `dsh-llm-pi-ai` 的 `supportedProtocols()` 表中的具名条目。手工声明的路由设置 `api: cohere-v2-chat` 与前缀 `baseURL`；协议把 `{baseURL}/chat` 按路径前缀拼接，因此 `https://api.cohere.com/v2` 仍是 `/v2/chat`，而不是把 `chat` 相对 `/v2` 解析从而丢掉版本段。认证是路由已经解析好的凭据填入 `Authorization: Bearer`（桌面上为 `COHERE_API_KEY`）。

请求映射：system prompt → `role: system`；用户文本与图片 → `role: user`（图片为 `image_url` data URL）；assistant 文本／思考 → 内容部分，但 tool-calling 轮次把思考写成 `tool_plan`；harness 工具结果 → 带 `tool_call_id` 的 `role: tool`。非空 `tools` 列表同时发送 `strict_tools: true`。采样复制 `temperature`／`max_tokens`；`reasoning: off` 发送 `thinking: {type: disabled}`，任何其他具名档位发送 `{type: enabled}`，省略则保留 Cohere 的模型默认。

流映射：Cohere SSE（`message-start`、`content-*`、`tool-plan-delta`、`tool-call-*`、`message-end`）变成 pi-ai `AssistantMessageEvent`，由现有 harness 转换组装。`tool_plan` 是思考。结束原因 `COMPLETE`／`STOP_SEQUENCE` → `stop`，`MAX_TOKENS` → `length`，`TOOL_CALL` → `toolUse`，`TIMEOUT`／`ERROR` → `error`。Citation SSE 被消费以保持分帧，不会变成内容块。

`workspace-alberta.patch.yml` 选用该协议，`baseURL: https://api.cohere.com/v2`，保持 `searchProvider: exa`，并插入 `@workspacealberta/wa-web-search-exa`。base bundle 列出该包，以便 `--patch` 解析能加载该行。桌面身份仍是 `@workspacealberta`；不增加 `@deepseek-ai` 产品外观。

## 备选方案

**新建 `@workspacealberta/llm-cohere` 包。** 否决：桌面已经为 Cohere 路由挂载 `llm-pi-ai`。第二个适配器族会拆开 settings、凭据与协议选择，而用户可见需求只是在现有插件上写 `api: cohere-v2-chat`。

**继续对 `https://api.cohere.ai/compatibility/v1` 使用 `openai-completions`。** 否决：那是 OpenAI 兼容 shim。Command A+ 的 agent 轮次需要 `/v2/chat` 上的原生 `tools`／`tool_plan`／`tool_calls`／`strict_tools`。

**用 URL 解析把 `chat` 接到配置的 base。** 否决：`new URL('chat', 'https://api.cohere.com/v2')` 会变成 `https://api.cohere.com/chat` 并丢掉 `/v2`。

**把 Cohere 注册为同一密钥上的 `searchProvider`。** 否决：搜索留在 Exa；模型密钥不是搜索密钥。

## 后果

任何 `llm-pi-ai` profile 都可以点名 `cohere-v2-chat`。Models 页的协议列表会多出该 id，因为它从同一份 `Config` schema 读取 `supportedProtocols()`。端点询问对该协议仍返回 `DISCOVERY_UNSUPPORTED`。引用文本不会被重建进 assistant 内容。桌面默认模型路由不再使用 `compatibility/v1`；运维需要 `COHERE_API_KEY` 与 `EXA_API_KEY`。

## 测试

`packages/llm/llm-pi-ai/tests/cohere-v2-chat.spec.ts` 覆盖协议选择、前缀 URL 拼接、请求序列化（system、tools、`strict_tools`、思考、图片、空工具结果）、SSE 分帧、文本／思考／工具／citation／结束原因映射、HTTP 与传输错误，以及针对接收 `POST /v2/chat` 的本地 mock 的 harness assemble tool-call 加 tool-result 往返。`tests/discovery.spec.ts` 钉住 `cohere-v2-chat` 的 `DISCOVERY_UNSUPPORTED`。不新增 ACP 或 headless snapshot：该协议由配置选择，不改变已发布 example 的文本记录；Models 页协议下拉框 snapshot 会更新，因为 schema 联合变大了。
