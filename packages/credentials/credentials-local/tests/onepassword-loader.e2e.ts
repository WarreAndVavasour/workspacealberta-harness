import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('loads the built 1Password provider through real cordis.yml with no local credential artifact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wa-op-loader-'))
  try {
    const state = join(dir, 'version')
    const audit = join(dir, 'audit.jsonl')
    await writeFile(state, '1')
    const command = [process.execPath, fileURLToPath(new URL('./fixtures/op-reader.mjs', import.meta.url)), audit, state]
    const config = join(dir, 'cordis.yml')
    await writeFile(config, `- id: credentials
  name: ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)}
  config:
    path: ${JSON.stringify(join(dir, '.credentials.yaml'))}
    onePassword:
      command: ${JSON.stringify(command)}
      refs:
        COHERE_API_KEY: op://test/cohere/api-key
`)
    const result = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('./fixtures/onepassword-loader.mjs', import.meta.url)), config,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    expect(result.stdout).toContain('"source":"1password"')
    expect(result.stdout).toContain('"configured":true')
    expect(result.stdout).toContain('"writable":false')
    expect(result.stdout + result.stderr).not.toContain('synthetic-v1')
    await expect(stat(join(dir, '.credentials.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
