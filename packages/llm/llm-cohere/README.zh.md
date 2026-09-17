# @workspacealberta/wa-llm-cohere

[English](README.md) | 中文

面向 harness LLM seam 的 Cohere v2 Chat 适配器：直接 `fetch` + SSE（由 `eventsource-parser` 分帧），把官方 `/v2/chat` 流（`docs.cohere.com/v2/reference/chat-stream`）翻译成 `StreamChunk` 协议。

包根导出 Cordis 插件约定和 `CohereAdapter`；协议序列化、SSE 解析和分片转换辅助函数不属于该根约定。

## 配置

```yaml
- id: llm-cohere
  name: '@workspacealberta/wa-llm-cohere'
  config:
    apiKeyEnv: COHERE_API_KEY  # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.cohere.ai # optional; $COHERE_BASE_URL then the public API when omitted
    thinking: disabled       # optional; omitted ⇒ no thinking parameter on the wire
    maxTokens: 32768         # optional positive per-request output cap; this is the default
    streamIdleTimeoutMs: 300000 # optional; positive finite Node timer delay; five-minute default
    retryPolicy:             # optional; omission uses normal mode with five retries
      mode: always           # normal | always
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
    defaultContextWindow: 256000 # optional positive-integer fallback; this is the default
    models:                  # optional; defaults to Command A+
      - id: command-a-plus-05-2026
        name: Command A+
```

插件注册唯一提供方路由 `cohere-canada` 及其已解析的 `retryPolicy`；省略则解析为普通模式、五次重试。请求用 `provider: cohere-canada` 选中它；`model` 原样作为线上 `model` 字符串。省略 `models` 时公布 `command-a-plus-05-2026`，上下文窗口 256,000 token，输出上限 32,768 token；显式列表替换这些默认，`models: []` 则一条也不公布。目录条目经 `ctx.llm.listModels('cohere-canada')` 暴露，但仍是建议性的：未列出的模型 id 仍原样通过。省略的条目标题默认等于其 id。所有公布模型都只接受文本。

`contextWindow` 可按配置模型省略，且不出现在建议目录里。`ctx.llm.resolveModelInfo('cohere-canada', model).context` 先返回该模型的精确值，条目没有容量或未列出的透传 id 再回退到 `defaultContextWindow`。因此对压力敏感的插件能拿到部署方拥有的容量，而不把模型选择器当成权威。再为 `cohere-canada` 注册另一个适配器会抛出 `LlmError('DUPLICATE_ADAPTER')`。

`maxTokens` 是对话请求的适配器配置输出上限，默认 32,768。目录条目可以自带 `maxTokens`，该模型以它为准；没有该字段的条目和任何未列出的透传 id 都解析为 profile 值。精确模型解析把胜出值暴露为 `defaultMaxTokens`；`LlmRuntime` 在 agent loop 写入 `request/header` 之前把它落到 `GenerateOptions.maxTokens`。显式请求或 `AgentOptions.maxTokens` 胜出，并序列化为 `max_tokens`。省略 `maxTokens` 的直接 `stream()` 调用仍发送 profile 上限。

`thinking: disabled` 是部署锁，只公布 `off` 并以 `off` 为默认，且每条对话请求都序列化 `thinking: {type: disabled}`。`thinking: enabled` 序列化 `thinking: {type: enabled}`，且不公布可选 effort，因为本路由的 Cohere v2 没有 effort 级别。省略 `thinking` 则线上不带该字段。`GenerateOptions.purpose: 'session-title'` 的请求强制关闭 thinking。`GenerateOptions.reasoningEffort` 为 `off` 也会关闭 thinking；任何其他 effort 在网络 I/O 之前以 `UNSUPPORTED_REASONING_EFFORT` 失败。

`streamIdleTimeoutMs` 约束每一次未完成的提供方读取（含最初的 `fetch`），不计算消费方在分片之间花费的时间。Cohere SSE 注释会把未完成读取重新记为传输活动，但绝不会变成 `StreamChunk` 或会话日志事件。一个稳定的 abort 信号覆盖整次调用的请求和 body 读取；超时停止传输并抛出 `LlmError('TIMEOUT')`，更早的调用方中止抛出 `LlmError('ABORTED')`。适配器对每次 `stream()` 只发一次提供方请求；它把配置的策略登记为提供方元数据，由 `dsh-llm-retry` 在持久 agent 步骤边界单独执行。

## 动态配置（settings + credentials）

连接事实不在加载时冻结。`resolveAdapterOptions` 是从原始配置到已验证事实的唯一显式解析步骤，适配器通过 thunk **每次操作读一次**：base URL、目录、请求默认值和空闲预算都在下一次请求生效，而进行中的流继续使用它开始时的事实。两个可选 seam 向该 thunk 供数：

- **`ctx.settings`** — 插件用同一份 `Config` schema 注册 `llm-cohere` namespace，并以 `cordis.yml` 条目为组合 `base`，因此用户设置文档里的 `llm-cohere:` 分节可以覆盖任意字段且无需重启。没有挂载 settings 服务时，仍只由条目配置驱动适配器。通过 schema 但未通过 schema 之外约束（重复目录 id）的实时 settings 快照会保留上一份可用事实并记录失败；条目配置本身仍会让插件加载失败。
- **`ctx.credentials`** — API 密钥按每次 stream 调用解析，来自*同一份*提供端点的已解析快照。配置只携带 `apiKeyEnv`，从不带字面密钥：引用经 credential seam 解析，没有挂载 seam 时经受信任的环境层。每个已解析密钥在使用前都做格式检查，因此 HTTP 头无法携带的值会以 `LlmError('INVALID_CREDENTIAL')` 拒绝，只点名失败的入口、绝不带出密钥的任何部分。任何地方都没有密钥的请求以 `MISSING_CREDENTIAL` 失败并点名每个配置入口，路由仍保持注册、目录仍可浏览。

唯一在注册时捕获的事实是重试策略：其已解析值变化时，插件就地重新注册路由（同一适配器实例、一次同步区段），因此 `ctx.llm.providerRetryPolicy('cohere-canada')` 始终报告当前策略。

插件还会在可配置提供方目录（`ctx.llm.listConfigurableProviders()`）中声明自己的路由：提供方为 `cohere-canada`，settings namespace 为 `llm-cohere`，settings path 为空——整个分节就是 profile。

## 应用归属

每个请求都携带 dsh-llm `attributionHeaders()` 的共享归属头，以及 Cohere 可选的 `X-Client-Name: workspacealberta-harness`。凭证解析之后，每个提供方请求都携带 `x-workspacealberta-user-id`，值为 [`@workspacealberta/wa-anonymous-user-id`](../../identity/anonymous-user-id/README.md) 的稳定匿名 id；携带 `GenerateOptions.sessionId` 的请求还会把该精确值作为 `x-workspacealberta-session-id` 发送。`GenerateOptions.purpose` 为 `compaction` 的请求额外携带 `x-workspacealberta-compact: 1`。带凭证的请求设置 `redirect: 'error'`，因此 3xx 不能转发 bearer token。

## 线上格式说明

- 只走流式（`POST {baseURL}/v2/chat`）。转换器在 `message-end` 上先刷 `usage` 再刷 `finish`；citation 和 debug 事件被忽略。
- 工具 schema 序列化为带 `strict_tools: true` 的 v2 `function` 工具。Command A+ 拒绝 `tool_choice`。
- `GenerateOptions.stop` 序列化为 `stop_sequences`。
- 没有工具调用的助手推理按 thinking 内容块回放；带工具调用的推理按 `tool_plan` 回放。流式 `thinking` 内容和 `tool-plan-delta` 事件都变成 harness 推理块。
- tool 角色内容是字符串；空工具输出在线上变成字面量 `(no output)`。
- 缓存计量：`cacheReadTokens` ← `tokens.cached_tokens`；存在时从 `inputTokens` 减去该计数。仅在没有 `tokens` 时使用 `billed_units`。

## 错误

非 2xx 响应抛出带稳定码的 `LlmError`：`AUTH`（401/403）、`QUOTA`（提供方细节标明额度、余额或积分耗尽）、`RATE_LIMIT`（其他 429）、`CONTEXT_WINDOW_EXCEEDED`（400 且提供方消息标明上下文溢出）、`INVALID_REQUEST`（其他 400 和 413）、`SERVER`（5xx），其余为 `HTTP_<status>`。可序列化的 `failure` 保留 HTTP 状态，以及有效的正数 `Retry-After` 秒数/日期延迟和存在时的 `x-request-id` / `x-trace-id`。响应前的传输失败（DNS、拒绝连接、TLS、代理、拒绝重定向）抛出 `TRANSPORT`，点名已配置端点并把原始拒绝链为 `cause`；调用方中止抛出 `ABORTED`。协议违规抛出 `STREAM_CLOSED`（没有 `message-end`）或 `MALFORMED_RESPONSE`（坏 JSON 载荷）。未知线上 `finish_reason` 变成 `finish {kind: 'error', failure}` 分片；`COMPLETE`（或缺失）结束且未打开任何内容块的已完成流变成码为 `EMPTY_RESPONSE` 的 `finish {kind: 'error'}`。

## Model Experience

### Cohere v2 Chat 请求

#### 模型看到什么

所选 Cohere 模型收到 harness 系统提示、消息历史、工具 schema、停止序列和调用配置，没有适配器撰写的提示散文。上一轮助手推理按上文所述作为 thinking 内容或 `tool_plan` 回传。

#### Token 效果

精确文本输入由提供方分词决定。推理回传把每个带推理轮次的文本带入后续请求；可用时报告缓存读取用量。

#### KV Cache 效果

未改动的已组装前缀有资格被 Cohere 缓存复用，当存在 `cached_tokens` 时本适配器在用量中报告。模型路由变化或任何上游提示、schema、前缀或历史变化都可能从第一个改动 token 起阻止复用；推理回传在每个带推理轮次追加。

### Cohere v2 Chat 响应

#### 模型看到什么

thinking、tool-plan、文本和原始字符串工具参数被翻译成 harness 分片，供循环记录和组装。引用被丢弃。

#### Token 效果

生成 token 遵循请求已记录的 `maxTokens`；只有循环保留的块影响后续输入。

#### KV Cache 效果

循环保留的响应块追加到下一次请求，并保持其更早的可复用前缀；丢弃的块没有后续缓存效果。更换提供方或模型会选择不同的缓存域。

## 已知限制与延后工作

- **settings 的 `models` 列表整表替换组合列表** — settings 层按字段合并，数组是一个字段；按条目合并目录需要带键的形状。
- **不支持图像** — Command A+ 只接受文本；视觉模型和 Files API 延后。
- **未映射 `tool_choice`** — 本部署的 Command A+ 路由拒绝它；是否调用工具由模型自行选择。
- **引用不属于 harness 流词汇** — citation 事件被忽略而不存储。
- **请求使用原始 `fetch`，而不是 `@cordisjs/plugin-http`** — 没有共享的代理/拦截配置；等到第二个适配器也需要时再采纳（`TODO(http)`）。
- **插件新增的内容块类型会被跳过** — 只序列化核心文本，空工具输出在线上变成字面量 `(no output)`。
