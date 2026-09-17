import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import LlmRuntime, { createUserMessage, CallId, createMessage } from '@workspacealberta/wa-llm'
import type { Message, ToolSchema } from '@workspacealberta/wa-llm'
import * as LlmCohere from '@workspacealberta/wa-llm-cohere'
import type { Config } from '@workspacealberta/wa-llm-cohere'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Real-API e2e for the Cohere v2 Chat adapter. Key-gated — skips entirely
 * without $COHERE_API_KEY (see vitest.e2e.config.ts).
 */

const MODEL = 'command-a-plus-05-2026'
const contexts: Context[] = []
let identityHome: string

beforeEach(async () => {
  identityHome = await mkdtemp(join(tmpdir(), 'dsh-e2e-cohere-'))
  vi.stubEnv('DSH_HOME', identityHome)
})

async function harness(config: Partial<Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmCohere, config)
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllEnvs()
  await rm(identityHome, { recursive: true, force: true })
})

function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

const weatherTool: ToolSchema = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
}

describe.skipIf(!process.env.COHERE_API_KEY)('Cohere v2 Chat against the live API', () => {
  it('returns a text answer', async () => {
    const ctx = await harness()
    const result = await assemble(ctx, {
      model: MODEL,
      messages: ask('Reply with the single word pong and nothing else.'),
    })
    expect(result.finish.kind).toBe('stop')
    expect(textOf(result).toLowerCase()).toContain('pong')
  })

  it('calls a function tool', async () => {
    const ctx = await harness()
    const first = await assemble(ctx, {
      model: MODEL,
      messages: ask('What is the weather in Calgary? Use the get_weather tool.'),
      tools: [weatherTool],
    })
    const call = first.message.content.find(block => block.type === 'tool-call')
    expect(first.finish.kind).toBe('tool-calls')
    expect(call?.type).toBe('tool-call')
    if (call?.type !== 'tool-call') throw new Error('expected a tool call')

    const second = await assemble(ctx, {
      model: MODEL,
      messages: [
        ...ask('What is the weather in Calgary? Use the get_weather tool.'),
        createMessage({
          role: 'assistant',
          content: first.message.content,
          source: { kind: 'model', provider: 'cohere-canada', model: MODEL },
        }),
        createUserMessage({
          content: [{
            type: 'tool-result',
            toolCallId: CallId(call.id),
            content: [{ type: 'text', text: '{"city":"Calgary","temp_c":18}' }],
          }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
      tools: [weatherTool],
    })
    expect(second.finish.kind).toBe('stop')
    expect(textOf(second).toLowerCase()).toMatch(/calgary|18/)
  })
})
