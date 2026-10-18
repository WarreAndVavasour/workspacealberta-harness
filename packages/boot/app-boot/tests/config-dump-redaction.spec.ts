import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOverlayPatches, renderConfigDump } from '../src/index.ts'

describe('configuration export credential redaction', () => {
  it('redacts nested literal keys, credential env values, and authentication headers at the actual dump entrypoint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-secret-dump-'))
    try {
      const path = join(dir, 'cordis.yml')
      writeFileSync(path, `- id: test
  name: ./noop.mjs
  config:
    apiKey: synthetic-dump-key
    env:
      COHERE_API_KEY: synthetic-env-key
      OP_SESSION_test: synthetic-op-session
      AWS_ACCESS_KEY_ID: synthetic-aws-id
    headers:
      Authorization: synthetic-header-value
    nested:
      - refresh_token: synthetic-refresh-value
    refs:
      COHERE_API_KEY: op://test/cohere/api-key
    apiKeyEnv: COHERE_API_KEY
    model: ordinary-model
`)
      const dump = renderConfigDump('wa', path, [], () => {})
      expect(dump).not.toContain('synthetic-')
      expect(dump).toContain('[REDACTED]')
      expect(dump).toContain('op://test/cohere/api-key')
      expect(dump).toContain('apiKeyEnv: COHERE_API_KEY')
      expect(dump).toContain('ordinary-model')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('conceals source text in malformed base and overlay YAML errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-secret-parse-'))
    try {
      const path = join(dir, 'cordis.yml')
      writeFileSync(path, '- id: test\n  config: {apiKey: "synthetic-parser-secret}\n')
      for (const parse of [() => renderConfigDump('wa', path, [], () => {}), () => loadOverlayPatches('wa', path)]) {
        let failure: unknown
        try { parse() } catch (error) { failure = error }
        expect(failure).toBeInstanceOf(Error)
        expect(String(failure)).toContain('source details concealed')
        expect(String(failure)).not.toContain('synthetic-parser-secret')
        expect((failure as Error).cause).toBeUndefined()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
