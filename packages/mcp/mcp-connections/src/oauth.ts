/** Native MCP OAuth adapter; discovery, PKCE and refresh belong to the MCP SDK. */
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthGrant, OAuthVault } from './vault.ts'

/** One connection's SDK adapter and memory-only pending authorization. */
export class NativeOAuth implements OAuthClientProvider {
  private verifier = ''
  private redirect = ''
  private authorization = ''
  private grant: OAuthGrant = {}
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private readonly cancellation = new AbortController()
  readonly fetch: typeof fetch = (input, options) => fetch(input, {
    ...options, signal: AbortSignal.any([this.cancellation.signal, ...(options?.signal ? [options.signal] : [])]),
  })
  constructor(private readonly vault: OAuthVault, readonly identity: string, private readonly csrf: () => string) {}
  /** Restore encrypted credentials before opening a transport. */
  async load(): Promise<void> { this.grant = await this.vault.read(this.identity); this.redirect = this.grant.redirectUrl ?? '' }
  get redirectUrl(): string { return this.redirect }
  get clientMetadata(): OAuthClientMetadata {
    if (!this.redirect) throw new Error('Sign in from Connections to authorize this MCP server')
    return { client_name: 'WorkspaceAlberta', redirect_uris: [this.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }
  }
  state(): string { return this.csrf() }
  clientInformation(): OAuthClientInformationMixed | undefined { return this.grant.client }
  discoveryState(): OAuthDiscoveryState | undefined { return this.grant.discovery }
  async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> { await this.commit({ discovery }) }
  tokens(): OAuthTokens | undefined { return this.grant.tokens }
  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> { await this.commit({ client }) }
  async saveTokens(tokens: OAuthTokens): Promise<void> { await this.commit({ tokens }) }
  saveCodeVerifier(verifier: string): void { this.verifier = verifier }
  codeVerifier(): string { if (!this.verifier) throw new Error('MCP OAuth attempt is no longer available'); return this.verifier }
  redirectToAuthorization(url: URL): void {
    if (!this.redirect) throw new Error('Sign in from Connections to authorize this MCP server')
    this.authorization = url.href
  }
  /** Begin a human sign-in; a changed callback invalidates the previous registration. */
  async begin(redirectUrl: string): Promise<void> {
    if (this.grant.redirectUrl !== redirectUrl) await this.update(() => ({ redirectUrl }))
    this.redirect = redirectUrl
    this.authorization = ''
    await this.commit({ redirectUrl })
  }
  /** Read the temporary authorization URL without exposing any stored grants. */
  authorizationUrl(): string | null { return this.authorization || null }
  /** Discard credentials requested by the SDK after an invalid grant/client. */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all' || scope === 'verifier') this.verifier = ''
    await this.update((grant) => {
      const next = scope === 'all' ? { redirectUrl: this.redirect } : { ...grant }
      if (scope === 'client') delete next.client
      if (scope === 'tokens') delete next.tokens
      if (scope === 'discovery') delete next.discovery
      return next
    })
  }
  /** Reject late SDK writes, then wait for already-owned durable writes to finish. */
  async close(): Promise<void> { this.closed = true; this.cancellation.abort(); this.verifier = ''; await this.tail }
  private commit(patch: Partial<OAuthGrant>): Promise<void> {
    return this.update(grant => ({ ...grant, ...patch }))
  }
  private update(change: (grant: OAuthGrant) => OAuthGrant): Promise<void> {
    const operation = this.tail.then(async () => {
      if (this.closed) throw new Error('MCP authorization was canceled')
      const next = change(this.grant)
      await this.vault.write(this.identity, next)
      this.grant = next
    })
    // The caller receives a persistence failure; the queue still accepts its next operation.
    this.tail = operation.catch(() => {})
    return operation
  }
}
