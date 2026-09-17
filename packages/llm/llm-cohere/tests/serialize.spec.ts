import { describe, expect, it } from 'vitest'
import { createUserMessage, CallId, createMessage } from '@workspacealberta/wa-llm'
import type { GenerateOptions, Message } from '@workspacealberta/wa-llm'
import { AttachmentId } from '@workspacealberta/wa-attachment'
import { serializeMessages, serializeRequest } from '../src/serialize.ts'

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'cohere-canada', model: 'command-a-plus-05-2026', messages: [], ...overrides }
}

describe('serializeMessages', () => {
  it('maps user text to string content', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('maps system-role messages in history', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'system', content: [{ type: 'text', text: 'be brief' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'system', content: 'be brief' }])
  })

  it('maps assistant text without reasoning to string content', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'assistant', content: 'answer' }])
  })

  it('replays thinking content on tool-call-free turns', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'thinking…' },
        { type: 'text', text: 'answer' },
      ],
    }])
  })

  it('replays reasoning as tool_plan on tool-call turns', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          { type: 'tool-call', id: CallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      tool_plan: 'I should check the weather.',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
      }],
    }])
  })

  it('omits content on a text-less tool-call turn', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('call-1'), name: 'ping', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
    }])
  })

  it('expands tool results into tool-role messages', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'use the tool' },
          { type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'sunny' }] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([
      { role: 'user', content: 'use the tool' },
      { role: 'tool', tool_call_id: 'call-1', content: 'sunny' },
    ])
  })

  it('substitutes a placeholder for empty tool output', () => {
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'tool-result', toolCallId: CallId('call-1'), content: [] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: '(no output)' },
    ])
  })

  it('replays reasoning-only turns as a thinking block', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'just thinking' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'just thinking' }],
    }])
  })

  it('rejects image content', () => {
    const messages: Message[] = [
      createUserMessage({
        content: [{
          type: 'image',
          attachment: {
            attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
            mediaType: 'image/png',
            bytes: 3,
            width: 1,
            height: 1,
          },
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]
    expect(() => serializeMessages(messages)).toThrow('does not support image content')
  })

  it('rejects image content inside a tool result', () => {
    expect(() => serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{
            type: 'image',
            attachment: {
              attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
              mediaType: 'image/png',
              bytes: 3,
              width: 1,
              height: 1,
            },
          }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])).toThrow('does not support image content')
  })
})

describe('serializeRequest', () => {
  it('prepends the system prompt and always streams', () => {
    const body = serializeRequest(request({
      system: 'be brief',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))
    expect(body).toMatchObject({
      model: 'command-a-plus-05-2026',
      stream: true,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    })
  })

  it('offers tools with strict_tools', () => {
    const body = serializeRequest(request({
      tools: [{
        name: 'get_weather',
        description: 'Weather lookup',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    }))
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Weather lookup',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    }])
    expect(body.strict_tools).toBe(true)
  })

  it('omits tools when the list is empty', () => {
    const body = serializeRequest(request({ tools: [] }))
    expect(body.tools).toBeUndefined()
    expect(body.strict_tools).toBeUndefined()
  })

  it('maps stop sequences, temperature, and max_tokens', () => {
    const body = serializeRequest(request({
      stop: ['END'],
      temperature: 0.2,
      maxTokens: 128,
    }))
    expect(body.stop_sequences).toEqual(['END'])
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(128)
  })

  it('sends the thinking lock when configured', () => {
    expect(serializeRequest(request(), { thinking: 'enabled' }).thinking).toEqual({ type: 'enabled' })
    expect(serializeRequest(request(), { thinking: 'disabled' }).thinking).toEqual({ type: 'disabled' })
    expect(serializeRequest(request()).thinking).toBeUndefined()
  })

  it('forces thinking disabled for session-title requests', () => {
    const body = serializeRequest(request({ purpose: 'session-title' }), { thinking: 'enabled' })
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('maps reasoningEffort off to thinking disabled', () => {
    const body = serializeRequest(request({ reasoningEffort: 'off' }), { thinking: 'enabled' })
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('rejects unsupported reasoning efforts', () => {
    expect(() => serializeRequest(request({ reasoningEffort: 'high' }))).toThrow('does not support reasoning effort')
  })
})
