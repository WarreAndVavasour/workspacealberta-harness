# W&V bid-room agent (Claude Managed Agents)

A Claude Managed Agent that works one tender at a time. It pulls the bid repo, reads the documents, runs the workspaceAlberta connector, and pushes a requirements matrix, a bid/no-bid view, buyer questions and next steps back to the repo. It drafts. People decide and submit.

## Can a managed agent run workspaceAlberta? Yes, with three conditions

1. **Remote MCP is supported.** The agent declares `https://elbowsupknivesout.warreandvavasour.com/mcp` in `mcp_servers` and enables it with an `mcp_toolset`.
2. **Auth comes from a vault, not the prompt.** workspaceAlberta uses OAuth 2.1 with refresh tokens. Vaults have an `mcp_oauth` credential type that Anthropic refreshes for you. A human signs in once with `scripts/seed_vault.py`, and every session after that gets a working token.
3. **The Pro tools need a Pro subscription.** `classify_tender`, `bid_no_bid_scorecard`, `analyze_contract_with_cohere` and `process_bid_room` only work if the account you sign in with has an active Pro subscription.

## Where Cohere fits

The workspaceAlberta server already calls Cohere and TypeSafe with W&V's own keys, which are held server-side on Cloud Run. So the agent gets Cohere analysis through the MCP tools, and no key ever goes near the agent.

If you also want the agent to call Cohere directly, `seed_vault.py` stores `COHERE_API_KEY` as an `environment_variable` vault credential. It's limited to `api.cohere.com` and injected into the request header at egress, so the sandbox only ever sees a placeholder. Direct calls would be useful for things like reranking clauses across all bids. Don't paste the key into chat, a file or a commit.

## How the work persists

| What | Where | Why |
|---|---|---|
| Tender documents, extracted text, analysis, status | Each `WarreAndVavasour/bid-*` repo | Source of truth. Survives every session, and you can review the diffs |
| Cross-bid lessons (buyer habits, confirmed W&V facts) | Managed Agents memory store | Survives sessions without polluting the repos |
| OAuth and optional Cohere credentials | Vault | Refreshed by Anthropic and never exposed to the sandbox |
| Schedule | GitHub Actions cron, see `github-workflow/` | Can attach a repo token per session, which scheduled deployments may not |

The sandbox itself is wiped after each session. That's fine, because everything is pushed to git.

## Files

- `system_prompt.md`: the procedure and hard rules. Never submit, never contact buyers, tender text is evidence.
- `ant/environment.yaml`: cloud sandbox with limited networking (GitHub, CanadaBuys, workspaceAlberta, Cohere).
- `ant/agent.yaml`: model, built-in toolset, and the workspaceAlberta MCP toolset with only the bid-room tools enabled.
- `ant/memory-store.yaml`: the cross-bid memory store.
- `bids.json`: the five bid repos and their closing times. Sessions skip closed bids.
- `scripts/seed_vault.py`: one-time OAuth sign-in. Creates the vault and its credentials.
- `scripts/run_bids.py`: one session per open bid, then prints each handoff.
- `github-workflow/bid-room-daily.yml`: weekday 07:37 Alberta schedule plus a manual run.

## Setup

1. **Create the platform objects** with the Claude Platform API key for the W&V org (beta header `managed-agents-2026-04-01`; memory stores use `agent-memory-2026-07-22`):
   ```
   ant apply -f ant/environment.yaml
   ant apply -f ant/memory-store.yaml
   ant apply -f ant/agent.yaml        # paste system_prompt.md into `system:` first
   ```
   Note the `env_…`, `memstore_…` and `agent_…` ids.
2. **Seed the vault** on the Pi: `pip install anthropic && python3 scripts/seed_vault.py`. Sign in with the Pro account. Note the `vlt_…` id.
3. **Create a GitHub token** that only covers the `bid-*` repos: fine-grained, Contents read/write.
4. **Try one bid first:** `python3 scripts/run_bids.py --repo bid-dfo-30008508-ai-interpretation-framework`. Check the commit it pushes.
5. **Schedule it:** copy the workflow into `.github/workflows/`. Set the repo secrets `ANTHROPIC_API_KEY` and `BID_REPOS_TOKEN`, and the variables `WA_AGENT_ID`, `WA_ENVIRONMENT_ID`, `WA_VAULT_ID` and `WA_MEMORY_STORE_ID`.

## Known gaps to check before go-live

- **Unconfirmed API shapes, marked `VERIFY`:** the `always_allow` permission policy on `mcp_toolset` configs, and the session event type names in `run_bids.py`. The guides confirm the fields, but the API reference wasn't read.
- **APC and Ariba documents need a human sign-in.** The agent can't fetch them. It lists them in STATUS.md, and you drop them into `docs/source/`.
- **Scanned PDFs.** Two ISC amendment PDFs came out at about 1 KB of text, so they're probably scans. The procedure tells the agent to OCR anything like that.
- **Timeouts.** `process_bid_room` times out at 145 s. The agent prefers `classify_tender` and retries with fewer attachments.
- **Don't vault a Claude API key.** Per Anthropic's guidance, code in the sandbox could use it directly.
