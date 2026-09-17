/**
 * Cohere Chat API v2 request body from a pi-ai Context.
 *
 * The configured `baseURL` is a prefix: this module appends `/chat`, so
 * `https://api.cohere.com/v2` becomes `POST https://api.cohere.com/v2/chat`.
 * URL-resolving `chat` against a `/v2` prefix would drop the version segment.
 *
 * @module dsh-llm-pi-ai/cohere-v2-chat-request
 */

import type { Context, ImageContent, Message, TextContent, Tool } from '@earendil-works/pi-ai'

/** Wire protocol id a profile names for this implementation. */
export const COHERE_V2_CHAT_API = 'cohere-v2-chat' as const

/** Cohere Chat API v2 user/system content part. */
export type CohereV2ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'thinking'; thinking: string }

/** Cohere Chat API v2 tool definition. */
export interface CohereV2Tool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Tool['parameters']
  }
}

/** Cohere Chat API v2 function tool call. */
export interface CohereV2ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** One Cohere Chat API v2 history message. */
export type CohereV2Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | CohereV2ContentPart[] }
  | {
    role: 'assistant'
    content?: string | CohereV2ContentPart[]
    tool_plan?: string
    tool_calls?: CohereV2ToolCall[]
  }
  | { role: 'tool'; tool_call_id: string; content: string }

/** POST /v2/chat body this protocol sends. */
export interface CohereV2ChatRequest {
  stream: true
  model: string
  messages: CohereV2Message[]
  tools?: CohereV2Tool[]
  strict_tools?: boolean
  temperature?: number
  max_tokens?: number
  thinking?: { type: 'enabled' | 'disabled' }
}

/** Sampling fields copied from pi-ai stream options when present. */
export interface CohereV2ChatRequestOptions {
  /** Sampling temperature; omitted when the request names none. */
  temperature?: number
  /** Output cap; omitted when the request names none. */
  maxTokens?: number
  /**
   * pi-ai thinking level. `off` sends `{type: disabled}`; any other named
   * level sends `{type: enabled}`; omission leaves Cohere's model default.
   */
  reasoning?: string
}

/**
 * Join `{baseURL}/chat` as a prefix, not as a URL relative to the last path
 * segment. `https://api.cohere.com/v2` must stay `/v2/chat`.
 * @param baseURL - configured endpoint prefix.
 * @returns the Chat API v2 URL.
 */
export function cohereV2ChatUrl(baseURL: string): string {
  return `${baseURL.replace(/\/$/, '')}/chat`
}

function userParts(content: string | readonly (TextContent | ImageContent)[]): string | CohereV2ContentPart[] {
  if (typeof content === 'string') return content
  const parts: CohereV2ContentPart[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text.length > 0) parts.push({ type: 'text', text: part.text })
      continue
    }
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${part.mimeType};base64,${part.data}` },
    })
  }
  if (parts.every(part => part.type === 'text')) return parts.map(part => part.text).join('')
  return parts
}

function toolCall(block: Extract<Extract<Message, { role: 'assistant' }>['content'][number], { type: 'toolCall' }>): CohereV2ToolCall {
  return {
    id: block.id,
    type: 'function',
    function: {
      name: block.name,
      arguments: JSON.stringify(block.arguments),
    },
  }
}

function assistantMessage(message: Extract<Message, { role: 'assistant' }>): CohereV2Message {
  const texts: string[] = []
  const thinking: string[] = []
  const toolCalls: CohereV2ToolCall[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) texts.push(block.text)
        break
      case 'thinking':
        if (block.thinking.length > 0) thinking.push(block.thinking)
        break
      case 'toolCall':
        toolCalls.push(toolCall(block))
        break
    }
  }
  const text = texts.join('')
  const plan = thinking.join('')
  const wire: CohereV2Message = { role: 'assistant' }
  if (toolCalls.length > 0) {
    // Cohere records tool-turn chain-of-thought as `tool_plan`, not thinking content.
    if (plan.length > 0) wire.tool_plan = plan
    if (text.length > 0) wire.content = text
    wire.tool_calls = toolCalls
    return wire
  }
  if (plan.length > 0 && text.length > 0) {
    wire.content = [
      { type: 'thinking', thinking: plan },
      { type: 'text', text },
    ]
    return wire
  }
  if (plan.length > 0) {
    wire.content = [{ type: 'thinking', thinking: plan }]
    return wire
  }
  wire.content = text
  return wire
}

function serializeMessage(message: Message): CohereV2Message {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: userParts(message.content) }
    case 'assistant':
      return assistantMessage(message)
    case 'toolResult': {
      const text = message.content
        .filter((part): part is TextContent => part.type === 'text')
        .map(part => part.text)
        .join('')
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: text.length > 0 ? text : '(no output)',
      }
    }
    /* v8 ignore start -- closed Message union; TypeScript exhaustiveness */
    default: {
      const exhaustive: never = message
      return exhaustive
    }
    /* v8 ignore stop */
  }
}

/**
 * Build the streaming Chat API v2 body for one pi-ai context.
 * @param modelId - wire model id.
 * @param context - converted harness history and tools.
 * @param options - sampling fields already resolved by the adapter.
 * @returns the JSON body posted to `/chat`.
 */
export function serializeCohereV2ChatRequest(
  modelId: string,
  context: Context,
  options: CohereV2ChatRequestOptions = {},
): CohereV2ChatRequest {
  const messages: CohereV2Message[] = []
  if (context.systemPrompt !== undefined) {
    messages.push({ role: 'system', content: context.systemPrompt })
  }
  for (const message of context.messages) messages.push(serializeMessage(message))
  const tools = context.tools?.map((tool): CohereV2Tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const request: CohereV2ChatRequest = {
    stream: true,
    model: modelId,
    messages,
  }
  if (tools !== undefined && tools.length > 0) {
    request.tools = tools
    // Force tool calls to match the declared schema; required for Command A agent turns.
    request.strict_tools = true
  }
  if (options.temperature !== undefined) request.temperature = options.temperature
  if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens
  if (options.reasoning === 'off') request.thinking = { type: 'disabled' }
  else if (options.reasoning !== undefined) request.thinking = { type: 'enabled' }
  return request
}
