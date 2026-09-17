/**
 * pi-ai `ProviderStreams` for Cohere Chat API v2 (`POST {baseURL}/chat`).
 *
 * Maps tools, `tool_plan`, `tool_calls`, and thinking onto pi-ai events so the
 * existing harness conversion can assemble them. Citation SSE events are
 * consumed so the stream stays framed and are not turned into content blocks.
 *
 * @module dsh-llm-pi-ai/cohere-v2-chat
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  Usage,
} from '@earendil-works/pi-ai'
import { COHERE_V2_CHAT_API, cohereV2ChatUrl, serializeCohereV2ChatRequest } from './cohere-v2-chat-request.ts'

export {
  COHERE_V2_CHAT_API,
  cohereV2ChatUrl,
  serializeCohereV2ChatRequest,
} from './cohere-v2-chat-request.ts'
export type {
  CohereV2ChatRequest,
  CohereV2ChatRequestOptions,
  CohereV2Message,
  CohereV2Tool,
  CohereV2ToolCall,
} from './cohere-v2-chat-request.ts'


/** One parsed SSE frame. */
export interface CohereSseFrame {
  /** `event:` field, empty when the server sent only `data:`. */
  event: string
  /** Joined `data:` lines. */
  data: string
}

interface ToolCallDraft {
  id: string
  name: string
  arguments: string
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function usageOf(raw: unknown): Usage {
  if (typeof raw !== 'object' || raw === null) return emptyUsage()
  const body = raw as {
    tokens?: { input_tokens?: unknown; output_tokens?: unknown; cached_tokens?: unknown }
    billed_units?: { input_tokens?: unknown; output_tokens?: unknown }
  }
  const tokens = body.tokens
  const billed = body.billed_units
  const input = numberOf(tokens?.input_tokens) ?? numberOf(billed?.input_tokens) ?? 0
  const output = numberOf(tokens?.output_tokens) ?? numberOf(billed?.output_tokens) ?? 0
  const cacheRead = numberOf(tokens?.cached_tokens) ?? 0
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: input + output + cacheRead,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stopReasonOf(finish: unknown): AssistantMessage['stopReason'] {
  switch (finish) {
    case 'COMPLETE':
    case 'STOP_SEQUENCE':
      return 'stop'
    case 'MAX_TOKENS':
      return 'length'
    case 'TOOL_CALL':
      return 'toolUse'
    case 'TIMEOUT':
    case 'ERROR':
      return 'error'
    default:
      return 'stop'
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (_invalidToolArguments) {
    // Model JSON is not trusted; an unparsable argument string becomes {}.
  }
  return {}
}

function argumentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  // SSE JSON cannot carry cyclic values; stringify only sees parsed JSON.
  return JSON.stringify(value)
}

function assistantOf(
  model: Model<Api>,
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  usage: Usage,
  extras: { responseId?: string; errorMessage?: string } = {},
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: COHERE_V2_CHAT_API as Api,
    provider: model.provider,
    model: model.id,
    ...extras.responseId === undefined ? {} : { responseId: extras.responseId },
    ...extras.errorMessage === undefined ? {} : { errorMessage: extras.errorMessage },
    usage,
    stopReason,
    timestamp: 0,
  }
}

function readErrorText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'object' && value !== null) {
    const body = value as { message?: unknown; error?: unknown }
    if (typeof body.message === 'string' && body.message.length > 0) return body.message
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
    if (typeof body.error === 'object' && body.error !== null) {
      const nested = (body.error as { message?: unknown }).message
      if (typeof nested === 'string' && nested.length > 0) return nested
    }
  }
  return fallback
}

/**
 * Decode Cohere SSE into event/data frames. An unterminated tail at EOF is
 * truncation and is not flushed.
 * @param stream - raw response bytes.
 * @returns each terminated frame in arrival order.
 */
export async function* parseCohereSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<CohereSseFrame> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []
  const flush = (): CohereSseFrame | undefined => {
    if (event.length === 0 && data.length === 0) return undefined
    const frame = { event, data: data.join('\n') }
    event = ''
    data = []
    return frame
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.length === 0) {
          const frame = flush()
          if (frame !== undefined) yield frame
        } else if (line.startsWith(':')) {
          // SSE comment: transport activity only.
        } else if (line.startsWith('event:')) {
          event = line.slice('event:'.length).trim()
        } else if (line.startsWith('data:')) {
          data.push(line.slice('data:'.length).trimStart())
        }
        newline = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function eventTypeOf(frame: CohereSseFrame, body: { type?: unknown }): string {
  if (frame.event.length > 0) return frame.event
  return typeof body.type === 'string' ? body.type : ''
}

function messageDelta(body: {
  delta?: { message?: Record<string, unknown>; error?: unknown; finish_reason?: unknown; usage?: unknown }
}): Record<string, unknown> {
  const message = body.delta?.message
  return typeof message === 'object' && message !== null ? message : {}
}

/**
 * Translate one Cohere Chat API v2 SSE stream into pi-ai assistant events.
 * @param model - the route model this stream belongs to.
 * @param frames - parsed SSE frames.
 * @returns pi-ai events ending in `done` or `error`.
 */
export async function* translateCohereSse(
  model: Model<Api>,
  frames: AsyncIterable<CohereSseFrame>,
): AsyncGenerator<AssistantMessageEvent> {
  const content: AssistantMessage['content'] = []
  let responseId: string | undefined
  let usage = emptyUsage()
  let nextIndex = 0
  let openThinking: { index: number; text: string } | undefined
  const toolDrafts = new Map<number, { index: number; draft: ToolCallDraft }>()

  const snapshot = (
    stopReason: AssistantMessage['stopReason'] = 'stop',
    extras: { errorMessage?: string } = {},
  ): AssistantMessage => assistantOf(model, [...content], stopReason, usage, {
    ...responseId === undefined ? {} : { responseId },
    ...extras,
  })

  const closeThinking = function* (): Generator<AssistantMessageEvent> {
    if (openThinking === undefined) return
    const { index, text } = openThinking
    openThinking = undefined
    content[index] = { type: 'thinking', thinking: text }
    yield { type: 'thinking_end', contentIndex: index, content: text, partial: snapshot() }
  }

  yield { type: 'start', partial: snapshot() }

  for await (const frame of frames) {
    if (frame.data === '[DONE]') continue
    let body: {
      type?: unknown
      id?: unknown
      index?: unknown
      delta?: { message?: Record<string, unknown>; error?: unknown; finish_reason?: unknown; usage?: unknown }
    }
    try {
      body = JSON.parse(frame.data) as typeof body
    } catch (_invalidSseJson) {
      continue
    }
    const type = eventTypeOf(frame, body)
    const delta = messageDelta(body)
    switch (type) {
      case 'message-start':
        if (typeof body.id === 'string' && body.id.length > 0) responseId = body.id
        break
      case 'content-start': {
        yield* closeThinking()
        const started = delta['content']
        const kind = typeof started === 'object' && started !== null
          ? (started as { type?: unknown }).type
          : undefined
        if (kind === 'thinking') {
          const index = nextIndex++
          openThinking = { index, text: '' }
          content[index] = { type: 'thinking', thinking: '' }
          yield { type: 'thinking_start', contentIndex: index, partial: snapshot() }
        } else {
          const index = nextIndex++
          content[index] = { type: 'text', text: '' }
          yield { type: 'text_start', contentIndex: index, partial: snapshot() }
        }
        break
      }
      case 'content-delta': {
        const piece = delta['content']
        const text = typeof piece === 'object' && piece !== null
          ? (piece as { text?: unknown; thinking?: unknown })
          : {}
        if (openThinking !== undefined && typeof text.thinking === 'string') {
          openThinking.text += text.thinking
          yield {
            type: 'thinking_delta',
            contentIndex: openThinking.index,
            delta: text.thinking,
            partial: snapshot(),
          }
        } else if (typeof text.text === 'string') {
          const index = content.findLastIndex(block => block?.type === 'text')
          const block = index >= 0 ? content[index] : undefined
          if (block?.type === 'text') {
            block.text += text.text
            yield { type: 'text_delta', contentIndex: index, delta: text.text, partial: snapshot() }
          }
        }
        break
      }
      case 'content-end': {
        if (openThinking !== undefined) {
          yield* closeThinking()
          break
        }
        const index = content.findLastIndex(block => block?.type === 'text')
        const block = index >= 0 ? content[index] : undefined
        if (block?.type === 'text') {
          yield { type: 'text_end', contentIndex: index, content: block.text, partial: snapshot() }
        }
        break
      }
      case 'tool-plan-delta': {
        const plan = delta['tool_plan']
        if (typeof plan !== 'string' || plan.length === 0) break
        if (openThinking === undefined) {
          const index = nextIndex++
          openThinking = { index, text: '' }
          content[index] = { type: 'thinking', thinking: '' }
          yield { type: 'thinking_start', contentIndex: index, partial: snapshot() }
        }
        openThinking.text += plan
        yield {
          type: 'thinking_delta',
          contentIndex: openThinking.index,
          delta: plan,
          partial: snapshot(),
        }
        break
      }
      case 'tool-call-start': {
        yield* closeThinking()
        const call = delta['tool_calls']
        const fn = typeof call === 'object' && call !== null
          ? (call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } })
          : {}
        const wireIndex = typeof body.index === 'number' ? body.index : toolDrafts.size
        const index = nextIndex++
        const draft: ToolCallDraft = {
          id: typeof fn.id === 'string' ? fn.id : '',
          name: typeof fn.function?.name === 'string' ? fn.function.name : '',
          arguments: argumentText(fn.function?.arguments),
        }
        toolDrafts.set(wireIndex, { index, draft })
        content[index] = { type: 'toolCall', id: draft.id, name: draft.name, arguments: parseArguments(draft.arguments) }
        yield { type: 'toolcall_start', contentIndex: index, partial: snapshot() }
        if (draft.arguments.length > 0) {
          yield { type: 'toolcall_delta', contentIndex: index, delta: draft.arguments, partial: snapshot() }
        }
        break
      }
      case 'tool-call-delta': {
        const call = delta['tool_calls']
        const extra = argumentText(
          typeof call === 'object' && call !== null
            ? (call as { function?: { arguments?: unknown } }).function?.arguments
            : undefined,
        )
        const wireIndex = typeof body.index === 'number' ? body.index : 0
        const known = toolDrafts.get(wireIndex)
        if (known === undefined || extra.length === 0) break
        known.draft.arguments += extra
        content[known.index] = {
          type: 'toolCall',
          id: known.draft.id,
          name: known.draft.name,
          arguments: parseArguments(known.draft.arguments),
        }
        yield { type: 'toolcall_delta', contentIndex: known.index, delta: extra, partial: snapshot() }
        break
      }
      case 'tool-call-end': {
        const wireIndex = typeof body.index === 'number' ? body.index : 0
        const known = toolDrafts.get(wireIndex)
        if (known === undefined) break
        const args = parseArguments(known.draft.arguments)
        content[known.index] = {
          type: 'toolCall',
          id: known.draft.id,
          name: known.draft.name,
          arguments: args,
        }
        yield {
          type: 'toolcall_end',
          contentIndex: known.index,
          toolCall: { type: 'toolCall', id: known.draft.id, name: known.draft.name, arguments: args },
          partial: snapshot(),
        }
        break
      }
      case 'message-end': {
        yield* closeThinking()
        usage = usageOf(body.delta?.usage)
        const finish = body.delta?.finish_reason
        const stopReason = stopReasonOf(finish)
        if (stopReason === 'error') {
          yield {
            type: 'error',
            reason: 'error',
            error: snapshot('error', {
              errorMessage: readErrorText(body.delta?.error, 'Cohere v2 chat generation failed'),
            }),
          }
          return
        }
        yield { type: 'done', reason: stopReason, message: snapshot(stopReason) }
        return
      }
      case 'citation-start':
      case 'citation-delta':
      case 'citation-end':
      case 'debug':
      default:
        break
    }
  }

  yield {
    type: 'error',
    reason: 'error',
    error: snapshot('error', {
      errorMessage: 'Cohere v2 chat stream ended without a terminal message-end event',
    }),
  }
}

async function* streamCohereV2Chat(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions = {},
): AsyncGenerator<AssistantMessageEvent> {
  const failed = (stopReason: AssistantMessage['stopReason'], errorMessage: string): AssistantMessageEvent => ({
    type: 'error',
    reason: stopReason === 'aborted' ? 'aborted' : 'error',
    error: assistantOf(model, [], stopReason, emptyUsage(), { errorMessage }),
  })

  if (options.signal?.aborted) {
    yield failed('aborted', 'Cohere v2 chat request aborted by caller')
    return
  }

  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    'content-type': 'application/json',
  }
  if (options.headers !== undefined) {
    for (const [name, value] of Object.entries(options.headers)) {
      if (value !== null) headers[name] = value
    }
  }
  if (options.apiKey !== undefined && options.apiKey.length > 0) {
    headers.authorization = `Bearer ${options.apiKey}`
  }

  let response: Response
  try {
    response = await fetch(cohereV2ChatUrl(model.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(serializeCohereV2ChatRequest(model.id, context, options)),
      signal: options.signal,
    })
  } catch (error: unknown) {
    if (options.signal?.aborted) {
      yield failed('aborted', 'Cohere v2 chat request aborted by caller')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    yield failed('error', message)
    return
  }

  if (!response.ok) {
    let detail: unknown
    try {
      detail = await response.json()
    } catch (_nonJsonErrorBody) {
      // Error bodies are often plain text; the status line is enough.
      detail = undefined
    }
    yield failed(
      'error',
      readErrorText(detail, `Cohere v2 chat request failed with HTTP ${response.status}`),
    )
    return
  }

  if (response.body === null) {
    yield failed('error', 'Cohere v2 chat stream ended without a terminal message-end event')
    return
  }

  yield* translateCohereSse(model, parseCohereSse(response.body))
}

/**
 * The lazily constructed streams object `createProvider` registers for this protocol.
 * @returns a `ProviderStreams` whose `stream` talks Chat API v2.
 */
export function cohereV2ChatApi(): ProviderStreams {
  return {
    stream: streamCohereV2Chat,
    // createProvider dispatches Models.streamSimple through this slot; the
    // adapter never calls `stream` on a hand-declared route.
    streamSimple: streamCohereV2Chat,
  }
}
