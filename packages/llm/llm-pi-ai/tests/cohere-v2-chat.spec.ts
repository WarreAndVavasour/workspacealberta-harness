import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import LlmRuntime, { CallId, createMessage, createUserMessage } from '@workspacealberta/wa-llm'
import type { Message } from '@workspacealberta/wa-llm'
import type { Api, Context as PiContext, Model } from '@earendil-works/pi-ai'
import * as LlmPiAi from '@workspacealberta/wa-llm-pi-ai'
import { supportedProtocols } from '@workspacealberta/wa-llm-pi-ai'
import {
  COHERE_V2_CHAT_API,
  cohereV2ChatApi,
  cohereV2ChatUrl,
  parseCohereSse,
  serializeCohereV2ChatRequest,
  translateCohereSse,
} from '../src/cohere-v2-chat.ts'
import { resolveProfiles } from '../src/config.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

const KEY_ENV = 'COHERE_V2_TEST_KEY'

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await closeMockServers()
})

function model(baseUrl: string): Model<Api> {
  return {
    id: 'command-a-plus-05-2026',
    name: 'Command A+',
    api: COHERE_V2_CHAT_API as Api,
    provider: 'cohere-canada',
    baseUrl,
    input: ['text'],
    contextWindow: 256_000,
    maxTokens: 32_768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
  }
}

function context(overrides: Partial<PiContext> = {}): PiContext {
  return {
    messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    ...overrides,
  }
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of stream) out.push(item)
  return out
}

function sseBytes(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
}

function sseData(...payloads: unknown[]): string[] {
  return payloads.map(payload => typeof payload === 'string' ? payload : JSON.stringify(payload))
}

const textEvents = sseData(
  { type: 'message-start', id: 'msg-1', delta: { message: { role: 'assistant' } } },
  { type: 'content-start', index: 0, delta: { message: { content: { type: 'text', text: '' } } } },
  { type: 'content-delta', index: 0, delta: { message: { content: { text: 'hello' } } } },
  { type: 'content-end', index: 0 },
  {
    type: 'message-end',
    delta: { finish_reason: 'COMPLETE', usage: { tokens: { input_tokens: 3, output_tokens: 1 } } },
  },
)

const toolEvents = sseData(
  { type: 'message-start', id: 'msg-tool' },
  { type: 'tool-plan-delta', delta: { message: { tool_plan: 'I will look it up.' } } },
  {
    type: 'tool-call-start',
    index: 0,
    delta: { message: { tool_calls: { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '' } } } },
  },
  {
    type: 'tool-call-delta',
    index: 0,
    delta: { message: { tool_calls: { function: { arguments: '{"q":"x"}' } } } },
  },
  { type: 'tool-call-end', index: 0 },
  { type: 'citation-start', index: 0, delta: { message: { citations: { text: 'x' } } } },
  { type: 'citation-delta', index: 0 },
  { type: 'citation-end', index: 0 },
  { type: 'debug', event_type: 'debug' },
  {
    type: 'message-end',
    delta: { finish_reason: 'TOOL_CALL', usage: { billed_units: { input_tokens: 10, output_tokens: 8 } } },
  },
)

async function harness(baseURL: string): Promise<Context> {
  vi.stubEnv(KEY_ENV, 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: {
      'cohere-canada': {
        apiKeyEnv: KEY_ENV,
        displayName: 'Cohere (Canada)',
        api: COHERE_V2_CHAT_API,
        baseURL,
        models: [{
          id: 'command-a-plus-05-2026',
          name: 'Command A+',
          contextWindow: 256_000,
          maxTokens: 32_768,
        }],
      },
    },
  })
  return ctx
}

function user(text: string): Message {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })
}

describe('cohere-v2-chat protocol selection', () => {
  it('is a named supported protocol and builds a hand-declared route', () => {
    expect(supportedProtocols()).toContain(COHERE_V2_CHAT_API)
    const resolved = resolveProfiles({
      'cohere-canada': {
        api: COHERE_V2_CHAT_API,
        baseURL: 'https://api.cohere.com/v2',
        models: [{ id: 'command-a-plus-05-2026', contextWindow: 1, maxTokens: 1 }],
      },
    })
    expect(resolved.get('cohere-canada')?.piProvider.baseUrl).toBe('https://api.cohere.com/v2')
  })

  it('joins /chat onto the configured prefix without dropping /v2', () => {
    expect(cohereV2ChatUrl('https://api.cohere.com/v2')).toBe('https://api.cohere.com/v2/chat')
    expect(cohereV2ChatUrl('https://api.cohere.com/v2/')).toBe('https://api.cohere.com/v2/chat')
  })
})

describe('serializeCohereV2ChatRequest', () => {
  it('sends system, tools, strict_tools, and sampling fields', () => {
    const request = serializeCohereV2ChatRequest('command-a-plus-05-2026', context({
      systemPrompt: 'be brief',
      tools: [{ name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: {} } }],
    }), {
      temperature: 0.2,
      maxTokens: 64,
      reasoning: 'high',
    })
    expect(request).toEqual({
      stream: true,
      model: 'command-a-plus-05-2026',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      tools: [{
        type: 'function',
        function: { name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: {} } },
      }],
      strict_tools: true,
      temperature: 0.2,
      max_tokens: 64,
      thinking: { type: 'enabled' },
    })
  })

  it('omits tools and thinking unless configured, and disables thinking for off', () => {
    expect(serializeCohereV2ChatRequest('m', context({ tools: [] }))).not.toHaveProperty('tools')
    expect(serializeCohereV2ChatRequest('m', context({
      tools: [{ name: 'lookup', parameters: { type: 'object', properties: {} } }],
    })).tools).toEqual([{
      type: 'function',
      function: { name: 'lookup', parameters: { type: 'object', properties: {} } },
    }])
    expect(serializeCohereV2ChatRequest('m', context(), { reasoning: 'off' }).thinking).toEqual({ type: 'disabled' })
    expect(serializeCohereV2ChatRequest('m', context())).not.toHaveProperty('thinking')
  })

  it('serializes images, thinking, tool calls, and empty tool results', () => {
    const request = serializeCohereV2ChatRequest('m', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: 'see ' },
            { type: 'image', data: 'AQID', mimeType: 'image/png' },
          ],
          timestamp: 0,
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'thinking', thinking: 'plan' },
            { type: 'text', text: '' },
            { type: 'text', text: 'calling' },
            { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { q: 'x' } },
          ],
          api: COHERE_V2_CHAT_API as Api,
          provider: 'cohere-canada',
          model: 'm',
          usage: ZERO_USAGE,
          stopReason: 'toolUse',
          timestamp: 0,
        },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'lookup',
          content: [{ type: 'text', text: '' }],
          isError: false,
          timestamp: 0,
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'mull' },
            { type: 'text', text: 'done' },
          ],
          api: COHERE_V2_CHAT_API as Api,
          provider: 'cohere-canada',
          model: 'm',
          usage: ZERO_USAGE,
          stopReason: 'stop',
          timestamp: 0,
        },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'only' }],
          api: COHERE_V2_CHAT_API as Api,
          provider: 'cohere-canada',
          model: 'm',
          usage: ZERO_USAGE,
          stopReason: 'stop',
          timestamp: 0,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'plain' }],
          api: COHERE_V2_CHAT_API as Api,
          provider: 'cohere-canada',
          model: 'm',
          usage: ZERO_USAGE,
          stopReason: 'stop',
          timestamp: 0,
        },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'c2', name: 'f', arguments: {} }],
          api: COHERE_V2_CHAT_API as Api,
          provider: 'cohere-canada',
          model: 'm',
          usage: ZERO_USAGE,
          stopReason: 'toolUse',
          timestamp: 0,
        },
        {
          role: 'toolResult',
          toolCallId: 'c2',
          toolName: 'f',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
          timestamp: 0,
        },
      ],
    })
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ],
      },
      {
        role: 'assistant',
        tool_plan: 'plan',
        content: 'calling',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '(no output)' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'mull' },
          { type: 'text', text: 'done' },
        ],
      },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }] },
      { role: 'assistant', content: 'plain' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'c2', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c2', content: 'ok' },
    ])
  })

  it('keeps text-only user arrays as a joined string', () => {
    const request = serializeCohereV2ChatRequest('m', {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
        timestamp: 0,
      }],
    })
    expect(request.messages[0]).toEqual({ role: 'user', content: 'ab' })
  })
})

describe('parseCohereSse', () => {
  it('reads named events, comments, CRLF, and joined data lines', async () => {
    const frames = await collect(parseCohereSse(sseBytes([
      ': keep-alive\r',
      'event: content-delta\r\n',
      'data: {"a":1}\n',
      'data: {"b":2}\n',
      '\n',
      'data: {"type":"message-end"}\n',
      '\n',
      'event: leftover-without-blank',
    ].join(''))))
    expect(frames).toEqual([
      { event: 'content-delta', data: '{"a":1}\n{"b":2}' },
      { event: '', data: '{"type":"message-end"}' },
    ])
  })

  it('does not flush an empty event block', async () => {
    expect(await collect(parseCohereSse(sseBytes('\n\n')))).toEqual([])
  })

  it('ignores comments, unknown fields, and empty frames', async () => {
    const frames = await collect(parseCohereSse(sseBytes([
      ': keep-alive\n',
      '\n',
      'foo: bar\n',
      '\n',
      'event: debug\n',
      'data: {}\n',
      '\n',
    ].join(''))))
    expect(frames).toEqual([{ event: 'debug', data: '{}' }])
  })
})

describe('translateCohereSse', () => {
  it('maps text, usage tokens, and COMPLETE', async () => {
    const events = await collect(translateCohereSse(model('https://api.cohere.com/v2'), (async function* () {
      for (const data of textEvents) yield { event: '', data }
    })()))
    expect(events[0]).toMatchObject({ type: 'start' })
    expect(events.some(event => event.type === 'text_delta' && event.delta === 'hello')).toBe(true)
    const done = events.at(-1)
    expect(done).toMatchObject({
      type: 'done',
      reason: 'stop',
      message: {
        api: COHERE_V2_CHAT_API,
        responseId: 'msg-1',
        stopReason: 'stop',
        usage: { input: 3, output: 1, cacheRead: 0 },
      },
    })
  })

  it('maps tool_plan, tool_calls, citations, billed usage, and TOOL_CALL', async () => {
    const events = await collect(translateCohereSse(model('https://api.cohere.com/v2'), (async function* () {
      yield { event: 'tool-plan-delta', data: toolEvents[1]! }
      for (const data of toolEvents) yield { event: '', data }
    })()))
    expect(events.some(event => event.type === 'thinking_delta' && event.delta === 'I will look it up.')).toBe(true)
    const end = events.find(event => event.type === 'toolcall_end')
    expect(end).toMatchObject({
      type: 'toolcall_end',
      toolCall: { id: 'call-1', name: 'lookup', arguments: { q: 'x' } },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'toolUse',
      message: { stopReason: 'toolUse', usage: { input: 10, output: 8 } },
    })
  })

  it('maps thinking content, stop reasons, and skips malformed frames', async () => {
    const events = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield { event: '', data: 'not-json' }
      yield { event: '', data: '[DONE]' }
      yield { event: '', data: JSON.stringify({ type: 'content-start', delta: { message: { content: { type: 'thinking' } } } }) }
      yield { event: '', data: JSON.stringify({ type: 'content-delta', delta: { message: { content: { thinking: 'hmm' } } } }) }
      yield { event: '', data: JSON.stringify({ type: 'content-end' }) }
      yield { event: '', data: JSON.stringify({ type: 'tool-plan-delta', delta: { message: { tool_plan: '' } } }) }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-delta', index: 3, delta: { message: { tool_calls: { function: { arguments: '{}' } } } } }) }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-end', index: 3 }) }
      yield { event: '', data: JSON.stringify({ type: 'content-delta', delta: { message: { content: { text: 'late' } } } }) }
      yield {
        event: '',
        data: JSON.stringify({
          type: 'message-end',
          delta: { finish_reason: 'MAX_TOKENS', usage: { tokens: { cached_tokens: 2, input_tokens: 1, output_tokens: 1 } } },
        }),
      }
    })()))
    expect(events.some(event => event.type === 'thinking_delta' && event.delta === 'hmm')).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'length',
      message: { usage: { input: 1, output: 1, cacheRead: 2 } },
    })
  })

  it('maps ERROR finish and a truncated stream', async () => {
    const errorEvents = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield {
        event: '',
        data: JSON.stringify({ type: 'message-end', delta: { finish_reason: 'ERROR', error: 'boom' } }),
      }
    })()))
    expect(errorEvents.at(-1)).toMatchObject({
      type: 'error',
      error: { stopReason: 'error', errorMessage: 'boom' },
    })

    const truncated = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield { event: '', data: JSON.stringify({ type: 'content-start', delta: { message: { content: { type: 'text' } } } }) }
    })()))
    expect(truncated.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: /ended without a terminal message-end/ },
    })
  })

  it('accepts object tool arguments and unknown finish reasons', async () => {
    const events = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield {
        event: '',
        data: JSON.stringify({
          type: 'tool-call-start',
          delta: { message: { tool_calls: { id: 'c', function: { name: 'f', arguments: { a: 1 } } } } },
        }),
      }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-end' }) }
      yield { event: '', data: JSON.stringify({ type: 'message-end', delta: { finish_reason: 'OTHER' } }) }
    })()))
    expect(events.some(event => event.type === 'toolcall_delta' && event.delta === '{"a":1}')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stop' })
  })

  it('maps STOP_SEQUENCE, TIMEOUT, nested errors, and unusable argument JSON', async () => {
    const stopped = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield { event: '', data: JSON.stringify({ type: 'message-end', delta: { finish_reason: 'STOP_SEQUENCE' } }) }
    })()))
    expect(stopped.at(-1)).toMatchObject({ type: 'done', reason: 'stop' })

    const timedOut = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield {
        event: '',
        data: JSON.stringify({
          type: 'message-end',
          delta: { finish_reason: 'TIMEOUT', error: { message: 'took too long' } },
        }),
      }
    })()))
    expect(timedOut.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'took too long' },
    })

    const unusable = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield {
        event: '',
        data: JSON.stringify({
          type: 'tool-call-start',
          delta: { message: { tool_calls: { function: { arguments: [1] } } } },
        }),
      }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-end' }) }
      yield { event: '', data: JSON.stringify({ type: 'message-end', delta: { finish_reason: 'COMPLETE' } }) }
    })()))
    const end = unusable.find(event => event.type === 'toolcall_end')
    expect(end).toMatchObject({ toolCall: { arguments: {} } })
  })

  it('falls through empty error objects, invalid usage numbers, and missing tool arguments', async () => {
    const events = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield {
        event: '',
        data: JSON.stringify({
          type: 'tool-call-start',
          delta: { message: { tool_calls: { function: { arguments: 'not-json' } } } },
        }),
      }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-delta', delta: { message: {} } }) }
      yield { event: '', data: JSON.stringify({ type: 'content-start', delta: { message: {} } }) }
      yield {
        event: '',
        data: JSON.stringify({
          type: 'message-end',
          delta: {
            finish_reason: 'ERROR',
            error: { message: '', error: '', errorObject: {} },
            usage: { tokens: { input_tokens: Number.NaN, output_tokens: 'x' } },
          },
        }),
      }
    })()))
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'Cohere v2 chat generation failed' },
    })
  })

  it('covers unused SSE fields, non-object deltas, and fallback usage', async () => {
    const events = await collect(translateCohereSse(model('https://example'), (async function* () {
      yield { event: '', data: JSON.stringify({ type: 1 }) }
      yield { event: '', data: JSON.stringify({ type: 'message-start', id: 9 }) }
      yield { event: '', data: JSON.stringify({ type: 'message-start', id: '' }) }
      yield { event: '', data: JSON.stringify({ type: 'content-delta', delta: { message: { content: 'x' } } }) }
      yield { event: '', data: JSON.stringify({ type: 'content-delta', delta: { message: { content: { thinking: 'late' } } } }) }
      yield { event: '', data: JSON.stringify({ type: 'content-end' }) }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-start', delta: { message: { tool_calls: 'x' } } }) }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { function: { arguments: '' } } } } }) }
      yield { event: '', data: JSON.stringify({ type: 'tool-call-end', index: 1 }) }
      yield {
        event: '',
        data: JSON.stringify({
          type: 'message-end',
          delta: {
            finish_reason: 'ERROR',
            error: { error: { message: 5 } },
            usage: 'none',
          },
        }),
      }
    })()))
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'Cohere v2 chat generation failed' },
    })
    const start = events.find(event => event.type === 'toolcall_start')
    expect(start).toMatchObject({ type: 'toolcall_start' })
  })
})

describe('cohereV2ChatApi stream', () => {
  it('POSTs /v2/chat with bearer auth and streams a text turn', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(`${server.url}/v2`)
    const result = await assemble(ctx, {
      provider: 'cohere-canada',
      model: 'command-a-plus-05-2026',
      messages: [user('hi')],
    })
    expect(server.paths).toEqual(['/v2/chat'])
    expect(server.headers[0]?.authorization).toBe('Bearer test-key')
    expect(server.requests[0]).toMatchObject({
      stream: true,
      model: 'command-a-plus-05-2026',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1 })
  })

  it('round-trips a tool call and the following tool result', async () => {
    const server = await mockServer([{ events: toolEvents }, { events: textEvents }])
    const ctx = await harness(server.url)
    const first = await assemble(ctx, {
      provider: 'cohere-canada',
      model: 'command-a-plus-05-2026',
      messages: [user('look up x')],
      tools: [{ name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
    })
    expect(first.finish).toEqual({ kind: 'tool-calls' })
    const call = first.message.content.find(block => block.type === 'tool-call')
    expect(call).toMatchObject({ id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' })

    const followup = await assemble(ctx, {
      provider: 'cohere-canada',
      model: 'command-a-plus-05-2026',
      messages: [
        user('look up x'),
        first.message,
        createMessage({
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: CallId('call-1'),
            content: [{ type: 'text', text: 'value=1' }],
          }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
      tools: [{ name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
    })
    expect(followup.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests[0]).toMatchObject({
      tools: [{ type: 'function', function: { name: 'lookup' } }],
      strict_tools: true,
    })
    expect(server.requests[1]).toMatchObject({
      messages: [
        { role: 'user', content: 'look up x' },
        {
          role: 'assistant',
          tool_plan: 'I will look it up.',
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'value=1' },
      ],
    })
  })

  it('yields an in-stream error for HTTP failures and a missing body', async () => {
    const api = cohereV2ChatApi()
    const http = await mockServer([{ status: 401, body: '{"message":"bad key"}' }])
    const unauthorized = await collect(api.stream(model(http.url), context(), { apiKey: 'k' }))
    expect(unauthorized.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'bad key' },
    })

    const plain = await mockServer([{ status: 503, body: 'nope' }])
    const server = await collect(api.stream(model(plain.url), context(), {}))
    expect(server.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: /HTTP 503/ },
    })

    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const empty = await collect(api.stream(model('https://example'), context(), {}))
    expect(empty.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: /ended without a terminal/ },
    })
  })

  it('maps abort and transport failures to error events', async () => {
    const api = cohereV2ChatApi()
    const aborted = await collect(api.stream(model('https://example'), context(), {
      signal: AbortSignal.abort('stop'),
    }))
    expect(aborted.at(-1)).toMatchObject({
      type: 'error',
      reason: 'aborted',
      error: { stopReason: 'aborted' },
    })

    const controller = new AbortController()
    vi.stubGlobal('fetch', async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const mid = await collect(api.stream(model('https://example'), context(), {
      signal: controller.signal,
    }))
    expect(mid.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' })

    vi.stubGlobal('fetch', async () => {
      throw 'socket down'
    })
    const transport = await collect(api.stream(model('https://example'), context(), {}))
    expect(transport.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'socket down' },
    })

    vi.stubGlobal('fetch', async () => {
      throw new Error('dns failed')
    })
    const named = await collect(api.stream(model('https://example'), context(), {}))
    expect(named.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'dns failed' },
    })
  })

  it('copies caller headers and drops null suppressions', async () => {
    const api = cohereV2ChatApi()
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const events = await collect(api.streamSimple(model(`${server.url}/v2`), context(), {
      apiKey: 'k',
      headers: { 'x-test': '1', 'x-omit': null },
    }))
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(server.headers[0]?.['x-test']).toBe('1')
    expect(server.headers[0]?.['x-omit']).toBeUndefined()

    const keyless = await collect(api.stream(model(`${server.url}/v2`), context(), { apiKey: '' }))
    expect(keyless.at(-1)).toMatchObject({ type: 'done' })
    expect(server.headers[1]?.authorization).toBeUndefined()
  })

  it('reads nested HTTP error objects', async () => {
    const api = cohereV2ChatApi()
    const http = await mockServer([{ status: 400, body: '{"error":{"message":"schema rejected"}}' }])
    const rejected = await collect(api.stream(model(http.url), context(), { apiKey: 'k' }))
    expect(rejected.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'schema rejected' },
    })

    const stringError = await mockServer([{ status: 400, body: '{"error":"quota"}' }])
    const quota = await collect(api.stream(model(stringError.url), context(), { apiKey: 'k' }))
    expect(quota.at(-1)).toMatchObject({
      type: 'error',
      error: { errorMessage: 'quota' },
    })
  })
})
