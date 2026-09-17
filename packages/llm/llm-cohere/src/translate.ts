/**
 * Translate Cohere v2 Chat SSE events with one stateful harness block per
 * text, thinking, tool-plan, or tool-call. Empty initial thinking or text
 * deltas do not open a block. Finish reason and usage are deferred until
 * `message-end`, so `usage` always precedes `finish` and nothing follows it.
 * Citation and debug events are ignored.
 *
 * @module @workspacealberta/wa-llm-cohere/translate
 */

import { CallId, EMPTY_RESPONSE_CODE, LlmError } from '@workspacealberta/wa-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@workspacealberta/wa-llm'
import type { WireEvent, WireUsage } from './types.ts'

/** One open block under assembly. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only */
  callId?: string
  name?: string
}

/**
 * Map the wire `finish_reason` vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @param error - optional in-band error text from `message-end`.
 * @returns the mapped reason; unrecognized values become `{kind: 'error'}` with the uppercased value as `code`.
 */
export function mapFinishReason(reason: string, error?: string): FinishReason {
  switch (reason) {
    case 'COMPLETE':
    case 'STOP_SEQUENCE':
      return { kind: 'stop' }
    case 'TOOL_CALL':
      return { kind: 'tool-calls' }
    case 'MAX_TOKENS':
      return { kind: 'max-tokens' }
    case 'ERROR':
    case 'TIMEOUT':
      return {
        kind: 'error',
        failure: {
          message: error !== undefined && error.length > 0 ? error : `model stopped: ${reason}`,
          code: reason,
        },
      }
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map wire usage fields. Cohere reports `tokens.input_tokens` as the full
 * prompt count; when `cached_tokens` is present it is subtracted so harness
 * `inputTokens` stay disjoint from `cacheReadTokens`. `billed_units` is a
 * fallback when `tokens` is absent.
 * @param usage - wire usage from `message-end`.
 * @returns disjoint harness counts; cache fields present only when the wire reported them.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const tokens = usage.tokens
  const billed = usage.billed_units
  const input = tokens?.input_tokens ?? billed?.input_tokens ?? 0
  const output = tokens?.output_tokens ?? billed?.output_tokens ?? 0
  const cacheRead = tokens?.cached_tokens
  return {
    inputTokens: input - (cacheRead ?? 0),
    outputTokens: output,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
  }
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: CallId(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

/**
 * Consume SSE data payloads and yield StreamChunks. Malformed JSON payloads
 * abort the stream with `MALFORMED_RESPONSE`. EOF without `message-end` is
 * `STREAM_CLOSED`.
 * @param payloads - SSE data payloads from {@link parseSse}.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` flush on `message-end`.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let sawMessageEnd = false

  function open(kind: OpenBlock['kind']): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  function appendReasoning(fragment: string): StreamChunk[] {
    if (fragment.length === 0) return []
    if (reasoningBlock === undefined) {
      reasoningBlock = open('reasoning')
      reasoningBlock.text += fragment
      return [
        { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: reasoningBlock.index, text: fragment },
      ]
    }
    reasoningBlock.text += fragment
    return [{ type: 'reasoning-delta', index: reasoningBlock.index, text: fragment }]
  }

  for await (const payload of payloads) {
    let event: WireEvent
    try {
      event = JSON.parse(payload) as WireEvent
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    switch (event.type) {
      case 'content-start':
      case 'content-delta': {
        const content = event.delta?.message?.content
        const thinking = content?.thinking
        if (typeof thinking === 'string' && thinking.length > 0) {
          if (reasoningBlock === undefined) {
            reasoningBlock = open('reasoning')
            yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
          }
          reasoningBlock.text += thinking
          yield { type: 'reasoning-delta', index: reasoningBlock.index, text: thinking }
        }
        const text = content?.text
        if (typeof text === 'string' && text.length > 0) {
          if (textBlock === undefined) {
            textBlock = open('text')
            yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
          }
          textBlock.text += text
          yield { type: 'text-delta', index: textBlock.index, text }
        }
        break
      }
      case 'tool-plan-delta': {
        const plan = event.delta?.message?.tool_plan
        if (typeof plan === 'string') {
          for (const chunk of appendReasoning(plan)) yield chunk
        }
        break
      }
      case 'tool-call-start':
      case 'tool-call-delta': {
        const index = event.index ?? 0
        const call = event.delta?.message?.tool_calls
        let block = toolBlocks.get(index)
        if (block === undefined) {
          block = open('tool-call')
          toolBlocks.set(index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (call?.id !== undefined) block.callId = call.id
        if (call?.function?.name !== undefined) block.name = call.function.name
        const fragment = call?.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: fragment,
        }
        break
      }
      case 'message-end': {
        sawMessageEnd = true
        for (const block of order) {
          yield { type: 'block-end', index: block.index, block: closeBlock(block) }
        }
        const usage = event.delta?.usage
        if (usage !== undefined) yield { type: 'usage', usage: mapUsage(usage) }
        const reason = event.delta?.finish_reason === undefined
          ? { kind: 'stop' as const }
          : mapFinishReason(event.delta.finish_reason, event.delta.error)
        yield {
          type: 'finish',
          reason: reason.kind === 'stop' && order.length === 0
            ? {
              kind: 'error',
              failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
            }
            : reason,
        }
        break
      }
      default:
        // message-start, content-end, tool-call-end, citation-*, debug.
        break
    }
  }

  if (!sawMessageEnd) {
    throw new LlmError('SSE stream ended without message-end', 'STREAM_CLOSED')
  }
}
