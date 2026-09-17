import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessageEvent, Context as PiContext, Message as PiMessage, Provider, Tool } from '@earendil-works/pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { supportedProtocols } from '../src/provider.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

/**
 * A route resolved through the shipping config path, plus its built model:
 * the tests below exercise the same provider construction a deployment gets,
 * not a hand-assembled API module.
 */
function routeOf(baseURL: string): { provider: Provider; model: ReturnType<Provider['getModels']>[number] } {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const profiles = resolveProfiles({
    'cohere-canada': {
      apiKeyEnv: 'PI_TEST_KEY',
      api: 'cohere-v2-chat',
      baseURL,
      models: [{ id: 'command-a-plus-05-2026', name: 'Command A+', contextWindow: 256000, maxTokens: 32768 }],
    },
  })
  const provider = profiles.get('cohere-canada')?.piProvider
  if (provider === undefined) throw new Error('route did not resolve')
  const model = provider.getModels()[0]
  if (model === undefined) throw new Error('route resolved no models')
  return { provider, model }
}

async function collect(events: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const out: AssistantMessageEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

const user = (text: string): PiMessage => ({ role: 'user', content: text, timestamp: 0 })

const WEATHER_TOOL: Tool = {
  name: 'get_weather',
  description: 'Get current weather',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
}

describe('cohere-v2-chat protocol', () => {
  it('is offered by the protocol table', () => {
    expect(supportedProtocols()).toContain('cohere-v2-chat')
  })

  it('streams thinking and text blocks to a terminal stop', async () => {
    const server = await mockServer([{ events: [
      '{"id":"msg-1","type":"message-start","delta":{"message":{"role":"assistant","content":[],"tool_plan":"","tool_calls":[],"citations":[]}}}',
      '{"type":"content-start","index":0,"delta":{"message":{"content":{"type":"thinking","thinking":""}}}}',
      '{"type":"content-delta","index":0,"delta":{"message":{"content":{"thinking":"Need the weather."}}}}',
      '{"type":"content-end","index":0}',
      '{"type":"content-start","index":1,"delta":{"message":{"content":{"type":"text","text":""}}}}',
      '{"type":"content-delta","index":1,"delta":{"message":{"content":{"text":"Hello"}}}}',
      '{"type":"content-delta","index":1,"delta":{"message":{"content":{"text":" there"}}}}',
      '{"type":"content-end","index":1}',
      // Unmodeled event types must drop, not kill the stream.
      '{"type":"citation-start","index":1,"citation":{"start":0,"end":5,"text":"Hello","sources":[]}}',
      '{"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{"billed_units":{"input_tokens":31,"output_tokens":7},"tokens":{"input_tokens":245,"output_tokens":9},"cached_tokens":144}}}',
    ] }])
    const { provider, model } = routeOf(server.url)
    const events = await collect(provider.streamSimple(model, { messages: [user('hi')] }, { apiKey: 'test-key' }))

    expect(events.map(event => event.type)).toEqual([
      'start', 'thinking_start', 'thinking_delta', 'thinking_end',
      'text_start', 'text_delta', 'text_delta', 'text_end', 'done',
    ])
    const done = events.at(-1)
    if (done?.type !== 'done') throw new Error('stream did not complete')
    expect(done.message.content).toEqual([
      { type: 'thinking', thinking: 'Need the weather.' },
      { type: 'text', text: 'Hello there' },
    ])
    expect(done.message.stopReason).toBe('stop')
    expect(done.message.responseId).toBe('msg-1')
    expect(done.message.usage).toMatchObject({ input: 31, output: 7, cacheRead: 144, totalTokens: 38 })
    expect(server.paths).toEqual(['/chat'])
    expect(server.headers[0]?.authorization).toBe('Bearer test-key')
    expect(server.requests[0]).toMatchObject({ model: 'command-a-plus-05-2026', messages: [{ role: 'user', content: 'hi' }], stream: true })
  })

  it('remaps the endpoint\'s per-stream tool indexes onto one block sequence', async () => {
    const server = await mockServer([{ events: [
      '{"type":"message-start","id":"msg-2","delta":{"message":{"role":"assistant","content":[]}}}',
      // Content and tool calls both count from 0 on the wire.
      '{"type":"content-start","index":0,"delta":{"message":{"content":{"type":"thinking","thinking":""}}}}',
      '{"type":"content-delta","index":0,"delta":{"message":{"content":{"thinking":"Plan the call."}}}}',
      '{"type":"content-end","index":0}',
      '{"type":"tool-call-start","index":0,"delta":{"message":{"tool_calls":{"id":"get_weather_1","type":"function","function":{"name":"get_weather","arguments":""}}}}}',
      '{"type":"tool-call-delta","index":0,"delta":{"message":{"tool_calls":{"function":{"arguments":"{\\"city\\""}}}}}',
      '{"type":"tool-call-delta","index":0,"delta":{"message":{"tool_calls":{"function":{"arguments":":\\"Calgary\\"}"}}}}}',
      '{"type":"tool-call-end","index":0}',
      '{"type":"message-end","delta":{"finish_reason":"TOOL_CALL","usage":{"billed_units":{"input_tokens":5,"output_tokens":3}}}}',
    ] }])
    const { provider, model } = routeOf(server.url)
    const events = await collect(provider.streamSimple(model, { messages: [user('weather?')] }, { apiKey: 'test-key' }))

    const end = events.at(-1)
    if (end?.type !== 'done') throw new Error('stream did not complete')
    expect(end.reason).toBe('toolUse')
    const start = events.find(event => event.type === 'toolcall_start')
    const call = events.find(event => event.type === 'toolcall_end')
    if (start?.type !== 'toolcall_start' || call?.type !== 'toolcall_end') throw new Error('tool call events missing')
    // The thinking block took slot 0, so the call lands at 1 despite its wire index 0.
    expect(start.contentIndex).toBe(1)
    expect(call.contentIndex).toBe(1)
    expect(call.toolCall).toMatchObject({ id: 'get_weather_1', name: 'get_weather', arguments: { city: 'Calgary' } })
  })

  it('maps tool-plan deltas onto a thinking block ahead of the call', async () => {
    const server = await mockServer([{ events: [
      '{"type":"message-start","delta":{"message":{"role":"assistant","content":[]}}}',
      '{"type":"tool-plan-delta","delta":{"message":{"tool_plan":"I should "}}}',
      '{"type":"tool-plan-delta","delta":{"message":{"tool_plan":"call the tool"}}}',
      '{"type":"tool-call-start","index":0,"delta":{"message":{"tool_calls":{"id":"t1","type":"function","function":{"name":"lookup","arguments":""}}}}}',
      '{"type":"tool-call-end","index":0}',
      '{"type":"message-end","delta":{"finish_reason":"TOOL_CALL","usage":{}}}',
    ] }])
    const { provider, model } = routeOf(server.url)
    const events = await collect(provider.streamSimple(model, { messages: [user('go')] }, { apiKey: 'test-key' }))

    const planStart = events.find(event => event.type === 'thinking_start')
    const planDelta = events.filter(event => event.type === 'thinking_delta')
    if (planStart?.type !== 'thinking_start') throw new Error('plan block missing')
    expect(planStart.contentIndex).toBe(0)
    expect(planDelta.map(event => (event as { delta: string }).delta).join('')).toBe('I should call the tool')
    const call = events.find(event => event.type === 'toolcall_end')
    if (call?.type !== 'toolcall_end') throw new Error('tool call missing')
    expect(call.contentIndex).toBe(1)
  })

  it('converts replay history into the v2 message vocabulary', async () => {
    const server = await mockServer([{ events: [
      '{"type":"message-start","delta":{"message":{"role":"assistant","content":[]}}}',
      '{"type":"content-start","index":0,"delta":{"message":{"content":{"type":"text","text":""}}}}',
      '{"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"done"}}}}',
      '{"type":"content-end","index":0}',
      '{"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{}}}',
    ] }])
    const { provider, model } = routeOf(server.url)
    const context: PiContext = {
      systemPrompt: 'You are the desk agent.',
      messages: [
        user('Use the tool for Calgary.'),
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need the weather.' },
            { type: 'text', text: 'Checking.' },
            { type: 'toolCall', id: 'call1', name: 'get_weather', arguments: { city: 'Calgary' } },
          ],
          api: 'cohere-v2-chat',
          provider: 'cohere-canada',
          model: 'command-a-plus-05-2026',
          usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 0,
        },
        {
          role: 'toolResult',
          toolCallId: 'call1',
          toolName: 'get_weather',
          content: [{ type: 'text', text: '{"temp_c": -2}' }],
          isError: false,
          timestamp: 0,
        },
        {
          role: 'toolResult',
          toolCallId: 'call1',
          toolName: 'get_weather',
          content: [{ type: 'text', text: 'snowing lightly' }],
          isError: false,
          timestamp: 0,
        },
      ],
      tools: [WEATHER_TOOL],
    }
    await collect(provider.streamSimple(model, context, { apiKey: 'test-key', temperature: 0.2, maxTokens: 512 }))

    expect(server.requests[0]).toEqual({
      model: 'command-a-plus-05-2026',
      stream: true,
      temperature: 0.2,
      max_tokens: 512,
      tools: [{
        type: 'function',
        function: { name: 'get_weather', description: 'Get current weather', parameters: WEATHER_TOOL.parameters },
      }],
      messages: [
        { role: 'system', content: 'You are the desk agent.' },
        { role: 'user', content: 'Use the tool for Calgary.' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need the weather.' },
            { type: 'text', text: 'Checking.' },
          ],
          tool_calls: [{ id: 'call1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Calgary"}' } }],
        },
        // A JSON-object result passes through as the JSON string the endpoint
        // asks for (normalized); free text is wrapped so it still parses.
        { role: 'tool', tool_call_id: 'call1', content: '{"temp_c":-2}' },
        { role: 'tool', tool_call_id: 'call1', content: '{"output":"snowing lightly"}' },
      ],
    })
  })

  it('fails the stream with the endpoint message on a non-OK response', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ message: 'invalid api key' }) }])
    const { provider, model } = routeOf(server.url)
    const events = await collect(provider.streamSimple(model, { messages: [user('hi')] }, { apiKey: 'test-key' }))

    expect(events).toHaveLength(1)
    const error = events[0]
    if (error?.type !== 'error') throw new Error('expected an error event')
    expect(error.reason).toBe('error')
    expect(error.error.errorMessage).toBe('401 Unauthorized: invalid api key')
  })

  it('fails a stream the endpoint closed before its terminal event', async () => {
    const server = await mockServer([{ events: [
      '{"type":"message-start","delta":{"message":{"role":"assistant","content":[]}}}',
      '{"type":"content-start","index":0,"delta":{"message":{"content":{"type":"text","text":""}}}}',
      '{"type":"content-end","index":0}',
    ] }])
    const { provider, model } = routeOf(server.url)
    const events = await collect(provider.streamSimple(model, { messages: [user('hi')] }, { apiKey: 'test-key' }))

    const error = events.at(-1)
    if (error?.type !== 'error') throw new Error('expected an error event')
    expect(error.error.errorMessage).toBe('cohere-canada stream ended without a terminal event')
  })

  it('fails the message on ERROR and TIMEOUT finish reasons', async () => {
    for (const finish_reason of ['ERROR', 'TIMEOUT']) {
      const server = await mockServer([{ events: [
        '{"type":"message-start","delta":{"message":{"role":"assistant","content":[]}}}',
        `{"type":"message-end","delta":{"finish_reason":"${finish_reason}","usage":{}}}`,
      ] }])
      const { provider, model } = routeOf(server.url)
      const events = await collect(provider.streamSimple(model, { messages: [user('hi')] }, { apiKey: 'test-key' }))
      const error = events.at(-1)
      if (error?.type !== 'error') throw new Error(`expected an error event for ${finish_reason}`)
      expect(error.error.errorMessage).toBe(`cohere finish_reason "${finish_reason}"`)
    }
  })

  it('requires an api key before any request and a baseURL at resolution', async () => {
    const server = await mockServer([{ events: [] }])
    const { provider, model } = routeOf(server.url)
    const keyless = await collect(provider.streamSimple(model, { messages: [user('hi')] }, {}))
    expect(keyless[0]).toMatchObject({ type: 'error', reason: 'error' })
    if (keyless[0]?.type !== 'error') throw new Error('unreachable')
    expect(keyless[0].error.errorMessage).toContain('No API key provided')

    // A hand-declared route with no endpoint is refused where it is written —
    // resolution — never at request time.
    const resolve = (): unknown => resolveProfiles({
      'cohere-canada': {
        apiKeyEnv: 'PI_TEST_KEY',
        api: 'cohere-v2-chat',
        models: [{ id: 'command-a-plus-05-2026', name: 'Command A+' }],
      },
    })
    expect(resolve).toThrow(/needs a baseURL/)
  })
})
