import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import Loader from '@workspacealberta/cordis-plugin-loader'
import Include from '@workspacealberta/cordis-plugin-include'
import LocalFileSystem from '@workspacealberta/wa-fs-local'
import AgentRegistry from '@workspacealberta/wa-agent'
import AgentLoop from '@workspacealberta/wa-agent-loop'
import LlmRuntime, { ToolCallId } from '@workspacealberta/wa-llm'
import SessionStore, { Session, SessionId } from '@workspacealberta/wa-session'
import SessionProjectionRegistry from '@workspacealberta/wa-session-projection'
import SystemPrompt from '@workspacealberta/wa-system-prompt'
import ToolRuntime from '@workspacealberta/wa-tools'
import JsonlPersistence from '@workspacealberta/wa-session-persistence-jsonl'
import { CredentialProvider } from '@workspacealberta/wa-credentials'
import * as ProjectTools from '../src/index.ts'
import { checkpointProject, readProject } from '../src/state.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

class Credentials extends CredentialProvider {
  async resolve() { return { value: 'synthetic-fixture-key', source: 'fixture' } }
  async describe() { return { configured: true, writable: false } }
  async set() { throw new Error('read only') }
  async unset() { throw new Error('read only') }
  async readRecord() { return undefined }
  async describeRecord() { return { configured: false, writable: false } }
  async listRecords() { return [] }
  async modifyRecord(): Promise<never> { throw new Error('read only') }
  async deleteRecord() { throw new Error('read only') }
}

const plan = {
  title: 'Community centre RFP', business: 'Synthetic Alberta builder', objective: 'Deliver an evidence-backed proposal',
  sources: [{ id: 'rfp', location: 'rfp.pdf#page=1', sha256: 'a'.repeat(64) }],
  tasks: [{ id: 'scope', description: 'Confirm construction scope', status: 'pending', dependsOn: [], sourceIds: ['rfp'],
    toolNames: [], artifacts: [], acceptance: 'Scope cites the source pages and records unknowns' }], blockers: [], decisions: [],
}

async function boot(root: string, pluginConfig: Partial<ProjectTools.Config> = {}) {
  const config = join(root, 'cordis.yml')
  const modules: Record<string, unknown> = { fs: LocalFileSystem, llm: LlmRuntime, session: SessionStore,
    projections: SessionProjectionRegistry,
    prompt: SystemPrompt, tools: ToolRuntime, agents: AgentRegistry, credentials: Credentials,
    persistence: JsonlPersistence, loop: AgentLoop, project: ProjectTools }
  await writeFile(config, [
    '- name: fs', '- name: llm', '- name: session', '- name: projections', '- name: prompt', '- name: tools', '- name: agents', '- name: credentials',
    '- name: persistence', '  config:', `    root: ${JSON.stringify(join(root, 'sessions'))}`, '    compression: none',
    '- name: loop', '  config:', '    agents: []', '- name: project',
    `  config: ${JSON.stringify({ minConfidence: 0.9, ...pluginConfig })}`, '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // Only module imports are used by this non-HMR Loader composition.
  ctx.loader.internal = { version: 'v2',
    get loadCache(): never { throw new Error('No HMR in this fixture') },
    register() { throw new Error('No module registration in this fixture') },
    async getOrCreateModuleJob() { throw new Error('No HMR in this fixture') },
    resolveSync() { throw new Error('No module resolution in this fixture') },
    async load() { throw new Error('No module loading in this fixture') },
    async import(specifier: string) {
      if (!(specifier in modules)) throw new Error(`Unexpected fixture import: ${specifier}`)
      return modules[specifier]
    } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  return ctx
}

async function setup(config: Partial<ProjectTools.Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wa-project-'))
  roots.push(root)
  const ctx = await boot(root, config)
  const agent = await ctx.agentLoop.create(SessionId('rfp-project'))
  const call = (name: string, args: unknown) => ctx.tools.execute({ name, arguments: args, agent,
    callId: ToolCallId(randomUUID()), signal: new AbortController().signal })
  return { root, ctx, agent, call }
}

describe('durable business project', () => {
  it('survives a new turn, process disposal, disk reload and a revision conflict', async () => {
    const { ctx, root, agent, call } = await setup()
    expect((await call('project_checkpoint', { expectedRevision: 0, plan })).isError).toBe(false)
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.sessions.flush(agent.session)
    await ctx.fiber.dispose()
    const restored = await boot(root)
    const handle = await restored.sessionPersistence.open(SessionId('rfp-project'), 'read')
    try {
      const session = Session.create(SessionId('rfp-project'), await handle.read(), handle.header)
      expect(readProject(session)).toEqual({ ...plan, revision: 1 })
      expect(() => checkpointProject(session, 0, plan)).toThrow('revision changed')
      const revised = checkpointProject(session, 1, { ...plan, blockers: ['Need owner pricing'] })
      expect({ title: revised.title, revision: revised.revision, blockers: revised.blockers }).toMatchInlineSnapshot(`
        {
          "blockers": [
            "Need owner pricing",
          ],
          "revision": 2,
          "title": "Community centre RFP",
        }
      `)
    } finally { await handle.close() }
  })

  it('rejects cycles, missing sources, incomplete dependencies and missing delivery artifacts', () => {
    const session = Session.create(SessionId('validation'))
    expect(() => checkpointProject(session, 0, { ...plan, tasks: [] })).toThrow()
    for (const task of [
      { ...plan.tasks[0], dependsOn: ['scope'] },
      { ...plan.tasks[0], sourceIds: ['invented'] },
      { ...plan.tasks[0], status: 'completed' },
      { ...plan.tasks[0], dependsOn: ['absent'] },
    ]) expect(() => checkpointProject(session, 0, { ...plan, tasks: [task] })).toThrow()
    expect(readProject(session)).toBeNull()
  })

  it('batches independent document decisions, preserves citations and flags uncertainty without executing business tools', async () => {
    const { call, agent } = await setup()
    const answer = (selected: string, confidence: number) => ({ type: 'choice', choice: selected, confidence,
      probabilities: Object.fromEntries(['scope', 'eligibility', 'commercial', 'submission', 'other'].map(k => [k, k === selected ? 1 : 0])) })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'jev-1.14.0',
      answers: { section_0: answer('scope', 0.98), section_1: answer('submission', 0.6) },
      usage: { input_tokens: 100, output_tokens: 0 } }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await call('project_classify_sections', { sourceId: 'rfp', sections: [
      { id: 's1', location: 'rfp.pdf#page=2', text: 'Build a community centre.' },
      { id: 's2', location: 'rfp.pdf#page=6', text: 'Submit by the stated closing date.' },
    ] })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ results: [{ id: 's1', reviewRequired: false }, { id: 's2', reviewRequired: true }] })
    expect(fetch).toHaveBeenCalledTimes(1)
    const events = agent.session.snapshotEvents().filter(e => e.type === 'workspace/intake')
    expect(events.map(e => e.data.phase)).toEqual(['request', 'response'])
    expect(JSON.stringify(events)).not.toContain('synthetic-fixture-key')
    expect(readProject(agent.session)).toBeNull()
  })

  it('refuses oversized and duplicate document batches before making a request', async () => {
    const { call } = await setup()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const section = { id: 's1', location: 'page=1', text: 'x'.repeat(33000) }
    expect((await call('project_classify_sections', { sourceId: 'rfp', sections: [section] })).isError).toBe(true)
    expect((await call('project_classify_sections', { sourceId: 'rfp', sections: [section, section] })).isError).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains rounded live probabilities and rejects distributions outside the rounding bound', async () => {
    const { call } = await setup()
    const answer = { type: 'choice', choice: 'other', confidence: 0.6,
      probabilities: { scope: 0.01, eligibility: 0.01, commercial: 0.01, submission: 0.28, other: 0.68 } }
    const response = () => new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { section_0: answer },
      usage: { input_tokens: 100, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const args = { sourceId: 'rfp', sections: [{ id: 'one', location: 'page=2', text: 'Contents' }] }
    const rounded = await call('project_classify_sections', args)
    expect(rounded.isError).toBe(false)
    expect(rounded.value).toMatchObject({ results: [{ probabilities: answer.probabilities, reviewRequired: true }] })
    answer.probabilities.other = 0.1
    expect((await call('project_classify_sections', args)).isError).toBe(true)
  })

  it('sends the long-context header only for an explicit larger request and enforces its byte cap', async () => {
    const { call, agent } = await setup({ enableLongContext: true, maxLongRequestBytes: 80000 })
    const answer = { type: 'choice', choice: 'scope', confidence: 0.99,
      probabilities: { scope: 1, eligibility: 0, commercial: 0, submission: 0, other: 0 } }
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { section_0: answer } })))
    vi.stubGlobal('fetch', fetch)
    const args = { sourceId: 'rfp', sections: [{ id: 'one', location: 'pages=1-100', text: 'a'.repeat(40000) }] }
    expect((await call('project_classify_sections', args)).isError).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect((await call('project_classify_sections', { ...args, useLongContext: true })).isError).toBe(false)
    let request = agent.session.snapshotEvents().filter(event => event.type === 'workspace/intake').filter(event => event.data.phase === 'request').at(-1)
    expect(request?.data.value).toMatchObject({ headers: { 'TypeSafe-Danger-Zone-Long-Context': 'true' } })
    expect((await call('project_classify_sections', { ...args, useLongContext: true,
      sections: [{ ...args.sections[0], text: 'small' }] })).isError).toBe(false)
    request = agent.session.snapshotEvents().filter(event => event.type === 'workspace/intake').filter(event => event.data.phase === 'request').at(-1)
    expect(request?.data.value).toMatchObject({ headers: {} })
    expect((await call('project_classify_sections', { ...args, useLongContext: true,
      sections: [{ ...args.sections[0], text: 'å­—'.repeat(30000) }] })).isError).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('denies disabled image and long-context paths through the executor', async () => {
    const { call } = await setup()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await call('project_inspect_image', { sourceId: 'rfp', location: 'page=1', file_path: 'missing.png' })).isError).toBe(true)
    expect((await call('project_classify_sections', { sourceId: 'rfp', useLongContext: true,
      sections: [{ id: 'one', location: 'page=1', text: 'Scope' }] })).isError).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends bounded image bytes with the image header and logs reconstructable evidence without a key', async () => {
    const { root, call, agent } = await setup({ enableImages: true, maxImageBytes: 1024 })
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    const file = join(root, 'page.png')
    await writeFile(file, bytes)
    const answers = {
      kind: { type: 'choice', choice: 'table', confidence: 0.99 },
      expertReview: { type: 'noul', noul: 0.2 },
      region: { type: 'box', box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 }, confidence: 0.4 },
    }
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(new Headers(options?.headers).get('TypeSafe-Danger-Zone-Images')).toBe('true')
      expect(new Headers(options?.headers).has('TypeSafe-Danger-Zone-Long-Context')).toBe(false)
      return new Response(JSON.stringify({ model: 'jev-1.14.0', answers }))
    })
    vi.stubGlobal('fetch', fetch)
    const args = { sourceId: 'rfp', location: 'rfp.pdf#page=440', file_path: file }
    const result = await call('project_inspect_image', args)
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    expect(result.value).toMatchObject({ location: args.location, answers, reviewRequired: true })
    const events = agent.session.snapshotEvents().filter(event => event.type === 'workspace/intake')
    expect(events[0]?.data.value).toMatchObject({ request: { assets: { page_image: {
      encoding: 'base64', mediaType: 'image/png', data: bytes.toString('base64'),
    } } }, headers: { 'TypeSafe-Danger-Zone-Images': 'true' } })
    expect(JSON.stringify(events)).not.toContain('synthetic-fixture-key')
    answers.region.box.top = 0.95
    expect((await call('project_inspect_image', args)).isError).toBe(true)
    await writeFile(file, Buffer.alloc(1025))
    expect((await call('project_inspect_image', args)).isError).toBe(true)
    await writeFile(file, 'not an image')
    expect((await call('project_inspect_image', args)).isError).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('aborts in-flight inference and removes tool registrations on disposal', async () => {
    const { ctx, call, agent } = await setup()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let aborted = false
    vi.stubGlobal('fetch', vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled fixture')) }, { once: true })
      started()
    })))
    const pending = call('project_classify_sections', { sourceId: 'rfp', sections: [{ id: 'one', location: 'page=1', text: 'Scope' }] })
    await ready
    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect((await pending).isError).toBe(true)
    expect(aborted).toBe(true)
    expect(tools.schemas()).toEqual([])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'workspace/intake').map(event => event.data.phase)).toEqual(['request'])
  })
})
