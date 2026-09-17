# workspaceAlberta

workspaceAlberta is the Warre & Vavasour product: a plugin-based agent terminal for Canadian industrial and procurement work. npm packages ship as `@workspacealberta/*`; the operator CLI is `wa`. MIT copyright and third-party notices for inherited source stay in `LICENSE` and `THIRD_PARTY_NOTICES.md`. This product is not DeepSeek software and does not use the DeepSeek Harness name, scope, or `dsh` command.

Build and launch the Web profile on port 3081 with telemetry hard-disabled and the workspaceAlberta deployment patch:

```sh
DSH_CLIENT_BUILD_PROFILE=official DSH_CLIENT_TITLE=workspaceAlberta pnpm run build
DSH_TELEMETRY_DISABLED=1 pnpm wa --profile web --patch workspace-alberta.patch.yml --host 127.0.0.1 --port 3081 --no-open
```

Remote support / desk rebuild: RaspberryPiBot or Litter rebuilds a customer desk Pi over Tailscale with `bash scripts/wa-desk-rebuild.sh` from the repo root (install + official workspaceAlberta client build; prints `BUILD_OK`).

The Cohere route reads `COHERE_API_KEY`. Composio is not part of this harness: it is the WorkspaceAlberta connection layer for other products, never a tool-calling surface here and never bridged to the workspaceAlberta server. The harness's model-facing MCP surface is Linear plus the direct workspaceAlberta endpoint, mounted through the upstream streamable-HTTP MCP client. No keys belong in this repository.

The deployment patch disables the upstream DeepSeek model adapter, DeepSeek-backed web search, the generic Web tool rows that depend on that search provider, and session OTLP telemetry. The source tree contains no `.cn` update or download callback; upstream Chinese-language documentation remains as legal and technical documentation rather than shipped runtime behavior.

## Procurement: two files, two clocks

For authenticated APC document retrieval, follow the [local APC connector setup](integrations/apc/README.md). Its optional overlay adds account sign-in and resumable downloads to the Cohere harness; authentication stays on the local desktop.

The [procurement base](.agents/skills/wa-procurement-base/SKILL.md) performs cold-start tender work. The [improver](.agents/skills/wa-procurement-improver/SKILL.md) reviews feedback in a separate maintenance run. These are the only two instruction entrypoints; the base owns three small reference files. The harness discovers the base under its existing project skill root. The improver sets `disable-model-invocation: true`, so ordinary harness agents cannot select it from the skill catalog; its scheduler reads the file directly. This is routing, not a filesystem security restriction.

### Task clock

Open a fresh session in this checkout and request `Use wa-procurement-base to find work this week`, supplying the subscriber's trade, region, capacity, and known qualification limits. The existing deployment connects the Workspace Alberta procurement server and web tools. Discovery does not itself subscribe to tender feeds: a user request or external feed must start the session. Never load the improver as task instructions.

Verify installation by finding `wa-procurement-base` in the skill catalog and confirming that `wa-procurement-improver` is absent from the model-facing catalog. Run a brief against a primary notice and inspect its citations, deadline timezone, missing fields, and fit evidence. The [synthetic cases](.agents/skills/wa-procurement-base/resources/wa-label-examples.md) distinguish unknown bonding from a verified capacity mismatch.

### Maintenance clock

Configure a separate scheduler job for weekdays at 07:00 **America/Edmonton**, with non-overlapping runs. Load only the improver as operating instructions; it may inspect the base as an editable document. Supply repository `HarleyCoops/workspacealberta-harness`, target branch `workspace-alberta`, and `wa-feedback` issues/PRs as authorized feedback sources. GitHub CLI authentication must allow reading comments and creating branches and PRs. Private harness feedback requires an explicitly supplied export; this deployment does not scrape customer sessions.

The scheduler owns the last completed scan cursor, unaddressed signal IDs, and outcome receipts. If it cannot persist that metadata, the improver uses its documented seven-day overlap and PR deduplication fallback. Temporary signal summaries stay outside versioned files. A failure does not advance the cursor. A threshold trigger such as three new comments requires an external collector; it is not installed by the skill files.

Use a dedicated automation identity without merge or target-branch write privileges when enforcing the human gate. A skill instruction cannot restrict an owner's GitHub credentials. Keep the base/resources under human review, and do not grant the improver permission to alter its own instructions or protections. An approved merge becomes active in a new task only after that terminal updates its checkout; git push does not update the Pi fleet.

The task model remains the deployment's configured Cohere route. A separate Codex/gpt-6 maintenance job uses its own explicitly configured model and processing route; these skills do not change provider settings or claim a gpt-6 API model ID exists. Roll back procedure changes by reverting the merge and updating deployed checkouts. Pause the maintenance job separately if needed.
