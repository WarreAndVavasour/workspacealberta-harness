import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import InvariantRegistry from '@workspacealberta/wa-invariants'
import * as ProcurementInvariant from '@workspacealberta/wa-procurement-base/invariant'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('procurement invariant companion', () => {
  it('registers package ownership with no durable state to check', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ProcurementInvariant).then(() => undefined)).resolves.toBeUndefined()
  })
})
