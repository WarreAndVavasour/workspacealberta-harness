/** Relate durable router decisions and results to their initiating Jev requests. @module */
import type { Context } from '@workspacealberta/cordis'
import type { InvariantFailure, InvariantInstaller } from '@workspacealberta/wa-invariants'
import type { Session, SessionEvent } from '@workspacealberta/wa-session'
import './types.ts'

/** Companion Loader name. */
export const name = 'workspace-router-invariant'
/** Registry required for package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'workspace/route') return
    const prior = session.snapshotEvents().filter(item => item.type === 'workspace/route'
      && item.data.callId === event.data.callId)
    const expected = ['request', 'decision', 'result'][prior.length]
    if (event.data.phase !== expected) fail(`workspace route ${event.data.callId}: expected ${String(expected)}, got ${event.data.phase}`)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the request-before-decision-before-result invariant.
 * @param ctx - context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@workspacealberta/wa-workspace-router', install))
