import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { credentialKey, credentialRef } from '@workspacealberta/wa-credentials'
import { createLaunchEnvironmentSnapshot } from '@workspacealberta/wa-launch-environment'
import { LocalCredentialProvider } from '../src/index.ts'
import { OnePasswordSource } from '../src/onepassword.ts'
import { BrowserAuth } from '../../../client/connection/src/browser-auth.ts'
import { authContextFrom } from '../../../llm/llm-pi-ai/src/auth.ts'
import { scrubbedParentEnv } from '@workspacealberta/wa-subprocess'

const cleanups: Array<() => Promise<void>> = []
const REF = credentialRef('COHERE_API_KEY')
const RECORD = credentialKey('client-connection', 'browser-session')
const CLI = fileURLToPath(new URL('./fixtures/op-reader.mjs', import.meta.url))

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length) await cleanups.pop()!()
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'wa-onepassword-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const audit = join(dir, 'audit.jsonl')
  const state = join(dir, 'version')
  await writeFile(state, '1')
  return { dir, audit, state, command: [process.execPath, CLI, audit, state] }
}

async function boot(f: Awaited<ReturnType<typeof fixture>>, uri = 'op://test/cohere/api-key') {
  const ctx = new Context()
  ctx.launchEnvironment = createLaunchEnvironmentSnapshot([
    { source: 'process', values: { COHERE_API_KEY: 'synthetic-ambient' } },
    { source: 'project-env', values: { COHERE_API_KEY: 'synthetic-dotenv' } },
  ])
  const fiber = ctx.plugin(LocalCredentialProvider, {
    path: join(f.dir, '.credentials.yaml'),
    onePassword: { command: f.command, refs: { COHERE_API_KEY: uri },
      records: { 'client-connection/browser-session': 'op://test/harness/browser-session-record' } },
  })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('1Password credential source', () => {
  it('preserves the real CLI default when product configuration omits a wrapper command', () => {
    const config = LocalCredentialProvider.Config({ onePassword: { refs: { COHERE_API_KEY: 'op://test/cohere/api-key' } } })
    expect(config.onePassword?.command).toEqual(['op'])
    if (config.onePassword === undefined) throw new Error('missing normalized source')
    const source = config.onePassword
    expect(() => new OnePasswordSource(source)).not.toThrow()
  })
  it('reads on every operation, ignores legacy sources, and never persists resolved values', async () => {
    const f = await fixture()
    const path = join(f.dir, '.credentials.yaml')
    await writeFile(path, 'not valid YAML: [')
    vi.stubEnv('COHERE_API_KEY', 'synthetic-host-key')
    const ctx = await boot(f)
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'synthetic-v1', source: '1password' })
    await writeFile(f.state, '2')
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'synthetic-v2', source: '1password' })
    expect(await ctx.credentials.describe(REF)).toEqual({ configured: true, source: '1password', writable: false })
    expect(await ctx.credentials.resolve(credentialRef('UNMAPPED'))).toBeUndefined()
    expect(await ctx.credentials.describe(credentialRef('UNMAPPED'))).toEqual({ configured: false, writable: false })
    expect(await readFile(path, 'utf8')).toBe('not valid YAML: [')
    expect(process.env.COHERE_API_KEY).toBe('synthetic-host-key')
    const audit = await readFile(f.audit, 'utf8')
    expect(audit).not.toContain('synthetic-')
    expect(audit).not.toContain('COHERE_API_KEY')
    expect(audit).not.toContain('--out-file')
  })

  it('denies writes and serves a preprovisioned browser record through real browser authentication', async () => {
    const f = await fixture()
    const ctx = await boot(f)
    expect(await ctx.credentials.describeRecord(RECORD)).toEqual({ configured: true, kind: 'grant', writable: false })
    expect(await ctx.credentials.listRecords()).toEqual([{ key: RECORD, kind: 'grant' }])
    await expect(ctx.credentials.set(REF, 'synthetic-value')).rejects.toThrow('read-only')
    await expect(ctx.credentials.unset(REF)).rejects.toThrow('read-only')
    await expect(ctx.credentials.deleteRecord(RECORD)).rejects.toThrow('read-only')
    await expect(ctx.credentials.modifyRecord(RECORD, async () => ({ kind: 'api-key', key: 'synthetic' }))).rejects.toThrow('read-only')
    const mutate = vi.fn(async () => undefined)
    await expect(ctx.credentials.modifyRecord(RECORD, mutate)).rejects.toThrow('read-only')
    expect(mutate).not.toHaveBeenCalled()
    await expect(BrowserAuth.create({}, ctx.credentials, 7)).resolves.toBeInstanceOf(BrowserAuth)
    await expect(stat(join(f.dir, '.credentials.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks native provider fallback and 1Password authentication inheritance by ordinary child processes', async () => {
    const f = await fixture()
    const ctx = await boot(f)
    vi.stubEnv('OP_SESSION_test', 'synthetic-session')
    vi.stubEnv('OP_SERVICE_ACCOUNT_TOKEN', 'synthetic-account')
    vi.stubEnv('UNMAPPED', 'synthetic-ambient')
    const auth = authContextFrom(ctx)
    expect(await auth.env('UNMAPPED')).toBeUndefined()
    expect(await auth.fileExists(f.state)).toBe(false)
    expect(scrubbedParentEnv()).not.toHaveProperty('OP_SESSION_test')
    expect(scrubbedParentEnv()).not.toHaveProperty('OP_SERVICE_ACCOUNT_TOKEN')
  })

  it.each(['error', 'empty'])('fails activation on a %s read without exposing CLI output', async (mode) => {
    const f = await fixture()
    await expect(boot(f, `op://test/${mode}/api-key`)).rejects.toThrow('1Password field read failed')
    const source = new OnePasswordSource({ refs: {}, command: f.command })
    const error = await source.read(`op://test/${mode}/api-key`).catch((value: unknown) => value)
    expect(String(error)).not.toContain('synthetic-sensitive')
    expect((error as Error).cause).toBeUndefined()
  })

  it('bounds time and output and rejects malformed JSON without leaking record contents', async () => {
    const f = await fixture()
    const source = new OnePasswordSource({ refs: {}, command: f.command, timeoutMs: 200 })
    await expect(source.read('op://test/slow/api-key')).rejects.toThrow('1Password field read failed')
    const boundedOutput = new OnePasswordSource({ refs: {}, command: f.command })
    await expect(boundedOutput.read('op://test/large/api-key')).rejects.toThrow('1Password field read failed')
    const ctx = new Context()
    const other = ctx.plugin(LocalCredentialProvider, { onePassword: { refs: {}, command: f.command,
      records: { 'test/record': 'op://test/bad-record/value' } } })
    cleanups.push(async () => { await other.dispose() })
    await expect(other).rejects.toThrow('valid tagged JSON')
  })

  it('rejects nonreference configuration and unavailable executables', async () => {
    expect(() => new OnePasswordSource({ refs: { COHERE_API_KEY: 'synthetic-literal' } })).toThrow('op://')
    expect(() => new OnePasswordSource({ refs: {}, command: [] })).toThrow('configuration')
    expect(() => new OnePasswordSource({ refs: {}, timeoutMs: 0 })).toThrow('configuration')
    const source = new OnePasswordSource({ refs: {}, command: ['nonexistent-wa-op-executable'] })
    await expect(source.read('op://test/cohere/api-key')).rejects.toThrow('1Password field read failed')
  })
})
