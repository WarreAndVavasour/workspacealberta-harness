/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@workspacealberta/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('dsh-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@workspacealberta/wa-sdk-app'],
      ['sdk-jsonrpc-server', '@workspacealberta/wa-sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@workspacealberta/wa-deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@workspacealberta/wa-session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@workspacealberta/wa-plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@workspacealberta/wa-llm-deepseek'],
      ['sandbox', '@workspacealberta/wa-sandbox-local'],
      ['session-projection', '@workspacealberta/wa-session-projection'],
      ['sandbox-policy', '@workspacealberta/wa-sandbox-policy'],
      ['subprocess', '@workspacealberta/wa-subprocess-local'],
      ['pty', '@workspacealberta/wa-terminal'],
      ['terminal-bash', '@workspacealberta/wa-terminal-bash'],
      ['terminal-pwsh', '@workspacealberta/wa-terminal-bash'],
      ['fs-local', '@workspacealberta/wa-fs-local'],
      ['timer', '@workspacealberta/cordis-plugin-timer'],
      ['llm', '@workspacealberta/wa-llm'],
      ['session', '@workspacealberta/wa-session'],
      ['session-title', '@workspacealberta/wa-session-title'],
      ['system-prompt', '@workspacealberta/wa-system-prompt'],
      ['tools', '@workspacealberta/wa-tools'],
      ['agent', '@workspacealberta/wa-agent'],
      ['llm-retry', '@workspacealberta/wa-llm-retry'],
      ['jobs', '@workspacealberta/wa-jobs-local'],
      ['invariants', '@workspacealberta/wa-invariants'],
      ['session-invariant', '@workspacealberta/wa-session/invariant'],
      ['agent-invariant', '@workspacealberta/wa-agent/invariant'],
      ['scope-invariant', '@workspacealberta/wa-scope/invariant'],
      ['agent-loop-invariant', '@workspacealberta/wa-agent-loop/invariant'],
      ['agent-loop', '@workspacealberta/wa-agent-loop'],
      ['persistent-bash', '@workspacealberta/wa-tool-bash-persistent'],
      ['persistent-pwsh', '@workspacealberta/wa-tool-pwsh-persistent'],
      ['str-replace-editor', '@workspacealberta/wa-tool-str-replace-editor'],
      ['sessions', '@workspacealberta/wa-session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.DSH_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: { __jsExpr: "process.env.DSH_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
