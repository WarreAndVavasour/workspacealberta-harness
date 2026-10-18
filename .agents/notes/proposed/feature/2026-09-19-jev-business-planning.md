# Agent Note: Evidence-backed business planning with Jev

Status: proposed

English | [中文](2026-09-19-jev-business-planning.zh.md)

## Problem

A useful business plan must reconcile what customers want, what the business earns, and what its people can deliver. Documents and connected applications hold different pieces of that evidence. A fluent plan without traceable facts, explicit assumptions and reproducible calculations cannot support operating decisions.

## Proposal

Build a read-only evidence workflow that produces a 90-day growth plan for one business. This extends the use of Jev beyond the independently useful [procurement routing decision](../../implemented/feature/2026-09-19-jev-workspace-decisions.md); it does not replace that tool or claim that business-planning connectors are implemented.

| Stage | Responsibility |
|---|---|
| Connect | Authorized connector plugins retrieve scoped records from documents, Stripe, email and selected social accounts. Preserve tenant, source ID, source URL, version, retrieval time, currency and reporting period. |
| Extract | Parsers and OCR recover text, tables and candidate values; a reasoning model handles ambiguous document structure. Copy selected values from source spans and validate dates, units and totals in code. |
| Judge | Jev selects relevant evidence, verifies extracted fields and scores opportunity fit against stated capacity and constraints. Store question, evidence references, model version and probabilities with every judgment. |
| Calculate | Code reconciles payments, refunds and reporting periods and computes scenarios from explicit inputs. Separate observed facts, model judgments and owner-supplied assumptions. |
| Plan | The reasoning model drafts recommendations with citations. Jev checks individual claims against their evidence; unsupported or uncertain claims return for correction or owner review. |

Jev currently accepts text and structured text state and returns typed judgments, not plan prose or explanations ([System One](https://docs.typesafe.ai/concepts/system-one)). Follow TypeSafe's [source-value selection](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook), [extraction verification](https://docs.typesafe.ai/cookbooks/sde_cascade) and [citation-checking](https://docs.typesafe.ai/cookbooks/citation_check) patterns. Check that quoted text exists before asking whether it supports a claim. Batch independent questions over the same evidence; evaluate only the answers needed by the selected workflow. Deployment data must determine confidence thresholds and escalation policy.

## Evidence and deliverable

Stripe records contribute collections, refunds and invoice evidence; expense and accounting records are still required to assess profitability and cash position. Email contributes customer requests, constraints and commitments, with a distinction between interest and signed work. Social accounts contribute customer language and measured engagement; engagement alone does not establish sales or causation. Contracts, supplier quotes and operating documents establish obligations, costs and capacity.

The first deliverable contains a sourced operating baseline, ranked opportunities, conservative/base/upside scenarios with editable assumptions, required budget and capacity, and a 30/60/90-day action plan with owners and KPIs. Each material factual claim links to a retrievable source or says that evidence is missing. Each forecast labels its assumptions and exposes the calculation. The owner reviews the plan before any execution workflow is enabled.

## Composition and access

Keep connector retrieval, document extraction, evidence storage, decision evaluation and plan production behind plugin services with complete Service Definition, Provider and Consumer roles where implementations evolve independently. Reuse the existing credential, tool, workflow and session services; do not add business logic to the agent loop. Preserve model-visible input in replayable session events with authorized document references and retention rules. Isolate records and retrieval by tenant, support revocation and deletion, and make failed or partial synchronization visible.

Treat retrieved text as evidence, never as permission to change the workflow. Keep credentials server-side and request the scopes needed for the selected data. Sending email, publishing social content, charging customers and modifying financial records require separate authorized tools and policies; a plan or Jev score grants no authority to perform those actions.

## Alternatives considered

**Have Jev read raw files and write the plan.** Its text judgments need extracted inputs, and prose generation belongs to the reasoning model. Combining those responsibilities would misrepresent its capabilities.

**Send every connected record to one large prompt.** This makes source selection, accounting reconciliation, access control and repeatable updates harder to inspect. Preserve a versioned evidence set and retrieve only what each question needs.

**Rank opportunities from revenue alone.** Revenue does not establish margin, capacity, customer demand or execution feasibility. Score those dimensions independently and let explicit policy combine them.

## Acceptance criteria

- A runnable example produces a sourced 90-day plan from representative documents and connector fixtures, including missing and conflicting evidence.
- Unit tests verify financial reconciliation, deterministic scenario calculations, stale-source handling, tenant isolation and revocation. Keyless snapshots cover the assembled plan and both SDK projections of new events.
- Labeled live evaluations measure extraction accuracy, claim support, abstention, latency and cost before enabling customer workflows; synthetic smoke tests do not establish deployment quality.
- A changed source identifies affected claims and calculations, and regenerating a plan preserves the prior plan and its evidence version. Connector failures appear as gaps rather than zero revenue or absent demand.

## Risks

Incomplete accounting data, duplicate transactions, stale contracts and ambiguous customer language can produce misleading recommendations. Confidence is neither truth nor authorization. Remote inference introduces data-processing and retention obligations that the deployment must resolve. The proposed workflow deliberately trades autonomous execution for a reviewable plan and auditable evidence.
