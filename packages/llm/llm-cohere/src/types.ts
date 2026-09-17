/**
 * Cohere v2 Chat wire format. Types only.
 *
 * Source of truth: the official Chat streaming reference
 * (docs.cohere.com/v2/reference/chat-stream) plus the request fields this
 * adapter serializes. Fields the loop does not read or write are omitted.
 *
 * @module @workspacealberta/wa-llm-cohere/types
 */

/** Request body for `POST {baseURL}/v2/chat`. */
export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  tools?: WireTool[]
  /** Force generated tool calls to follow the offered definition. */
  strict_tools?: boolean
  thinking?: { type: 'enabled' | 'disabled' }
  temperature?: number
  max_tokens?: number
  stop_sequences?: string[]
}

/** System-role message: a single string of instructions. */
export interface WireSystemMessage {
  role: 'system'
  content: string
}

/** User-role message: text-only string content. */
export interface WireUserMessage {
  role: 'user'
  content: string
}

/** One thinking content block replayed on an assistant history message. */
export interface WireThinkingContentBlock {
  type: 'thinking'
  thinking: string
}

/** One text content block replayed on an assistant history message. */
export interface WireTextContentBlock {
  type: 'text'
  text: string
}

/** Assistant content as a string or an ordered thinking/text block list. */
export type WireAssistantContent = string | Array<WireThinkingContentBlock | WireTextContentBlock>

/**
 * Assistant-role history message. Text-less tool-call turns omit `content`.
 * Reasoning from a tool-using turn is replayed as `tool_plan`; reasoning
 * without tool calls is replayed as thinking content blocks.
 */
export interface WireAssistantMessage {
  role: 'assistant'
  content?: WireAssistantContent
  tool_plan?: string
  tool_calls?: WireToolCall[]
}

/** Tool-role message: the result of one tool call, keyed by its call id. */
export interface WireToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

/** One entry of the request `messages` array, discriminated on `role`. */
export type WireMessage =
  | WireSystemMessage
  | WireUserMessage
  | WireAssistantMessage
  | WireToolMessage

/** A completed tool call replayed on an assistant history message; `arguments` is the raw JSON string. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One entry of the request `tools` array; `parameters` is a JSON Schema object. */
export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** One parsed SSE `data:` payload. Discriminated on `type`. */
export interface WireEvent {
  type?: string
  index?: number
  delta?: WireDelta
}

/** Incremental payload shared by content, tool-plan, tool-call, and message-end events. */
export interface WireDelta {
  message?: {
    content?: {
      type?: string
      text?: string
      thinking?: string
    }
    tool_plan?: string
    tool_calls?: {
      id?: string
      type?: 'function'
      function?: {
        name?: string
        arguments?: string
      }
    }
  }
  finish_reason?: string
  error?: string
  usage?: WireUsage
}

/**
 * Wire token accounting. `tokens.input_tokens` is the prompt count; when
 * `cached_tokens` is present the harness subtracts it so `inputTokens` stays
 * disjoint from `cacheReadTokens`.
 */
export interface WireUsage {
  tokens?: {
    input_tokens?: number
    output_tokens?: number
    cached_tokens?: number
  }
  billed_units?: {
    input_tokens?: number
    output_tokens?: number
  }
}

/** Non-2xx error body; both observed Cohere spellings are accepted. */
export interface WireError {
  message?: string
  detail?: string | readonly { readonly message?: string }[]
}
