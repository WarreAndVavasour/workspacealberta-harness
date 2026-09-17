/**
 * Native Cohere Chat API v2 wire protocol, served as a pi-ai API module.
 *
 * The request is one `POST {baseURL}/chat` (`baseURL` is the version root,
 * `https://api.cohere.com/v2` for the public endpoint) with `stream: true`,
 * and the response is an SSE stream of `message-start` / `content-*` /
 * `tool-call-*` / `message-end` events. This is the agent/tool-calling surface
 * Cohere documents for Command models — tool definitions travel as
 * `{type: 'function', function: {name, parameters}}`, the assistant answers
 * with `tool_calls` plus an optional thinking plan, and tool results replay as
 * `role: "tool"` messages carrying a JSON-object string — where the
 * OpenAI-compatibility endpoint only approximates all three. A route selects
 * it with `api: cohere-v2-chat` in the {@link ./provider.ts | protocol table}.
 *
 * The wire facts this module encodes were verified against the live endpoint
 * (2026-09): streamed arguments arrive as string fragments under
 * `delta.message.tool_calls.function.arguments`, thinking streams as
 * `content` blocks typed `thinking`, and `finish_reason` values are
 * `COMPLETE | STOP_SEQUENCE | MAX_TOKENS | TOOL_CALL | ERROR | TIMEOUT`.
 *
 * @module dsh-llm-pi-ai/cohere-v2-chat
 */

import { createAssistantMessageEventStream, parseStreamingJson } from '@earendil-works/pi-ai'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  StreamOptions,
  ToolCall,
  Usage,
} from '@earendil-works/pi-ai'

/** Empty usage for the partial every stream starts from. */
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

// ---------------------------------------------------------------------------
// Wire vocabulary (request)
// ---------------------------------------------------------------------------

/** One tool definition as the v2 endpoint expects it: OpenAI-style wrapped. */
interface CohereTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: unknown
  }
}

/** One assistant tool call, on send and as echoed by the endpoint. */
interface CohereToolCall {
  id?: string
  type?: 'function'
  function?: {
    name?: string
    /** String fragments while streaming; a JSON string on complete messages. */
    arguments?: string
  }
}

/** Assistant content blocks the endpoint round-trips on replay. */
type CohereAssistantBlock = { type: 'text'; text: string } | { type: 'thinking'; thinking: string }

/** The message shapes this module sends. */
type CohereMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: CohereAssistantBlock[]; tool_calls?: CohereToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/** The request body. Only the fields this module can produce are modeled. */
interface CohereChatRequest {
  model: string
  messages: CohereMessage[]
  stream: true
  tools?: CohereTool[]
  temperature?: number
  max_tokens?: number
  thinking?: { type: 'enabled'; token_budget?: number }
}

// ---------------------------------------------------------------------------
// Wire vocabulary (stream events), narrowed defensively off the SSE payloads
// ---------------------------------------------------------------------------

/** `usage` as `message-end` carries it; every layer is optional in practice. */
interface CohereUsage {
  billed_units?: { input_tokens?: number; output_tokens?: number }
  tokens?: { input_tokens?: number; output_tokens?: number }
  /** Prompt tokens served from the inference cache; the cacheRead source. */
  cached_tokens?: number
}

/** One parsed SSE event. Unrecognized `type`s are dropped, not fatal. */
interface CohereStreamEvent {
  type: string
  id?: unknown
  index?: unknown
  delta?: {
    message?: {
      content?: { type?: unknown; text?: unknown; thinking?: unknown }
      tool_plan?: unknown
      tool_calls?: CohereToolCall
    }
    finish_reason?: unknown
    usage?: CohereUsage
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one SSE `data:` payload; anything unexpected parses to undefined. */
function parseStreamEvent(data: string): CohereStreamEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || typeof parsed['type'] !== 'string') return undefined
  const delta = isRecord(parsed['delta']) ? parsed['delta'] : undefined
  const message = isRecord(delta?.['message']) ? delta['message'] : undefined
  return {
    type: parsed['type'],
    ...('id' in parsed ? { id: parsed['id'] } : {}),
    ...('index' in parsed ? { index: parsed['index'] } : {}),
    delta: {
      ...message === undefined ? {} : { message },
      ...delta !== undefined && 'finish_reason' in delta ? { finish_reason: delta['finish_reason'] } : {},
      ...delta !== undefined && isRecord(delta['usage']) ? { usage: delta['usage'] } : {},
    },
  }
}

/** Map a terminal `finish_reason` onto pi-ai's stop reasons; unknown is an error. */
function finishReason(raw: string): { reason: 'stop' | 'length' | 'toolUse' } | { errorMessage: string } {
  switch (raw) {
    case 'COMPLETE':
    case 'STOP_SEQUENCE':
      return { reason: 'stop' }
    case 'MAX_TOKENS':
      return { reason: 'length' }
    case 'TOOL_CALL':
      return { reason: 'toolUse' }
    default:
      return { errorMessage: `cohere finish_reason "${raw}"` }
  }
}

/** Flatten the terminal usage into pi-ai's vocabulary; billed units win. */
function mapUsage(raw: CohereUsage | undefined): Usage {
  const billedInput = raw?.billed_units?.input_tokens
  const billedOutput = raw?.billed_units?.output_tokens
  const input = typeof billedInput === 'number' ? billedInput : raw?.tokens?.input_tokens ?? 0
  const output = typeof billedOutput === 'number' ? billedOutput : raw?.tokens?.output_tokens ?? 0
  const cacheRead = typeof raw?.cached_tokens === 'number' ? raw.cached_tokens : 0
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

// ---------------------------------------------------------------------------
// Request conversion
// ---------------------------------------------------------------------------

/** Report a context this protocol cannot represent, as a stream-level failure. */
function unsupported(detail: string): Error {
  return new Error(`cohere-v2-chat: ${detail}`)
}

/** Join the text of a tool-result/user content list, refusing images. */
function textOf(blocks: ReadonlyArray<{ type: string; text?: unknown }>): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
      continue
    }
    // Unreachable behind the adapter's image gate (the model declares
    // `input: [text]`); reaching it means a misconfigured route, so refuse
    // instead of silently dropping content the turn cannot spare.
    throw unsupported(`content block "${block.type}" is not representable; declare text-only input`)
  }
  return text
}

/**
 * Tool results travel as a JSON-object string. Results already carrying JSON
 * pass through verbatim; free text is wrapped under `output` so the endpoint
 * always reads an object — its citation machinery keys off the object shape.
 */
function toolResultContent(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) return JSON.stringify(parsed)
  } catch {
    // Not JSON on its own; wrapped below.
  }
  return JSON.stringify({ output: text })
}

function convertMessage(message: Context['messages'][number]): CohereMessage | undefined {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: typeof message.content === 'string' ? message.content : textOf(message.content) }
    case 'assistant': {
      const content: CohereAssistantBlock[] = []
      const toolCalls: CohereToolCall[] = []
      for (const block of message.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text })
        else if (block.type === 'thinking') content.push({ type: 'thinking', thinking: block.thinking })
        else {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.arguments) },
          })
        }
      }
      // A turn with neither text, thinking, nor calls carries nothing the
      // endpoint can replay; dropping it keeps the alternation it expects.
      if (content.length === 0 && toolCalls.length === 0) return undefined
      return {
        role: 'assistant',
        ...content.length > 0 ? { content } : {},
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
      }
    }
    case 'toolResult':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: toolResultContent(textOf(message.content)),
      }
  }
}

function convertTools(tools: Readonly<NonNullable<Context['tools']>> | undefined): CohereTool[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      ...tool.description.length > 0 ? { description: tool.description } : {},
      // pi-ai's TSchema is structurally JSON Schema, which is exactly what
      // the endpoint's `parameters` field asks for.
      parameters: tool.parameters,
    },
  }))
}

/** The simple-vocabulary knobs this protocol maps, beyond the shared request fields. */
type ReasoningOptions = Partial<Pick<SimpleStreamOptions, 'reasoning' | 'thinkingBudgets'>>

function buildRequest(
  model: Model<Api>,
  context: Context,
  options: (StreamOptions & ReasoningOptions) | undefined,
): CohereChatRequest {
  const messages: CohereMessage[] = []
  if (context.systemPrompt !== undefined && context.systemPrompt.length > 0) {
    messages.push({ role: 'system', content: context.systemPrompt })
  }
  for (const message of context.messages) {
    const converted = convertMessage(message)
    if (converted !== undefined) messages.push(converted)
  }
  const tools = convertTools(context.tools)
  // xhigh/max have no slot in pi-ai's ThinkingBudgets; a budgeted level maps,
  // those pass unbudgeted.
  const budget = options?.reasoning !== undefined && options.thinkingBudgets !== undefined
    ? options.thinkingBudgets[options.reasoning as 'minimal' | 'low' | 'medium' | 'high']
    : undefined
  const reasoning = options?.reasoning
  return {
    model: model.id,
    messages,
    stream: true,
    ...tools === undefined ? {} : { tools },
    ...options?.temperature === undefined ? {} : { temperature: options.temperature },
    ...options?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    // No `thinking` field is the protocol's "provider default"; the harness
    // sends a level only when a route actually offers reasoning, and `off`
    // never leaves profileOptions.
    ...reasoning === undefined ? {} : { thinking: { type: 'enabled', ...(budget === undefined ? {} : { token_budget: budget }) } },
  }
}

// ---------------------------------------------------------------------------
// SSE plumbing
// ---------------------------------------------------------------------------

/** Read one SSE body as `data:` payloads, tolerating `\r\n` and CoW splits. */
async function* readDataPayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/gu, '\n')
      let split = buffer.indexOf('\n\n')
      while (split !== -1) {
        yield payloadOf(buffer.slice(0, split))
        buffer = buffer.slice(split + 2)
        split = buffer.indexOf('\n\n')
      }
      if (done) break
    }
    if (buffer.trim().length > 0) yield payloadOf(buffer)
  } finally {
    reader.releaseLock()
  }
}

/** The `data:` line of one SSE block; absent, `[DONE]`, or blank yields none. */
function payloadOf(block: string): string {
  const data = block.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim() ?? ''
  return data.length === 0 || data === '[DONE]' ? '' : data
}

/**
 * Merge the caller's provider headers over this module's defaults. A `null`
 * value suppresses the default of the same name (case-insensitive), matching
 * pi-ai's ProviderHeaders convention; the suppression set is resolved before
 * any header is written so nothing ever needs removing.
 */
function requestHeaders(apiKey: string | undefined, options: StreamOptions | undefined): Record<string, string> {
  const caller = options?.headers ?? {}
  const suppressed = new Set(
    Object.entries(caller).flatMap(([name, value]) => value === null ? [name.toLowerCase()] : []),
  )
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'text/event-stream',
    ...apiKey === undefined || suppressed.has('authorization') ? {} : { authorization: `Bearer ${apiKey}` },
  }
  for (const [name, value] of Object.entries(caller)) {
    if (typeof value === 'string' && !suppressed.has(name.toLowerCase())) headers[name] = value
  }
  return headers
}

/** Signal handed to fetch: the caller's, plus the profile timeout when set. */
function requestSignal(options: StreamOptions | undefined): AbortSignal | undefined {
  const timeout = options?.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? AbortSignal.timeout(options.timeoutMs)
    : undefined
  if (options?.signal === undefined) return timeout
  if (timeout === undefined) return options.signal
  return AbortSignal.any([options.signal, timeout])
}

// ---------------------------------------------------------------------------
// Stream state machine: Cohere events → pi-ai AssistantMessageEvents
// ---------------------------------------------------------------------------

/** One in-flight tool call, keyed by the endpoint's per-stream tool index. */
interface PendingToolCall {
  /** pi contentIndex this call's block occupies. */
  slot: number
  id: string
  name: string
  json: string
}

/**
 * Mutable accumulator behind one response. The endpoint counts content blocks
 * and tool calls in two independent `index` sequences — a thinking block and
 * the first tool call each arrive at index 0 — so every block is remapped onto
 * one dense pi contentIndex sequence in arrival order.
 */
class ResponseAccumulator {
  readonly partial: AssistantMessage
  private readonly contentSlots = new Map<number, number>()
  private readonly toolCalls = new Map<number, PendingToolCall>()
  /** pi slot of the thinking block fed by `tool-plan-delta`, once opened. */
  private toolPlanSlot: number | undefined
  private nextSlot = 0
  private responseId: string | undefined

  constructor(model: Model<Api>) {
    this.partial = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: 'pending',
      timestamp: Date.now(),
    }
  }

  private takeIndex(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined
  }

  /** The pi slot for one endpoint content index, allocating the block fresh. */
  private slotForContent(index: number | undefined): number {
    const key = index ?? -1
    const known = this.contentSlots.get(key)
    if (known !== undefined) return known
    const slot = this.nextSlot++
    this.contentSlots.set(key, slot)
    return slot
  }

  /** Slot for a deferred-start block (the tool plan), allocating at most once. */
  private slotForToolPlan(): number {
    this.toolPlanSlot ??= this.nextSlot++
    return this.toolPlanSlot
  }

  start(id: unknown): { type: 'start'; partial: AssistantMessage } {
    if (typeof id === 'string') {
      this.responseId = id
      this.partial.responseId = id
    }
    return { type: 'start', partial: this.partial }
  }

  contentStart(event: CohereStreamEvent): { type: 'text_start' | 'thinking_start'; contentIndex: number; partial: AssistantMessage } {
    const slot = this.slotForContent(this.takeIndex(event.index))
    const thinking = event.delta?.message?.content?.type === 'thinking'
    this.partial.content[slot] = thinking ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' }
    return thinking
      ? { type: 'thinking_start', contentIndex: slot, partial: this.partial }
      : { type: 'text_start', contentIndex: slot, partial: this.partial }
  }

  contentDelta(event: CohereStreamEvent):
    | { type: 'text_delta' | 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
    | undefined {
    const index = this.takeIndex(event.index)
    const slot = this.contentSlots.get(index ?? -1)
    const block = slot === undefined ? undefined : this.partial.content[slot]
    if (slot === undefined || block === undefined) return undefined
    if (block.type === 'thinking' && typeof event.delta?.message?.content?.thinking === 'string') {
      block.thinking += event.delta.message.content.thinking
      return { type: 'thinking_delta', contentIndex: slot, delta: event.delta.message.content.thinking, partial: this.partial }
    }
    if (block.type === 'text' && typeof event.delta?.message?.content?.text === 'string') {
      block.text += event.delta.message.content.text
      return { type: 'text_delta', contentIndex: slot, delta: event.delta.message.content.text, partial: this.partial }
    }
    return undefined
  }

  contentEnd(event: CohereStreamEvent):
    | { type: 'text_end' | 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
    | undefined {
    const index = this.takeIndex(event.index)
    const slot = this.contentSlots.get(index ?? -1)
    const block = slot === undefined ? undefined : this.partial.content[slot]
    if (slot === undefined || block === undefined) return undefined
    if (block.type === 'thinking') {
      return { type: 'thinking_end', contentIndex: slot, content: block.thinking, partial: this.partial }
    }
    if (block.type !== 'text') return undefined
    return { type: 'text_end', contentIndex: slot, content: block.text, partial: this.partial }
  }

  /**
   * Plan deltas arrive without a start event, so the opening fragment both
   * allocates the thinking block and yields its first delta — the endpoint
   * has no "plan start" of its own to forward.
   */
  toolPlanDelta(event: CohereStreamEvent): AssistantMessageEvent[] {
    const plan = event.delta?.message?.tool_plan
    if (typeof plan !== 'string') return []
    if (this.toolPlanSlot === undefined) {
      const slot = this.slotForToolPlan()
      this.partial.content[slot] = { type: 'thinking', thinking: '' }
      return [
        { type: 'thinking_start', contentIndex: slot, partial: this.partial },
        { type: 'thinking_delta', contentIndex: slot, delta: plan, partial: this.partial },
      ]
    }
    const slot = this.toolPlanSlot
    const block = this.partial.content[slot] as { type: 'thinking'; thinking: string }
    block.thinking += plan
    return [{ type: 'thinking_delta', contentIndex: slot, delta: plan, partial: this.partial }]
  }

  toolCallStart(event: CohereStreamEvent): { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage } | undefined {
    const index = this.takeIndex(event.index)
    if (index === undefined || this.toolCalls.has(index)) return undefined
    const raw = event.delta?.message?.tool_calls
    const slot = this.nextSlot++
    const pending: PendingToolCall = {
      slot,
      id: typeof raw?.id === 'string' ? raw.id : `cohere_tool_${index}`,
      name: typeof raw?.function?.name === 'string' ? raw.function.name : '',
      json: typeof raw?.function?.arguments === 'string' ? raw.function.arguments : '',
    }
    this.toolCalls.set(index, pending)
    this.partial.content[slot] = { type: 'toolCall', id: pending.id, name: pending.name, arguments: parseStreamingJson(pending.json) }
    return { type: 'toolcall_start', contentIndex: slot, partial: this.partial }
  }

  toolCallDelta(event: CohereStreamEvent): { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage } | undefined {
    const index = this.takeIndex(event.index)
    const pending = index === undefined ? undefined : this.toolCalls.get(index)
    const fragment = event.delta?.message?.tool_calls?.function?.arguments
    if (pending === undefined || typeof fragment !== 'string') return undefined
    pending.json += fragment
    const block = this.partial.content[pending.slot] as ToolCall
    block.arguments = parseStreamingJson(pending.json)
    return { type: 'toolcall_delta', contentIndex: pending.slot, delta: fragment, partial: this.partial }
  }

  toolCallEnd(event: CohereStreamEvent): { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage } | undefined {
    const index = this.takeIndex(event.index)
    if (index === undefined || !this.toolCalls.has(index)) return undefined
    const pending = this.toolCalls.get(index) as PendingToolCall
    this.toolCalls.delete(index)
    const block = this.partial.content[pending.slot] as ToolCall
    // The assembled arguments replace the streaming parse; a fragment stream
    // that never formed valid JSON still yields the literal text via {}.
    const parsed: unknown = JSON.parse(pending.json.length > 0 ? pending.json : '{}')
    block.arguments = isRecord(parsed) ? parsed : {}
    return { type: 'toolcall_end', contentIndex: pending.slot, toolCall: block, partial: this.partial }
  }

  /**
   * The terminal event. A recognized `finish_reason` completes the message;
   * `ERROR`/`TIMEOUT` (or an unrecognized value) fail it with the reason named.
   */
  end(event: CohereStreamEvent):
    | { type: 'done'; reason: 'stop' | 'length' | 'toolUse'; message: AssistantMessage }
    | { type: 'error'; reason: 'error'; error: AssistantMessage } {
    if (typeof event.id === 'string') this.partial.responseId = event.id
    else if (this.responseId !== undefined) this.partial.responseId = this.responseId
    this.partial.usage = mapUsage(event.delta?.usage)
    const raw = event.delta?.finish_reason
    const reason = typeof raw === 'string' ? finishReason(raw) : { errorMessage: 'cohere stream ended without a finish_reason' }
    if ('errorMessage' in reason) {
      this.partial.stopReason = 'error'
      this.partial.errorMessage = reason.errorMessage
      return { type: 'error', reason: 'error', error: this.partial }
    }
    this.partial.stopReason = reason.reason
    return { type: 'done', reason: reason.reason, message: this.partial }
  }
}

// ---------------------------------------------------------------------------
// The API module proper
// ---------------------------------------------------------------------------

/** The assistant-message error event every failure path funnels into. */
function errorEvent(model: Model<Api>, error: unknown, aborted: boolean): {
  type: 'error'
  reason: 'aborted' | 'error'
  error: AssistantMessage
} {
  return {
    type: 'error',
    reason: aborted ? 'aborted' : 'error',
    error: {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    },
  }
}

/** Format one non-OK HTTP response, preferring the endpoint's `message` field. */
async function responseError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '')
  let detail = body
  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed) && typeof parsed['message'] === 'string') detail = parsed['message']
  } catch {
    // Body stays raw.
  }
  return new Error(`${response.status} ${response.statusText}${detail.length > 0 ? `: ${detail}` : ''}`.trim())
}

async function runStream(
  eventStream: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  options: (StreamOptions & ReasoningOptions) | undefined,
): Promise<void> {
  try {
    if (!options?.apiKey) {
      throw new Error(`No API key provided for provider "${model.provider}"`)
    }
    const url = `${model.baseUrl.replace(/\/+$/u, '')}/chat`
    const payload: CohereChatRequest = buildRequest(model, context, options)
    const replaced = await options.onPayload?.(payload, model)
    const signal = requestSignal(options)
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      method: 'POST',
      headers: requestHeaders(options.apiKey, options),
      body: JSON.stringify(replaced === undefined || !isRecord(replaced) ? payload : replaced),
      ...signal === undefined ? {} : { signal },
    })
    await options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model)
    if (!response.ok) throw await responseError(response)
    if (response.body === null) throw new Error(`${model.provider} response has no body`)

    const accumulator = new ResponseAccumulator(model)
    for await (const data of readDataPayloads(response.body)) {
      if (data.length === 0) continue
      const event = parseStreamEvent(data)
      if (event === undefined) continue
      switch (event.type) {
        case 'message-start':
          eventStream.push(accumulator.start(event.id))
          break
        case 'content-start':
          eventStream.push(accumulator.contentStart(event))
          break
        case 'content-delta': {
          const mapped = accumulator.contentDelta(event)
          if (mapped !== undefined) eventStream.push(mapped)
          break
        }
        case 'content-end': {
          const mapped = accumulator.contentEnd(event)
          if (mapped !== undefined) eventStream.push(mapped)
          break
        }
        case 'tool-plan-delta':
          for (const mapped of accumulator.toolPlanDelta(event)) eventStream.push(mapped)
          break
        case 'tool-call-start': {
          const mapped = accumulator.toolCallStart(event)
          if (mapped !== undefined) eventStream.push(mapped)
          break
        }
        case 'tool-call-delta': {
          const mapped = accumulator.toolCallDelta(event)
          if (mapped !== undefined) eventStream.push(mapped)
          break
        }
        case 'tool-call-end': {
          const mapped = accumulator.toolCallEnd(event)
          if (mapped !== undefined) eventStream.push(mapped)
          break
        }
        case 'message-end':
          eventStream.push(accumulator.end(event))
          return
        default:
          // Citations and future event types carry no content this seam
          // models; dropping them keeps the stream alive rather than failing
          // a response the endpoint considers healthy.
          break
      }
    }
    throw new Error(`${model.provider} stream ended without a terminal event`)
  } catch (error: unknown) {
    eventStream.push(errorEvent(model, error, options?.signal?.aborted ?? false))
  }
}

function stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream {
  const eventStream = createAssistantMessageEventStream()
  void runStream(eventStream, model, context, options)
  return eventStream
}

function streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
  return stream(model, context, options)
}

/**
 * The `ProviderStreams` factory the protocol table names. One endpoint, one
 * implementation: `stream` and `streamSimple` share the request path because
 * the v2 protocol has no options pi-ai's simple vocabulary does not cover.
 * @returns the Cohere Chat API v2 implementation.
 */
export function cohereV2ChatApi(): ProviderStreams {
  return { stream, streamSimple }
}
