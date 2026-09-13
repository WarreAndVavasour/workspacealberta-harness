# Agent Note: Cohere batch procurement review in the harness

Status: implemented

English | [中文](2026-09-12-cohere-procurement-batch-review.zh.md)

## Problem

Workspace Alberta procurement work needs grounded, cited tender analysis at batch scale, but the harness had no procurement-specific tool: agents improvised with raw web search and manual citation handling, and any batch design risked unbounded parallel provider calls, leaked error prose, and invented references. The procurement MCP server stays the system of record for tender data; the harness needed a consumer-side synthesis layer with honest bounds.

## Decision

The harness ships `@workspacealberta/wa-procurement-base` (`packages/procurement/wa-procurement-base/`), a `procurement_review_batch` tool that synthesizes one grounded summary per opportunity over caller-supplied evidence through Cohere v2 chat with native citations. A fixed worker pool (`concurrency`, default 3) settles every requested job with its own outcome; oversized queues fail before any provider call; retryable failures back off with a capped delay; cancellation settles in-flight and queued jobs as cancelled. Citation records validate spans against the exact response text and sources against the supplied manifest, and rejections stay countable. Raw PDFs and video report explicit unsupported outcomes; oversized or remote image payloads throw before any provider call. Credentials resolve per batch through the credential seam and never enter logs or error text; credential-bearing requests never follow redirects. Fit labels stay with the calling agent and the `wa-procurement-base` skill rubric: extraction of a requirement is never recorded as verification of subscriber capacity.

## Alternatives considered

**Unbounded subagent fan-out for batches.** Rejected because one provider request per opportunity with no concurrency bound risks rate-limit storms and couples batch latency to the slowest item; the worker pool gives the same per-item isolation with a fixed ceiling.

**Server-side batch endpoint on the procurement MCP server.** Rejected for this change because synthesis credentials, model bounds, and citation validation are harness deployment concerns; the MCP server remains a data and entitlement API, and the tool consumes it like any other evidence source.

**Lenient citation repair (fuzzy spans, guessed sources).** Rejected because a repaired citation looks like evidence while pointing nowhere; rejection with escalation keeps the gap visible.

## Consequences

Batches of 100 or more opportunities queue safely with observable per-item outcomes and fixed failure codes, at the cost of added latency versus parallel fan-out: throughput is bounded by `concurrency`, and large evidence sets must fit the per-call document and image budgets or arrive split across calls. PDF extraction and video frame sampling remain explicit gaps the tool reports rather than fills.

## Testing

Unit coverage pins the queue bounds (125-job settlement at peak concurrency 3, retry caps, cancellation, oversized rejection), citation validation (Unicode offsets, invented IDs, mismatched spans), media refusal, credential layering, spec resolution, and provider error mapping, all with fixture values and stubbed transport. A real Loader composition test proves configured bounds change tool behavior and every requested item settles; mock transport is test-only and never presented as live verification.
