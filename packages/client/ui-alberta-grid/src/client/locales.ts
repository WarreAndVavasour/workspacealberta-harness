/** `alberta-grid` namespace dictionaries (view tab label + HUD strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'alberta-grid'

/** The alberta-grid dictionary key set. */
export type AlbertaGridKey =
  | 'view.grid'
  | 'hud.title'
  | 'hud.version'
  | 'hud.loading'
  | 'hud.error'
  | 'hud.ail'
  | 'hud.price'
  | 'hud.refresh'
  | 'hud.fallback'
  | 'hud.solarNote'
  | 'hud.pollLive'
  | 'hud.pollStale'
  | 'hud.pollError'
  | 'hud.generation'
  | 'hud.intertie'
  | 'hud.import'
  | 'hud.export'
  | 'hud.orbitHint'
  | 'hud.orbitTitle'

declare module '@workspacealberta/wa-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Alberta Grid view tab + HUD copy. */
    'alberta-grid': AlbertaGridKey
  }
}

/** Simplified Chinese dictionary. */
export const zh: Record<AlbertaGridKey, string> = {
  'view.grid': '电网',
  'hud.title': 'Alberta Grid',
  'hud.version': 'v2 / Wilke',
  'hud.loading': '加载中…',
  'hud.error': '数据不可用',
  'hud.ail': 'AIL',
  'hud.price': '池价格',
  'hud.refresh': '刷新',
  'hud.fallback': '2D 模式（WebGL 有限或 ?lite）',
  'hud.solarNote': 'Solar：AESO 可见（>5 MW）',
  'hud.pollLive': 'Live AESO feed',
  'hud.pollStale': 'AESO 数据源陈旧',
  'hud.pollError': 'AESO 数据源不可达',
  'hud.generation': '发电（MW 与占 AIL 百分比，柱从 0 起）',
  'hud.intertie': '联络线（BC / Montana，从 0 起的有符号 MW）',
  'hud.import': '进口',
  'hud.export': '出口',
  'hud.orbitHint': '拖动轨道旋转 — 次要隐喻；比较请读柱形图',
  'hud.orbitTitle': '负荷容器（次要）',
}

/** English dictionary. */
export const en: Record<AlbertaGridKey, string> = {
  'view.grid': 'Grid',
  'hud.title': 'Alberta Grid',
  'hud.version': 'v2 / Wilke',
  'hud.loading': 'Loading…',
  'hud.error': 'Data unavailable',
  'hud.ail': 'AIL',
  'hud.price': 'Pool price',
  'hud.refresh': 'Refresh',
  'hud.fallback': '2D mode (modest WebGL or ?lite)',
  'hud.solarNote': 'Solar: AESO-visible (>5 MW)',
  'hud.pollLive': 'Live AESO feed',
  'hud.pollStale': 'AESO feed stale',
  'hud.pollError': 'AESO feed unreachable',
  'hud.generation': 'Generation (MW and % of AIL, bars from 0)',
  'hud.intertie': 'Intertie (BC / Montana, signed MW from 0)',
  'hud.import': 'Import',
  'hud.export': 'Export',
  'hud.orbitHint': 'Drag to orbit — secondary metaphor; read the bars for comparisons',
  'hud.orbitTitle': 'Load vessel (secondary)',
}
