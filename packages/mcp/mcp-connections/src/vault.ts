/** Encrypted local OAuth records, bound to a connection id and server URL. */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@workspacealberta/wa-atomic-write'
import { OAuthTokensSchema, OAuthClientInformationSchema, OAuthMetadataSchema, OpenIdProviderMetadataSchema, OAuthProtectedResourceMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens, OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'

const discoverySchema = z.object({
  authorizationServerUrl: z.url(),
  authorizationServerMetadata: z.union([OAuthMetadataSchema, OpenIdProviderMetadataSchema]).optional(),
  resourceMetadata: OAuthProtectedResourceMetadataSchema.optional(), resourceMetadataUrl: z.url().optional(),
}).transform(state => ({
  authorizationServerUrl: state.authorizationServerUrl,
  ...(state.authorizationServerMetadata ? { authorizationServerMetadata: state.authorizationServerMetadata } : {}),
  ...(state.resourceMetadata ? { resourceMetadata: state.resourceMetadata } : {}),
  ...(state.resourceMetadataUrl ? { resourceMetadataUrl: state.resourceMetadataUrl } : {}),
}))
const grantSchema = z.object({
  tokens: OAuthTokensSchema.optional(),
  discovery: discoverySchema.optional(),
  client: OAuthClientInformationSchema.loose().optional(),
  redirectUrl: z.string().optional(),
})
/** Durable OAuth state; pending PKCE verifiers are memory-only. */
export interface OAuthGrant {
  discovery?: OAuthDiscoveryState | undefined
  tokens?: OAuthTokens | undefined
  client?: OAuthClientInformationMixed | undefined
  redirectUrl?: string | undefined
}

/** Host-only encrypted store. The encryption root is the existing browser-session secret. */
export class OAuthVault {
  private readonly key: Buffer
  constructor(private readonly directory: string, secret: Uint8Array) {
    if (secret.byteLength !== 32) throw new Error('MCP OAuth encryption requires a 32-byte host secret')
    this.key = Buffer.from(hkdfSync('sha256', secret, Buffer.from('WorkspaceAlberta'), Buffer.from('mcp-oauth-v1'), 32))
  }
  private path(identity: string): string { return join(this.directory, createHash('sha256').update(identity).digest('hex') + '.json') }
  /** Read and authenticate one complete record; corruption fails closed. */
  async read(identity: string): Promise<OAuthGrant> {
    let text: string
    try { text = await readFile(this.path(identity), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
    try {
      const envelope = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), body: z.string() }).parse(JSON.parse(text))
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64url'))
      cipher.setAAD(Buffer.from(identity))
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
      const body = Buffer.concat([cipher.update(Buffer.from(envelope.body, 'base64url')), cipher.final()])
      return grantSchema.parse(JSON.parse(body.toString('utf8')))
    } catch { throw new Error('MCP OAuth record is invalid; disconnect and sign in again') }
  }
  /** Atomically replace a record without placing credentials in settings or logs. */
  async write(identity: string, grant: OAuthGrant): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(identity))
    const body = Buffer.concat([cipher.update(JSON.stringify(grantSchema.parse(grant)), 'utf8'), cipher.final()])
    await writeFileAtomic(this.path(identity), JSON.stringify({ version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), body: body.toString('base64url') }) + '\n', { mode: 0o600 })
  }
  /** Remove this terminal's stored authorization. Provider-side revocation is separate. */
  async remove(identity: string): Promise<void> { await rm(this.path(identity), { force: true }) }
}
