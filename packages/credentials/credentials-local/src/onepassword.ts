/** Read-only 1Password CLI access; values never enter files, argv, or the host environment. */
import { execFile } from 'node:child_process'
import { credentialRef, parseCredentialKey } from '@workspacealberta/wa-credentials'

/** Nonsecret addresses for a deployment's references and JSON credential records. */
export interface OnePasswordConfig {
  /** Environment-style reference names mapped to 1Password field URIs. */
  refs: Record<string, string>
  /** Plugin record addresses mapped to fields containing tagged JSON records. */
  records?: Record<string, string>
  /** CLI executable and optional wrapper arguments; defaults to `['op']`. */
  command?: string[]
  /** Maximum duration of a CLI read in milliseconds; defaults to 10000. */
  timeoutMs?: number
}

const REFERENCE = /^op:\/\/[^/?#\r\n]+\/[^/?#\r\n]+\/[^/?#\r\n]+(?:\/[^/?#\r\n]+)?$/

/** Validated, uncached field reader. Authentication belongs to the operator's existing CLI session. */
export class OnePasswordSource {
  /** Credential reference names and their validated field addresses. */
  readonly refs: Readonly<Record<string, string>>
  /** Plugin record addresses and their validated JSON-field addresses. */
  readonly records: Readonly<Record<string, string>>
  private readonly command: readonly string[]
  private readonly timeoutMs: number

  /**
   * Validate and freeze field mappings and the privileged reader's execution bounds.
   * @param config - nonsecret field addresses, executable arguments, and timeout.
   * @throws {Error} when an address, reference name, command, or timeout is invalid.
   */
  constructor(config: OnePasswordConfig) {
    this.refs = Object.freeze({ ...config.refs })
    this.records = Object.freeze({ ...config.records })
    this.command = Object.freeze([...(config.command ?? ['op'])])
    this.timeoutMs = config.timeoutMs ?? 10000
    try {
      for (const name of Object.keys(this.refs)) credentialRef(name)
      for (const name of Object.keys(this.records)) parseCredentialKey(name)
      if (![...Object.values(this.refs), ...Object.values(this.records)].every(uri => REFERENCE.test(uri))) {
        throw new Error('invalid URI')
      }
      if (!this.command.length || this.command.some(part => !part || /[\r\n]/.test(part))) throw new Error('invalid command')
      if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('invalid timeout')
    } catch {
      throw new Error('1Password configuration requires valid reference names, op:// field URIs, command, and timeout')
    }
  }

  /**
   * Read a field into memory with bounded output and no shell expansion. CLI output is never attached to errors.
   * @param uri - validated field URI.
   * @returns the nonempty field value, unchanged.
   * @throws {Error} when the CLI fails, exceeds a bound, or returns an empty or unresolved field.
   */
  read(uri: string): Promise<string> {
    const env: NodeJS.ProcessEnv = {}
    // Only the privileged reader receives 1Password authentication. Provider keys are never inherited.
    for (const [name, value] of Object.entries(process.env)) {
      if (/^(PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|TEMP|TMP)$/i.test(name) || /^OP_/i.test(name)) {
        env[name] = value
      }
    }
    const [executable, ...prefix] = this.command
    if (executable === undefined) return Promise.reject(new Error('1Password command is unavailable'))
    return new Promise((resolve, reject) => {
      execFile(executable, [...prefix, 'read', uri, '--no-newline'], {
        encoding: 'utf8', env, timeout: this.timeoutMs, maxBuffer: 65536, windowsHide: true,
      }, (error, stdout) => {
        if (error !== null || stdout.length === 0 || stdout.startsWith('op://')) {
          reject(new Error('1Password field read failed; check CLI installation, authorization, and field access'))
          return
        }
        resolve(stdout)
      })
    })
  }
}
