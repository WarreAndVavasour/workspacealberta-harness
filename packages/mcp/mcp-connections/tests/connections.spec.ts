import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@workspacealberta/cordis'
import Loader from '@workspacealberta/cordis-plugin-loader'
import Include from '@workspacealberta/cordis-plugin-include'
import SystemPrompt from '@workspacealberta/wa-system-prompt'
import ToolRuntime from '@workspacealberta/wa-tools'
import FileSettingsProvider from '@workspacealberta/wa-settings-file'
import LocalCredentialProvider from '@workspacealberta/wa-credentials-local'
import { credentialKey } from '@workspacealberta/wa-credentials'
import { ToolCallId } from '@workspacealberta/wa-llm'
import { startOAuthFixture } from './oauth-http-fixture.ts'
import * as supervisor from '@workspacealberta/wa-mcp-client/src/connection.ts'
import McpConnections, { validateConnection } from '../src/index.ts'
import type { ConnectionInput } from '../src/types.ts'
import { startHttpMcpFixture } from '../../mcp-client/tests/http-fixture.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
  vi.restoreAllMocks()
})
const remote: ConnectionInput = { name: 'Business tools', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', command: '', args: [], envRefs: {}, enabled: true, oauth: false }
class FixtureConnection extends Service { constructor(ctx: Context) { super(ctx, 'connection') } }
async function boot(root: string) {
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.credentials.modifyRecord(credentialKey('client-connection', 'browser-session'), previous => Promise.resolve(previous ?? {
    kind: 'grant', payload: { version: 1, secret: randomBytes(32).toString('base64url') },
  }))
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules: Record<string, unknown> = {
    systemPrompt: SystemPrompt, tools: ToolRuntime, settings: FileSettingsProvider,
    connection: FixtureConnection, connections: McpConnections,
  }
  const internal = ctx.loader.internal
  if (!internal) throw new Error('Loader resolver missing')
  vi.spyOn(internal, 'import').mockImplementation(async (specifier: unknown) => {
    const identifier: unknown = specifier
    if (typeof identifier !== 'string' || !(identifier in modules)) throw new Error('Unexpected fixture module')
    return modules[identifier]
  })
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- name: systemPrompt', '- name: tools', '- name: connection', '- name: settings', '  config:',
    '    watch: false', '    path: ' + JSON.stringify(join(root, 'settings.yaml')),
    '- name: connections', '  config:', '    storageDirectory: ' + JSON.stringify(join(root, 'oauth')),
  ].join('\n') + '\n')
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  await vi.waitFor(() =>{  expect(ctx.get('mcpConnections')).toBeDefined() })
  return ctx
}
async function rootDir() {
  const root = await mkdtemp(join(tmpdir(), 'wa-connections-loader-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  return root
}
describe('native Connections in the harness', () => {
  it('loads through Loader, discovers and executes a tool, disables it and restores metadata', async () => {
    const fixture = await startHttpMcpFixture(); cleanup.push(() => fixture.close())
    const root = await rootDir(); const ctx = await boot(root)
    await ctx.mcpConnections.save({ ...remote, url: fixture.url, oauth: true })
    await vi.waitFor(async () =>{  expect((await ctx.mcpConnections.list())[0]?.status).toBe('connected') })
    const row = (await ctx.mcpConnections.list())[0]!
    const name = 'mcp__user_' + Buffer.from(row.id.replaceAll('-', ''), 'hex').toString('base64url') + '__ping'
    expect(ctx.tools.get(name)).toBeDefined()
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('native-call'), name, arguments: {} })
    expect(result.isError).toBeFalsy(); expect(result.content).toEqual([{ type: 'text', text: 'pong' }])
    await ctx.mcpConnections.save({ ...row, enabled: false })
    await vi.waitFor(() =>{  expect(ctx.tools.get(name)).toBeUndefined() })
    expect(await readFile(join(root, 'settings.yaml'), 'utf8')).toContain('Business tools')
    await ctx.fiber.dispose()
    const restored = await boot(root)
    expect((await restored.mcpConnections.list())[0]).toMatchObject({ id: row.id, enabled: false, status: 'disabled' })
    await restored.mcpConnections.remove(row.id)
    expect(await restored.mcpConnections.list()).toEqual([])
  })
  it('keeps the latest server after two queued edits instead of replaying an older settings notification', async () => {
    const first = await startHttpMcpFixture('first server'); cleanup.push(() => first.close())
    const second = await startHttpMcpFixture('latest server'); cleanup.push(() => second.close())
    const ctx = await boot(await rootDir())
    const starts = vi.spyOn(supervisor, 'startConnection')
    await ctx.mcpConnections.save({ ...remote, enabled: false })
    const row = (await ctx.mcpConnections.list())[0]!
    await Promise.all([
      ctx.mcpConnections.save({ ...row, enabled: true, url: first.url }),
      ctx.mcpConnections.save({ ...row, enabled: true, url: second.url }),
    ])
    await vi.waitFor(async () => {
      expect((await ctx.mcpConnections.list())[0]).toMatchObject({ url: second.url, status: 'connected' })
      const name = 'mcp__user_' + Buffer.from(row.id.replaceAll('-', ''), 'hex').toString('base64url') + '__ping'
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('latest-call'), name, arguments: {} })
      expect(result.content).toEqual([{ type: 'text', text: 'latest server' }])
      expect(starts.mock.calls.filter(([, config]) => config.transport === 'streamable-http' && config.url === first.url)).toHaveLength(1)
    })
  })
  it('isolates a missing local credential and keeps the next remote server working', async () => {
    const fixture = await startHttpMcpFixture(); cleanup.push(() => fixture.close())
    const ctx = await boot(await rootDir())
    await ctx.mcpConnections.save({ ...remote, name: 'Not configured', transport: 'stdio', command: 'node', envRefs: { BUSINESS_KEY: 'UNCONFIGURED_TEST_CREDENTIAL' } })
    await ctx.mcpConnections.save({ ...remote, url: fixture.url })
    await vi.waitFor(async () =>{  expect((await ctx.mcpConnections.list()).map(row => row.status)).toEqual(['failed', 'connected']) })
  })
  it('requires an approved browser origin and rejects replayed or absent OAuth state', async () => {
    const ctx = await boot(await rootDir())
    await ctx.mcpConnections.save({ ...remote, oauth: true })
    const row = (await ctx.mcpConnections.list())[0]!
    await vi.waitFor(async () =>{  expect((await ctx.mcpConnections.list())[0]?.status).toBe('sign-in-required') })
    await expect(ctx.mcpConnections.signIn({ id: row.id, origin: 'https://unapproved.example.test' })).rejects.toThrow('not approved')
    await expect(ctx.mcpConnections.completeAuthorization({ state: 'unowned', code: 'code', error: '' })).rejects.toThrow('expired')
    await ctx.mcpConnections.disconnect(row.id)
    expect((await ctx.mcpConnections.list())[0]).toMatchObject({ enabled: false, signedIn: false })
    const manager = ctx.mcpConnections
    await ctx.fiber.dispose()
    await expect(manager.save(remote)).rejects.toThrow()
  })
  it('completes native sign-in, refreshes on 401, and refuses a callback after editing the server', async () => {
    const fixture = await startOAuthFixture(); cleanup.push(() => fixture.close())
    const ctx = await boot(await rootDir())
    await ctx.mcpConnections.save({ ...remote, url: fixture.url, oauth: true })
    const row = (await ctx.mcpConnections.list())[0]!
    const login = await ctx.mcpConnections.signIn({ id: row.id, origin: 'http://localhost:3081' })
    const state = new URL(login.authorizationUrl!).searchParams.get('state')!
    await ctx.mcpConnections.completeAuthorization({ state, code: 'approved', error: '' })
    await vi.waitFor(async () =>{  expect((await ctx.mcpConnections.list())[0]?.status).toBe('connected') })
    const name = 'mcp__user_' + Buffer.from(row.id.replaceAll('-', ''), 'hex').toString('base64url') + '__ping'
    fixture.expire()
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('oauth-tool-call'), name, arguments: {} })
    expect(result.content).toEqual([{ type: 'text', text: 'authenticated pong' }])
    expect(fixture.exchanges.some(value => value.get('grant_type') === 'refresh_token')).toBe(true)
    await expect(ctx.mcpConnections.completeAuthorization({ state, code: 'replay', error: '' })).rejects.toThrow('expired')
    await ctx.mcpConnections.disconnect(row.id)
    await ctx.mcpConnections.save({ ...row, enabled: true })
    const canceled = await ctx.mcpConnections.signIn({ id: row.id, origin: 'http://localhost:3081' })
    const canceledState = new URL(canceled.authorizationUrl!).searchParams.get('state')!
    await ctx.mcpConnections.save({ ...row, url: fixture.url + '/changed' })
    const before = fixture.exchanges.length
    await expect(ctx.mcpConnections.completeAuthorization({ state: canceledState, code: 'late-code', error: '' })).rejects.toThrow('expired')
    expect(fixture.exchanges).toHaveLength(before)
    expect((await ctx.mcpConnections.list())[0]?.signedIn).toBe(false)
  })
  it('rejects credentials in remote URLs and requires TLS for remote OAuth', () => {
    expect(() =>{  validateConnection({ ...remote, url: 'https://user:password@example.test/mcp' }) }).toThrow('embedded')
    expect(() =>{  validateConnection({ ...remote, url: 'https://example.test/mcp?access_token=private' }) }).toThrow('credentials')
    expect(() =>{  validateConnection({ ...remote, url: 'http://example.test/mcp', oauth: true }) }).toThrow('HTTPS')
  })
})
