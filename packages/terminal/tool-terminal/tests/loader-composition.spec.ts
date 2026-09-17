import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import Loader from '@workspacealberta/cordis-plugin-loader'
import Include from '@workspacealberta/cordis-plugin-include'
import { ToolCallId } from '@workspacealberta/wa-llm'
import { Session, SessionId } from '@workspacealberta/wa-session'
import AgentRegistry, { Inbox } from '@workspacealberta/wa-agent'
import type { Agent } from '@workspacealberta/wa-agent'
import SystemPrompt from '@workspacealberta/wa-system-prompt'
import ToolRuntime from '@workspacealberta/wa-tools'
import TerminalSessionService from '@workspacealberta/wa-terminal'
import SandboxProvider from '@workspacealberta/wa-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@workspacealberta/wa-sandbox'
import SandboxPolicyService from '@workspacealberta/wa-sandbox-policy'
import SessionProjectionRegistry from '@workspacealberta/wa-session-projection'
import LocalSubprocessRuntime from '@workspacealberta/wa-subprocess-local'
import * as TerminalLocal from '@workspacealberta/wa-terminal-bash'
import * as ToolPty from '@workspacealberta/wa-tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@workspacealberta/wa-agent'",
      "- name: '@workspacealberta/wa-system-prompt'",
      "- name: '@workspacealberta/wa-tools'",
      "- name: '@workspacealberta/wa-terminal'",
      "- name: '@workspacealberta/wa-test-sandbox'",
      "- name: '@workspacealberta/wa-session-projection'",
      "- name: '@workspacealberta/wa-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@workspacealberta/wa-subprocess-local'",
      "- name: '@workspacealberta/wa-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@workspacealberta/wa-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@workspacealberta/wa-agent', AgentRegistry],
      ['@workspacealberta/wa-system-prompt', SystemPrompt],
      ['@workspacealberta/wa-tools', ToolRuntime],
      ['@workspacealberta/wa-terminal', TerminalSessionService],
      ['@workspacealberta/wa-test-sandbox', PassthroughSandbox],
      ['@workspacealberta/wa-session-projection', SessionProjectionRegistry],
      ['@workspacealberta/wa-sandbox-policy', SandboxPolicyService],
      ['@workspacealberta/wa-subprocess-local', LocalSubprocessRuntime],
      ['@workspacealberta/wa-terminal-bash', TerminalLocal],
      ['@workspacealberta/wa-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context)
    const signal = new AbortController().signal
    const spawn = await context.tools.execute({
      signal, callId: ToolCallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await context.tools.execute({
      signal, callId: ToolCallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await context.tools.execute({
      signal, callId: ToolCallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
