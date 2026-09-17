import { describe, expect, it } from 'vitest'
import { BlockAssembler, EMPTY_RESPONSE_CODE, LlmError } from '@workspacealberta/wa-llm'
import type { StreamChunk } from '@workspacealberta/wa-llm'
import { mapFinishReason, mapUsage, translate } from '../src/translate.ts'

async function* feed(...payloads: (string | object)[]): AsyncGenerator<string> {
  for (const payload of payloads) {
    yield typeof payload === 'string' ? payload : JSON.stringify(payload)
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('translate: text', () => {
  it('streams a text block and defers finish to message-end', async () => {
    const chunks = await collect(translate(feed(
      { type: 'message-start' },
      { type: 'content-start', index: 0, delta: { message: { content: { type: 'text', text: '' } } } },
      { type: 'content-delta', index: 0, delta: { message: { content: { text: 'Hel' } } } },
      { type: 'content-delta', index: 0, delta: { message: { content: { text: 'lo' } } } },
      { type: 'content-end', index: 0 },
      { type: 'message-end', delta: { finish_reason: 'COMPLETE', usage: { tokens: { input_tokens: 5, output_tokens: 2 } } } },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hel' },
      { type: 'text-delta', index: 0, text: 'lo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('assembles into the message BlockAssembler expects', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of translate(feed(
      { type: 'content-delta', index: 0, delta: { message: { content: { text: 'hi' } } } },
      { type: 'message-end', delta: { finish_reason: 'COMPLETE' } },
    ))) {
      assembler.push(chunk)
    }
    expect(assembler.message().content).toEqual([{ type: 'text', text: 'hi' }])
    expect(assembler.finish).toEqual({ kind: 'stop' })
  })
})

describe('translate: reasoning', () => {
  it('does not open a reasoning block for an empty thinking start', async () => {
    const chunks = await collect(translate(feed(
      { type: 'content-start', index: 0, delta: { message: { content: { type: 'thinking', thinking: '' } } } },
      { type: 'content-delta', index: 1, delta: { message: { content: { text: 'plain' } } } },
      { type: 'message-end', delta: { finish_reason: 'COMPLETE' } },
    )))
    expect(chunks.some(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')).toBe(false)
  })

  it('streams thinking then text as separate blocks', async () => {
    const chunks = await collect(translate(feed(
      { type: 'content-delta', index: 0, delta: { message: { content: { thinking: 'think' } } } },
      { type: 'content-delta', index: 0, delta: { message: { content: { thinking: 'ing' } } } },
      { type: 'content-delta', index: 1, delta: { message: { content: { text: 'answer' } } } },
      { type: 'message-end', delta: { finish_reason: 'COMPLETE' } },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'reasoning-delta', index: 0, text: 'ing' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('maps tool_plan deltas onto the reasoning block', async () => {
    const chunks = await collect(translate(feed(
      { type: 'tool-plan-delta', delta: { message: { tool_plan: 'plan ' } } },
      { type: 'tool-plan-delta', delta: { message: { tool_plan: 'ahead' } } },
      { type: 'message-end', delta: { finish_reason: 'TOOL_CALL' } },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'plan ' },
      { type: 'reasoning-delta', index: 0, text: 'ahead' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'plan ahead' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })
})

describe('translate: tool calls', () => {
  it('streams a tool call by index', async () => {
    const chunks = await collect(translate(feed(
      { type: 'tool-call-start', index: 0, delta: { message: { tool_calls: { id: 'c1', type: 'function', function: { name: 'ping', arguments: '' } } } } },
      { type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { function: { arguments: '{"q":' } } } } },
      { type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { function: { arguments: '1}' } } } } },
      { type: 'tool-call-end', index: 0 },
      { type: 'message-end', delta: { finish_reason: 'TOOL_CALL' } },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'c1', name: 'ping', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 0, id: 'c1', name: 'ping', argumentsDelta: '{"q":' },
      { type: 'tool-call-delta', index: 0, id: 'c1', name: 'ping', argumentsDelta: '1}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'c1', name: 'ping', arguments: '{"q":1}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })
})

describe('translate: finish and usage', () => {
  it('maps known finish reasons', () => {
    expect(mapFinishReason('COMPLETE')).toEqual({ kind: 'stop' })
    expect(mapFinishReason('STOP_SEQUENCE')).toEqual({ kind: 'stop' })
    expect(mapFinishReason('TOOL_CALL')).toEqual({ kind: 'tool-calls' })
    expect(mapFinishReason('MAX_TOKENS')).toEqual({ kind: 'max-tokens' })
    expect(mapFinishReason('ERROR', 'boom')).toEqual({
      kind: 'error',
      failure: { message: 'boom', code: 'ERROR' },
    })
    expect(mapFinishReason('TIMEOUT')).toEqual({
      kind: 'error',
      failure: { message: 'model stopped: TIMEOUT', code: 'TIMEOUT' },
    })
    expect(mapFinishReason('weird')).toEqual({
      kind: 'error',
      failure: { message: 'model stopped: weird', code: 'WEIRD' },
    })
  })

  it('subtracts cached tokens from input', () => {
    expect(mapUsage({ tokens: { input_tokens: 10, output_tokens: 2, cached_tokens: 4 } })).toEqual({
      inputTokens: 6,
      outputTokens: 2,
      cacheReadTokens: 4,
    })
  })

  it('falls back to billed_units when tokens are absent', () => {
    expect(mapUsage({ billed_units: { input_tokens: 7, output_tokens: 3 } })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    })
  })

  it('counts zero tokens when usage carries neither tokens nor billed units', () => {
    expect(mapUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('maps an empty COMPLETE into EMPTY_RESPONSE', async () => {
    const chunks = await collect(translate(feed(
      { type: 'citation-start' },
      { type: 'debug' },
      { type: 'message-end', delta: { finish_reason: 'COMPLETE' } },
    )))
    expect(chunks).toEqual([
      {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
        },
      },
    ])
  })

  it('defaults a missing finish_reason to stop when content exists', async () => {
    const chunks = await collect(translate(feed(
      { type: 'content-delta', index: 0, delta: { message: { content: { text: 'ok' } } } },
      { type: 'message-end', delta: {} },
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('throws MALFORMED_RESPONSE on bad JSON', async () => {
    await expect(collect(translate(feed('{"type":')))).rejects.toThrow(LlmError)
    await expect(collect(translate(feed('{"type":')))).rejects.toThrow(/malformed SSE payload/)
  })

  it('ignores empty tool-plan deltas and defaults a missing tool-call index to 0', async () => {
    const chunks = await collect(translate(feed(
      { type: 'tool-plan-delta', delta: { message: {} } },
      { type: 'tool-plan-delta', delta: { message: { tool_plan: '' } } },
      { type: 'tool-call-delta', delta: { message: { tool_calls: { function: { arguments: '{}' } } } } },
      { type: 'message-end', delta: { finish_reason: 'TOOL_CALL' } },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: '', name: '', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('treats a tool-call delta without arguments as an empty fragment', async () => {
    const chunks = await collect(translate(feed(
      { type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { id: 'c2', function: { name: 'ping' } } } } },
      { type: 'message-end', delta: { finish_reason: 'TOOL_CALL' } },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'c2', name: 'ping', argumentsDelta: '' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'c2', name: 'ping', arguments: '' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('throws STREAM_CLOSED when the stream ends without message-end', async () => {
    await expect(collect(translate(feed({ type: 'content-delta' })))).rejects.toThrow(/without message-end/)
  })
})
