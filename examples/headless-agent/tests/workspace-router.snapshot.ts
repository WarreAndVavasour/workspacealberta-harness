import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@workspacealberta/wa-loader-smoke'
import { normalizeSessionLog } from '@workspacealberta/wa-acp-snapshot'
import { z } from 'zod'

const fixture = fileURLToPath(new URL('./fixtures/workspace-router/cordis.yml', import.meta.url))
const driver = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const names = ['search_opportunities', 'find_matching_opportunities', 'get_opportunity_details', 'list_deadlines', 'process_bid_room']
const bodySchema = z.object({
  state: z.object({ request: z.string() }),
  questions: z.record(z.string(), z.object({ type: z.literal('choice'), criteria: z.record(z.string(), z.unknown()) })),
})
const rpcSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional(),
})

function send(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function fixtureServer() {
  const calls: unknown[] = []
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === 'GET') { response.writeHead(405); response.end(); return }
      let text = ''
      for await (const chunk of request) text += String(chunk)
      try {
        const parsed: unknown = JSON.parse(text)
        if (request.url === '/v1/systemone') {
          const body = bodySchema.parse(parsed)
          requests.push(parsed)
          const scenario = body.state.request
          const operation = scenario === 'uncertain' ? 'search'
            : scenario === 'missing-profile' ? 'match' : scenario === 'ambiguous-reference' ? 'details' : scenario
          const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
            const selected = key === 'operation' ? operation : scenario === 'ambiguous-reference' ? 'none' : 'reference_0'
            return [key, { type: 'choice', choice: selected,
              confidence: body.state.request === 'uncertain' ? 0.1 : 1,
              probabilities: Object.fromEntries(Object.keys(question.criteria).map(label => [label, label === selected ? 1 : 0])),
            }]
          }))
          send(response, { model: 'jev-fixture', answers, usage: { input_tokens: 100, output_tokens: 10 } })
          return
        }
        const rpc = rpcSchema.parse(parsed)
        if (rpc.id === undefined) { response.writeHead(202); response.end(); return }
        let result: unknown
        switch (rpc.method) {
          case 'initialize': result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'procurement-fixture', version: '1' } }; break
          case 'tools/list': result = { tools: names.map(name => ({ name, description: `Fixture ${name}`, inputSchema: { type: 'object', additionalProperties: true } })) }; break
          case 'tools/call':
            calls.push(rpc.params)
            result = { content: [{ type: 'text', text: 'Retrieved AB-2026-12345 from the procurement fixture.' }] }
            break
          case 'ping': result = {}; break
          default: throw new Error(`Unexpected RPC ${rpc.method}`)
        }
        send(response, { jsonrpc: '2.0', id: rpc.id, result })
      } catch (error) {
        response.writeHead(500)
        response.end(String(error))
      }
    })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error(String(error))) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture server has no port')
  return { url: `http://127.0.0.1:${address.port}`, requests, calls,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    },
  }
}

describe('WorkspaceAlberta Jev Loader transcript', () => {
  it.each(['search', 'match', 'details', 'deadlines', 'bid_room', 'reason', 'uncertain', 'clarify', 'missing-profile', 'ambiguous-reference'])(
    'routes %s through the assembled application', async (request) => {
      const server = await fixtureServer()
      try {
        const args = { request, keywords: 'steel',
          ...request === 'missing-profile' ? {} : { profile: { description: 'Edmonton steel fabricator' } },
          source: 'federal', days: 14, limit: 3,
          references: [{ reference: 'AB-2026-12345', title: 'Steel fabrication', observedAt: 0 }],
        }
        const run = await runLoaderSmoke({
          label: `Jev ${request} transcript`, tempDirPrefix: 'jev-snapshot-', binScript: driver, configPath: fixture,
          tsconfigPath: tsconfig, binArgs: [fixture, JSON.stringify(args)],
          env: { TYPESAFE_FIXTURE_KEY: 'fixture-key', WORKSPACE_FIXTURE_URL: server.url, DSH_TELEMETRY_DISABLED: '1' },
        })
        const records = run.stdout.trim().split('\n').map(line => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
        const events = records.filter(record => record.type === 'session_event').map(record => z.object({ type: z.string(), data: z.unknown() }).parse(record.event))
        const relevant = events.filter(event => ['workspace/route', 'tool/call', 'tool/result', 'assistant/message'].includes(event.type))
        expect(server.requests).toHaveLength(1)
        expect(server.calls).toHaveLength(['search', 'match', 'details', 'deadlines', 'bid_room'].includes(request) ? 1 : 0)
        expect(JSON.stringify(relevant)).not.toContain('fixture-key')
        const normalized = normalizeSessionLog(relevant.map(event => JSON.stringify(event)).join('\n'), {
          sessionIds: [], cwd: process.cwd(),
        })
        expect({ events: normalized.trim().split('\n').map(line => JSON.parse(line) as unknown),
          calls: server.calls, output: records.at(-1)?.output }).toMatchSnapshot()
      } finally { await server.close() }
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
