import { TypeSafeClient } from '@typesafe-ai/sdk'
import { expect, it } from 'vitest'
import { parseAnswer, questionsFor } from '../src/decision.ts'

const cases = [
  ['Search procurement opportunities for steel fabrication.', 'search'],
  ['Find opportunities that match our business capabilities.', 'match'],
  ['Show the details of tender AB-2026-12345.', 'details'],
  ['List procurement closing dates over the next two weeks.', 'deadlines'],
  ['Analyze the attachments and requirements for tender AB-2026-12345 in the bid room.', 'bid_room'],
  ['Fix a TypeScript compiler error in my application.', 'reason'],
  ['Search for fabrication tenders and analyze the attachments of every match.', 'reason'],
] as const

it.skipIf(!process.env.TYPESAFE_API_KEY).each(cases)(
  'live Jev classifies %s', { retry: 0 }, async (request, expected) => {
    const apiKey = process.env.TYPESAFE_API_KEY
    if (!apiKey) throw new Error('TYPESAFE_API_KEY is required for live Jev verification')
    const client = new TypeSafeClient({ apiKey,
      defaultModel: process.env.TYPESAFE_MODEL ?? 'jev-1.14.0', timeout: 30000, retry: { maxRetries: 0 }, logLevel: 'off' })
    const state = { request, keywords: 'steel fabrication', profile: { description: 'Edmonton steel fabricator' },
      references: [{ reference: 'AB-2026-12345', title: 'Steel fabrication', observedAt: Date.now() }],
    }
    const questions = questionsFor(state)
    const start = performance.now()
    const response = await client.systemOne({ state, questions })
    const operation = parseAnswer(response.answers.operation, Object.keys(questions.operation.criteria))
    console.info(JSON.stringify({ expected, selected: operation.choice, confidence: operation.confidence,
      elapsedMs: Math.round(performance.now() - start), model: response.model, usage: response.usage }))
    expect(operation.choice).toBe(expected)
  },
)

it.skipIf(!process.env.TYPESAFE_API_KEY || !process.env.COHERE_API_KEY)(
  'runs the actual router with live Jev under native Cohere v2 without dispatching its recommendation', async () => {
    const { Context } = await import('@workspacealberta/cordis')
    const { default: LlmRuntime, createUserMessage } = await import('@workspacealberta/wa-llm')
    const { default: Sessions, SessionId } = await import('@workspacealberta/wa-session')
    const { default: Projections } = await import('@workspacealberta/wa-session-projection')
    const { default: Prompt } = await import('@workspacealberta/wa-system-prompt')
    const { default: Tools, defineTool } = await import('@workspacealberta/wa-tools')
    const { default: Agents } = await import('@workspacealberta/wa-agent')
    const { default: Loop } = await import('@workspacealberta/wa-agent-loop')
    const { CredentialProvider } = await import('@workspacealberta/wa-credentials')
    const PiAi = await import('@workspacealberta/wa-llm-pi-ai')
    const Router = await import('../src/index.ts')
    class Credentials extends CredentialProvider {
      async resolve(ref: string) { const value = process.env[ref]; return value ? { value, source: 'live-test' } : undefined }
      async describe() { return { configured: true, writable: false } }
      async set() { throw new Error('read only') }
      async unset() { throw new Error('read only') }
      async readRecord() { return undefined }
      async describeRecord() { return { configured: false, writable: false } }
      async listRecords() { return [] }
      async modifyRecord(): Promise<never> { throw new Error('read only') }
      async deleteRecord() { throw new Error('read only') }
    }
    const ctx = new Context()
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(Sessions)
      await ctx.plugin(Projections)
      await ctx.plugin(Prompt)
      await ctx.plugin(Tools)
      await ctx.plugin(Agents)
      await ctx.plugin(Credentials)
      await ctx.plugin(Loop, { agents: [] })
      await ctx.plugin(PiAi, { providers: { 'cohere-canada': { displayName: 'Cohere', apiKeyEnv: 'COHERE_API_KEY',
        api: 'cohere-v2-chat', baseURL: 'https://api.cohere.com/v2',
        models: [{ id: 'command-a-plus-05-2026', contextWindow: 256000, maxTokens: 2048 }] } } })
      let dispatched = false
      ctx.tools.register(defineTool({ name: 'search_fixture', description: 'Synthetic search target; do not invoke it.',
        parameters: { keywords: { type: 'string', required: true } },
        output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute() { dispatched = true; return { items: [] } } }))
      await ctx.plugin(Router, Router.Config({ mode: 'recommend',
        tools: { search: 'search_fixture', match: 'search_fixture', details: 'search_fixture', deadlines: 'search_fixture', bid_room: 'search_fixture' },
        minConfidence: { search: 0.9, match: 0.9, details: 0.9, deadlines: 0.9, bid_room: 0.9 }, referenceConfidence: 0.9 }))
      const agent = await ctx.agentLoop.create(SessionId('cohere-jev-router-live'), {
        provider: 'cohere-canada', model: 'command-a-plus-05-2026' })
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
        'Call workspace_route exactly once with request "Search procurement opportunities for steel fabrication" and keywords "steel fabrication". Report its decision kind. Do not call search_fixture.' }] }))
      await agent.whenIdle()
      const events = agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toMatchObject({ kind: 'completed' })
      expect(events.filter(event => event.type === 'workspace/route').map(event => event.data.phase)).toEqual(['request', 'decision'])
      const decision = events.find(event => event.type === 'workspace/route' && event.data.phase === 'decision')
      expect(decision?.data).toMatchObject({ value: { decision: { kind: 'recommend', operation: 'search', tool: 'search_fixture' } } })
      expect(dispatched).toBe(false)
    } finally { await ctx.fiber.dispose() }
  },
)
