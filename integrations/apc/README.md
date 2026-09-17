# APC account connection

English | [中文](README.zh.md)

This local MCP connector lets the Cohere harness open APC sign-in, retain a dedicated browser session, and download an opportunity's documents and amendments. Start it on the desktop where the user signs in: the Raspberry Pi with its desktop session, or a Windows/Linux/macOS workstation. It does not need Codex, an APC API key, or an APC password in GitHub secrets.

## Setup and test

Prerequisites: Python 3.11+, the repository's Node/pnpm dependencies and web build, and a graphical desktop. On Linux, install Playwright's Chromium system dependencies if the browser installer reports missing libraries. Run these commands from the repository root:

```sh
python integrations/apc/run.py setup
python integrations/apc/run.py test
python integrations/apc/run.py start
```

Keep `COHERE_API_KEY` configured for the harness. The launcher applies both the Cohere deployment and local APC overlays and serves the app at `http://127.0.0.1:3081`. Stop an existing harness on that port first. Installation creates an ignored Python virtual environment; the launcher selects its interpreter automatically.

In the harness chat, say **“Connect APC.”** Cohere calls `mcp__apc_local__apc_connect`, which opens a dedicated Chromium window on the host. Sign in on APC's official page and complete any human verification there. Then say **“Download the documents for AB-2026-05716.”** If APC requests another verification step, complete it in the same window and say **“Resume the APC download.”** The connector preserves the pending opportunity across process restarts. It does not poll in the background or resume without a subsequent tool call.

Downloading expresses interest under the signed-in supplier account and subscribes that account to posting updates. The tool description discloses this effect. The connector does not submit bids, alter partnerships, or send email. A personal Chrome login is not imported: sign in once in the connector's dedicated window. The account must remain associated with an APC supplier business.

## Connection and storage

The four tools return `connected`, `sign_in_required`, `verification_required`, `download_failed`, or `downloaded` as appropriate. Errors from the browser and invalid inputs become MCP errors. A connected account is not proof of document access; only a complete download receipt establishes retrieval. No arbitrary URL, browser script, password, or cookie arguments are exposed to the model. Tool results use the existing MCP client's generic presentation and session logging.

The default storage directory is `~/.workspacealberta/apc`. `browser-profile/` contains sensitive session data; `pending.json` identifies interrupted work; `opportunities/<APC-reference>/` contains content-addressed documents and an atomic `manifest.json`. Receipts include source posting, retrieval time, byte count and SHA256. Files survive browser and E2B shutdown. Retries fetch the current listing again; identical documents replace the same content-addressed file, while changed versions remain available. Only a fully retrieved listing receives `complete: true`. Partial files are not a complete RFP review.

Browser credentials and login-page contents are not exported through these tools, recorded as browser traces, or forwarded to E2B. Files returned by this connector can be passed to downstream processing. This is not OS isolation from other tools running as the same user: protect the host account and exclude the browser profile from model filesystem access and shared backups. POSIX storage uses owner-only directory permissions; Windows uses the host user's profile ACLs. One connector process owns one account profile; concurrent processes must use different `WA_APC_HOME` directories. A shared multi-user web deployment needs separate OS accounts or equivalent isolation.

Configuration is read from the host environment before launch:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WA_APC_HOME` | `~/.workspacealberta/apc` | Private account profile and document storage |
| `WA_APC_CHROMIUM` | Playwright Chromium | Optional browser executable, including a Pi system Chromium |
| `WA_APC_TIMEOUT_MS` | `20000` | Per-browser-operation timeout |
| `WA_APC_MAX_DOCUMENTS` | `64` | Maximum posting document count |
| `WA_APC_MAX_BYTES` | `104857600` | Per-file acceptance limit after download |

The MCP overlay allows four minutes per tool call. Large listings can exceed that deadline: the pending receipt survives, and the user can retry. The file-size limit validates received files; it does not cap network transfer. APC layout changes, document restrictions, expired sessions and human-verification challenges can prevent retrieval. The connector never circumvents those checks. A Pi without a graphical desktop cannot display sign-in; remote embedded sign-in and a dedicated Connections settings panel are not included.

## Verification

`run.py test` executes real Chromium against local portal fixtures and the actual stdio MCP server. The committed example transcript covers tool discovery, rejected path input, sign-in handoff, resumed retrieval of six documents, hashes verified against saved bytes, and survival after browser shutdown. Browser regressions cover verification handoff, persistent cookies/pending work, changed page layout and preserving the sign-in page. No live APC credentials are required in CI; the user's live test verifies current APC compatibility separately.
