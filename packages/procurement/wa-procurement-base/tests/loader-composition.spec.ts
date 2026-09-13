// Proves the batch review tool is real configurability through a real Loader composition:
// configured bounds change behavior, credentials gate execution, and every requested item settles.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import Loader from '@workspacealberta/cordis-plugin-loader'
import Include from '@workspacealberta/cordis-plugin-include'
import { CallId } from '@workspacealberta/wa-llm'
import { Session, SessionId } from '@workspacealberta/wa-session'
import AgentRegistry, { Inbox } from '@workspacealberta/wa-agent'
import type { Agent } from '@workspacealberta/wa-agent'
import SystemPrompt from '@workspacealberta/wa-system-prompt'
import ToolRuntime from '@workspacealberta/wa-tools'
import * as ProcurementBase from '@workspacealberta/wa-procurement-base'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
  delete process.env.COHERE_BASE_URL
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('procurement-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Boot a cordis.yml carrying the given procurement review config block.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'wa-procurement-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@workspacealberta/wa-agent'",
    "- name: '@workspacealberta/wa-system-prompt'",
    "- name: '@workspacealberta/wa-tools'",
    "- name: '@workspacealberta/wa-procurement-base'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@workspacealberta/wa-agent', AgentRegistry],
    ['@workspacealberta/wa-system-prompt', SystemPrompt],
    ['@workspacealberta/wa-tools', ToolRuntime],
    ['@workspacealberta/wa-procurement-base', ProcurementBase],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

const REVIEW_TEXT = 'Bond of 500 CAD is required.'
const REVIEW_CITATION = { start: 0, end: 4, text: 'Bond', sources: [{ type: 'document', id: 'opp-1' }] }
const IMAGE_URL = 'data:image/png;base64,aGVsbG8='

/** Stub v2 chat fetch capturing requests. */
function stubChat(payload: unknown, status = 200, seen: Array<{ url: string; init: RequestInit }> = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url, init: init as RequestInit })
    return { status, ok: status >= 200 && status < 300, json: async () => payload }
  })
}

function successPayload() {
  return { message: { content: REVIEW_TEXT, citations: [REVIEW_CITATION] } }
}

const TEXT_ITEM = { id: 'opp-1', title: 'Electrical upgrade', text: REVIEW_TEXT }
const IMAGE_ITEM = { id: 'opp-2', title: 'Site photos', text: 'Fenced yard.', imageUrls: [IMAGE_URL] }

describe('procurement review real Loader composition through cordis.yml', () => {
  it('reviews a mixed batch end to end with per-item outcomes', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', stubChat(successPayload(), 200, seen))
    const ctx = await boot(['    apiKey: test-key-1', '    maxJobs: 5'])
    expect(ctx.tools.schemas().some(s => s.name === 'procurement_review_batch')).toBe(true)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('mixed-batch'),
      name: 'procurement_review_batch',
      arguments: {
        opportunities: [TEXT_ITEM, IMAGE_ITEM],
        profile: { company: 'Test Shop', updated: '2026-09-12' },
        instruction: 'Review both.',
      },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('2 ready, 0 failed, 0 cancelled')
    expect(seen).toHaveLength(2)
    expect(seen[0]?.url).toBe('https://api.cohere.ai/v2/chat')
    const headers = seen[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-key-1')
    const second = JSON.parse(seen[1]?.init.body as string) as {
      documents: Array<{ id: string }>
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>
    }
    expect(second.documents[0]?.id).toBe('opp-2')
    expect(second.messages[0]?.content.some(block => block.type === 'image_url' && block.image_url?.url === IMAGE_URL)).toBe(
      true,
    )
  }, 30_000)

  it('maxJobs: 1 rejects a two-opportunity batch before any provider call', async () => {
    const fetchStub = stubChat(successPayload())
    vi.stubGlobal('fetch', fetchStub)
    const ctx = await boot(['    apiKey: test-key-1', '    maxJobs: 1'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('over-queue'),
      name: 'procurement_review_batch',
      arguments: { opportunities: [TEXT_ITEM, IMAGE_ITEM] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('maxJobs')
    expect(fetchStub).not.toHaveBeenCalled()
  }, 30_000)

  it('refuses to run without a resolvable credential', async () => {
    vi.stubGlobal('fetch', stubChat(successPayload()))
    const ctx = await boot(['    apiKeyEnv: WA_PROC_TEST_MISSING_CRED'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('no-credential'),
      name: 'procurement_review_batch',
      arguments: { opportunities: [TEXT_ITEM] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('WA_PROC_TEST_MISSING_CRED')
  }, 30_000)

  it('rejects an empty batch without calling the provider', async () => {
    const fetchStub = stubChat(successPayload())
    vi.stubGlobal('fetch', fetchStub)
    const ctx = await boot(['    apiKey: test-key-1'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('empty-batch'),
      name: 'procurement_review_batch',
      arguments: { opportunities: [] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('at least one opportunity')
    expect(fetchStub).not.toHaveBeenCalled()
  }, 30_000)

  it('surfaces registry cancellation when the caller aborts mid-batch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const ctx = await boot(['    apiKey: test-key-1'])
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
    }, 20)
    const result = await ctx.tools.execute({
      signal: controller.signal,
      callId: CallId('cancelled-batch'),
      name: 'procurement_review_batch',
      arguments: { opportunities: [{ id: 'x', title: 't', text: 'e' }] },
      agent: agent(ctx),
    })
    // Foreground work stays coupled to the call signal: the registry reports the abort and
    // discards the partial batch. Per-item cancelled outcomes are pinned at the queue level.
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('aborted')
  }, 30_000)

  it('keeps terminal provider failures inside per-item outcomes', async () => {
    vi.stubGlobal('fetch', stubChat({ error: 'denied' }, 400))
    const ctx = await boot(['    apiKey: test-key-1'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('denied-batch'),
      name: 'procurement_review_batch',
      arguments: { opportunities: [TEXT_ITEM] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('0 ready, 1 failed, 0 cancelled')
  }, 30_000)

  it('isolates unsupported media per item without blocking the batch', async () => {
    const fetchStub = stubChat(successPayload())
    vi.stubGlobal('fetch', fetchStub)
    const ctx = await boot(['    apiKey: test-key-1'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('media-batch'),
      name: 'procurement_review_batch',
      arguments: {
        opportunities: [
          { id: 'pdf-1', title: 'Scanned tender', text: 'sealed', mediaMime: 'application/pdf' },
          { id: 'png-1', title: 'Site photo', text: 'gate', mediaMime: 'image/png', imageUrls: [IMAGE_URL] },
        ],
      },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('1 ready, 1 failed, 0 cancelled')
    expect(fetchStub).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('honors the launch environment endpoint override', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', stubChat(successPayload(), 200, seen))
    process.env.COHERE_BASE_URL = 'https://env.invalid'
    const ctx = await boot(['    apiKey: test-key-1'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('env-endpoint'),
      name: 'procurement_review_batch',
      arguments: { opportunities: [TEXT_ITEM] },
      agent: agent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(seen[0]?.url).toBe('https://env.invalid/v2/chat')
  }, 30_000)
})
