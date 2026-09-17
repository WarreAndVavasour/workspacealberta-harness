# Agent Note: APC local account connector

Status: implemented

English | [中文](2026-09-07-apc-local-account-connector.zh.md)

## Problem

Public procurement discovery does not supply authenticated APC attachments. Supplier sign-in and verification require user interaction, while opportunity records must survive disposable processing environments.

## Decision

The [APC connector](../../../../integrations/apc/README.md) owns a dedicated persistent Chromium profile on the user's desktop. The existing stdio MCP client exposes fixed connect, status, download and resume tools to Cohere. Credentials are entered on APC, and tool results contain status and document receipts rather than browser session material. The optional deployment overlay does not change the agent loop or default tool composition.

Pending opportunity references and content-addressed document files persist outside the browser process. A complete manifest requires every listed document to finish. Resume retries the current listing and retains previous content versions. APC's automatic expression of interest is disclosed in the tool description and user guide.

## Alternatives considered

**Password secrets in CI.** They do not satisfy APC's interactive verification and would move a supplier account into a shared build environment.

**Authentication inside E2B.** Sandbox teardown would complicate interactive sign-in and account persistence. E2B can consume downloaded documents without owning portal credentials.

**Internal signed-URL API integration.** APC's browser handles authentication and verification before issuing signed download URLs. Using the visible download action avoids depending on an undocumented credential exchange.

## Consequences

The browser must run on a graphical desktop accessible to the user. Sign-in is a native browser handoff initiated from harness chat, not an embedded web settings panel. Each profile serves one local account and needs OS-level isolation in a multi-user deployment. Tool logging does not include cookies, but other processes running as the same OS user are not isolated from the profile. Automatic E2B ingestion and background polling are separate from this connector.

## Verification

The runnable keyless example exercises the real stdio MCP entrypoint and Chromium against a local portal, checks the model-visible transcript, validates downloaded bytes against receipts, and verifies files survive shutdown. Browser tests cover verification handoff, restart persistence, changed layout, invalid references and sign-in preservation. A dedicated CI workflow installs Chromium and runs these checks. Live APC compatibility and Raspberry Pi desktop behavior require user testing; the fixtures do not claim to prove either.
