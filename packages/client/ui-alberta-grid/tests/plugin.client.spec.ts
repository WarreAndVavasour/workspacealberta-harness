/**
 * Alberta Grid browser half: registers conversation.view id alberta-grid and
 * removes it on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { AlbertaGridView } from '../src/client/AlbertaGridView.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } } as never,
      () => null,
    )
  }
  return { ctx, slots }
}

describe('ui-alberta-grid apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers Grid, then removes it on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.view')[0]!
    expect(entry.options.id).toBe('alberta-grid')
    expect(entry.component).toBe(AlbertaGridView)
    expect(entry.locale).toBe(NS)
    const label = entry.options.label
    expect(typeof label === 'function' ? label() : label).toBe(en['view.grid'])
    await fiber.dispose()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
  })

  it('waits until conversation declares the view ring', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    b.slots.register(
      { name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } } as never,
      () => null,
    )
    await Promise.resolve()
    expect(b.slots.entries('conversation.view')).toHaveLength(1)
    await fiber.dispose()
  })

  it('ships complete en and zh dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(zh['view.grid']).toBe('电网')
  })
})
