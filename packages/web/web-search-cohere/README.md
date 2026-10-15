---
description: "Cohere v2 tool-driven web search for the harness web service."
kind: "package-reference"
---

# @workspacealberta/web-search-cohere

English | [中文](README.zh.md)

## Summary

Cohere-backed search provider for the [web capability seam](../web/README.md) (`ctx.web`), speaking Cohere's v2 Chat **tool-use format** end to end. Cohere v2 ships no hosted search endpoint — [their migration guide](https://docs.cohere.com/docs/migrating-v1-to-v2) prescribes web search through a user-defined tool — so this provider runs exactly that recipe: the model is offered a client-side `web_search` function tool, executes each planned call against anonymous DuckDuckGo HTML acquisition, receives the acquired sources back as `document` tool-result blocks, and its final message carries the answer plus citations the provider maps onto citeable sources. No Anthropic and no DeepSeek traffic exists anywhere in the path.

## Table of Contents

- [Wire flow](#wire-flow)
- [Configuration](#configuration)
- [Errors and cancellation](#errors-and-cancellation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Wire flow

1. `POST {baseURL}/v2/chat` with `tools: [{ type: 'function', function: { name: 'web_search', … } }]`, and `strict_tools: true`, constraining any generated call to the simple search schema. `tool_choice` is omitted because this deployment's model rejects it.
2. If the model answers directly (no `tool_calls`), the provider degrades to direct DuckDuckGo acquisition of the original query and returns snippets as sources with **no** answer — ungrounded prose is never passed off as a search answer.
3. Otherwise each `web_search` call (capped at `maxAcquisitions`) is executed against `https://html.duckduckgo.com/html/?q=…` (anonymous; no credential is ever sent there), and the results return as `{ role: 'tool', tool_call_id, content: [{ type: 'document', document: { data, id } }] }` with `id = <tool_call_id>:<index>`.
4. A final `POST /v2/chat` over the full history — `tools` still present (v2 rejects calls for unoffered tools as "hallucinated") with no forced `tool_choice` — maps the response onto cited synthesis. Further planned calls are not executed; the single acquisition round is the budget. `citations[].sources[].id` values order the returned sources, uncited acquisitions follow, and the prose becomes the result's optional answer content.

Every synthesis dispatch is recorded secret-free to the Session log as `web/cohere-search-llm-request` before it leaves the process; a throwing recorder prevents dispatch.

## Configuration

| key | default | meaning |
|---|---|---|
| `apiKey` | — | Literal Cohere API key; prefer `apiKeyEnv`. |
| `apiKeyEnv` | `COHERE_API_KEY` | Credential reference resolved per search. |
| `baseURL` | `https://api.cohere.ai` (env `COHERE_BASE_URL`) | v2 endpoint base; `/v2/chat` is appended. |
| `model` | `command-a-plus-05-2026` | v2 model name. |
| `maxTokens` | `1024` | Generated-token bound per synthesis call. |
| `maxAcquisitions` | `2` | `web_search` tool calls executed per search. |
| `acquireMaxResults` | `6` | DuckDuckGo results acquired per query. |

```yaml
- id: web-search-cohere
  name: '@workspacealberta/web-search-cohere'
  config:
    apiKeyEnv: COHERE_API_KEY
```

## Errors and cancellation

Failures throw `WebError` with the seam's shared codes: `WEB_PROVIDER_ERROR` (transport, HTTP, body, or acquisition failure), `WEB_PROVIDER_CREDENTIAL_MISSING` (no resolvable key), `WEB_ABORTED` (caller cancellation, including mid-body). The provider registers under the stable id `cohere`; point the seam at it with `searchProvider: cohere`.

## Dev Note

See the [web subsystem](../../../docs/subsystems/web.md) for provider composition and [provider implementation](src/provider.ts) for citation mapping.

## Model Experience

### Local web-search-cohere state

#### What the model sees

Nothing beyond the seam's own `web_search` tool contract. This package registers a provider, not a tool; names, schemas, and prompt guidance remain `dsh-tool-web`'s.

#### Token effect

The auxiliary Cohere requests are separate from the lead model conversation. Only the normalized `WebSearchResult` joins the lead model history through the tool result.

#### KV Cache effect

Independent. Search never touches a model request prefix.

## Known Limitations and Deferred Work

- Acquisition depends on anonymous DuckDuckGo HTML access. Model citations identify acquired sources; they do not independently verify the answer. This is not a hosted Cohere search service.
