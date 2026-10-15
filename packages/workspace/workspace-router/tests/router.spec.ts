import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import AgentRegistry from '@workspacealberta/wa-agent'
import AgentLoop from '@workspacealberta/wa-agent-loop'
import { CredentialProvider } from '@workspacealberta/wa-credentials'
import LlmRuntime, { ToolCallId, createUserMessage } from '@workspacealberta/wa-llm'
import SessionProjectionRegistry from '@workspacealberta/wa-session-projection'
import SessionStore, { SessionId } from '@workspacealberta/wa-session'
import SystemPrompt from '@workspacealberta/wa-system-prompt'
import ToolRuntime, { defineTool } from '@workspacealberta/wa-tools'
import * as router from '../src/index.ts'
import { questionsFor } from '../src/decision.ts'

class Credentials extends CredentialProvider {
  async resolve() { return { value: 'fixture-key', source: 'test' } }
  async describe() { return { configured: true, writable: false } }
  async set() { throw new Error('read only') }
  async unset() { throw new Error('read only') }
  async readRecord() { return undefined }
  async describeRecord() { return { configured: false, writable: false } }
  async listRecords() { return [] }
  async modifyRecord(): Promise<never> { throw new Error('read only') }
  async deleteRecord() { throw new Error('read only') }
}
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const thresholds = { search: 0.8, match: 0.8, details: 0.8, deadlines: 0.8, bid_room: 0.95 }
const targets = { search: 'search', match: 'match', details: 'details', deadlines: 'deadlines', bid_room: 'bid_room' }
const labels = Object.keys(questionsFor({ request: 'search' }).operation.criteria)
const resultFor = (selected: string) => ({ model: 'jev-fixture', usage: { input_tokens: 100, output_tokens: 10 }, answers: {
  operation: { type: 'choice', choice: selected, confidence: 1,
    probabilities: Object.fromEntries(labels.map(label => [label, label === selected ? 1 : 0])) },
} })

async function setup(overrides: Partial<router.Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Credentials)
  const invoked = vi.fn((args: unknown) => args)
  ctx.tools.register(defineTool({ name: 'search', description: 'Search fixture', parameters: { keywords: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) { invoked(args); return { references: ['AB-2026-12345'] } },
  }))
  const fiber = ctx.plugin(router, router.Config({ tools: targets, minConfidence: thresholds,
    referenceConfidence: 0.9, mode: 'execute', ...overrides }))
  await fiber
  const agent = await ctx.agentLoop.create(SessionId('workspace-test'), { provider: 'unused', model: 'unused' })
  const call = (args: unknown = { request: 'Find steel work', keywords: 'steel' }, signal = new AbortController().signal) =>
    ctx.tools.execute({ callId: ToolCallId('route'), name: 'workspace_route', arguments: args, agent, signal })
  return { ctx, agent, call, invoked, fiber }
}

describe('workspace_route execution', () => {
  it.each([
    { baseURL: 'ftp://example.test' },
    { model: ' ' },
    { tools: { ...targets, search: 'workspace_route' } },
    { tools: { ...targets, search: ' ' } },
  ])('rejects invalid deployment configuration at activation', async (config) => {
    await expect(setup(config)).rejects.toThrow()
  })
  it('requires credentials at activation and again before every inference', async () => {
    vi.spyOn(Credentials.prototype, 'resolve').mockResolvedValueOnce({ value: '', source: 'test' })
    await expect(setup()).rejects.toThrow('Missing credential')
    const { ctx, call } = await setup()
    vi.spyOn(ctx.credentials, 'resolve').mockResolvedValue(undefined)
    const result = await call()
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Missing credential')
  })
  it('requires a session-backed caller and bounded unique reference candidates', async () => {
    const { ctx, call } = await setup({ maxReferences: 1 })
    const duplicate = { reference: 'A', title: 'One', observedAt: 0 }
    expect((await call({ request: 'Details', references: [duplicate, duplicate] })).isError).toBe(true)
    const unique = await setup()
    expect((await unique.call({ request: 'Details', references: [duplicate, duplicate] })).isError).toBe(true)
    const result = await ctx.tools.execute({ callId: ToolCallId('no-agent'), name: 'workspace_route',
      arguments: { request: 'Search' }, signal: new AbortController().signal })
    expect(JSON.stringify(result)).toContain('requires a session-backed agent')
  })
  it('reports an unavailable selected tool instead of recommending a broken invocation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resultFor('match')))))
    const { call } = await setup({ mode: 'recommend' })
    expect(JSON.stringify(await call({ request: 'Match us', profile: { description: 'Steel' } })))
      .toContain('Configured WorkspaceAlberta tool is unavailable')
  })
  it('consumes a relevant reference answer and ignores it below the operation threshold', async () => {
    const response = { ...resultFor('details'), answers: { ...resultFor('details').answers,
      reference: { type: 'choice', choice: 'reference_0', confidence: 1, probabilities: { none: 0, reference_0: 1 } },
    } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))))
    const { call, agent } = await setup({ mode: 'recommend', tools: { ...targets, details: 'search' } })
    const args = { request: 'Details of A', references: [{ reference: 'A', title: 'Steel', observedAt: Date.now() }] }
    const accepted = await call(args)
    expect(!accepted.isError && accepted.value).toMatchObject({ decision: { kind: 'recommend', arguments: { reference: 'A' } } })
    response.answers.operation.confidence = 0.1
    const second = await setup({ mode: 'recommend' })
    const uncertain = await second.call(args)
    expect(!uncertain.isError && uncertain.value).toMatchObject({ decision: { reason: 'uncertain_operation' } })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'workspace/route')).toHaveLength(2)
  })
  it('forwards child-tool context through the owning tool execution', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resultFor('search')))))
    const { ctx, call } = await setup({ tools: { ...targets, search: 'with-context' } })
    const context = createUserMessage({ content: [{ type: 'text', text: 'Retrieved reference context' }], source: { kind: 'user' } })
    ctx.tools.register(defineTool({ name: 'with-context', description: 'Context fixture', parameters: {},
      output: { schema: { type: 'json' }, render: () => [] },
      async execute(_args, exec) {
        exec.deferContext(context)
        return null
      },
    }))
    expect((await call()).additionalContexts).toEqual([context])
  })
  it('uses the SDK request and guarded dispatch with durable request/decision/result records', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(resultFor('search')), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { call, invoked, agent } = await setup()
    const result = await call()
    expect(result.isError).toBe(false)
    expect(!result.isError && result.value).toMatchObject({ decision: { kind: 'execute', tool: 'search', arguments: { keywords: 'steel' } }, execution: { isError: false } })
    expect(invoked).toHaveBeenCalledExactlyOnceWith({ keywords: 'steel' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'workspace/route').map(event => event.data.phase)).toEqual(['request', 'decision', 'result'])
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain('fixture-key')
  })
  it('returns a recommendation without dispatching when configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resultFor('search')))))
    const { call, invoked } = await setup({ mode: 'recommend' })
    expect((await call()).isError).toBe(false)
    expect(invoked).not.toHaveBeenCalled()
  })
  it('preserves authoritative guard denial on the selected tool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resultFor('search')))))
    const { ctx, call, invoked } = await setup()
    ctx.tools.guard(exec => exec.name === 'search' ? 'Search denied by fixture policy' : undefined)
    const result = await call()
    expect(!result.isError && result.value).toMatchObject({ execution: { isError: true } })
    expect(invoked).not.toHaveBeenCalled()
  })
  it.each(['reason', 'clarify', 'match'])('does not dispatch unresolved %s requests', async (selected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resultFor(selected)))))
    const { call, invoked } = await setup()
    const result = await call({ request: 'Help with my business' })
    expect(result.isError).toBe(false)
    expect(invoked).not.toHaveBeenCalled()
  })
  it('ignores answers from unused speculative branches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...resultFor('search'), answers: {
      ...resultFor('search').answers, reference: 'malformed unused answer',
    } }))))
    const { call, invoked } = await setup()
    expect((await call({ request: 'Find steel', keywords: 'steel', references: [{ reference: 'A', title: 'Other', observedAt: 0 }] })).isError).toBe(false)
    expect(invoked).toHaveBeenCalledOnce()
  })
  it.each([{}, { ...resultFor('search'), answers: { operation: { type: 'choice', choice: 'invented' } } }])('falls back on malformed responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))))
    const { call, invoked } = await setup()
    const result = await call()
    expect(!result.isError && result.value).toMatchObject({ decision: { kind: 'fallback', reason: 'invalid_response' } })
    expect(invoked).not.toHaveBeenCalled()
  })
  it('does not retry service errors or expose their bodies', async () => {
    const fetchMock = vi.fn(async () => new Response('sensitive remote diagnostic', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { call, invoked } = await setup()
    const result = await call()
    expect(!result.isError && result.value).toMatchObject({ decision: { kind: 'fallback', reason: 'provider_unavailable' } })
    expect(JSON.stringify(result)).not.toContain('sensitive remote')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(invoked).not.toHaveBeenCalled()
  })
  it('aborts in-flight inference and drains it before plugin disposal completes', async () => {
    const started = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      started.resolve(undefined)
    })))
    const { call, fiber, ctx, invoked } = await setup()
    const running = call()
    await started.promise
    await fiber.dispose()
    expect((await running).isError).toBe(true)
    expect(ctx.tools.get('workspace_route')).toBeUndefined()
    expect(invoked).not.toHaveBeenCalled()
  })
  it('rejects oversized input before inference and reports oversized output after execution', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(resultFor('search'))))
    vi.stubGlobal('fetch', fetchMock)
    const tooSmall = await setup({ maxRequestBytes: 1 })
    expect((await tooSmall.call()).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    const smallResult = await setup({ maxResultBytes: 1 })
    expect((await smallResult.call()).isError).toBe(true)
    expect(smallResult.invoked).toHaveBeenCalledOnce()
    expect(smallResult.agent.session.snapshotEvents().at(-1)?.data).toMatchObject({ phase: 'result', value: { actionMayHaveCompleted: true } })
  })
})
