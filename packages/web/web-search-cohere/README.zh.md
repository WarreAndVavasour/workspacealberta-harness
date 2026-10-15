---
description: "为 harness 网页服务提供基于 Cohere v2 工具的网页搜索。"
kind: "package-reference"
---

# @workspacealberta/web-search-cohere

[English](README.md) | 中文

## 概述

基于 Cohere 的[网页能力接口](../web/README.zh.md)（`ctx.web`）搜索提供者，端到端使用 Cohere v2 Chat **工具调用格式**。Cohere v2 不提供托管搜索端点；其[迁移指南](https://docs.cohere.com/docs/migrating-v1-to-v2) 要求通过用户定义工具实现网页搜索。本提供者按此方式运行：模型获得客户端 `web_search` 函数工具，每个规划调用通过匿名 DuckDuckGo HTML 获取执行，来源作为 `document` 工具结果返回；最终消息中的回答与引用映射为可引用来源。此路径不向 Anthropic 或 DeepSeek 发送流量。

## 目录

- [调用流程](#wire-flow)
- [配置](#configuration)
- [错误与取消](#errors-and-cancellation)
- [开发说明](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="wire-flow"></a>
## 调用流程

1. 向 `{baseURL}/v2/chat` 发送 `POST`，包含 `tools: [{ type: 'function', function: { name: 'web_search', … } }]`及 `strict_tools: true`，约束所生成调用符合简单搜索结构。部署模型拒绝 `tool_choice`，因此省略该参数。
2. 若模型直接回答且没有 `tool_calls`，提供者降级为对原查询直接获取 DuckDuckGo 结果，仅返回来源摘要，**不含**回答；无依据文本不作为搜索回答输出。
3. 每个 `web_search` 调用（受 `maxAcquisitions` 限制）向 `https://html.duckduckgo.com/html/?q=…` 执行查询，不发送凭据。结果以 `{ role: 'tool', tool_call_id, content: [{ type: 'document', document: { data, id } }] }` 返回，其中 `id = <tool_call_id>:<index>`。
4. 最后对完整历史再次 `POST /v2/chat`；仍提供 `tools`（v2 拒绝未提供工具的调用），不强制 `tool_choice`，将响应映射为带引用的综合结果。不再执行后续规划调用；预算仅允许一轮获取。`citations[].sources[].id` 决定来源顺序，未引用来源随后列出，文本成为结果的可选回答。

每次综合请求在发送前以不含密钥的 `web/cohere-search-llm-request` 事件写入会话日志；记录器抛错会阻止发送。

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | — | Cohere API 密钥字面值；推荐使用 `apiKeyEnv`。 |
| `apiKeyEnv` | `COHERE_API_KEY` | 每次搜索解析的凭据引用。 |
| `baseURL` | `https://api.cohere.ai`（环境变量 `COHERE_BASE_URL`） | v2 端点根地址；附加 `/v2/chat`。 |
| `model` | `command-a-plus-05-2026` | v2 模型名称。 |
| `maxTokens` | `1024` | 每次综合调用的生成 token 上限。 |
| `maxAcquisitions` | `2` | 每次搜索执行的 `web_search` 调用数。 |
| `acquireMaxResults` | `6` | 每次查询获取的 DuckDuckGo 结果数。 |

```yaml
- id: web-search-cohere
  name: '@workspacealberta/web-search-cohere'
  config:
    apiKeyEnv: COHERE_API_KEY
```

<a id="errors-and-cancellation"></a>
## 错误与取消

失败抛出共享错误码的 `WebError`：`WEB_PROVIDER_ERROR`（传输、HTTP、正文或获取失败）、`WEB_PROVIDER_CREDENTIAL_MISSING`（无法解析密钥）、`WEB_ABORTED`（调用方取消，包括读取正文期间）。提供者以固定标识 `cohere` 注册；使用 `searchProvider: cohere` 选择它。

<a id="dev-note"></a>
## 开发说明

提供者组合见[网页子系统](../../../docs/subsystems/web.zh.md)，引用映射见[提供者实现](src/provider.ts)。

<a id="model-experience"></a>
## 模型体验

### 本地 web-search-cohere 状态

#### 模型看到什么

除接口已有的 `web_search` 工具约定外没有新增内容。本包注册提供者，不注册工具；名称、结构与提示指导仍由 `dsh-tool-web` 定义。

#### Token 影响

辅助 Cohere 请求独立于主模型对话。只有归一化的 `WebSearchResult` 通过工具结果进入主模型历史。

#### KV Cache 影响

相互独立。搜索不改动模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 获取依赖匿名 DuckDuckGo HTML 访问。模型引用标识已获取来源，不会独立核验回答。这不是 Cohere 托管搜索服务。
