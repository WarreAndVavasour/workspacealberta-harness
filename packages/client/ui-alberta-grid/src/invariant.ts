/**
 * Package-owned invariant companion for `@workspacealberta/ui-alberta-grid`.
 * @module @workspacealberta/ui-alberta-grid/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@workspacealberta/cordis'
import type { InvariantInstaller } from '@workspacealberta/wa-invariants'

const PACKAGE_NAME = '@workspacealberta/ui-alberta-grid'

/** Cordis companion plugin name. */
export const name = 'client-ui-alberta-grid-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: pure-consumer conversation view plugin.
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
