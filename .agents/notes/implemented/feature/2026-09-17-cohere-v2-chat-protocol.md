# Agent Note: Cohere Chat API v2 is a first-party llm-pi-ai protocol

Status: implemented

English | [中文](2026-09-17-cohere-v2-chat-protocol.zh.md)

## Problem

The workspaceAlberta desk needed Command A+ tool-calling on Cohere's native Chat API v2 (`POST https://api.cohere.com/v2/chat`, `tools`, `tool_plan`, `tool_calls`, `strict_tools`). The only configurable wire on `dsh-llm-pi-ai` was pi-ai's OpenAI-compatible and Anthropic factories, so the desk had to speak `openai-completions` against `https://api.cohere.ai/compatibility/v1`. That shim is not the agent API Christian asked for, and a new `@workspacealberta/llm-cohere` package would have duplicated the adapter, settings, and credential path the desk already uses.

Search must stay on Exa. Putting Cohere search on the same key as the model loop reintroduces per-minute contention the desk already left.

## Decision

`cohere-v2-chat` is a named entry in `dsh-llm-pi-ai`'s `supportedProtocols()` table. A hand-declared route sets `api: cohere-v2-chat` and a prefix `baseURL`; the protocol joins `{baseURL}/chat` as a path prefix so `https://api.cohere.com/v2` stays `/v2/chat` instead of resolving `chat` against `/v2` and dropping the version segment. Auth is `Authorization: Bearer` from the route's already-resolved credential (`COHERE_API_KEY` on the desk).

Request mapping: system prompt → `role: system`; user text and images → `role: user` (images as `image_url` data URLs); assistant text/thinking → content parts, except a tool-calling turn sends thinking as `tool_plan`; harness tool results → `role: tool` with `tool_call_id`. A non-empty `tools` list also sends `strict_tools: true`. Sampling copies `temperature` / `max_tokens`; `reasoning: off` sends `thinking: {type: disabled}`, any other named level sends `{type: enabled}`, and omission leaves Cohere's model default.

Stream mapping: Cohere SSE (`message-start`, `content-*`, `tool-plan-delta`, `tool-call-*`, `message-end`) becomes pi-ai `AssistantMessageEvent`s so the existing harness conversion assembles them. `tool_plan` is thinking. Finish `COMPLETE` / `STOP_SEQUENCE` → `stop`, `MAX_TOKENS` → `length`, `TOOL_CALL` → `toolUse`, `TIMEOUT` / `ERROR` → `error`. Citation SSE is consumed so framing stays intact and is not turned into content blocks.

`workspace-alberta.patch.yml` selects this protocol with `baseURL: https://api.cohere.com/v2`, keeps `searchProvider: exa`, and inserts `@workspacealberta/wa-web-search-exa`. The base bundle lists that package so `--patch` resolution can load the row. The desk identity stays `@workspacealberta`; no `@deepseek-ai` product chrome is added.

## Alternatives considered

**A new `@workspacealberta/llm-cohere` package.** Rejected: the desk already mounts `llm-pi-ai` for the Cohere route. A second adapter family would split settings, credentials, and protocol selection, and the user-visible need is `api: cohere-v2-chat` on the existing plugin.

**Keep `openai-completions` against `https://api.cohere.ai/compatibility/v1`.** Rejected: that is the OpenAI-compat shim. Command A+ agent turns need native `tools` / `tool_plan` / `tool_calls` / `strict_tools` on `/v2/chat`.

**URL-resolve `chat` against the configured base.** Rejected: `new URL('chat', 'https://api.cohere.com/v2')` becomes `https://api.cohere.com/chat` and drops `/v2`.

**Register Cohere as `searchProvider` on the same key.** Rejected: search stays Exa; the model key is not also the search key.

## Consequences

Any `llm-pi-ai` profile can name `cohere-v2-chat`. The Models page protocol list grows by that id because it reads `supportedProtocols()` from the same `Config` schema. Endpoint interrogation still returns `DISCOVERY_UNSUPPORTED` for this protocol. Citation text is not reconstructed into assistant content. The desk default model route no longer uses `compatibility/v1`; operators need `COHERE_API_KEY` and `EXA_API_KEY`.

## Testing

`packages/llm/llm-pi-ai/tests/cohere-v2-chat.spec.ts` covers protocol selection, prefix URL join, request serialization (system, tools, `strict_tools`, thinking, images, empty tool results), SSE framing, text / thinking / tool / citation / finish mapping, HTTP and transport errors, and a harness assemble tool-call plus tool-result round-trip against a local mock that receives `POST /v2/chat`. `tests/discovery.spec.ts` pins `DISCOVERY_UNSUPPORTED` for `cohere-v2-chat`. No ACP or headless snapshot is added: the protocol is config-selected and does not change a shipped example transcript; the Models-page protocol dropdown snapshot updates because the schema union grew.
