# Continuing a business project

English | [中文](workspace-projects.zh.md)

Use one conversation for one business project: an RFP response, a new service, or another deliverable that needs evidence and repeated owner input. The lead uses native Cohere v2 tool calling. Jev can classify independent source sections before the lead builds and revises its plan.

## Enable document intake

The [corporate deployment overlay](../../workspace-alberta.patch.yml) enables four project tools, image inspection and optional longer text batches with `jev-1.14.0`. It maps `TYPESAFE_API_KEY` to the Jev item in Agent Keys through the existing read-only 1Password provider. The Pi service account needs read access to that vault. The configured 0.9 review threshold is provisional; tune it using labeled customer documents. Classifications never authorize actions. The optional [worker overlay](../../apps/cli/config/examples/workspace-project/cordis.patch.yml) adds read-only exploration workers after the deployment overlay.

For the Pi without 1Password CLI, set `WA_CREDENTIALS_MODE=env` in its service environment alongside `COHERE_API_KEY` and `TYPESAFE_API_KEY`. The corporate overlay then selects the existing local credential provider, including its protected `.env` support. No additional provider or launch flag is required. The standard mode remains read-only 1Password when this setting is absent. Never put key values in chat or Git.

The [package reference](../../packages/workspace/project-tools/README.md) owns configuration and failure behaviour. These tools require the base profile's session persistence. Keep the same persistent harness home when rebuilding or restarting the Pi; rebuilding code does not require deleting its conversations.

## Work toward a deliverable

1. Retrieve the real source documents and company evidence using available MCP or filesystem tools. Preserve file locations, content hashes and page or section citations. Parse documents into text sections; Jev does not replace a PDF parser.
2. Call `project_classify_sections` on bounded batches. For a drawing, scanned form or visual table, render its PDF page to PNG/JPEG with available document tools and call `project_inspect_image` with its local `file_path`, `sourceId` and exact `location`. Review its Box coordinates against the image. Use `useLongContext: true` for text only when a larger batch is needed; the long-context header is sent only above the normal request limit. Independent section questions share one TypeSafe request. Treat low confidence and `other` classifications as review work. Do not discard unclassified sections or turn a classifier score into an eligibility decision.
3. Have Cohere assemble the plan from the sources, classifications, business facts and discovered tools. Call `project_read`, then save the complete plan using `project_checkpoint` and its expected revision. Record dependencies, acceptance criteria, blockers and missing facts.
4. Execute ready tasks through the existing guarded tools. Save artifact locations and progress. A tool error or interrupted request is not proof that an external action failed: inspect the destination before retrying.
5. Continue in the same conversation after a pause. Read the saved project before resuming. A new conversation does not automatically inherit another project's checkpoint. Reconcile revision conflicts rather than overwriting them.
6. Verify the deliverable against its sources and task acceptance criteria. Record the final artifact and outstanding issues. Obtain the owner's approval through the existing interaction and permission flow before external submission. A recorded `completed` task is a caller report, not proof of owner acceptance.

## Evaluate planning workers separately

The optional overlay also exposes `project_explore` through the existing in-process subagent tool. Workers inherit the parent Cohere route, can only read and search local files (`read`, `glob`, `grep`), and cannot delegate further. The overlay allows two parallel-safe tool calls per step and disables background worker starts. After retrieving documents locally, ask the lead to assign independent, cited exploration tasks in the same step. This enables parallel planning without giving workers write or submission tools. It does not automatically choose a cheaper model, set a total project budget or prove the research result transfers.

Cohere's [agent-team study](https://cohere.com/blog/lessons-from-scaling-teams-of-frontier-coding-agents) tests coding agents, not procurement delivery. Its planning-worker result motivates an RFP experiment: compare one Cohere lead, a lead with parallel document exploration, and a lead with Jev section judgments plus parallel exploration. Use the same source bundle and acceptance rubric. Measure mandatory-requirement recall, source accuracy, unsupported company claims, owner corrections, delivered artifacts, latency and actual inference usage. Worker findings should cite evidence; the lead consolidates the plan and owns external actions. No RFP quality or cost advantage is established by the coding benchmark.

[Jev 1.14](https://typesafe.ai/blog/jev-1-14) image and long-context options are experimental. The image tool sends `TypeSafe-Danger-Zone-Images: true`; larger opted-in text requests send `TypeSafe-Danger-Zone-Long-Context: true`. Normal text batches send neither header. The real-document smoke exercises both actual harness tools. Focused and 100-page inputs gave the same decisions on four source-check questions, while longer context used more tokens. This small test does not establish accuracy or a quality advantage. Source review is still required: the draft builder produced unsupported wording and misplaced citations despite passing the execution smoke.

## Diagnose an interrupted conversation

Inspect the last committed turn and service log before changing limits. Distinguish a provider HTTP 429, quota refusal, context overflow, output-token limit, stream timeout, tool timeout and service restart. The native adapter preserves HTTP status in errors so the harness can classify them. Per-request limits do not define a project's lifetime. Keep source documents and checkpoint state outside any single request's context budget; never raise all limits to hide a failure.
