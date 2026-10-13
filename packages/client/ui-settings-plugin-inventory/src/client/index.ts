/** Read-only Host plugin inventory registered into Web Settings. */

import type {} from '@workspacealberta/wa-client-locale/client'
import type { Context as ClientContext } from '@workspacealberta/cordis'
import type {} from '@workspacealberta/wa-client-ui-settings/client'
import type {} from '@workspacealberta/wa-client-ui-renderer/client'
// Type-only: pulls the 'settings.agentPreset' LocaleNamespaceMap merge, whose
// dictionaries the shipped-preset name resolution below reads.
import type {} from '@workspacealberta/wa-client-ui-agent-preset/client'
// Inline-safe shared fold: shipped ids map to dictionary keys in one home.
import { presetDisplayText } from '@workspacealberta/wa-agent-presets/display'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'
import { ConnectionsSettings, type ConnectionsOperations } from './ConnectionsSettings.tsx'
import { connectionEn, connectionZh, type ConnectionLocaleKey } from './connections-locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@workspacealberta/wa-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
    'settings.connections': ConnectionLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.mcpConnections']

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.connections', { en: connectionEn, zh: connectionZh }), 'mcp-connections: dictionaries')
  const connectionCopy = ctx.locale.bind('settings.connections')
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const operations: ConnectionsOperations = {
    list: async () => unwrap(await ctx.remote.mcpConnections.list()),
    save: async (value) => { unwrap(await ctx.remote.mcpConnections.save(value)) },
    remove: async (id) => { unwrap(await ctx.remote.mcpConnections.remove(id)) },
    reconnect: async (id) => { unwrap(await ctx.remote.mcpConnections.reconnect(id)) },
    disconnect: async (id) => { unwrap(await ctx.remote.mcpConnections.disconnect(id)) },
    signIn: async value => unwrap(await ctx.remote.mcpConnections.signIn(value)),
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'connections', order: 35,
    label: () => connectionCopy('title'), locale: 'settings.connections',
    inject: () => ({ operations }),
  }, ConnectionsSettings))
  const callback = new URL(window.location.href)
  if (callback.searchParams.has('mcp_oauth_callback')) {
    const value = { state: callback.searchParams.get('state') ?? '', code: callback.searchParams.get('code') ?? '', error: callback.searchParams.get('error') ?? '' }
    for (const key of ['mcp_oauth_callback', 'state', 'code', 'error', 'error_description']) callback.searchParams.delete(key)
    window.history.replaceState(null, '', callback.href)
    ctx.effect(() => {
      let active = true
      void ctx.remote.mcpConnections.completeAuthorization(value).then((result) => {
        if (active) window.alert(connectionCopy(result.ok ? 'signedIn' : 'callbackFailed'))
      }, () => { if (active) window.alert(connectionCopy('callbackFailed')) })
      return () => { active = false }
    }, 'mcp-connections.oauth-callback')
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  // Resolved per call over ui-agent-preset's dictionaries, so a language
  // switch re-resolves shipped names; user-authored metadata passes through.
  const agentPresetCopy = ctx.locale.bind('settings.agentPreset')
  const presetName: PluginInventorySettingsTabInjected['presetName'] = preset =>
    presetDisplayText(preset, agentPresetCopy).name
  const injected = (): PluginInventorySettingsTabInjected => ({ list, presetName })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
}
