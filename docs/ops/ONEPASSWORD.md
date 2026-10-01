---
description: "Operator tutorial for the read-only workspaceAlberta 1Password credential source and approved deployment cutover."
kind: "tutorial"
---

# workspaceAlberta 1Password setup

English | [中文](ONEPASSWORD.zh.md)

The [product deployment overlay](../../workspace-alberta.patch.yml) selects a read-only 1Password source for API-key references and plugin credential records. The [credential provider](../../packages/credentials/credentials-local/README.md) reads each field through a bounded `op read` subprocess, captures its output only in memory, and never injects resolved values into configuration files or the host environment. Missing CLI access, inaccessible or empty fields, and invalid records fail startup. The source does not fall back to environment values, `.env`, or `.credentials.yaml`.

## Operator setup

1. Install [1Password CLI](https://developer.1password.com/docs/cli/get-started/) on the delivery host. Authenticate through an operator-approved existing desktop session or a least-privilege service account. Account sign-in, new service accounts, and persistent access configuration require the user's participation. Do not put the authentication token in the repository or a generated configuration artifact.
2. Provision the deployment vault and copy its actual field references into the overlay. The example addresses are `op://workspaceAlberta/Cohere/api-key` and `op://workspaceAlberta/Harness/browser-session-record`; they are configuration addresses, not evidence that those items exist. Use the desktop app to copy field references; immutable vault/item IDs can replace names.
3. Put the approved Cohere key in the first field. The browser field contains a JSON record with `kind: "grant"` and `payload: { "version": 1, "secret": "<base64url encoding of 32 random bytes>" }`. Migrate an existing valid browser signing record through an approved, private migration process or create a replacement inside that process. Never print its value. Replacing it and restarting invalidates existing browser cookies.
4. Stop the service for cutover. Remove its plaintext `EnvironmentFile` key-loading instruction and use the normal `wa --profile web --patch workspace-alberta.patch.yml` entrypoint under the approved CLI identity. Retire the old checkout/home `.env` secrets and `.credentials.yaml` only after a verified vault migration. The code leaves legacy files untouched.
5. Start the service. Successful activation proves reads of every configured field and validation of each tagged JSON record. Confirm the Models credential view reports source `1password` and `writable: false`, authenticate in the browser, and run an approved ordinary Cohere request. Do not use a suspected exposed key for testing. Vault failure must prevent startup, and a vault-side API-key rotation must reach the next request without rewriting any local file.

## Rotation

For a confirmed exposure, revoke or rotate the credential in its provider account, store its replacement in 1Password, and approve the production cutover. Check provider audit/usage records and reconcile the scanner after revocation; do not probe the old key. History rewrites, force-pushes, remote artifact removal, and credential revocation require separate approval. Coordinate remediation of any backups or logs that contain the credential after rotation.

## Delivery limits

This mode refuses credential writes before invoking record mutations. API-key entry, pi-ai custom profile headers, and OAuth grant/refresh writes through the harness are unavailable; preprovision approved fields in 1Password. Local credential mode remains available for generic upstream compositions. Optional integrations that use explicit child environments or their own credential files require a separate cutover review before claiming every deployed integration is centralized. The existing backup passphrase file and service units are outside this repository patch and also need an approved migration. 1Password access is privileged host access; this source does not protect against arbitrary same-user host programs or trusted plugins that invoke the CLI themselves.

[1Password secret references](https://developer.1password.com/docs/cli/secret-references/) define the field URI syntax. The provider uses [the CLI read command](https://developer.1password.com/docs/cli/reference/commands/read/) with `--no-newline` and never `--out-file`.
