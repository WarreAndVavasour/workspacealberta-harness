# Agent Note: Native Cohere v2 Chat adapter

Status: implemented

English | [中文](2026-09-17-cohere-v2-chat-adapter.zh.md)

## Problem

Workspace Alberta's default model route is Cohere Command A+, but the agent loop reached it through pi-ai's OpenAI-compatible Chat Completions path (`https://api.cohere.ai/compatibility/v1`). That path is a lossy translation of Cohere v2 Chat: tool-call planning, `tool_plan`, thinking content, `strict_tools`, and `message-end` usage do not survive as first-class wire facts. The existing [`web-search-cohere`](../../../../packages/web/web-search-cohere/README.md) provider already speaks native `/v2/chat` for search synthesis and must stay off `ctx.llm`; the conversation loop had no matching adapter.

## Decision

`@workspacealberta/wa-llm-cohere` is a first-party `LlmAdapter` on the same seam as [`llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md). It owns the single route `cohere-canada`, posts streaming `POST {baseURL}/v2/chat`, and translates Cohere SSE events into the harness `StreamChunk` protocol. The Workspace Alberta patch empties the pi-ai `cohere-canada` profile so the native adapter is the only owner of that route; `agent-default-model` keeps `provider: cohere-canada` and `model: command-a-plus-05-2026`.

The adapter is text-only. Tool schemas serialize as v2 function tools with `strict_tools: true` and without `tool_choice`, matching the search provider's Command A+ constraint. Assistant reasoning without tool calls is replayed as thinking content blocks; reasoning on a tool-call turn is replayed as `tool_plan`. Streamed thinking content and `tool-plan-delta` events both become harness reasoning blocks. Citation events are ignored. Settings and credentials resolve per request the same way the DeepSeek adapter does.

This adapter does not replace the [twin adapters](2026-06-13-twin-llm-adapters.md). DeepSeek and pi-ai remain the neutrality pair; Cohere is a third first-party protocol implementation for the Canadian default route.

## Alternatives considered

**Keep the OpenAI compatibility gateway through pi-ai.** It already boots and needs no new package, but Command A+ tool use and thinking/tool-plan passback are native v2 facts. The compatibility path cannot reconstruct them, and the search provider already refused that path for the same reason.

**Extend pi-ai with a Cohere protocol.** pi-ai is an external library. A first-party fetch-and-translate adapter keeps Cohere wire types, SSE events, and error mapping in this repository, beside the DeepSeek layout the cookbook names as the reference.

**Share a client with web-search-cohere.** The search provider's loop is non-streaming, records a private `web/cohere-search-llm-request` event, and must not depend on `ctx.llm`. Folding it into the adapter would couple an auxiliary search synthesis call to the conversation seam.

## Consequences

The `cohere-canada` route cannot be owned by two adapters. The Workspace Alberta patch must leave pi-ai dormant (empty `providers`) or the composition fails with `DUPLICATE_ADAPTER`. Existing sessions that already logged `provider: cohere-canada` keep that id; only the wire protocol behind it changes. Images, `tool_choice`, and citation storage remain out of scope. Live Command A+ behavior still needs `COHERE_API_KEY`; unit tests speak to a local mock of `/v2/chat`.
