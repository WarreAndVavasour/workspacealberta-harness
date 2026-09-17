# @workspacealberta/wa-llm-cohere

English | [中文](README.zh.md)

Cohere v2 Chat adapter for the harness LLM seam: direct `fetch` + SSE (framed by `eventsource-parser`) translating the official `/v2/chat` stream (`docs.cohere.com/v2/reference/chat-stream`) into the `StreamChunk` protocol.

The package root exposes the Cordis plugin contract and `CohereAdapter`; wire serialization, SSE parsing, and chunk translation helpers are not part of that root contract.

## Config

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

The plugin registers the single provider route `cohere-canada` together with its resolved `retryPolicy`; omission resolves to normal mode with five retries. A request selects it with `provider: cohere-canada`; its `model` is passed through as the wire `model` string. Omitting `models` advertises `command-a-plus-05-2026` with a 256,000-token context window and a 32,768-token output cap; an explicit list replaces those defaults, while `models: []` advertises none. Catalog entries are exposed through `ctx.llm.listModels('cohere-canada')` but remain advisory: unlisted model ids still pass through unchanged. An omitted entry name defaults to its id. Every advertised model is text-only.

`contextWindow` is optional per configured model and is not exposed through the advisory catalog. `ctx.llm.resolveModelInfo('cohere-canada', model).context` returns an exact model value first, then `defaultContextWindow` for an entry without capacity or an unlisted pass-through id. Pressure-sensitive plugins therefore get deployment-owned capacity without treating the model selector as authoritative. Registering another adapter for `cohere-canada` throws `LlmError('DUPLICATE_ADAPTER')`.

`maxTokens` is the adapter-configured output cap for conversation requests and defaults to 32,768. A catalog entry may carry its own `maxTokens`, which wins for that model; an entry without one, and any unlisted pass-through id, resolve to the profile value. Exact-model resolution exposes the winner as `defaultMaxTokens`; `LlmRuntime` materializes that value into `GenerateOptions.maxTokens` before the agent loop writes `request/header`. An explicit request or `AgentOptions.maxTokens` value wins and is serialized as `max_tokens`. Direct `stream()` calls that omit `maxTokens` still send the profile cap.

`thinking: disabled` is a deployment lock that publishes only `off` with `off` as its default and serializes `thinking: {type: disabled}` on every conversation request. `thinking: enabled` serializes `thinking: {type: enabled}` and does not advertise selectable efforts, because Cohere v2 has no effort levels on this route. Omitting `thinking` puts nothing on the wire. A request with `GenerateOptions.purpose: 'session-title'` forces thinking disabled. `GenerateOptions.reasoningEffort` of `off` also disables thinking; any other effort fails with `UNSUPPORTED_REASONING_EFFORT` before network I/O.

`streamIdleTimeoutMs` bounds each outstanding provider read, including the initial `fetch`, without counting time the consumer spends between chunks. Cohere SSE comments rearm an outstanding read as transport activity but never become `StreamChunk` values or session-log events. One stable abort signal reaches the request and body reader for the whole call; expiry stops the transport and throws `LlmError('TIMEOUT')`, while an earlier caller abort throws `LlmError('ABORTED')`. The adapter makes exactly one provider request per `stream()` call; it registers the configured policy as provider metadata, and `dsh-llm-retry` separately executes it at durable agent-step boundaries.

## Dynamic configuration (settings + credentials)

Connection facts are not frozen at load. `resolveAdapterOptions` is the one explicit resolve step from raw config to validated facts, and the adapter re-reads them through a thunk **once per operation**: base URL, catalog, request defaults, and idle budget all take effect on the next request, while an in-flight stream keeps the facts it started with. Two optional seams feed that thunk:

- **`ctx.settings`** — the plugin registers the `llm-cohere` namespace with this same `Config` schema and its `cordis.yml` entry as the composition `base`, so a `llm-cohere:` section in the user settings document overrides any field without a restart. Without a mounted settings service the entry config alone drives the adapter, unchanged. A live settings snapshot that passes the schema but fails a beyond-schema bound (a duplicate catalog id) keeps the last good facts and logs the failure; the entry config itself still fails plugin load.
- **`ctx.credentials`** — the API key resolves per stream call, from the *same* resolved snapshot that supplies the endpoint. Configuration carries only `apiKeyEnv`, never a literal key: the reference resolves through the credential seam, and without a mounted seam through the trusted environment layers. Every resolved key is format-checked before use, so a value no HTTP header can carry is refused with `LlmError('INVALID_CREDENTIAL')` naming the failing entry point — never any part of the key. A request with no key anywhere fails with `MISSING_CREDENTIAL` naming every configuration entry point, while the route stays registered and the catalog stays browsable.

The one registration-captured fact is the retry policy: when its resolved value changes, the plugin re-registers the route in place (same adapter instance, one synchronous section), so `ctx.llm.providerRetryPolicy('cohere-canada')` always reports the current policy.

The plugin also declares its route in the configurable-provider directory (`ctx.llm.listConfigurableProviders()`): provider `cohere-canada`, settings namespace `llm-cohere`, empty settings path — the whole section is the profile.

## App attribution

Every request carries the shared attribution header from dsh-llm's `attributionHeaders()` and Cohere's optional `X-Client-Name: workspacealberta-harness`. After credential resolution, every provider request carries `x-workspacealberta-user-id` with the stable anonymous id from [`@workspacealberta/wa-anonymous-user-id`](../../identity/anonymous-user-id/README.md); a request carrying `GenerateOptions.sessionId` also sends that exact value as `x-workspacealberta-session-id`. A request whose `GenerateOptions.purpose` is `compaction` additionally carries `x-workspacealberta-compact: 1`. Credential-bearing requests set `redirect: 'error'` so a 3xx cannot forward the bearer token.

## Wire-format notes

- Streaming only (`POST {baseURL}/v2/chat`). The translator flushes `usage` then `finish` on `message-end`; citation and debug events are ignored.
- Tool schemas serialize as v2 `function` tools with `strict_tools: true`. Command A+ rejects `tool_choice`.
- `GenerateOptions.stop` serializes as `stop_sequences`.
- Assistant reasoning without tool calls is replayed as thinking content blocks; reasoning on a tool-call turn is replayed as `tool_plan`. Streamed `thinking` content and `tool-plan-delta` events both become harness reasoning blocks.
- Tool-role content is a string; empty tool output crosses the wire as the literal `(no output)`.
- Cache accounting: `cacheReadTokens` ← `tokens.cached_tokens`; `inputTokens` subtracts that count when present. `billed_units` is used only when `tokens` is absent.

## Errors

Non-2xx responses throw `LlmError` with stable codes: `AUTH` (401/403), `QUOTA` (a response whose provider details identify exhausted quota, balance, or credits), `RATE_LIMIT` (other 429s), `CONTEXT_WINDOW_EXCEEDED` (a 400 whose provider message identifies context overflow), `INVALID_REQUEST` (other 400s and 413), `SERVER` (5xx), `HTTP_<status>` otherwise. Its serializable `failure` retains the HTTP status plus a valid positive `Retry-After` seconds/date delay and `x-request-id` / `x-trace-id` when present. A pre-response transport failure (DNS, refused connection, TLS, proxy, refused redirect) throws `TRANSPORT` naming the configured endpoint and chaining the original rejection as `cause`; caller aborts throw `ABORTED`. Protocol violations throw `STREAM_CLOSED` (no `message-end`) or `MALFORMED_RESPONSE` (bad JSON payload). Unknown wire `finish_reason`s become `finish {kind: 'error', failure}` chunks, and a completed stream whose `COMPLETE` (or absent) finish opened no content blocks becomes a `finish {kind: 'error'}` with code `EMPTY_RESPONSE`.

## Model Experience

### Cohere v2 Chat request

#### What the model sees

The selected Cohere model receives the harness system prompt, message history, tool schemas, stop sequences, and call config without adapter-authored prompt prose. Reasoning from a prior assistant turn is passed back as thinking content or `tool_plan` as documented above.

#### Token effect

Provider tokenization governs exact text input. Reasoning passback carries every reasoned turn's text into later requests; cache-read usage is reported when available.

#### KV Cache effect

An unchanged assembled prefix is eligible for Cohere cache reuse, which this adapter reports in usage when `cached_tokens` is present. A model-route change or any upstream prompt, schema, prefix, or history change may prevent reuse from the first changed token; reasoning passback appends on every reasoned turn.

### Cohere v2 Chat response

#### What the model sees

Thinking, tool-plan, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble. Citations are dropped.

#### Token effect

Generated tokens follow the request's logged `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field; per-entry catalog merging would need a keyed shape.
- **Images are not supported** — Command A+ is text-only; vision models and the Files API are deferred.
- **`tool_choice` is not mapped** — this deployment's Command A+ route rejects it; acquisition relies on the model choosing a tool.
- **Citations are not part of the harness stream vocabulary** — citation events are ignored rather than stored.
- **Requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy/interception configuration; adoption is deferred until a second adapter wants it (`TODO(http)`).
- **Plugin-added content block types are skipped** — core text is serialized, and empty tool output crosses the wire as the literal `(no output)`.
