import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime, { INVALID_CREDENTIAL_CODE } from '@workspacealberta/wa-llm'
import { credentialRef } from '@workspacealberta/wa-credentials'
import { LocalCredentialProvider } from '@workspacealberta/wa-credentials-local'
import { settingsNamespace } from '@workspacealberta/wa-settings'
import { FileSettingsProvider } from '@workspacealberta/wa-settings-file'
import * as LlmCohere from '@workspacealberta/wa-llm-cohere'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const NS = settingsNamespace('llm-cohere')
const KEY_REF = credentialRef('COHERE_API_KEY')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-cohere-dynamic-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

interface Harness {
  ctx: Context
  settingsFiber: { dispose(): Promise<void> }
}

async function boot(dir: string, config: object): Promise<Harness> {
  vi.stubEnv('DSH_HOME', dir)
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  await ctx.plugin(LlmRuntime)
  const settingsFiber = ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await settingsFiber
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmCohere, config)
  return { ctx, settingsFiber }
}

function prompt(ctx: Context) {
  return assemble(ctx, { model: 'command-a-plus-05-2026', messages: [] })
}

describe('request-level dynamic configuration', () => {
  it('routes the next request with the freshly resolved base URL and credential', async () => {
    vi.stubEnv('COHERE_API_KEY', '')
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'COHERE_API_KEY: first-key\n', { mode: 0o600 })
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await boot(dir, { baseURL: serverA.url })

    await prompt(ctx)
    expect(serverA.headers[0]?.authorization).toBe('Bearer first-key')

    await ctx.settings.update(NS, { baseURL: serverB.url })
    await ctx.credentials.set(KEY_REF, 'second-key')

    await prompt(ctx)
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.headers[0]?.authorization).toBe('Bearer second-key')
  })

  it('starts keyless and serves the next request once the key arrives', async () => {
    vi.stubEnv('COHERE_API_KEY', '')
    const dir = await home()
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await boot(dir, { baseURL: server.url })

    const keyless = await prompt(ctx)
    expect(keyless.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    await expect(access(join(dir, '.anonymous-user-id'))).rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.credentials.set(KEY_REF, 'sk-arrived')
    await prompt(ctx)
    expect(server.headers[0]?.authorization).toBe('Bearer sk-arrived')
    await expect(access(join(dir, '.anonymous-user-id'))).resolves.toBeUndefined()
  })

  it('rejects a stored credential no header can carry, never echoing it in the failure', async () => {
    vi.stubEnv('COHERE_API_KEY', '')
    const dir = await home()
    const { ctx } = await boot(dir, { baseURL: 'http://127.0.0.1:1' })
    const secret = 'sk-\u{1F600}supersecret'

    await ctx.credentials.set(KEY_REF, secret)
    const result = await prompt(ctx)
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: INVALID_CREDENTIAL_CODE } })
    if (result.finish.kind !== 'error') throw new Error('expected an error finish')
    expect(result.finish.failure.message).not.toContain(secret)
    expect(result.finish.failure.message).not.toContain('supersecret')
    expect(result.finish.failure.message).not.toContain('ByteString')
  })

  it('advertises a live settings catalog without re-registration', async () => {
    const dir = await home()
    const { ctx } = await boot(dir, { baseURL: 'http://127.0.0.1:1' })

    await expect(ctx.llm.listModels('cohere-canada')).resolves.toHaveLength(1)
    await ctx.settings.update(NS, {
      models: [{ id: 'settings-model', name: 'From Settings' }],
    })
    await expect(ctx.llm.listModels('cohere-canada')).resolves.toEqual([
      { provider: 'cohere-canada', id: 'settings-model', name: 'From Settings', inputModalities: ['text'] },
    ])
  })

  it('re-registers the route in place when the captured retry policy changes', async () => {
    const dir = await home()
    const { ctx } = await boot(dir, { baseURL: 'http://127.0.0.1:1' })

    const observed: string[][] = []
    ctx.on('llm/adapters-updated', () => {
      observed.push(ctx.llm.listProviders().map(provider => provider.id))
    })

    await ctx.settings.update(NS, {
      retryPolicy: { mode: 'always', backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 } },
    })
    expect(ctx.llm.providerRetryPolicy('cohere-canada')).toEqual({
      mode: 'always',
      initialDelayMs: 25,
      maxDelayMs: 100,
      jitterRatio: 0.2,
    })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'cohere-canada', name: 'Cohere (Canada)' }])
    expect(observed).toEqual([['cohere-canada']])
  })

  it('keeps the last good options when a settings snapshot fails beyond-schema validation', async () => {
    const dir = await home()
    const { ctx } = await boot(dir, { baseURL: 'http://127.0.0.1:1' })

    await ctx.settings.update(NS, { models: [{ id: 'dup' }, { id: 'dup' }] })
    await expect(ctx.llm.listModels('cohere-canada')).resolves.toHaveLength(1)
    await ctx.settings.update(NS, { models: [{ id: 'recovered' }] })
    await expect(ctx.llm.listModels('cohere-canada')).resolves.toEqual([
      { provider: 'cohere-canada', id: 'recovered', name: 'recovered', inputModalities: ['text'] },
    ])
  })

  it('keeps the whole last-good snapshot when a rejected one changed the URL', async () => {
    const dir = await home()
    const good = await mockServer([{ kind: 'sse', events: textEvents }])
    const rejected = await mockServer([{ kind: 'sse', events: textEvents }])
    vi.stubEnv('COHERE_API_KEY', 'good-key')
    const { ctx } = await boot(dir, { baseURL: good.url })

    await ctx.settings.update(NS, {
      baseURL: rejected.url,
      models: [{ id: 'dup' }, { id: 'dup' }],
    })

    await prompt(ctx)
    expect(rejected.requests).toHaveLength(0)
    expect(good.requests).toHaveLength(1)
    expect(good.headers[0]?.authorization).toBe('Bearer good-key')
  })

  it('falls back to the composition entry when settings detach', async () => {
    vi.stubEnv('COHERE_API_KEY', '')
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'COHERE_API_KEY: steady-key\n', { mode: 0o600 })
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx, settingsFiber } = await boot(dir, { baseURL: serverA.url })

    await ctx.settings.update(NS, { baseURL: serverB.url })
    await prompt(ctx)
    expect(serverB.requests).toHaveLength(1)

    await settingsFiber.dispose()
    await prompt(ctx)
    expect(serverA.requests).toHaveLength(1)
    expect(serverA.headers[0]?.authorization).toBe('Bearer steady-key')
  })
})
