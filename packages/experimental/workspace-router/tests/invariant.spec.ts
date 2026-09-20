import { Context } from '@workspacealberta/cordis'
import InvariantRegistry from '@workspacealberta/wa-invariants'
import SessionStore, { SessionId } from '@workspacealberta/wa-session'
import { CallId } from '@workspacealberta/wa-llm'
import { expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'

it('rejects decisions without requests and duplicate phases in the authoritative session stream', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(invariant)
    const session = ctx.sessions.create(SessionId('order'))
    const event = { callId: CallId('route'), value: null }
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('workspace/route', { ...event, phase: 'decision' })).toThrow('expected request')
    session.append('workspace/route', { ...event, phase: 'request' })
    session.append('workspace/route', { ...event, callId: CallId('other'), phase: 'request' })
    expect(() => session.append('workspace/route', { ...event, phase: 'request' })).toThrow('expected decision')
    session.append('workspace/route', { ...event, phase: 'decision' })
    session.append('workspace/route', { ...event, phase: 'result' })
    expect(() => session.append('workspace/route', { ...event, phase: 'result' })).toThrow('expected undefined')
  } finally { await ctx.fiber.dispose() }
})
