import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { OAuthVault } from '../src/vault.ts'
import { NativeOAuth } from '../src/oauth.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function vault() {
  const root = await mkdtemp(join(tmpdir(), 'wa-native-oauth-'))
  roots.push(root)
  return { root, secret: randomBytes(32) }
}
function issuer() {
  const requests: URLSearchParams[] = []
  const fetchFn: typeof fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const reply = (body: object) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    if (url.pathname.includes('oauth-protected-resource')) return reply({ resource: 'https://mcp.example.test/mcp', authorization_servers: ['https://issuer.example.test'] })
    if (url.pathname.includes('.well-known/')) return reply({
      issuer: 'https://issuer.example.test', authorization_endpoint: 'https://issuer.example.test/authorize',
      token_endpoint: 'https://issuer.example.test/token', registration_endpoint: 'https://issuer.example.test/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    })
    if (url.pathname === '/register') {
      const body = await new Request(url, options).text()
      return reply({ ...OAuthClientMetadataSchema.parse(JSON.parse(body)), client_id: 'native-client' })
    }
    if (url.pathname === '/token') {
      const body = new URLSearchParams(await new Request(url, options).text()); requests.push(body)
      return reply({ access_token: body.has('code') ? 'secret-access' : 'refreshed-access', refresh_token: 'secret-refresh', token_type: 'Bearer', expires_in: 3600 })
    }
    return new Response('', { status: 404 })
  }
  return { fetchFn, requests }
}
describe('native MCP OAuth', () => {
  it('discovers, registers, exchanges PKCE and refreshes after an encrypted reload', async () => {
    const { root, secret } = await vault()
    const store = new OAuthVault(root, secret)
    const provider = new NativeOAuth(store, 'connection-one', () => 'single-use-state')
    await provider.load(); await provider.begin('http://localhost:3081/?mcp_oauth_callback=1')
    const server = issuer()
    expect(await auth(provider, { serverUrl: 'https://mcp.example.test/mcp', fetchFn: server.fetchFn })).toBe('REDIRECT')
    const redirect = new URL(provider.authorizationUrl()!)
    expect(redirect.searchParams.get('state')).toBe('single-use-state')
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256')
    expect(redirect.searchParams.get('redirect_uri')).toBe(provider.redirectUrl)
    expect(await auth(provider, { serverUrl: 'https://mcp.example.test/mcp', authorizationCode: 'approved-code', fetchFn: server.fetchFn })).toBe('AUTHORIZED')
    expect(server.requests[0]?.get('code_verifier')).toBe(provider.codeVerifier())
    await provider.close()
    const restored = new NativeOAuth(new OAuthVault(root, secret), 'connection-one', () => 'next-state')
    await restored.load()
    expect(restored.tokens()?.access_token).toBe('secret-access')
    expect(await auth(restored, { serverUrl: 'https://mcp.example.test/mcp', fetchFn: server.fetchFn })).toBe('AUTHORIZED')
    expect(server.requests[1]?.get('grant_type')).toBe('refresh_token')
    expect(restored.tokens()?.access_token).toBe('refreshed-access')
    const filename = (await readdir(root))[0]!
    const disk = await readFile(join(root, filename), 'utf8')
    expect(disk).not.toContain('secret-access'); expect(disk).not.toContain('secret-refresh'); expect(disk).not.toContain('native-client')
    await restored.close()
  })
  it('rejects corrupted grants and rejects late SDK writes after cancellation', async () => {
    const { root, secret } = await vault(); const store = new OAuthVault(root, secret)
    const provider = new NativeOAuth(store, 'connection-one', () => 'state')
    await provider.load(); await provider.saveTokens({ access_token: 'do-not-resurrect', token_type: 'Bearer' })
    await provider.close(); await store.remove('connection-one')
    await expect(provider.saveTokens({ access_token: 'late', token_type: 'Bearer' })).rejects.toThrow('canceled')
    expect(await store.read('connection-one')).toEqual({})
    await store.write('connection-one', { tokens: { access_token: 'protected', token_type: 'Bearer' } })
    const filename = (await readdir(root))[0]!
    await writeFile(join(root, filename), '{}')
    await expect(store.read('connection-one')).rejects.toThrow('invalid')
  })
  it('rejects a grant copied to another connection or decrypted with another host key', async () => {
    const { root, secret } = await vault(); const store = new OAuthVault(root, secret)
    await store.write('one', { tokens: { access_token: 'private', token_type: 'Bearer' } })
    await expect(new OAuthVault(root, randomBytes(32)).read('one')).rejects.toThrow('invalid')
    const first = (await readdir(root))[0]!
    await store.write('two', {})
    const second = (await readdir(root)).find(name => name !== first)!
    await writeFile(join(root, second), await readFile(join(root, first)))
    await expect(store.read('two')).rejects.toThrow('invalid')
  })
})
