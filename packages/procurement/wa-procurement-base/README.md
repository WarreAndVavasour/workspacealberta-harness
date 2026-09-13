# @workspacealberta/wa-procurement-base

English | [中文](README.zh.md)

Cohere-backed batch procurement review for Workspace Alberta (`procurement_review_batch`).

The tool queues the requested opportunities through a fixed worker pool: Cohere v2 synthesizes one grounded summary per opportunity over caller-supplied evidence, native citation records validate against the supplied documents, and every requested item settles with its own outcome. Queue bounds, model, and credentials are deployment configuration.

## Plugin

Requires `ctx.tools` (`inject: ['tools']`).

### Config

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | — | Literal key for tests and manual runs; prefer `apiKeyEnv` so no secret enters configuration files. |
| `apiKeyEnv` | `COHERE_API_KEY` | Credential reference resolved per batch. |
| `baseURL` | `https://api.cohere.ai` (`COHERE_BASE_URL` env wins when unconfigured) | v2 endpoint base; `/v2/chat` is appended. |
| `model` | `command-a-plus-05-2026` | v2 model name. |
| `maxTokens` | `1024` | Upper bound on generated tokens per synthesis call. |
| `concurrency` | `3` | Maximum simultaneous in-flight synthesis calls. |
| `maxJobs` | `200` | Maximum opportunities accepted per batch; larger queues fail before any provider call. |
| `maxRetries` | `2` | Retries per opportunity after a retryable (429/5xx) failure. |
| `retryBaseMs` / `retryMaxMs` | `200` / `5000` | Exponential backoff base and cap, including server retry-after hints. |
| `maxDocuments` | `12` | Evidence documents per call; extras are dropped and reported. |
| `maxCharsPerDocument` | `6000` | Characters kept per document; overlong text is cut and reported. |
| `maxImageBytes` | `20971520` | Total decoded image-byte budget per call. |

## Behavior

Each opportunity carries its own evidence text and optional base64 image data URLs. Raw PDFs and video have no direct model path and return explicit unsupported outcomes; oversized or remote image payloads throw before any provider call. Credentials resolve per batch through the credential seam and never enter logs, dumps, or error text; credential-bearing requests never follow redirects. Provider failures map to fixed codes (`COHERE_HTTP_429`, `PROCESSING_FAILED`); a batch with failures is partial coverage, never a complete review. Fit labels stay with the calling agent and its rubric: extraction of a requirement is not verification of subscriber capacity.

## Model Experience

The tool renders one summary line (ready/failed/cancelled counts) plus the per-item canonical values: summary text, validated citation count, rejected-citation count, truncation flag, attempts, and failure code. Visual interpretations arrive as ordinary text without page citations; decisive claims that lose their citations must be escalated by the caller, never repaired.

#### KV Cache effect

No direct invalidation; results are fresh tool output per call.

## Known Limitations and Deferred Work

- **Evidence is caller-supplied** — the tool synthesizes over given text and images; it does not fetch procurement portals itself. Pair it with the procurement MCP server and official notices.
- **No PDF or video path** — PDFs need an extraction/rendering step and video needs timestamped frame sampling; both are explicit gaps, not silent skips.
- **Image budget is per call** — at most 20 images within the byte budget; larger evidence sets must be split across calls by the agent.
- **Capacity is not verified** — profile matching compares supplied records; live crew scheduling needs a live authoritative integration.
