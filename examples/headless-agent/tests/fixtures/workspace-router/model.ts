/** Deterministic external-model substitute for the assembled routing transcript. */
import type { Context } from '@workspacealberta/cordis'
import { CallId, LlmAdapter } from '@workspacealberta/wa-llm'
import type { GenerateOptions, StreamChunk } from '@workspacealberta/wa-llm'

class FixtureModel extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result === undefined) {
      const message = options.messages.findLast(item => item.role === 'user')
      const text = message?.content.find(block => block.type === 'text')
      if (text?.type !== 'text') throw new Error('Fixture needs JSON tool arguments as its user task')
      const block = { type: 'tool-call' as const, id: CallId('workspace-fixture-call'), name: 'workspace_route', arguments: text.text }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

export const name = 'workspace-fixture-model'
export const inject = ['llm']
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['workspace-fixture'], new FixtureModel())
}
