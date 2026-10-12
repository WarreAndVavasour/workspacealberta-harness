/**
 * The `episodeRecorder` projection unit: a pure fold of tool call→result
 * pairs, approval decisions, and `classify_tender` manifests into
 * per-requirement episode trajectories (`wa.episode.v1` shape, minus the
 * human outcome labels — those land through board-label sync, never through
 * the model).
 *
 * Attribution contract (v1): a completed step is attributed to every
 * requirement id its tool name, arguments or result text mentions (word-boundary
 * `R\d+` against the sniffed manifest catalog); steps that mention none land in
 * the `unscoped` bucket. The unit is deterministic and side-effect free — the
 * exporter (scripts/export-episodes) folds the same definition offline over a
 * session log and writes the training JSONL.
 *
 * Approval join: `approval/asked` carries the callId, `approval/decided` only
 * the ask's id — so the fold keeps `openApprovals` (id → callId) and lands the
 * outcome on the step through its callId.
 *
 * @module @workspacealberta/wa-session-episode-recorder/projection
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SessionEvent, SessionHeader } from '@workspacealberta/wa-session'
// Brings the `approval/asked` + `approval/decided` SessionEventMap augmentation
// into this compilation — without it the two cases narrow to `never`.
import '@workspacealberta/wa-user-approval'
import type { ProjectionDefinition } from '@workspacealberta/wa-session-projection'
import type { EpisodeRecord, EpisodeRecorderState, EpisodeStep } from './types.ts'

/** The classify_tender result schema this unit keys episodes off. */
const TENDER_REQUIREMENTS_SCHEMA = 'wa.tender_requirements.v1'

/** Requirement-id shape the classifier mints (`R01`, `R12`, …). */
const REQUIREMENT_ID = /\bR\d{1,3}\b/

/** Cap on how many requirement ids a single step may attribute to. */
const MAX_ATTRIBUTION = 3

/** The unscoped bucket key — steps no requirement id claims. */
export const UNSCOPED_KEY = 'unscoped'

/** First 16 hex chars of SHA-256 over the raw arguments string. */
function argsDigest(args: string): string {
  return createHash('sha256').update(args).digest('hex').slice(0, 16)
}

/** Concatenated text of a result message's text blocks, descending into tool-result blocks. */
function resultText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: unknown; text?: unknown; content?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') text += b.text
    else if (b.type === 'tool-result') text += resultText(b) // nested result content
  }
  return text
}

/**
 * Balanced-brace scan for the first JSON object in `text` at or after `from`.
 * Returns the parsed value, or null when no parse succeeds. Tool text wraps
 * the artifact in prose ("classify_tender JSON (schema …):"), so a naive
 * `indexOf('{')` + `JSON.parse` on a suffix is not enough.
 */
function firstJsonObject(text: string, from = 0): unknown {
  for (let start = text.indexOf('{', from); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text.charAt(i)
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        }
        catch {
          break // this brace pair is not a whole object; try the next '{'
        }
      }
    }
  }
  return null
}

interface SniffedManifest {
  reference: string | null
  closesAt: string | null
  requirements: Record<string, {
    tag: string
    mandatory: boolean
    connector: string
    answerSource: string
    leadTime: string
  }>
}

/**
 * Lift the requirement manifest out of a `classify_tender` result text. The
 * result carries the artifact twice (markdown table + compact JSON block);
 * the JSON block is authoritative, the id scan is the fallback. Never throws:
 * a malformed result degrades to no manifest rather than poisoning the fold.
 */
function sniffManifest(text: string): SniffedManifest | null {
  const parsed = firstJsonObject(text)
  if (parsed === null || typeof parsed !== 'object') return null
  const artifact = parsed as {
    schema?: unknown
    reference?: unknown
    tender?: { closes_at?: unknown; closing?: unknown }
    requirements?: unknown
  }
  if (artifact.schema !== TENDER_REQUIREMENTS_SCHEMA) return null
  const requirements: SniffedManifest['requirements'] = {}
  if (Array.isArray(artifact.requirements)) {
    for (const req of artifact.requirements) {
      if (typeof req !== 'object' || req === null) continue
      const r = req as Record<string, unknown>
      const id = typeof r['id'] === 'string' ? r['id'] : null
      if (id === null || !REQUIREMENT_ID.test(id)) continue
      requirements[id] = {
        tag: typeof r['tag'] === 'string' ? r['tag'] : '',
        mandatory: r['mandatory'] === true,
        connector: typeof r['connector'] === 'string' ? r['connector'] : '',
        answerSource: typeof r['answer_source'] === 'string' ? r['answer_source'] : '',
        leadTime: typeof r['lead_time'] === 'string' ? r['lead_time'] : '',
      }
    }
  }
  const closes = artifact.tender?.closes_at ?? artifact.tender?.closing
  return {
    reference: typeof artifact.reference === 'string' ? artifact.reference : null,
    closesAt: typeof closes === 'string' ? closes : null,
    requirements,
  }
}

/** Requirement ids from the catalog mentioned in `texts` (catalog order, capped). */
function mentionedRequirements(catalog: Record<string, unknown>, ...texts: string[]): string[] {
  const haystack = texts.filter(t => t !== '').join('\n')
  if (haystack === '') return []
  return Object.keys(catalog)
    .filter(id => new RegExp(`\\b${id}\\b`).test(haystack))
    .slice(0, MAX_ATTRIBUTION)
}

function emptyEpisode(requirementId: string | null): EpisodeRecord {
  return {
    requirementId,
    tag: null,
    connector: null,
    answerSource: null,
    leadTime: null,
    mandatory: null,
    reference: null,
    closesAt: null,
    steps: [],
  }
}

const stepSchema = z.object({
  seq: z.number().int().nonnegative(),
  callId: z.string(),
  tool: z.string(),
  argsDigest: z.string(),
  args: z.string(),
  ok: z.boolean(),
  errorCode: z.string().nullable(),
  time: z.number().nonnegative(),
  latencyMs: z.number().nonnegative().nullable(),
  approval: z.enum(['auto', 'approved', 'denied', 'canceled', 'unavailable']),
})

const episodeSchema = z.object({
  requirementId: z.string().nullable(),
  tag: z.string().nullable(),
  connector: z.string().nullable(),
  answerSource: z.string().nullable(),
  leadTime: z.string().nullable(),
  mandatory: z.boolean().nullable(),
  reference: z.string().nullable(),
  closesAt: z.string().nullable(),
  steps: z.array(stepSchema),
})

const requirementInfoSchema = z.object({
  tag: z.string(),
  mandatory: z.boolean(),
  connector: z.string(),
  answerSource: z.string(),
  leadTime: z.string(),
})

const episodeRecorderStateSchema = z.object({
  reference: z.string().nullable(),
  closesAt: z.string().nullable(),
  requirements: z.record(z.string(), requirementInfoSchema),
  openCalls: z.record(z.string(), z.object({
    name: z.string(),
    args: z.string(),
    time: z.number().nonnegative(),
    seq: z.number().int().nonnegative(),
  })),
  openApprovals: z.record(z.string(), z.object({
    toolName: z.string(),
    callId: z.string().nullable(),
  })),
  pendingApprovals: z.record(z.string(), z.enum(['auto', 'approved', 'denied', 'canceled', 'unavailable'])),
  episodes: z.record(z.string(), episodeSchema),
  stepCount: z.number().int().nonnegative(),
})

/**
 * The `episodeRecorder` unit registered on `ctx.sessionProjections` (exported
 * for the unit spec and the offline exporter).
 */
export const episodeRecorderProjectionDefinition = {
  key: 'episodeRecorder',
  stateVersion: 1,
  stateSchema: episodeRecorderStateSchema,
  init: (_header: SessionHeader, _inheritedEventCount: number): EpisodeRecorderState => ({
    reference: null,
    closesAt: null,
    requirements: {},
    openCalls: {},
    openApprovals: {},
    pendingApprovals: {},
    episodes: { [UNSCOPED_KEY]: emptyEpisode(null) },
    stepCount: 0,
  }),
  apply: (state: EpisodeRecorderState, event: SessionEvent): EpisodeRecorderState => {
    switch (event.type) {
      case 'tool/call':
        return {
          ...state,
          openCalls: {
            ...state.openCalls,
            [event.data.callId]: { name: event.data.name, args: event.data.arguments, time: event.time, seq: event.seq },
          },
        }
      case 'tool/result': {
        // Own-key check: callId is provider-minted, so a result with no
        // recorded call reads as unmatched (same guard as session-stats).
        const callId = event.data.message.source.callId
        const open = Object.hasOwn(state.openCalls, callId) ? state.openCalls[callId] : undefined
        if (open === undefined) return state
        const openCalls = Object.fromEntries(
          Object.entries(state.openCalls).filter(([id]) => id !== callId),
        )
        const text = resultText(event.data.message)
        const step: EpisodeStep = {
          seq: event.seq,
          callId,
          tool: open.name,
          argsDigest: argsDigest(open.args),
          args: open.args,
          ok: event.data.error === undefined,
          errorCode: event.data.error?.code ?? null,
          time: event.time,
          latencyMs: Math.max(0, event.time - open.time),
          approval: state.pendingApprovals[callId] ?? 'auto',
        }
        const pendingApprovals = Object.fromEntries(
          Object.entries(state.pendingApprovals).filter(([id]) => id !== callId),
        )

        // A classify_tender result refreshes the RFP manifest and the
        // requirement catalog; the step itself stays unscoped (it serves the
        // plan, not one requirement).
        if (open.name.includes('classify_tender')) {
          const sniffed = sniffManifest(text)
          if (sniffed !== null) {
            const episodes: EpisodeRecorderState['episodes'] = {}
            for (const [id, info] of Object.entries(sniffed.requirements)) {
              episodes[id] = {
                ...emptyEpisode(id),
                tag: info.tag,
                connector: info.connector,
                answerSource: info.answerSource,
                leadTime: info.leadTime,
                mandatory: info.mandatory,
                reference: sniffed.reference,
                closesAt: sniffed.closesAt,
                steps: state.episodes[id]?.steps ?? [],
              }
            }
            const unscoped = state.episodes[UNSCOPED_KEY] ?? emptyEpisode(null)
            episodes[UNSCOPED_KEY] = {
              ...unscoped,
              reference: sniffed.reference,
              closesAt: sniffed.closesAt,
              steps: [...unscoped.steps, step],
            }
            return {
              ...state,
              reference: sniffed.reference ?? state.reference,
              closesAt: sniffed.closesAt ?? state.closesAt,
              requirements: sniffed.requirements,
              openCalls,
              pendingApprovals,
              episodes,
              stepCount: state.stepCount + 1,
            }
          }
        }

        const matched = mentionedRequirements(state.requirements, open.name, open.args, text)
        const episodes = { ...state.episodes }
        const keys = matched.length > 0 ? matched : [UNSCOPED_KEY]
        for (const key of keys) {
          const existing = episodes[key] ?? state.episodes[key]
            ?? emptyEpisode(key === UNSCOPED_KEY ? null : key)
          episodes[key] = { ...existing, steps: [...existing.steps, step] }
        }
        return { ...state, openCalls, pendingApprovals, episodes, stepCount: state.stepCount + 1 }
      }
      case 'approval/asked':
        // Ask-first audit: the ask carries the callId the decision will join on.
        if (event.data.callId === undefined) return state
        return {
          ...state,
          openApprovals: {
            ...state.openApprovals,
            [event.data.id]: { toolName: event.data.toolName, callId: event.data.callId },
          },
        }
      case 'approval/decided': {
        // The decision carries only the ask's id; land the outcome on the
        // call through the join recorded at ask time. Decisions for calls
        // that never ran (denied) drop out when nothing results.
        const open = state.openApprovals[event.data.id]
        if (open === undefined || open.callId === null) return state
        const openApprovals = Object.fromEntries(
          Object.entries(state.openApprovals).filter(([id]) => id !== event.data.id),
        )
        const outcome = event.data.outcome === 'allowed-once'
          ? 'approved'
          : event.data.outcome === 'rejected'
            ? 'denied'
            : event.data.outcome === 'cancelled'
              ? 'canceled'
              : 'unavailable'
        return { ...state, openApprovals, pendingApprovals: { ...state.pendingApprovals, [open.callId]: outcome } }
      }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'episodeRecorder'>
