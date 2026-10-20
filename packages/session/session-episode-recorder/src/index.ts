/**
 * Function plugin registering the `episodeRecorder` projection unit: folds
 * tool calls, results, approvals and `classify_tender` manifests into
 * per-requirement episode trajectories served through the session-projection
 * seam. The plugin owns only the fold; delivery is the seam's. Host-only —
 * no client view; consumers are the episode exporter and (later) board-label
 * sync.
 *
 * @module @workspacealberta/wa-session-episode-recorder
 */

import type { Context } from '@workspacealberta/cordis'
import { episodeRecorderProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-episode-recorder'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `episodeRecorder` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(episodeRecorderProjectionDefinition)
}
