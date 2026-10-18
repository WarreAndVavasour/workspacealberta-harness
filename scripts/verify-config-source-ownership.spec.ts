import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigSourceOwnershipViolations } from './verify-config-source-ownership.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('configuration source ownership gate', () => {
  it('rejects literal product-overlay credentials without printing values and accepts vault references', () => {
    const root = mkdtempSync(join(tmpdir(), 'wa-config-secrets-'))
    roots.push(root)
    const path = join(root, 'workspace-alberta.patch.yml')
    writeFileSync(path, 'config:\n  apiKey: synthetic-private-key\n  COHERE_API_KEY: op://test/cohere/api-key\n')
    expect(collectConfigSourceOwnershipViolations(root)).toEqual([
      'workspace-alberta.patch.yml:2: contains a credential literal; use a credential reference.',
    ])
    writeFileSync(path, 'config:\n  apiKeyEnv: COHERE_API_KEY\n  COHERE_API_KEY: op://test/cohere/api-key\n')
    expect(collectConfigSourceOwnershipViolations(root)).toEqual([])
  })
  it('rejects inline endpoints in shipped bundle patches', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-config-source-ownership-'))
    roots.push(root)
    const directory = join(root, 'packages/subagent/subagent-claude-code')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'cordis.patch.yml'),
      'config:\n  baseURL: !!js process.env.DEEPSEEK_SEARCH_BASE_URL\n',
    )

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([
      'packages/subagent/subagent-claude-code/cordis.patch.yml:2: inlines a credential or endpoint from the environment.'
      + ' The adapter resolves apiKeyEnv through ctx.credentials and the endpoint through the'
      + ' environment snapshot; inlining here bypasses both ladders.',
    ])
  })
  it.each([
    '"apiKey": synthetic-quoted',
    'headers: {Authorization: synthetic-flow}',
    'env: {OP_SESSION_test: synthetic-session, AWS_ACCESS_KEY_ID: synthetic-id}',
    'alias: &key synthetic-alias\napiKey: *key',
    'apiKey: |\n  synthetic-multiline',
  ])('rejects equivalent YAML credential forms with sanitized diagnostics: %s', (input) => {
    const root = mkdtempSync(join(tmpdir(), 'wa-config-forms-'))
    roots.push(root)
    writeFileSync(join(root, 'workspace-alberta.patch.yml'), input)
    const failures = collectConfigSourceOwnershipViolations(root)
    expect(failures.length).toBeGreaterThan(0)
    expect(failures.join('\n')).not.toContain('synthetic-')
  })
})
