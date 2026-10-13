# Agent Note: Native MCP connections in WorkspaceAlberta

Status: implemented

English | [中文](2026-10-13-native-mcp-connections.zh.md)

## Problem

Business owners need to connect tools from their harness interface. Requiring a separate integration vendor adds an account and a deployment dependency to an unused connection path.

## Decision

[Native MCP connections](../../../../packages/mcp/mcp-connections/README.md) own durable connection metadata, local encrypted OAuth grants, and an authenticated Remote used by Settings. The maintained MCP SDK owns standard authorization; the existing MCP client contributes discovered tools to the harness. The Web bundle mounts the service and the Settings plugin contributes its Connections section. Settings notifications compare the current document with last applied metadata, so a delayed callback cannot restore an older server configuration.

## Alternatives considered

**Composio or Nango:** a vendor can manage app-specific OAuth and connector catalogs, but the requested interface connects MCP servers directly and does not require that additional account or service. Standard MCP authorization supplies the needed connection flow.

**Configuration-only MCP servers:** composition entries remain useful for deployment-owned tools, but do not let a business owner add, sign in, and manage saved servers in Settings.

## Consequences

Credentials remain on the host, encrypted under a key derived from the existing browser-session secret, and never appear in connection metadata. Losing that root requires signing in again. Sign-in state is single-use, expires after ten minutes, and is canceled on edits, removal, and shutdown. Forgetting sign-in disables the connection and removes local grants; it does not revoke provider-side access. OAuth currently requires standard MCP discovery and dynamic registration; individual SaaS connector implementations remain the connected server's responsibility.
