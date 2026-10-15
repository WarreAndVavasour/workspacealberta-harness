import { expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Context } from '@workspacealberta/cordis'
import { ToolCallId, createUserMessage } from '@workspacealberta/wa-llm'
import { SessionId } from '@workspacealberta/wa-session'
import { defineTool } from '@workspacealberta/wa-tools'
import * as PiAi from '@workspacealberta/wa-llm-pi-ai'
import * as ProjectTools from '../src/index.ts'
import { fresh, boot } from './live-harness.ts'

it.skipIf(!process.env.WA_RFP_SMOKE_DIR || !process.env.TYPESAFE_API_KEY)(
  'uses the actual harness image and long-context tools on the supplied RFP', async () => {
    const directory = process.env.WA_RFP_SMOKE_DIR
    if (!directory) throw new Error('WA_RFP_SMOKE_DIR is required')
    const { ctx } = await fresh()
    await ctx.plugin(ProjectTools, ProjectTools.Config({ minConfidence: 0.9, enableImages: true, enableLongContext: true }))
    const agent = await ctx.agentLoop.create(SessionId('jev-multimodal-live'))
    const call = (name: string, args: unknown) => ctx.tools.execute({ name, arguments: args, agent,
      callId: ToolCallId(name), signal: new AbortController().signal })
    const image = await call('project_inspect_image', { sourceId: 'AB-2026-06600-024300',
      location: 'AB-2026-06600-024300.pdf#page=440', file_path: join(directory, 'page-440.png') })
    expect(image.isError, JSON.stringify(image.content)).toBe(false)
    expect(image.value).toMatchObject({ model: 'jev-1.14.0', answers: { kind: { choice: 'drawing' } } })
    const document = z.object({ sourceId: z.string(), pages: z.array(z.object({ text: z.string() })) })
      .parse(JSON.parse(await readFile(join(directory, 'extraction.json'), 'utf8')))
    const text = document.pages.slice(0, 100).map((page, index) => `PDF page ${index + 1}\n${page.text}`).join('\n\n')
    const long = await call('project_classify_sections', { sourceId: document.sourceId, useLongContext: true,
      sections: [{ id: 'first-100-pages', location: 'AB-2026-06600-024300.pdf#pages=1-100', text }] })
    expect(long.isError, JSON.stringify(long.content)).toBe(false)
    const requests = agent.session.snapshotEvents().filter(event => event.type === 'workspace/intake').filter(event => event.data.phase === 'request')
    expect(requests[0]?.data.value).toMatchObject({ headers: { 'TypeSafe-Danger-Zone-Images': 'true' } })
    expect(requests[1]?.data.value).toMatchObject({ headers: { 'TypeSafe-Danger-Zone-Long-Context': 'true' } })
    await writeFile(join(directory, 'harness-multimodal.json'), JSON.stringify({ image: image.value, long: long.value,
      note: 'Actual production tool path. Results require source review; this smoke is not accuracy calibration.' }, null, 2) + '\n')
  },
)

it.skipIf(!process.env.TYPESAFE_API_KEY)('classifies synthetic RFP sections with the pinned live Jev release', async () => {
  const { ctx } = await fresh()
  await ctx.plugin(ProjectTools, ProjectTools.Config({ minConfidence: 0.9 }))
  const agent = await ctx.agentLoop.create(SessionId('jev-live'))
  const result = await ctx.tools.execute({ name: 'project_classify_sections', callId: ToolCallId('jev-intake'), agent,
    signal: new AbortController().signal, arguments: { sourceId: 'synthetic-rfp', sections: [
      { id: 'scope', location: 'synthetic.pdf#page=1', text: 'Scope of work: construct a public community centre with a library and a gymnasium.' },
      { id: 'deadline', location: 'synthetic.pdf#page=2', text: 'Submission instructions: upload the completed proposal and all attachments by October 30, 2026 at 14:00 America/Edmonton.' },
    ] } })
  expect(result.isError, JSON.stringify(result.content)).toBe(false)
  expect(result.value).toMatchObject({ model: 'jev-1.14.0', results: [{ id: 'scope', category: 'scope' }, { id: 'deadline', category: 'submission' }] })
})

it.skipIf(!process.env.COHERE_API_KEY)('executes a live native Cohere tool call, persists it, and continues after a restart', async () => {
  const { root, ctx } = await fresh()
  const model = { provider: 'cohere-canada', model: 'command-a-plus-05-2026' }
  const mount = async (target: Context) => {
    await target.plugin(PiAi, { providers: { 'cohere-canada': { displayName: 'Cohere', apiKeyEnv: 'COHERE_API_KEY',
      api: 'cohere-v2-chat', baseURL: 'https://api.cohere.com/v2', models: [{ id: model.model, contextWindow: 256000, maxTokens: 2048 }] } } })
    target.tools.register(defineTool({ name: 'inspect_business_fixture', description: 'Get the synthetic business project reference. Call this to retrieve it.',
      parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute() { return { reference: 'WA-RFP-SYNTHETIC-42' } } }))
  }
  await mount(ctx)
  const id = SessionId('cohere-live-project')
  const agent = await ctx.agentLoop.create(id, model)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Call inspect_business_fixture once and tell me its exact reference. You must retrieve it from that tool.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  expect(events.some(event => event.type === 'tool/result')).toBe(true)
  expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toMatchObject({ kind: 'completed' })
  await ctx.sessions.flush(agent.session)
  await ctx.fiber.dispose()
  const restored = await boot(root)
  await mount(restored)
  await restored.agents.resume({ resumeSessionId: id, agentOptions: model })
  const resumed = restored.agents.get(id)!
  resumed.followup(createUserMessage({ content: [{ type: 'text', text: 'What exact reference did the tool return earlier? Answer from our conversation, without calling a tool again.' }], source: { kind: 'user' } }))
  await resumed.whenIdle()
  const continued = resumed.session.snapshotEvents()
  expect(continued.filter(event => event.type === 'turn/end')).toHaveLength(2)
  expect(continued.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toMatchObject({ kind: 'completed' })
  expect(continued.filter(event => event.type === 'tool/result')).toHaveLength(1)
  expect(JSON.stringify(resumed.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1)))
    .toContain('WA-RFP-SYNTHETIC-42')
})
