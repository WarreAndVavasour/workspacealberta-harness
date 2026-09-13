/**
 * Package-owned invariant companion for `@workspacealberta/wa-procurement-base`.
 * @module @workspacealberta/wa-procurement-base/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@workspacealberta/cordis'
import type { InvariantInstaller } from '@workspacealberta/wa-invariants'

const PACKAGE_NAME = '@workspacealberta/wa-procurement-base'

/** Cordis companion plugin name. */
export const name = 'procurement-base-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package persists no session events and owns no mutable data relation
 * beyond the tool registry contract; batch outcomes are returned as tool values, and citation
 * validity is enforced at synthesis time before any value is produced.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
