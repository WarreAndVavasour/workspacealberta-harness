import { createServer } from 'node:http'
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

/** Loopback MCP and OAuth issuer fixture; owns its listener and per-request SDK resources. */
export async function startOAuthFixture() {
  let origin = ''
  let access = 'initial-access'
  const exchanges: URLSearchParams[] = []
  const active = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const work = (async () => {
      const url = new URL(request.url ?? '/', origin)
      const json = (body: object, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)) }
      if (url.pathname.includes('oauth-protected-resource')) { json({ resource: origin + '/mcp', authorization_servers: [origin] }); return }
      if (url.pathname.includes('.well-known/')) { json({ issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', registration_endpoint: origin + '/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }); return }
      if (url.pathname === '/register' || url.pathname === '/token') {
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          const data: unknown = chunk
          if (!(data instanceof Uint8Array)) throw new Error('Expected fixture request bytes')
          chunks.push(Buffer.from(data))
        }
        const body = Buffer.concat(chunks).toString('utf8')
        if (url.pathname === '/register') { json({ ...OAuthClientMetadataSchema.parse(JSON.parse(body)), client_id: 'fixture-client' }); return }
        const form = new URLSearchParams(body); exchanges.push(form)
        if (form.get('code') === 'denied') { json({ error: 'invalid_grant' }, 400); return }
        access = form.get('grant_type') === 'refresh_token' ? 'refreshed-access' : 'authorized-access'
        json({ access_token: access, refresh_token: 'fixture-refresh-secret', token_type: 'Bearer', expires_in: 3600 }); return
      }
      if (url.pathname !== '/mcp') { response.writeHead(404).end(); return }
      if (request.headers.authorization !== 'Bearer ' + access) { response.writeHead(401, { 'WWW-Authenticate': 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"' }).end(); return }
      const mcp = new McpServer({ name: 'protected-fixture', version: '1' })
      mcp.registerTool('ping', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'authenticated pong' }] }))
      const transport = new StreamableHTTPServerTransport({})
      const closed: PromiseWithResolvers<void> = Promise.withResolvers()
      response.once('close', () =>{  closed.resolve() })
      try { await mcp.connect(transport as Transport); await transport.handleRequest(request, response); await closed.promise }
      finally { await transport.close(); await mcp.close() }
    })()
    active.add(work)
    void work.catch(() => { if (!response.headersSent) response.writeHead(500); response.end() }).finally(() => active.delete(work))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing OAuth fixture address')
  origin = 'http://127.0.0.1:' + String(address.port)
  return { url: origin + '/mcp', exchanges,
    expire() { access = 'expired-token' },
    async close() {
      const closing = new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
      server.closeAllConnections(); await closing; await Promise.allSettled(active)
    },
  }
}
