/**
 * Fold one or more DSH session logs into `wa.episode.v1` JSONL trajectories.
 *
 * Usage:
 *   pnpm tsx scripts/export-episodes.ts <session.jsonl[.zstd]> [--out FILE] [--redact]
 *
 * The fold is the SAME pure projection the desk runs live
 * (`session-episode-recorder/src/projection.ts`), so exported episodes match
 * what the host records. Redaction (--redact) replaces tool `args` with null
 * (the args digest stays) — ship that variant anywhere outside the business's
 * machine.
 *
 * Outcome labels (the board checklist) are a separate stream; until board-label
 * sync lands, episodes export with `outcome.status: "open"`.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { SessionId } from '@workspacealberta/wa-session'
import { episodeRecorderProjectionDefinition, UNSCOPED_KEY } from '../packages/session/session-episode-recorder/src/projection.ts'

const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const outPath = outIdx >= 0 ? argv[outIdx + 1] : undefined
const redact = argv.includes('--redact')
const inputs = argv.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1))
if (inputs.length === 0) {
  console.error('usage: pnpm tsx scripts/export-episodes.ts <session.jsonl[.zstd]> [--out FILE] [--redact]')
  process.exit(1)
}

/** Decode a session log (zstd-compressed or plain) into event lines. */
async function* decode(file: string): AsyncGenerator<string> {
  if (!file.endsWith('.zstd')) {
    const { readFile } = await import('node:fs/promises')
    for (const line of (await readFile(file, 'utf8')).split('\n')) yield line
    return
  }
  const child = spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] })
  const rl = createInterface({ input: child.stdout })
  for await (const line of rl) yield line
}

function stepOut(step: Record<string, unknown>): Record<string, unknown> {
  return redact ? { ...step, args: null, argsRedacted: true } : step
}

async function main(): Promise<void> {
  const sink = outPath === undefined
    ? process.stdout
    : createWriteStream(outPath, { flags: 'w' })
  let episodes = 0
  for (const file of inputs) {
    const sessionFile = resolve(file)
    let state = episodeRecorderProjectionDefinition.init(
      { version: 0, id: SessionId(`export-${Buffer.from(sessionFile).toString('base64url').slice(0, 12)}`), createdAt: 0, cwd: '', isSeeded: false }, 0,
    )
    for await (const line of decode(sessionFile)) {
      if (line.trim() === '') continue
      let event: unknown
      try { event = JSON.parse(line) } catch { continue }
      if (typeof event !== 'object' || event === null) continue
      const e = event as { type?: unknown; seq?: unknown }
      if (typeof e.type !== 'string' || typeof e.seq !== 'number') continue
      state = episodeRecorderProjectionDefinition.apply(state, event as never)
    }
    const sessionHash = Buffer.from(sessionFile).toString('base64url').slice(0, 12)
    for (const [key, episode] of Object.entries(state.episodes)) {
      if (episode.steps.length === 0) continue
      const record = {
        schema: 'wa.episode.v1',
        episode_id: `${state.reference ?? 'unreferenced'}:${key}`,
        export_source: { session_file: sessionFile, session_hash: sessionHash },
        rfp: { reference: state.reference, closes_at: state.closesAt },
        requirement: {
          id: episode.requirementId,
          tag: episode.tag,
          mandatory: episode.mandatory,
          connector: episode.connector,
          answer_source: episode.answerSource,
          lead_time: episode.leadTime,
        },
        steps: episode.steps.map(step => stepOut(step as unknown as Record<string, unknown>)),
        outcome: { status: 'open' },
      }
      episodes += 1
      sink.write(`${JSON.stringify(record)}\n`)
    }
    void UNSCOPED_KEY
  }
  if (sink !== process.stdout) sink.end()
  else process.stdout.write('')
  console.error(`exported ${episodes} episode(s)${redact ? ' (args redacted)' : ''}`)
}

void main()
