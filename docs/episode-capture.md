# Episode Capture: turning harness sessions into training data

How we record every tool call so a solved RFP becomes a reusable trajectory, and a
universe of solved RFPs becomes training data for small harnesses local businesses own.

## The product loop

1. **Classify.** `classify_tender` (Jev) parses the RFP into `wa.tender_requirements.v1`:
   one requirement per clause intent, each with `tag` (e.g. `security_bond`),
   `mandatory`, `answer_source` (`company_profile` / `document_on_file` /
   `person_input` / `calculation` / `third_party` / `calendar_action`), `lead_time`
   (`weeks` / `days` / `minutes`), `connector`, and evidence quotes with page numbers.
   `procurement_core/requirements/tags.py` maps every tag to
   `(answer_source, lead_time, connector)` — this table **is** the action space.
2. **Plan.** The start-by rule (weeks 21 days before closing, days 7, minutes 2) turns
   the requirement list into a schedule. The requirements board renders it and gives the
   human a checklist (To do / Doing / Done) that stays in their browser.
3. **Execute.** The harness works the plan over weeks: third-party requests go out
   first, profile facts get filled, calculations run, calendar entries land. Every step
   is a tool call.
4. **Capture.** Every call, result, error, approval and human checklist transition is
   recorded as an **episode** keyed to one requirement of one RFP.
5. **Distill.** Government RFPs ask the same things in the same way, so trajectories
   cluster by `tag`. Clusters with consistent successful outcomes become playbooks;
   playbooks become the fine-tuning (and evaluation) set for small, locally-owned
   harnesses.

## What we already record (no work needed)

- **Harness session log** (`~/.dsh/sessions/<dir>/session-*.jsonl.zstd`): full
  `tool/call` (callId, name, full arguments) and `tool/result` (content, error),
  `user/message`, `assistant/message`, `reasoning-chunks`, `approval/asked`,
  `approval/decided`, turn/step numbering, session cwd and timestamps.
- **Server telemetry**: every `mcp_tool_call` log line (tool, ok, duration, tier, plan,
  upstream usage and estimated cost) from the WorkspaceAlberta server.

## The gaps (what blocks training)

| Gap | Why it matters |
|---|---|
| No requirement linkage | A call is logged, but nothing says it served requirement `R04 (security_bond)`. Without the link you cannot cluster by tag. |
| No episode boundaries | A session is not an episode. One session may work five requirements across three weeks; training needs per-requirement trajectories. |
| No outcome label | The board checklist (To do/Doing/Done) lives in browser `localStorage` only. The human's Done is the ground truth that a trajectory worked — it is currently thrown away. |
| Streams don't join | Harness-side calls and server-side `mcp_tool_call` telemetry (cost, upstream errors) have no shared trace id. |
| No exporter | zstd JSONL is a storage format, not a training format. |
| No replay fixtures | Offline evaluation needs recorded tool responses; the server already has the fixture pattern (`PROCUREMENT_FIXTURE_DIR`). |

## Episode schema (v1)

One episode = one requirement of one RFP, from plan-start to outcome.

```json
{
  "schema": "wa.episode.v1",
  "episode_id": "AB-2026-06584:R04",
  "rfp": {"reference": "AB-2026-06584", "source": "alberta_apc",
           "closes_at": "2026-11-02T14:00:00-07:00", "posting_url": "..."},
  "requirement": {"id": "R04", "tag": "security_bond", "mandatory": true,
                   "connector": "surety_request", "answer_source": "third_party",
                   "lead_time": "weeks", "start_by": "2026-10-12",
                   "evidence": [{"page": 12, "text": "..."}]},
  "harness": {"name": "dsh", "version": "...", "model": "...", "profile": "..."},
  "steps": [
    {"seq": 1, "t": "...", "tool": "mcp__workspace_alberta__search_opportunities",
     "args": {}, "ok": true, "error": null,
     "result_digest": "sha256:...", "latency_ms": 812,
     "approval": "auto", "requirement": "R04"}
  ],
  "outcome": {
    "status": "done | partial | abandoned",
    "human_verdict": "accepted | edited | rejected",
    "artifacts": [{"path": "...", "sha256": "..."}],
    "submitted": false,
    "notes": "human free-text corrections"
  }
}
```

Rules:
- **Outcome label source of truth is the human**, never the model: the board checklist
  transition plus the human's accept/edit choice. The model never marks done for the user.
- **Failures are data.** `FS_SANDBOX_DENIED`, upstream 429s and retries are the negative
  half of the distribution — keep them with the retry that fixed them.
- **Privacy is structural**: business profile contents and credentials are stripped or
  redacted at export; episodes are tenant-scoped; a business opts in before its
  trajectories leave its machine. Each business owns the harness trained on its own data.

## Implementation plan (harness repo)

1. **Episode recorder** (`packages/episode-recorder`): subscribe to the session event
   stream (`tool/call`, `tool/result`, `approval/*`), decorate with the active episode
   (requirement id) and write `wa.episode.v1` records alongside the existing session log.
2. **Requirement context**: at plan time the harness holds the classify_tender JSON; the
   recorder reads the requirement manifest as the episode header. Attribution: a step's
   `requirement` field is set from the plan (which requirement the agent is working) —
   default by `answer_source`-to-connector mapping, overridden by explicit agent scoping.
3. **Trace join**: the harness sends a `trace_id` (episode_id + step seq) with every
   workspaceAlberta tool call; the server logs it in the `mcp_tool_call` line. Now
   server-side cost/upstream errors join onto steps.
4. **Board label sync**: checklist transitions (To do → Doing → Done) are appended to a
   local `episode-labels.jsonl` in the data dir (and optionally POSTed to the server for
   multi-device users). These are the outcome labels.
5. **Exporter**: `dsh episodes export` reads session logs + labels, emits one JSONL per
   episode cluster (by `tag`), deduplicated, redacted, schema-versioned. Train/eval
   splits are by RFP (never by requirement), so eval RFPs are unseen documents.
6. **Replay verifier**: exporter also emits fixtures from recorded tool responses so an
   episode can be replayed offline — this is the eval harness: a candidate harness must
   reproduce accepted trajectories against fixtures before it ships.

## What success looks like

- N RFPs solved by a human + harness → N × ~10-20 episodes tagged by requirement type.
- Tag clusters with ≥ 20 accepted episodes become playbook candidates.
- A playbook candidate is promoted to a trained local harness only after it passes the
  replay verifier on held-out RFPs and a human reviews every sampled trajectory.
