---
description: "Add, authorize, and manage MCP servers directly in WorkspaceAlberta Settings; configure approved OAuth callback origins and encrypted host storage."
kind: "package-reference"
---

# @workspacealberta/wa-mcp-connections

English | [中文](README.zh.md)

## Summary

Add a remote MCP server or local server command in **Settings → Connections**. Sign in to protected servers through their own OAuth authorization page. Saved connections restore on restart; enable, disable, reconnect, edit, forget sign-in, or remove them from the same page. Discovered tools enter the existing harness tool pipeline through the MCP client. No integration vendor account is required.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this service alongside Settings, Credentials, Tools, and the authenticated browser connection.

### Add and manage servers

Open Settings, select Connections, and choose **Add connection**. For a remote server, enter its MCP URL and select OAuth when it requires sign-in. Save, then choose **Sign in** to open that server's authorization page. For a local server, enter its command and arguments; optional environment values refer to existing harness credential names rather than pasted secrets.

Disable keeps the saved connection and authorization while removing its tools. Reconnect refreshes discovery. Forget sign-in disables the connection and deletes this terminal's authorization; provider-side revocation remains separate. Remove also deletes the saved connection. A failed server does not prevent another server from connecting.

### Deployment configuration

The default OAuth callback origins are localhost and 127.0.0.1 on ports 3080 and 3081. For a Tailscale or HTTPS deployment, set the exact browser origin in `callbackOrigins`; the browser authority must also be trusted by the existing browser connection. The callback returns to `/?mcp_oauth_callback=1` on that origin. Remote OAuth requires HTTPS; loopback HTTP is supported for development.

```yaml
- id: mcp-connections
  name: '@workspacealberta/wa-mcp-connections'
  config:
    callbackOrigins: ['https://terminal.example.ca']
```

`storageDirectory` optionally selects the encrypted grant directory. Its default is `mcp-connections/oauth` under the harness home. Keep the existing browser-session secret available when restoring these records.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Connection metadata lives in the `mcp-connections` Settings namespace. The MCP SDK owns authorization discovery, dynamic client registration, PKCE, resource validation, code exchange, and refresh. Single-use sign-in state expires after ten minutes and is bound to the saved server; edits, removal, and shutdown cancel pending attempts. The browser callback clears its code and state from the address bar before calling the authenticated Host Remote.

OAuth tokens, client registration, and discovery state are encrypted with AES-256-GCM using a distinct HKDF key derived from the existing browser-session secret. Associated data binds each record to its connection id and server URL. Pending PKCE verifiers stay in memory. Removing or changing a server closes its OAuth adapter before deleting authorization, so late SDK writes cannot restore a deleted grant. Credentials are excluded from connection views and Settings.

The existing MCP supervisor owns transport generations and tool registration. Settings changes reconcile individual connections; plugin disposal closes transports and unregisters their tools. No separate invariant companion is published because this service owns both saved metadata and its live connection handles.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../mcp-client/README.md) — discovery and tool execution.
- [Settings](../../settings/settings/README.md) — durable connection metadata.
- [Browser connection](../../client/connection/README.md) — authenticated access.

-----

<a id="model-experience"></a>
## Model Experience

### Connected MCP tools

#### What the model sees

Enabled servers contribute the descriptions and input schemas of their discovered tools through the existing MCP client. OAuth grants and connection management methods are not model tools. Tool execution follows the existing execution and session recording path.

#### Token effect

Discovered tool schemas add request tokens while their server is connected. Disabled and removed servers contribute no tool schemas.

#### KV Cache effect

An unchanged discovered tool set preserves its tool-definition prefix. Enabling, disabling, or changing a server's tools can change that prefix and reduce cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These boundaries define the supported connection flow.

- OAuth sign-in requires a remote MCP server with standard OAuth discovery and dynamic client registration; manual client registration and arbitrary SaaS APIs are not configured here.
- Local commands run on the harness host. Only MCP tools are bridged; resources and prompts remain outside this interface.
- Connection status is polled while the Settings page is open. The interface does not provide provider-side token revocation or a shared organization credential store.
- Pending sign-in is canceled by a harness restart. Losing or rotating the host browser-session secret requires forgetting affected authorizations and signing in again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep OAuth credentials behind the host API and exercise cancellation before changing the SDK adapter lifecycle.

</details>
