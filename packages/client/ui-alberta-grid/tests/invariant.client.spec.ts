import { describe, expect, it } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import * as GridInvariant from '../src/invariant.ts'
import InvariantRegistry from '@workspacealberta/wa-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(GridInvariant).await()).resolves.toBeDefined()
    expect(GridInvariant.name).toBe('client-ui-alberta-grid-invariant')
    expect(GridInvariant.inject).toEqual(['invariants'])
  })
})
