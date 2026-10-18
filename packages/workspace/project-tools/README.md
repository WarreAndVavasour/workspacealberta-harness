---
description: "Classify document sections with Jev and keep a business project plan in a continuing harness conversation."
kind: "package-reference"
---

# @workspacealberta/wa-project-tools

English | [中文](README.zh.md)

## Summary

Classify source sections before building a proposal, then save the project plan and delivery evidence in the same conversation. Jev supplies bounded judgments; the lead model plans and uses the harness's available tools. Saved checkpoints survive turns and reloads when session persistence is mounted. Each intake batch makes one auxiliary TypeSafe request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the plugin with tools, filesystem, credentials, sessions and a session persistence provider. `minConfidence` is required; choose it using labeled examples from the deployment. Follow the [project delivery guide](../../../docs/user/workspace-projects.md) for the enabled corporate deployment and credential reference.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyRef` | `TYPESAFE_API_KEY` | Server-side TypeSafe credential reference |
| `baseURL` | `https://api.typesafe.ai` | TypeSafe API root |
| `model` | `jev-1.14.0` | Pinned classifier release |
| `minConfidence` | required | Below this confidence, return the section for review |
| `maxRequestBytes` | `32768` | Complete serialized auxiliary request limit |
| `enableImages` | `false` | Allow PNG/JPEG inspection; enabled in the corporate overlay |
| `maxImageBytes` | `4194304` | Complete image file byte limit |
| `enableLongContext` | `false` | Permit explicit larger text batches; enabled in the corporate overlay |
| `maxLongRequestBytes` | `1048576` | Complete JSON byte cap for larger text batches |
| `maxLongSections` | `128` | Larger batch section limit; at most 256 |
| `maxSections` | `16` | Sections per request; at most 64 |
| `maxCheckpointBytes` | `65536` | Complete supplied project plan limit |
| `timeoutMs` | `10000` | Single inference attempt deadline |

`project_read` returns the latest plan and the tools visible to the calling agent. `project_checkpoint` replaces the whole plan using an expected revision; a conflict requires rereading and reconciling. `project_classify_sections` sends supplied source text and citations to TypeSafe, classifies independent sections together, and returns probabilities and review flags. `project_inspect_image` reads a bounded local PNG/JPEG through the configured filesystem and returns page type, expert-review probability and a normalized Box. Its image bytes and SHA-256 are retained with the request for replay. It sends the Images header; text sends the Long-Context header only when `useLongContext` is requested and the request exceeds `maxRequestBytes`. Disabled paths fail before inference. These tools never execute a procurement action. Missing credentials, malformed answers and provider failures produce tool errors; the lead can continue ordinary reasoning.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The session log owns project checkpoints and secret-free inference records. Checkpoints validate unique IDs, source references, acyclic dependencies and artifact locations before append. An active or completed task requires completed dependencies. The save awaits the session durability barrier; an absent writer or failed flush reports an error, so callers must reread before retrying. Whole-state replacement makes parallel stale writes fail rather than overwrite newer work. Inference follows caller cancellation and plugin disposal. The package uses existing tool and credential services rather than adding another provider service. No invariant companion is published: checkpoints have no independently maintained cache or projection to compare with the log.

</details>

<a id="dev-note"></a>
## Dev Note

The [decision record](../../../.agents/notes/implemented/feature/2026-10-14-cohere-project-recovery.md) separates implemented intake/checkpoints from the proposed planning-worker experiment.

<a id="model-experience"></a>
## Model Experience

### Project tools

#### What the model sees

Four tool schemas and their JSON results expose classified sections, supplied citations, available tools, the current project revision, blockers and reported artifacts. The lead must call `project_read` when continuing a project; no automatic context injection or autonomous scheduler is installed.

#### Token effect

Tool descriptions add request overhead. Intake text or image bytes go to one auxiliary Jev request, while its classification result joins the lead's history. Project documents remain in source artifacts rather than inside the bounded checkpoint.

#### KV Cache effect

Tool definitions remain stable during activation. Results append to conversation history; the package promises no reuse of Jev inference caches.

## Known Limitations and Deferred Work

- Classification is not extraction, eligibility verification or permission to submit a bid. Supplied citations, source hashes and artifact locations are recorded claims; this plugin does not read or independently verify their contents. Completion status is reported by the caller, not human acceptance. The lead owns document parsing, synthesis and verification through connected tools. Projects are conversation-scoped; keep the same conversation and persistent harness home. No background resumption, multi-device coordination, exactly-once external effects, PDF rendering, OCR transcription or guaranteed cost improvement is provided. Image and long-context capabilities remain experimental. Byte limits do not guarantee fitting the provider token limit; split rejected batches. Low-confidence regions require visual review. Image records increase session disk usage. The corporate review threshold of 0.9 is provisional, not calibrated; no classification authorizes a business action.
