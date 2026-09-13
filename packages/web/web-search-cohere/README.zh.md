# @workspacealberta/web-search-cohere

[English](README.md) | 中文

为 [web 能力 seam](../web/README.md)（`ctx.web`）提供的 Cohere 搜索提供方，端到端使用 Cohere v2 Chat 的 **tool-use 格式**。Cohere v2 没有托管搜索端点 — [其迁移指南](https://docs.cohere.com/docs/migrating-v1-to-v2) 规定网页搜索通过用户定义的工具完成 — 因此本提供方按该配方执行：向模型提供客户端 `web_search` function 工具，把每次计划中的调用打到匿名 DuckDuckGo HTML 采集，再以 `document` 工具结果块回传已采集来源，最终消息携带答案以及提供方映射到可引用源的 citations。整条路径上不存在 Anthropic 或 DeepSeek 流量。

## Wire flow

1. `POST {baseURL}/v2/chat`，带 `tools: [{ type: 'function', function: { name: 'web_search', … } }]`、`tool_choice: 'REQUIRED'` 和 `strict_tools: true`，使服务器约束的采集轮次始终产生一次 schema 合法的调用。
2. 若模型直接作答（没有 `tool_calls`），提供方退化为对原始查询做直接 DuckDuckGo 采集，并以片段作为来源返回且**没有**答案 — 无依据的散文绝不会被当成搜索答案。
3. 否则每个 `web_search` 调用（上限为 `maxAcquisitions`）针对 `https://html.duckduckgo.com/html/?q=…` 执行（匿名；从不向该处发送凭证），结果以 `{ role: 'tool', tool_call_id, content: [{ type: 'document', document: { data, id } }] }` 返回，其中 `id = <tool_call_id>:<index>`。
4. 在完整历史上再发一次最终 `POST /v2/chat` — `tools` 仍在（v2 会把未提供的工具调用视为 "hallucinated" 而拒绝）但 `tool_choice: 'NONE'` 强制直接作答 — 得到带引用的综合；`citations[].sources[].id` 决定返回来源的顺序，未引用的采集跟在后面，散文成为结果中可选的答案内容。

每次综合调度在离开进程之前都以无密钥方式记入 Session 日志，事件为 `web/cohere-search-llm-request`；会抛错的记录器会阻止调度。

## Configuration

| key | default | meaning |
|---|---|---|
| `apiKey` | — | 字面 Cohere API 密钥；请优先使用 `apiKeyEnv`。 |
| `apiKeyEnv` | `COHERE_API_KEY` | 每次搜索解析的凭证引用。 |
| `baseURL` | `https://api.cohere.ai`（环境变量 `COHERE_BASE_URL`） | v2 端点基地址；会追加 `/v2/chat`。 |
| `model` | `command-a-plus-05-2026` | v2 模型名。 |
| `maxTokens` | `1024` | 每次综合调用的生成 token 上限。 |
| `maxAcquisitions` | `2` | 每次搜索执行的 `web_search` 工具调用数。 |
| `acquireMaxResults` | `6` | 每个查询从 DuckDuckGo 采集的结果数。 |

```yaml
- id: web-search-cohere
  name: '@workspacealberta/web-search-cohere'
  config:
    apiKeyEnv: COHERE_API_KEY
```

## Errors and cancellation

失败时抛出 `WebError`，使用 seam 的共享错误码：`WEB_PROVIDER_ERROR`（传输、HTTP、响应体或采集失败）、`WEB_PROVIDER_CREDENTIAL_MISSING`（无法解析密钥）、`WEB_ABORTED`（调用方取消，包括读到一半的响应体）。提供方以稳定 id `cohere` 注册；用 `searchProvider: cohere` 把 seam 指过来。

## Model Experience

### Local web-search-cohere state

#### What the model sees

除 seam 自身的 `web_search` 工具约定外，模型看不到别的。本包注册的是提供方，不是工具；名称、schema 与提示词指引仍归 `dsh-tool-web`。

#### Token effect

辅助综合调用是提供方私有的，从不进入模型请求。只有规范化的 `WebSearchResult` 会经工具结果到达模型。

#### KV Cache effect

独立。搜索从不触碰模型请求前缀。
