/**
 * Browser Alberta Grid plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row must be in the program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotRegistry Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AlbertaGridView } from './AlbertaGridView.tsx'
import { en, NS, zh } from './locales.ts'

/** Required services: conversation view slot + locale. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the Grid view tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-alberta-grid: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'alberta-grid',
    order: 20,
    locale: NS,
    label: () => t('view.grid'),
  }, AlbertaGridView))
}
