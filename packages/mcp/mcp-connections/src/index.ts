/** Native, host-owned MCP connections for the authenticated Settings interface. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Context, Service } from '@workspacealberta/cordis'
import s from '@workspacealberta/schemastery'
import { z } from 'zod'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { credentialKey, credentialRef } from '@workspacealberta/wa-credentials'
import type {} from '@workspacealberta/wa-settings'
import type {} from '@workspacealberta/wa-client-connection'
import { TypertRemoteService, Remote } from '@workspacealberta/wa-typert-protocol'
import { resolveDshHome } from '@workspacealberta/wa-home-paths'
import { startConnection, resolveReconnectPolicy } from '@workspacealberta/wa-mcp-client/src/connection.ts'
import type { ConnectionHandle } from '@workspacealberta/wa-mcp-client/src/connection.ts'
import type { Config as McpConfig } from '@workspacealberta/wa-mcp-client'
import type { SettingsScope } from '@workspacealberta/wa-settings'
import type { ConnectionInput, ConnectionView, SignInRequest, SignInResult, OAuthCallback } from './types.ts'
import { OAuthVault } from './vault.ts'
import { NativeOAuth } from './oauth.ts'

export type * from './types.ts'

declare module '@workspacealberta/cordis' { interface Context { mcpConnections: McpConnections } }

/** Deployment policy for browser redirects and encrypted local OAuth storage. */
export interface Config { callbackOrigins: string[]; storageDirectory?: string }
const connectionSchema = s.object({
  id: s.string().required(), name: s.string().required(),
  transport: s.union(['streamable-http', 'stdio']).required(),
  url: s.string().default(''), command: s.string().default(''),
  args: s.array(String).default([]), envRefs: s.dict(String).default({}),
  enabled: s.boolean().default(true), oauth: s.boolean().default(false),
})
interface SavedConnections { connections: ConnectionInput[] }
const savedSchema: s<SavedConnections> = s.object({ connections: s.array(connectionSchema).default([]) })
interface LiveConnection { signature: string; handle?: ConnectionHandle; provider?: NativeOAuth; status: ConnectionView['status'] }
interface LoginAttempt { id: string; identity: string; provider: NativeOAuth; expiresAt: number }

/** Validate user-owned connection metadata before it becomes durable. */
export function validateConnection(input: ConnectionInput): void {
  if (!input.name.trim() || input.name.length > 120) throw new Error('Give the connection a name of at most 120 characters')
  if (input.transport === 'streamable-http') {
    const url = new URL(input.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Use an HTTP or HTTPS MCP server URL without embedded credentials')
    for (const key of url.searchParams.keys()) if (/token|secret|api.?key|authorization/i.test(key)) throw new Error('Keep credentials out of the server URL')
    if (input.oauth && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('OAuth requires HTTPS, except for a local MCP server')
  } else {
    if (!input.command.trim()) throw new Error('Enter the local server command')
    if (input.oauth) throw new Error('Browser OAuth is available for HTTP MCP servers')
  }
  if (input.args.length > 100 || Object.keys(input.envRefs).length > 100) throw new Error('Too many command arguments or credential references')
  for (const [name, ref] of Object.entries(input.envRefs)) { credentialRef(name); credentialRef(ref) }
}

/** Persistent connection manager. Public methods expose metadata, never OAuth tokens. */
export class McpConnections extends TypertRemoteService {
  static inject = ['tools', 'credentials', 'settings', 'connection']
  static Config: s<Config> = s.object({
    callbackOrigins: s.array(String).default(['http://127.0.0.1:3080', 'http://localhost:3080', 'http://127.0.0.1:3081', 'http://localhost:3081']),
    storageDirectory: s.string(),
  })
  private scope!: SettingsScope<SavedConnections>
  private vault!: OAuthVault
  private readonly live = new Map<string, LiveConnection>()
  private readonly attempts = new Map<string, LoginAttempt>()
  private readonly origins: Set<string>
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private readonly shutdown = new AbortController()
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'mcpConnections')
    this.origins = new Set(config.callbackOrigins.map((value) => {
      const url = new URL(value)
      if (url.href !== url.origin + '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('OAuth callback origins must use HTTPS or loopback HTTP')
      return url.origin
    }))
  }
  /** Restore metadata and the existing host secret without writing to 1Password. */
  protected async [Service.init](): Promise<void> {
    const record = await this.ctx.credentials.readRecord(credentialKey('client-connection', 'browser-session'))
    const payload = z.object({ version: z.literal(1), secret: z.string() }).parse(record?.kind === 'grant' ? record.payload : null)
    const secret = Buffer.from(payload.secret, 'base64url')
    if (secret.toString('base64url') !== payload.secret) throw new Error('Invalid browser-session encryption root')
    this.vault = new OAuthVault(this.config.storageDirectory ?? join(resolveDshHome(), 'mcp-connections', 'oauth'), secret)
    this.scope = this.ctx.settings.register('mcp-connections', savedSchema, {
      validate: (section) => {
        if (section.connections.length > 50) throw new Error('This terminal supports at most 50 saved MCP connections')
        const ids = new Set<string>()
        for (const row of section.connections) {
          validateConnection(row)
          if (!row.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id) || ids.has(row.id)) throw new Error('MCP connection ids must be unique')
          ids.add(row.id)
        }
      },
    })
    this.ctx.effect(() => () => {
      this.closed = true
      this.shutdown.abort()
      for (const attempt of this.attempts.values()) void attempt.provider.close()
      this.attempts.clear()
      return this.tail.then(async () => {
        await Promise.all([...this.live.values()].map(value => this.stop(value)))
        this.live.clear()
      })
    }, 'mcp-connections.close')
    await this.reconcile()
    this.ctx.effect(() => this.scope.watch((next, previous) => this.serial(async () => {
      for (const row of previous.connections) {
        const replacement = next.connections.find(value => value.id === row.id)
        if (JSON.stringify(row) === JSON.stringify(replacement) || (replacement && this.live.get(row.id ?? '')?.signature === this.signature(replacement))) continue
        await this.cancelAttempts(row.id ?? '')
        await this.stop(this.live.get(row.id ?? ''))
        this.live.delete(row.id ?? '')
        if (!replacement || this.identity(row) !== this.identity(replacement) || row.oauth !== replacement.oauth) {
          await this.vault.remove(this.identity(row))
        }
      }
      for (const row of next.connections) {
        const before = previous.connections.find(value => value.id === row.id)
        if (row.enabled && JSON.stringify(before) !== JSON.stringify(row) && this.live.get(row.id ?? '')?.signature !== this.signature(row)) await this.restart(row)
      }
    })), 'mcp-connections.settings-watch')
  }
  /** List user-owned connections, including disabled and failed servers. */
  @Remote('list')
  async list(): Promise<ConnectionView[]> {
    return Promise.all(this.scope.get().connections.map(async (row) => {
      const id = row.id ?? ''
      let signedIn = false
      try { signedIn = (await this.vault.read(this.identity(row))).tokens !== undefined }
      catch { /* An invalid grant is represented by the failed connection and can be forgotten. */ }
      const live = this.live.get(id)
      const runtime = live?.handle?.status
      const status = runtime === 'failed' ? (row.oauth ? 'sign-in-required' : 'failed') : runtime === 'closed' ? 'disabled' : runtime ?? live?.status ?? (row.enabled && row.oauth ? 'sign-in-required' : 'disabled')
      return { ...row, id, status, signedIn }
    }))
  }
  /** Add or edit a connection; settings persist before its runtime is replaced. */
  @Remote('save')
  async save(input: ConnectionInput): Promise<void> {
    validateConnection(input)
    await this.serial(async () => {
      const rows = this.scope.get().connections
      if (input.id !== undefined && !rows.some(row => row.id === input.id)) throw new Error('Connection no longer exists')
      const next = { ...input, name: input.name.trim(), id: input.id ?? randomUUID() }
      await this.scope.replace({ connections: [...rows.filter(row => row.id !== next.id), next] })
      await this.cancelAttempts(next.id)
      const previous = rows.find(row => row.id === next.id)
      await this.stop(this.live.get(next.id))
      if (previous && (this.identity(previous) !== this.identity(next) || previous.oauth !== next.oauth)) {
        await this.vault.remove(this.identity(previous))
      }
      await this.restart(next)
    })
  }
  /** Remove metadata, registered tools, pending sign-in and local OAuth authorization. */
  @Remote('remove')
  async remove(id: string): Promise<void> {
    await this.serial(async () => {
      const row = this.row(id)
      await this.scope.replace({ connections: this.scope.get().connections.filter(value => value.id !== id) })
      await this.cancelAttempts(id)
      await this.stop(this.live.get(id))
      this.live.delete(id)
      await this.vault.remove(this.identity(row))
    })
  }
  /** Reconnect a saved server and refresh its discovered tools. */
  @Remote('reconnect')
  async reconnect(id: string): Promise<void> { await this.serial(() => this.restart(this.row(id))) }
  /** Forget this terminal's OAuth grant. This does not revoke access at the provider. */
  @Remote('disconnect')
  async disconnect(id: string): Promise<void> {
    await this.serial(async () => {
      const row = this.row(id)
      await this.cancelAttempts(id)
      await this.stop(this.live.get(id))
      this.live.delete(id)
      await this.vault.remove(this.identity(row))
      await this.scope.replace({
        connections: this.scope.get().connections.map(value => value.id === id ? { ...value, enabled: false } : value),
      })
    })
  }
  /** Begin standard MCP OAuth from an approved browser origin. */
  @Remote('signIn')
  async signIn(request: SignInRequest): Promise<SignInResult> {
    return this.serial(async () => {
      const row = this.row(request.id)
      if (!row.enabled || row.transport !== 'streamable-http' || !row.oauth) {
        throw new Error('Enable OAuth on an HTTP connection before signing in')
      }
      if (!this.origins.has(request.origin)) throw new Error('This browser address is not approved for OAuth callbacks')
      await this.cancelAttempts(request.id)
      await this.stop(this.live.get(request.id))
      this.live.delete(request.id)
      const state = randomUUID()
      const provider = new NativeOAuth(this.vault, this.identity(row), () => state)
      await provider.load()
      await provider.begin(new URL('/?mcp_oauth_callback=1', request.origin).href)
      this.attempts.set(state, { id: request.id, identity: this.identity(row), provider, expiresAt: Date.now() + 10 * 60_000 })
      try {
        const result = await auth(provider, { serverUrl: row.url, fetchFn: this.oauthFetch(provider) })
        if (result === 'AUTHORIZED') { this.attempts.delete(state); await provider.close(); await this.restart(row); return { authorizationUrl: null } }
        return { authorizationUrl: provider.authorizationUrl() }
      } catch { this.attempts.delete(state); await provider.close(); throw new Error('MCP sign-in could not start; check the server supports MCP OAuth') }
    })
  }
  /** Validate the single-use state and exchange the authorization code on the host. */
  @Remote('completeAuthorization')
  async completeAuthorization(callback: OAuthCallback): Promise<void> {
    await this.serial(async () => {
      const attempt = this.attempts.get(callback.state)
      this.attempts.delete(callback.state)
      if (!attempt) throw new Error('Sign-in expired or was canceled; start again from Connections')
      try {
        if (attempt.expiresAt < Date.now() || callback.error || !callback.code) throw new Error('Sign-in was not completed')
        const row = this.row(attempt.id)
        if (!row.enabled || !row.oauth || this.identity(row) !== attempt.identity) throw new Error('Connection changed during sign-in')
        const result = await auth(attempt.provider, {
          serverUrl: row.url, authorizationCode: callback.code, fetchFn: this.oauthFetch(attempt.provider),
        })
        if (result !== 'AUTHORIZED') throw new Error('Authorization not completed')
        await attempt.provider.close()
        await this.restart(row)
      } catch { throw new Error('MCP sign-in failed; start again from Connections') }
      finally { await attempt.provider.close() }
    })
  }
  private row(id: string): ConnectionInput {
    const value = this.scope.get().connections.find(row => row.id === id)
    if (!value) throw new Error('Connection no longer exists')
    return value
  }
  private signature(row: ConnectionInput): string {
    return JSON.stringify([row.id, row.name, row.transport, row.url, row.command, row.args,
      Object.entries(row.envRefs).sort(), row.enabled, row.oauth])
  }
  private identity(row: ConnectionInput): string { return `${row.id}\n${row.transport}\n${row.url}` }
  private async cancelAttempts(id: string): Promise<void> {
    for (const [state, attempt] of this.attempts) if (attempt.id === id || attempt.expiresAt < Date.now()) {
      this.attempts.delete(state)
      await attempt.provider.close()
    }
  }
  private oauthFetch(provider: NativeOAuth): typeof fetch {
    return (input, options) => provider.fetch(input, {
      ...options,
      signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(30_000), ...(options?.signal ? [options.signal] : [])]),
    })
  }
  private async stop(live: LiveConnection | undefined): Promise<void> {
    await live?.provider?.close()
    await live?.handle?.dispose()
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Connections are shutting down'))
    const pending = this.tail.then(() => {
      if (this.closed) throw new Error('Connections are shutting down')
      return operation()
    })
    // Preserve queue ordering after an operation rejects; its caller receives the failure.
    this.tail = pending.then(() => {}, () => {})
    return pending
  }
  private async reconcile(): Promise<void> {
    for (const value of this.live.values()) await this.stop(value)
    this.live.clear()
    for (const row of this.scope.get().connections) if (row.enabled) await this.restart(row)
  }
  private async restart(row: ConnectionInput): Promise<void> {
    const id = row.id ?? ''
    await this.stop(this.live.get(id))
    this.live.delete(id)
    if (!row.enabled || this.closed) return
    const live: LiveConnection = { signature: this.signature(row), status: 'connecting' }
    this.live.set(id, live)
    try {
      const common = { serverName: 'user_' + Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url'), toolCallTimeoutMs: 60_000, failOnStartupError: false }
      const env: Record<string, string> = {}
      for (const [key, ref] of Object.entries(row.envRefs)) {
        const value = await this.ctx.credentials.resolve(credentialRef(ref))
        if (!value) throw new Error(`Configure credential reference ${ref} before starting this connection`)
        env[key] = value.value
      }
      const config: McpConfig = row.transport === 'streamable-http'
        ? { ...common, transport: 'streamable-http', url: row.url, headers: {} }
        : { ...common, transport: 'stdio', command: row.command, args: row.args, env, cwd: '' }
      let provider: NativeOAuth | undefined
      if (row.oauth) {
        provider = new NativeOAuth(this.vault, this.identity(row), () => randomUUID())
        await provider.load()
        live.provider = provider
      }
      const handle = startConnection(this.ctx, config, resolveReconnectPolicy({ maxAttempts: 1 }, 'MCP connection'), provider, provider?.fetch)
      live.handle = handle
      if (provider) live.provider = provider
      void handle.ready.then((outcome) => {
        if (this.live.get(id) !== live) return
        live.status = outcome.error ? (row.oauth ? 'sign-in-required' : 'failed') : 'connected'
      })
    } catch { live.status = 'failed' }
  }
}

export default McpConnections
