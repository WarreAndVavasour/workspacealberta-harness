/** Alberta Grid v2 conversation view: Wilke-honest 2D encodings plus optional orbit. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ConvViewProps } from '@workspacealberta/wa-client-ui-conversation/client'
import type { PropsLocale } from '@workspacealberta/wa-client-ui-slots'
import { fetchGrid, type GridSnapshot } from './aeso.ts'
import {
  POLL_MS,
  PRICE_SCALE_MAX,
  formatMw,
  formatPctOfLoad,
  formatPrice,
  fuelBarSpecs,
  intertieBarSpecs,
  orbitMode,
  orbitNoteKey,
  pollStatus,
  preferLiteScene,
  priceColor,
  priceMarker,
  tooltipOffset,
  type FuelBarSpec,
  type IntertieBarSpec,
  type PollStatus,
} from './encodings.ts'
import { createGridScene, type HoverInfo, type SceneHandle } from './scene.ts'
import type {} from './locales.ts'
import css from './AlbertaGridView.module.css'

/** Conversation-view runtime share plus the alberta-grid locale seat. */
export type AlbertaGridViewProps = ConvViewProps & PropsLocale<'alberta-grid'>

const POLL_COPY: Record<PollStatus, 'hud.loading' | 'hud.pollLive' | 'hud.pollStale' | 'hud.pollError'> = {
  loading: 'hud.loading',
  live: 'hud.pollLive',
  stale: 'hud.pollStale',
  error: 'hud.pollError',
}

/**
 * Full-height Grid tab: aligned 2D bars are always the primary encoding.
 * @param props - conversation view runtime share plus the alberta-grid locale seat.
 * @returns the Grid tab tree.
 */
export function AlbertaGridView(props: AlbertaGridViewProps): ReactElement {
  const { t } = props
  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const [snapshot, setSnapshot] = useState<GridSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [orbit, setOrbit] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const next = await fetchGrid()
      setSnapshot(next)
      setError(null)
      sceneRef.current?.setSnapshot(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    /* v8 ignore next -- interval reuses load(); mount and Refresh cover the fetch */
    const id = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(id) }
  }, [load])

  useEffect(() => {
    /* v8 ignore next -- clock tick only ages pollStatus; encodings tests pin that */
    const id = window.setInterval(() => { setNow(Date.now()) }, 5_000)
    return () => { window.clearInterval(id) }
  }, [])

  useEffect(() => {
    const host = stageRef.current
    /* v8 ignore next -- the stage node is committed before this effect runs */
    if (!host) return
    const scene = createGridScene(host, { lite: preferLiteScene() })
    sceneRef.current = scene
    setOrbit(scene !== null)
    /* v8 ignore start -- WebGL scene handle is null in jsdom; 2D bars remain the primary encoding. */
    if (scene) {
      scene.onHover(setHover)
      scene.setSnapshot(snapshot)
      const onResize = (): void => { scene.resize() }
      const ro = new ResizeObserver(onResize)
      ro.observe(host)
      window.addEventListener('resize', onResize)
      return () => {
        ro.disconnect()
        window.removeEventListener('resize', onResize)
        scene.dispose()
        sceneRef.current = null
      }
    }
    /* v8 ignore stop */
    return () => {
      sceneRef.current = null
    }
    // Mount once per host lifetime; snapshot updates flow through setSnapshot.
  }, [])

  useEffect(() => {
    sceneRef.current?.setSnapshot(snapshot)
  }, [snapshot])

  const fuels = useMemo(
    () => fuelBarSpecs(snapshot?.csd.fuels ?? [], snapshot?.csd.ail ?? 0),
    [snapshot],
  )
  const interties = useMemo(
    () => intertieBarSpecs(snapshot?.csd.interties ?? []),
    [snapshot],
  )
  const status = pollStatus({
    fetchedAt: snapshot?.fetchedAt ?? null,
    now,
    error,
    loading,
  })
  const price = snapshot?.price?.price ?? null
  const priceCss = price === null ? undefined : priceColor(price)
  const marker = price === null ? 0 : priceMarker(price)

  const showTip = (info: HoverInfo | null): void => { setHover(info) }

  return (
    <div className={css.root} data-view="alberta-grid" data-encoding="wilke-v2" data-poll={status}>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <h2 className={css.title}>{t('hud.title')}</h2>
          <span className={css.version}>{t('hud.version')}</span>
          <p className={`${css.poll} ${status === 'live' ? css.pollLive : css.pollWarn}`}>
            {t(POLL_COPY[status])}
          </p>
          {error !== null && <p className={css.error}>{t('hud.error')}: {error}</p>}
        </div>
        <div className={css.actions}>
          <button type="button" className={css.button} onClick={() => { void load() }}>
            {t('hud.refresh')}
          </button>
        </div>
      </header>

      <section className={css.metrics}>
        <div className={css.card}>
          <span className={css.metricLabel}>{t('hud.ail')}</span>
          <p className={css.ailValue} data-metric="ail">
            {snapshot ? formatMw(snapshot.csd.ail) : '—'}
          </p>
        </div>
        <div className={css.card}>
          <span className={css.metricLabel}>{t('hud.price')}</span>
          <p className={css.priceValue} data-metric="price" style={priceCss ? { color: priceCss } : undefined}>
            {price === null ? '—' : formatPrice(price)}
          </p>
          {price !== null && (
            <div className={css.scale} aria-hidden="true">
              <span className={css.marker} style={{ left: `${marker * 100}%` }} />
            </div>
          )}
          {price !== null && (
            <div className={css.scaleLabels}>
              <span>$0</span>
              <span>$40</span>
              <span>$100</span>
              <span>${PRICE_SCALE_MAX}+</span>
            </div>
          )}
        </div>
      </section>

      <section className={css.section} aria-label={t('hud.generation')}>
        <h3 className={css.sectionTitle}>{t('hud.generation')}</h3>
        {fuels.map(bar => (
          <FuelRow
            key={bar.id}
            bar={bar}
            selected={selected === bar.id}
            onSelect={setSelected}
            onHover={showTip}
          />
        ))}
        <div className={css.legend}>
          {fuels.map(row => (
            <span key={row.id} className={css.swatch}>
              <i style={{ background: row.color }} />
              {row.label}
            </span>
          ))}
        </div>
        <p className={css.note}>{t('hud.solarNote')}</p>
      </section>

      <section className={css.section} aria-label={t('hud.intertie')}>
        <h3 className={css.sectionTitle}>{t('hud.intertie')}</h3>
        <div className={css.axis}>
          <span>{t('hud.import')}</span>
          <span>0</span>
          <span>{t('hud.export')}</span>
        </div>
        {interties.map(bar => (
          <IntertieRow
            key={bar.id}
            bar={bar}
            selected={selected === bar.id}
            onSelect={setSelected}
            onHover={showTip}
          />
        ))}
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('hud.orbitTitle')}</h3>
        <p className={css.note}>{t(orbitNoteKey(orbit))}</p>
        <div className={css.orbit}>
          <div className={css.stage} ref={stageRef} data-orbit={orbitMode(orbit)} />
        </div>
      </section>

      {hover !== null && (
        <div className={css.tooltip} style={{ left: hover.x, top: hover.y }}>
          <div><strong>{hover.label}</strong></div>
          <div>{formatMw(hover.mw)}</div>
          {hover.pctOfLoad !== null && <div>{formatPctOfLoad(hover.pctOfLoad)}</div>}
        </div>
      )}
    </div>
  )
}

function FuelRow(props: {
  readonly bar: FuelBarSpec
  readonly selected: boolean
  readonly onSelect: (id: string) => void
  readonly onHover: (info: HoverInfo | null) => void
}): ReactElement {
  const { bar, selected, onSelect, onHover } = props
  const label = bar.note ? `${bar.label} (${bar.note})` : bar.label
  const emit = (el: HTMLElement): void => {
    const { x, y } = tooltipOffset(el, el.closest('[data-view="alberta-grid"]'))
    onHover({ id: bar.id, label, mw: bar.mw, pctOfLoad: bar.pctOfLoad, x, y })
  }
  return (
    <button
      type="button"
      className={css.fuelRow}
      data-fuel={bar.id}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => { onSelect(bar.id) }}
      onMouseEnter={(ev) => { emit(ev.currentTarget) }}
      onFocus={(ev) => { emit(ev.currentTarget) }}
      onMouseLeave={() => { onHover(null) }}
      onBlur={() => { onHover(null) }}
    >
      <span className={css.fuelName}>{bar.label}</span>
      <span className={css.track}>
        <span className={css.fill} style={{ width: `${bar.length * 100}%`, background: bar.color }} />
      </span>
      <span className={css.fuelNums}>
        {formatMw(bar.mw)}
        {bar.pctOfLoad !== null ? ` · ${formatPctOfLoad(bar.pctOfLoad)}` : ''}
      </span>
    </button>
  )
}

function IntertieRow(props: {
  readonly bar: IntertieBarSpec
  readonly selected: boolean
  readonly onSelect: (id: string) => void
  readonly onHover: (info: HoverInfo | null) => void
}): ReactElement {
  const { bar, selected, onSelect, onHover } = props
  const emit = (el: HTMLElement): void => {
    const { x, y } = tooltipOffset(el, el.closest('[data-view="alberta-grid"]'))
    onHover({ id: bar.id, label: bar.label, mw: Math.abs(bar.mw), pctOfLoad: null, x, y })
  }
  const width = `${(bar.length / 2) * 100}%`
  const style = bar.side === 'export'
    ? { left: '50%', width }
    : bar.side === 'import'
      ? { right: '50%', width }
      : { left: '50%', width: '0%' }
  const fillClass = bar.side === 'import' ? css.importFill : css.exportFill
  return (
    <button
      type="button"
      className={css.intertieRow}
      data-intertie={bar.id}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => { onSelect(bar.id) }}
      onMouseEnter={(ev) => { emit(ev.currentTarget) }}
      onFocus={(ev) => { emit(ev.currentTarget) }}
      onMouseLeave={() => { onHover(null) }}
      onBlur={() => { onHover(null) }}
    >
      <span className={css.intertieName}>{bar.label}</span>
      <span className={css.signedTrack}>
        <span className={css.zero} />
        <span className={`${css.signedFill} ${fillClass}`} style={style} />
      </span>
      <span className={css.intertieNums}>{formatMw(bar.mw)}</span>
    </button>
  )
}
