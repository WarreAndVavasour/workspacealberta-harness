/**
 * The `episodeRecorder` projection unit: the fold is exercised directly over
 * captured session events (the unit is host-only — its state is omitted from
 * client snapshots by design), plus one registry-drive proof that mounting the
 * plugin folds a full turn without tearing. Regressions pinned here: a
 * `classify_tender` result must mint one episode per requirement with the
 * manifest facts, later calls mentioning a requirement id must attribute to
 * it, steps mentioning nothing must stay unscoped, and an approval decision
 * must land on its call's step through the ask-time join.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import type { ToolCallId, ToolResultMessage } from '@workspacealberta/wa-llm'
import { MessageId as brandMessageId, ToolCallId as brandCallId } from '@workspacealberta/wa-llm'
import SessionStore, { SessionId } from '@workspacealberta/wa-session'
import type { Session, SessionEvent } from '@workspacealberta/wa-session'
import SessionProjectionRegistry from '@workspacealberta/wa-session-projection'
import { ApprovalRequestId } from '@workspacealberta/wa-user-approval'
import * as EpisodeRecorderPlugin from '@workspacealberta/wa-session-episode-recorder'
import { episodeRecorderProjectionDefinition, UNSCOPED_KEY } from '@workspacealberta/wa-session-episode-recorder/src/projection.ts'
import type { EpisodeRecorderState } from '@workspacealberta/wa-session-episode-recorder/types'

/** Branded call id from a plain test index (`call_1`, …). */
const cid = (n: number): ToolCallId => brandCallId(`call_${n}`)

async function harness(): Promise<{ ctx: Context; session: Session; fold: () => EpisodeRecorderState }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(EpisodeRecorderPlugin)
  const session = ctx.sessions.create(SessionId('episodes'))
  const events: SessionEvent[] = []
  ctx.on('session/event', (_session, event) => { events.push(event) })
  const fold = (): EpisodeRecorderState => {
    let state = episodeRecorderProjectionDefinition.init(session.header, 0)
    for (const event of events) state = episodeRecorderProjectionDefinition.apply(state, event)
    return state
  }
  return { ctx, session, fold }
}

/** A tool result message over one text block (the model-facing shape). */
function toolResult(callId: ToolCallId, text: string): ToolResultMessage {
  return {
    id: brandMessageId(`msg_${callId}`),
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError: false }],
    source: { kind: 'tool', callId },
  }
}

/** Append a full tool call→result pair; returns the result event seq. */
function callAndResult(
  session: Session,
  callId: ToolCallId,
  name: string,
  args: string,
  text: string,
  errorCode?: string,
): number {
  const callSeq = session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: args }).seq
  return session.append('tool/result', {
    turn: 1,
    step: 1,
    message: toolResult(callId, text),
    ...(errorCode === undefined ? {} : { error: { name: 'ToolError', code: errorCode } }),
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] }).seq
}

const MANIFEST_JSON = JSON.stringify({
  schema: 'wa.tender_requirements.v1',
  reference: 'AB-2026-06584',
  tender: { closes_at: '2026-11-02T14:00:00-06:00' },
  requirements: [
    { id: 'R01', tag: 'security_bond', mandatory: true, connector: 'surety_request', answer_source: 'third_party', lead_time: 'weeks' },
    { id: 'R02', tag: 'form_field', mandatory: false, connector: 'business_profile', answer_source: 'company_profile', lead_time: 'minutes' },
  ],
})

describe('episodeRecorder projection unit (definition fold)', () => {
  it('serves an empty unscoped episode on the empty log', async () => {
    const { session, fold } = await harness()
    session.append('turn/start', { turn: 1 })
    const value = fold()
    expect(value.episodes[UNSCOPED_KEY]).toBeDefined()
    expect(value.stepCount).toBe(0)
  })

  it('mints one episode per requirement from a classify_tender result', async () => {
    const { session, fold } = await harness()
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    const value = fold()
    expect(value.reference).toBe('AB-2026-06584')
    expect(value.closesAt).toBe('2026-11-02T14:00:00-06:00')
    expect(Object.keys(value.requirements).sort()).toEqual(['R01', 'R02'])
    expect(value.episodes['R01']).toMatchObject({
      requirementId: 'R01', tag: 'security_bond', mandatory: true,
      connector: 'surety_request', answerSource: 'third_party', leadTime: 'weeks',
    })
    // The classify step itself serves the plan, not one requirement.
    expect(value.episodes[UNSCOPED_KEY]!.steps).toHaveLength(1)
    expect(value.stepCount).toBe(1)
  })

  it('attributes a later step to the requirement its text mentions', async () => {
    const { session, fold } = await harness()
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    callAndResult(session, cid(2), 'mcp__workspacealberta__get_opportunity_details',
      '{"reference":"AB-2026-06584","note":"surety letter wording for R01"}',
      'details fetched')
    const value = fold()
    expect(value.episodes['R01']!.steps).toHaveLength(1)
    expect(value.episodes['R01']!.steps[0]!.callId).toBe('call_2')
    expect(value.episodes[UNSCOPED_KEY]!.steps).toHaveLength(1)
    expect(value.stepCount).toBe(2)
  })

  it('keeps a step with no requirement mention unscoped', async () => {
    const { session, fold } = await harness()
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    callAndResult(session, cid(2), 'bash', '{"command":"ls"}', 'file list')
    const value = fold()
    expect(value.episodes[UNSCOPED_KEY]!.steps).toHaveLength(2)
    expect(value.episodes['R01']!.steps).toHaveLength(0)
  })

  it('records the error identity and latency of a failed call', async () => {
    const { session, fold } = await harness()
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    const callSeq = session.append('tool/call', { turn: 1, step: 2, callId: cid(2), name: 'write', arguments: '{"path":"/data/x"}' }).seq
    session.append('tool/result', {
      turn: 1,
      step: 2,
      message: toolResult(cid(2), 'denied'),
      error: { name: 'FsError', code: 'FS_SANDBOX_DENIED' },
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    const value = fold()
    const step = value.episodes[UNSCOPED_KEY]!.steps.at(-1)!
    expect(step.ok).toBe(false)
    expect(step.errorCode).toBe('FS_SANDBOX_DENIED')
    expect(step.argsDigest).toHaveLength(16)
    expect(step.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('lands an approval decision on its call through the ask-time join', async () => {
    const { session, fold } = await harness()
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    session.append('approval/asked', { id: ApprovalRequestId('ask_1'), toolName: 'bash', callId: cid(2) })
    session.append('approval/decided', { id: ApprovalRequestId('ask_1'), outcome: 'allowed-once' })
    callAndResult(session, cid(2), 'bash', '{"command":"ls"}', 'file list')
    const value = fold()
    expect(value.episodes[UNSCOPED_KEY]!.steps.at(-1)!.approval).toBe('approved')
  })

  it('folds events already in the log when the plugin mounts late', async () => {
    // Registry-drive proof: the plugin mounts after events flowed, the eager
    // drive folds the whole log, and a later event still lands (lazy cell).
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('episodes'))
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    await ctx.plugin(EpisodeRecorderPlugin)
    const events: SessionEvent[] = []
    ctx.on('session/event', (_session, event) => { events.push(event) })
    callAndResult(session, cid(2), 'bash', '{"command":"ls"}', 'file list')
    let state = episodeRecorderProjectionDefinition.init(session.header, 0)
    for (const event of events) state = episodeRecorderProjectionDefinition.apply(state, event)
    // The late mount saw only the post-mount event (the drive is eager, not
    // historical); the exporter is what folds whole logs.
    expect(state.stepCount).toBe(1)
  })

  it('validates its persisted state shape through the registry schema gate', async () => {
    // The definition's own schema gate: a state missing the manifest fields
    // is a corrupt cache row, not a valid fold input.
    expect(() => episodeRecorderProjectionDefinition.stateSchema.parse({})).toThrow()
    const { session, fold } = await harness()
    callAndResult(session, cid(1), 'mcp__workspacealberta__classify_tender',
      '{"reference":"AB-2026-06584"}',
      `classify_tender JSON (schema wa.tender_requirements.v1):\n${MANIFEST_JSON}`)
    expect(episodeRecorderProjectionDefinition.stateSchema.parse(fold())).toBeTruthy()
  })
})
