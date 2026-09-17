/**
 * Serialize harness messages into Cohere v2 Chat. Text-only requests flatten
 * user and tool-result content to strings. Images are refused before any
 * request is built. Assistant reasoning is replayed as thinking content when
 * the turn called no tool, and as `tool_plan` when it did.
 * @module @workspacealberta/wa-llm-cohere/serialize
 */

import { contentHasImage, LlmError } from '@workspacealberta/wa-llm'
import type { ContentBlock, GenerateOptions, Message } from '@workspacealberta/wa-llm'
import type {
  WireAssistantContent,
  WireMessage,
  WireRequest,
  WireTool,
} from './types.ts'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
}

/** Join the text blocks of a message (used for user/system/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The Cohere v2 Chat adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Resolve the optional thinking lock for one request. */
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): 'enabled' | 'disabled' | undefined {
  if (options.purpose === 'session-title') return 'disabled'
  if (options.reasoningEffort !== undefined) {
    if (options.reasoningEffort === 'off') return 'disabled'
    throw new LlmError(
      `Cohere v2 Chat does not support reasoning effort "${options.reasoningEffort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  return defaults.thinking
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  let content: WireAssistantContent | undefined
  if (toolCalls.length === 0 && reasoning.length > 0) {
    content = [
      { type: 'thinking', thinking: reasoning },
      ...text.length > 0 ? [{ type: 'text' as const, text }] : [],
    ]
  } else if (text.length > 0) {
    content = text
  }

  return {
    role: 'assistant',
    ...content !== undefined ? { content } : {},
    ...toolCalls.length > 0 && reasoning.length > 0 ? { tool_plan: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      assertTextOnly(result.content)
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`); optional
 * fields are omitted rather than sent as null, so provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the v2 Chat request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const thinking = resolveThinking(options, defaults)
  return {
    model: options.model,
    messages,
    stream: true,
    ...tools !== undefined && tools.length > 0 ? { tools, strict_tools: true } : {},
    ...thinking !== undefined ? { thinking: { type: thinking } } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop_sequences: options.stop } : {},
  }
}
