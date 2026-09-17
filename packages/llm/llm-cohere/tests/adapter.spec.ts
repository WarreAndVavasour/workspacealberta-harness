import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@workspacealberta/cordis'
import { AttachmentId } from '@workspacealberta/wa-attachment'
import { createLaunchEnvironmentSnapshot } from '@workspacealberta/wa-launch-environment'
import LlmRuntime, { createUserMessage,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  userAgent,
} from '@workspacealberta/wa-llm'
import { MAX_TIMER_DELAY_MS } from '@workspacealberta/wa-timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@workspacealberta/wa-anonymous-user-id'
import { SessionId } from '@workspacealberta/wa-session'
import * as LlmCohere from '@workspacealberta/wa-llm-cohere'
import { CohereAdapter, resolveAdapterOptions } from '@workspacealberta/wa-llm-cohere'
import { httpErrorCode } from '../src/adapter.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import type { Behavior } from './mock-server.ts'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001' as AnonymousUserId
let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-llm-cohere-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  vi.useRealTimers()
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

async function harness(baseURL: string, config: object = {}) {
  vi.stubEnv('COHERE_API_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmCohere, { baseURL, ...config })
  return ctx
}

function adapterOf(config: Partial<LlmCohere.Config> & { apiKey?: string } = {}): CohereAdapter {
  const { apiKey, ...rest } = config
  return new CohereAdapter({
    options: () => resolveAdapterOptions(rest),
    resolveApiKey: () => Promise.resolve(apiKey ?? 'k'),
    resolveUserId: () => TEST_USER_ID,
  })
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) { /* drain */ }
}

const imageRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 3,
  width: 1,
  height: 1,
}

describe('CohereAdapter against a mock server', () => {
  it('streams a text generation end to end through the assembler', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, {
      model: 'command-a-plus-05-2026',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1 })

    expect(server.requests[0]).toMatchObject({
      model: 'command-a-plus-05-2026',
      max_tokens: 32_768,
      stream: true,
    })
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
    expect(server.headers[0]?.['x-client-name']).toBe('workspacealberta-harness')
    expect(server.headers[0]?.['x-workspacealberta-user-id']).toBe(getOrCreateAnonymousUserId())
    expect(server.headers[0]).not.toHaveProperty('x-workspacealberta-session-id')
    expect(server.headers[0]).not.toHaveProperty('x-workspacealberta-compact')
  })

  it('rejects image input before credentials or fetch', async () => {
    const server = await mockServer([])
    const resolveApiKey = vi.fn(() => Promise.resolve('k'))
    const adapter = new CohereAdapter({
      options: () => resolveAdapterOptions({ baseURL: server.url }),
      resolveApiKey,
      resolveUserId: () => TEST_USER_ID,
    })

    await expect(drain(adapter.stream({
      provider: 'cohere-canada',
      model: 'command-a-plus-05-2026',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: imageRef }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(server.requests).toHaveLength(0)
  })

  it('streams raw chunks through ctx.llm.stream', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents, delayMs: 2 }])
    const ctx = await harness(server.url)

    const kinds: string[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'cohere-canada',
      model: 'command-a-plus-05-2026',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })) {
      kinds.push(chunk.type)
    }
    expect(kinds).toEqual(['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
  })

  it('forwards the harness user and session ids', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)

    await assemble(ctx, {
      model: 'command-a-plus-05-2026',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
      sessionId: SessionId('child-session'),
    })

    expect(server.headers[0]?.['x-workspacealberta-session-id']).toBe('child-session')
    expect(server.headers[0]?.['x-workspacealberta-user-id']).toBe(getOrCreateAnonymousUserId())
  })

  it('marks the auxiliary compaction call on the wire', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)

    await assemble(ctx, {
      model: 'command-a-plus-05-2026',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
      purpose: 'compaction',
    })

    expect(server.headers[0]?.['x-workspacealberta-compact']).toBe('1')
  })

  it('uses the configured maxTokens default and preserves an explicit request cap', async () => {
    const server = await mockServer([
      { kind: 'sse', events: textEvents },
      { kind: 'sse', events: textEvents },
    ])
    const ctx = await harness(server.url, { maxTokens: 4_096 })

    await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [], maxTokens: 512 })

    expect(server.requests[0]).toMatchObject({ max_tokens: 4_096 })
    expect(server.requests[1]).toMatchObject({ max_tokens: 512 })
  })

  it('publishes only off when thinking is disabled', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url, { thinking: 'disabled' })

    await assemble(ctx, {
      model: 'command-a-plus-05-2026',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(server.requests[0]).toMatchObject({
      thinking: { type: 'disabled' },
    })
    await expect(ctx.llm.resolveModelInfo('cohere-canada', 'command-a-plus-05-2026'))
      .resolves.toMatchObject({
        reasoning: {
          efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }],
          defaultEffort: ReasoningEffortId('off'),
        },
      })
  })

  it('does not advertise reasoning when thinking is omitted', async () => {
    const ctx = await harness('http://127.0.0.1:1')
    const info = await ctx.llm.resolveModelInfo('cohere-canada', 'command-a-plus-05-2026')
    expect(info.reasoning).toBeUndefined()
  })

  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [429, 'RATE_LIMIT'],
    [400, 'INVALID_REQUEST'],
    [500, 'SERVER'],
    [503, 'SERVER'],
  ])('maps HTTP %d to failure code %s with the body message', async (status, code) => {
    const behavior: Behavior = {
      kind: 'http-error',
      status,
      body: JSON.stringify({ message: `failed with ${status}` }),
    }
    const server = await mockServer([behavior])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toEqual({
      kind: 'error',
      failure: { message: `failed with ${status}`, code, status },
    })
  })

  it('reads a string detail error body', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 400,
      body: JSON.stringify({ detail: 'bad request detail' }),
    }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({
      kind: 'error',
      failure: { message: 'bad request detail', code: 'INVALID_REQUEST' },
    })
  })

  it('reads the first array detail message', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 400,
      body: JSON.stringify({ detail: [{ message: 'first' }, { message: 'second' }] }),
    }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({
      kind: 'error',
      failure: { message: 'first' },
    })
  })

  it('classifies an HTTP context-window failure with the canonical code', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 400,
      body: JSON.stringify({
        message: 'This model maximum context length is 256000 tokens; your input exceeds that limit.',
      }),
    }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({
      kind: 'error',
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    })
  })

  it('retains status, Retry-After seconds, and provider request id', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 429,
      body: JSON.stringify({ message: 'slow down' }),
      headers: { 'retry-after': '2', 'x-request-id': 'req-429' },
    }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toEqual({
      kind: 'error',
      failure: {
        message: 'slow down',
        code: 'RATE_LIMIT',
        status: 429,
        providerRetryAfterMs: 2_000,
        requestId: ProviderRequestId('req-429'),
      },
    })
  })

  it('parses a future Retry-After HTTP date and the trace-id fallback', async () => {
    const now = 1_800_000_000_000
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const server = await mockServer([{
        kind: 'http-error',
        status: 503,
        body: JSON.stringify({ message: 'come back later' }),
        headers: {
          'retry-after': new Date(now + 3_000).toUTCString(),
          'x-trace-id': 'cohere-503',
        },
      }])
      const ctx = await harness(server.url)
      const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
      expect(result.finish).toEqual({
        kind: 'error',
        failure: {
          message: 'come back later',
          code: 'SERVER',
          status: 503,
          providerRetryAfterMs: 3_000,
          requestId: ProviderRequestId('cohere-503'),
        },
      })
    } finally {
      dateNow.mockRestore()
    }
  })

  it('omits zero, non-finite, invalid, and past Retry-After values', async () => {
    const values = ['0', '9'.repeat(400), 'not-a-date', new Date(0).toUTCString()]
    for (const value of values) {
      const server = await mockServer([{
        kind: 'http-error',
        status: 429,
        body: JSON.stringify({ message: 'retry later' }),
        headers: { 'retry-after': value },
      }])
      const ctx = await harness(server.url)
      const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
      expect(result.finish).toEqual({
        kind: 'error',
        failure: { message: 'retry later', code: 'RATE_LIMIT', status: 429 },
      })
    }
  })

  it('classifies quota exhaustion and unusual statuses', () => {
    expect(httpErrorCode(429, 'account credits exhausted')).toBe(QUOTA_EXCEEDED_CODE)
    expect(httpErrorCode(429, 'request rate limit exceeded')).toBe('RATE_LIMIT')
    expect(httpErrorCode(413)).toBe('INVALID_REQUEST')
    expect(httpErrorCode(418)).toBe('HTTP_418')
    expect(httpErrorCode(400, 'request too large for model context')).toBe(CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(httpErrorCode(400, 'invalid input: temperature exceeds maximum')).toBe('INVALID_REQUEST')
  })

  it('keeps the status-line message for empty detail arrays and empty messages', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 400,
      body: JSON.stringify({ message: '', detail: [{ message: '' }] }),
    }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({
      kind: 'error',
      failure: { code: 'INVALID_REQUEST', message: expect.stringMatching(/HTTP 400/) },
    })
  })

  it('keeps the status-line message for empty and non-JSON error bodies', async () => {
    const empty = await mockServer([{ kind: 'http-error', status: 500, body: '{}' }])
    const ctxA = await harness(empty.url)
    const first = await assemble(ctxA, { model: 'command-a-plus-05-2026', messages: [] })
    expect(first.finish).toMatchObject({ kind: 'error', failure: { code: 'SERVER', message: expect.stringMatching(/HTTP 500/) } })

    const plain = await mockServer([{ kind: 'http-error', status: 502, body: 'Bad Gateway', contentType: 'text/plain' }])
    const ctxB = await harness(plain.url)
    const second = await assemble(ctxB, { model: 'command-a-plus-05-2026', messages: [] })
    expect(second.finish).toMatchObject({ kind: 'error', failure: { code: 'SERVER', message: expect.stringMatching(/HTTP 502/) } })
  })

  it('reports a transport failure with the endpoint in the message', async () => {
    const ctx = await harness('http://127.0.0.1:1')
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({
      kind: 'error',
      failure: {
        code: 'TRANSPORT',
        message: 'Cohere API request to http://127.0.0.1:1 failed',
      },
    })
  })

  it('classifies an aborted request as an aborted finish', async () => {
    const controller = new AbortController()
    controller.abort()
    const ctx = await harness('http://127.0.0.1:1')
    const result = await assemble(ctx, {
      model: 'command-a-plus-05-2026',
      messages: [],
      signal: controller.signal,
    })
    expect(result.finish).toMatchObject({ kind: 'aborted', failure: { code: 'ABORTED' } })
  })

  it('throws EMPTY_RESPONSE when the response has no body', async () => {
    const adapter = adapterOf({ baseURL: 'http://127.0.0.1:1' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    )
    try {
      const iterate = async (): Promise<void> => {
        for await (const _chunk of adapter.stream({ provider: 'cohere-canada', model: 'm', messages: [] })) { /* drain */ }
      }
      await expect(iterate()).rejects.toThrow(/no response body/)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('classifies an abrupt body close as TRANSPORT', async () => {
    const server = await mockServer([{
      kind: 'close-early',
      events: [JSON.stringify({ type: 'content-delta', delta: { message: { content: { text: 'par' } } } })],
    }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish.kind).toBe('error')
    if (result.finish.kind !== 'error') throw new Error('expected an error finish')
    expect(result.finish.failure.code).toBe('TRANSPORT')
    expect(result.finish.failure.message).toMatch(/^Cohere API stream from .* failed$/)
  })

  it('refuses HTTP redirects on credential-bearing requests', async () => {
    const server = await mockServer([{ kind: 'redirect', location: 'https://evil.example/steal' }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({
      kind: 'error',
      failure: { code: 'TRANSPORT' },
    })
  })

  it('aborts mid-stream via the request signal', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents, delayMs: 50 }])
    const ctx = await harness(server.url)
    const controller = new AbortController()

    const pending = (async () => {
      const chunks = []
      for await (const chunk of ctx.llm.stream({
        provider: 'cohere-canada',
        model: 'command-a-plus-05-2026',
        messages: [],
        signal: controller.signal,
      })) {
        chunks.push(chunk)
      }
      return chunks
    })()

    setTimeout(() => { controller.abort() }, 30)
    const chunks = await pending
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('finish')
    if (chunks[0]?.type !== 'finish') throw new Error('expected a finish chunk')
    expect(chunks[0].reason.kind).toBe('aborted')
    if (chunks[0].reason.kind !== 'aborted') throw new Error('expected an aborted finish')
    expect(chunks[0].reason.failure.code).toBe('ABORTED')
  })

  it('times out an idle stream', async () => {
    vi.useFakeTimers()
    const server = await mockServer([{ kind: 'sse', events: textEvents, delayMs: 60_000 }])
    const ctx = await harness(server.url, { streamIdleTimeoutMs: 20 })
    const pending = assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    await vi.advanceTimersByTimeAsync(50)
    const result = await pending
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'TIMEOUT' } })
  })

  it('keeps an idle provider read alive through SSE comments', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => { controller.enqueue(encoder.encode(': keep-alive\n\n')) }, 75)
          setTimeout(() => { controller.enqueue(encoder.encode(': keep-alive\n\n')) }, 150)
          setTimeout(() => {
            controller.enqueue(encoder.encode(textEvents.map(event => `data: ${event}\n\n`).join('')))
            controller.close()
          }, 225)
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    const adapter = adapterOf({ baseURL: 'https://example.invalid', streamIdleTimeoutMs: 100 })
    try {
      const chunks: string[] = []
      const drainStream = (async () => {
        for await (const chunk of adapter.stream({ provider: 'cohere-canada', model: 'm', messages: [] })) {
          chunks.push(chunk.type)
        }
      })()
      await vi.advanceTimersByTimeAsync(75)
      await vi.advanceTimersByTimeAsync(75)
      await vi.advanceTimersByTimeAsync(75)
      await expect(drainStream).resolves.toBeUndefined()
      expect(chunks).toEqual(['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('lists catalog models and resolves exact-model metadata', async () => {
    const ctx = await harness('http://127.0.0.1:1', {
      models: [
        { id: 'command-a-plus-05-2026', name: 'Command A+', description: 'default', contextWindow: 256_000, maxTokens: 8_192 },
      ],
    })
    await expect(ctx.llm.listModels('cohere-canada')).resolves.toEqual([
      { provider: 'cohere-canada', id: 'command-a-plus-05-2026', name: 'Command A+', description: 'default', inputModalities: ['text'] },
    ])
    await expect(ctx.llm.resolveModelInfo('cohere-canada', 'command-a-plus-05-2026')).resolves.toMatchObject({
      context: { contextWindow: 256_000 },
      defaultMaxTokens: 8_192,
    })
    await expect(ctx.llm.resolveModelInfo('cohere-canada', 'unlisted')).resolves.toMatchObject({
      id: 'unlisted',
      name: 'unlisted',
      inputModalities: ['text'],
      context: { contextWindow: 256_000 },
    })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'cohere-canada', name: 'Cohere (Canada)' }])
    expect(ctx.llm.listConfigurableProviders()).toEqual([
      { provider: 'cohere-canada', displayName: 'Cohere (Canada)', settingsNs: 'llm-cohere', settingsPath: [] },
    ])
  })

  it('registers the cohere-canada provider and unregisters on dispose', async () => {
    const server = await mockServer([])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmCohere, { baseURL: server.url })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'cohere-canada', name: 'Cohere (Canada)' }])
    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'cohere-canada',
      displayName: 'Cohere (Canada)',
      settingsNs: 'llm-cohere',
      settingsPath: [],
    }])
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('treats an empty ambient variable as no key when no credentials seam is mounted', async () => {
    vi.stubEnv('COHERE_API_KEY', '')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmCohere, { baseURL: 'http://127.0.0.1:1' })
    const result = await assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
  })

  it('fails plugin load when composition config is invalid', async () => {
    await expect(harness('http://127.0.0.1:1', { models: [{ id: 'dup' }, { id: 'dup' }] }))
      .rejects.toThrow('duplicate catalog model')
  })
})

describe('resolveAdapterOptions', () => {
  it('applies public defaults', () => {
    const resolved = resolveAdapterOptions({})
    expect(resolved.baseURL).toBe('https://api.cohere.ai')
    expect(resolved.maxTokens).toBe(32_768)
    expect(resolved.defaultContextWindow).toBe(256_000)
    expect(resolved.models).toEqual([
      { id: 'command-a-plus-05-2026', name: 'Command A+', contextWindow: 256_000 },
    ])
  })

  it('takes COHERE_BASE_URL from any environment layer, with explicit config still on top', () => {
    const trusted = createLaunchEnvironmentSnapshot([
      { source: 'user-env', path: '/home/.dsh/.env', values: { COHERE_BASE_URL: 'https://user.example' } },
    ])
    expect(resolveAdapterOptions({}, trusted).baseURL).toBe('https://user.example')
    const project = createLaunchEnvironmentSnapshot([
      { source: 'project-env', path: '/work/.env', values: { COHERE_BASE_URL: 'https://project.example' } },
    ])
    expect(resolveAdapterOptions({}, project).baseURL).toBe('https://project.example')
    const shell = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { COHERE_BASE_URL: 'https://stale.example' } },
    ])
    expect(resolveAdapterOptions({ baseURL: 'https://gateway.internal' }, shell).baseURL).toBe('https://gateway.internal')
  })

  it('rejects empty and duplicate catalog ids and empty names', () => {
    expect(() => resolveAdapterOptions({ models: [{ id: '' }] })).toThrow('must be non-empty')
    expect(() => resolveAdapterOptions({ models: [{ id: 'a', name: '' }] })).toThrow('empty name')
    expect(() => resolveAdapterOptions({ models: [{ id: 'a' }, { id: 'a' }] })).toThrow('duplicate catalog model')
  })

  it('rejects non-positive catalog capacities and profile bounds', () => {
    expect(() => resolveAdapterOptions({ models: [{ id: 'a', contextWindow: 0 }] })).toThrow('contextWindow')
    expect(() => resolveAdapterOptions({ models: [{ id: 'a', maxTokens: 0 }] })).toThrow('maxTokens')
    expect(() => resolveAdapterOptions({ defaultContextWindow: 0 })).toThrow('defaultContextWindow')
    expect(() => resolveAdapterOptions({ maxTokens: 0 })).toThrow('maxTokens')
    expect(() => resolveAdapterOptions({ streamIdleTimeoutMs: 0 })).toThrow('streamIdleTimeoutMs')
    expect(() => resolveAdapterOptions({ streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow('streamIdleTimeoutMs')
  })

  it('accepts an empty catalog', () => {
    expect(resolveAdapterOptions({ models: [] }).models).toEqual([])
  })
})
