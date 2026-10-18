/** External inference substitute for the recorded native-Cohere routing conversation. */
import { createServer } from 'node:http'
import { zstdDecompressSync } from 'node:zlib'
import { credentialRef } from '../../../packages/credentials/credentials/lib/index.js'
import * as Router from '../../../packages/workspace/workspace-router/lib/index.js'
import { defineTool } from '../../../packages/core/tools/lib/index.js'

/** Fixture Loader name. */
export const name = 'workspace-router-snapshot-fixture'
/** Real credential and execution seams. */
export const inject = ['tools', 'credentials']
/** Mount the actual router with one owned local inference service. @param ctx - Loader context. */
export async function apply(ctx) {
  let requests = 0
  const server = createServer((req, res) => {
    void (async () => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      // SDK 0.7 uses zstd for JSON requests above 1 KiB.
      const text = (req.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes).toString('utf8')
      const body = JSON.parse(text)
      if (req.url !== '/v1/systemone' || body.model !== 'jev-1.14.0') throw new Error('Unexpected synthetic request')
      requests += 1
      const labels = Object.keys(body.questions.operation.criteria)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ model: 'jev-fixture', usage: { input_tokens: 100, output_tokens: 10 }, answers: {
        operation: { type: 'choice', choice: 'search', confidence: 1,
          probabilities: Object.fromEntries(labels.map(label => [label, label === 'search' ? 1 : 0])) },
      } }))
    })().catch(() => { res.writeHead(500); res.end('Invalid synthetic request') })
  })
  ctx.effect(() => async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    if (requests !== 1) throw new Error('Expected exactly one auxiliary router request')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await ctx.credentials.set(credentialRef('WORKSPACE_ROUTER_FIXTURE_KEY'), 'synthetic-router-key')
  const target = 'mcp__workspace_alberta__search_opportunities'
  ctx.tools.register(defineTool({ name: target, description: 'Synthetic procurement retrieval; not needed for a recommendation.',
    parameters: { keywords: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute() { throw new Error('Recommendation mode must not dispatch procurement retrieval') },
  }))
  await ctx.plugin(Router, Router.Config({ apiKeyRef: 'WORKSPACE_ROUTER_FIXTURE_KEY', baseURL: `http://127.0.0.1:${address.port}`,
    mode: 'recommend', model: 'jev-1.14.0',
    tools: { search: target, match: target, details: target, deadlines: target, bid_room: target },
    minConfidence: { search: 0.9, match: 0.9, details: 0.9, deadlines: 0.9, bid_room: 0.9 }, referenceConfidence: 0.9,
  }))
}
