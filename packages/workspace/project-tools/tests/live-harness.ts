/** Persistent test-only host shared by live provider checks. @module */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import LocalFileSystem from '@workspacealberta/wa-fs-local'
import { Context } from '@workspacealberta/cordis'
import AgentRegistry from '@workspacealberta/wa-agent'
import AgentLoop from '@workspacealberta/wa-agent-loop'
import LlmRuntime from '@workspacealberta/wa-llm'
import SessionStore from '@workspacealberta/wa-session'
import SessionProjectionRegistry from '@workspacealberta/wa-session-projection'
import SystemPrompt from '@workspacealberta/wa-system-prompt'
import ToolRuntime from '@workspacealberta/wa-tools'
import JsonlPersistence from '@workspacealberta/wa-session-persistence-jsonl'
import { CredentialProvider } from '@workspacealberta/wa-credentials'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

class LiveCredentials extends CredentialProvider {
  async resolve(ref: string) { const value = process.env[ref]; return value ? { value, source: 'live-test-environment' } : undefined }
  async describe() { return { configured: true, writable: false } }
  async set() { throw new Error('read only') }
  async unset() { throw new Error('read only') }
  async readRecord() { return undefined }
  async describeRecord() { return { configured: false, writable: false } }
  async listRecords() { return [] }
  async modifyRecord(): Promise<never> { throw new Error('read only') }
  async deleteRecord() { throw new Error('read only') }
}

/** Mount the actual session, tool and agent services over one persistent test root. */
export async function boot(root: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: 'Use the supplied tools to answer accurately. Keep the answer short.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LiveCredentials)
  await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

/** Create an isolated, persistent test harness; afterEach disposes it before removing its temporary root. */
export async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'wa-live-project-'))
  roots.push(root)
  return { root, ctx: await boot(root) }
}
