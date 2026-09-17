// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@workspacealberta/wa-client-test-runtime'
import { CSD_URL, PRICE_URL } from '../src/client/aeso.ts'
import { AlbertaGridView } from '../src/client/AlbertaGridView.tsx'
import { en } from '../src/client/locales.ts'
import { CSD_FIXTURE, PRICE_EMPTY, PRICE_FIXTURE } from './fixtures.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = makeTranslate(en)

function renderView() {
  // @ts-expect-error test stub only needs locale t()
  return render(<AlbertaGridView t={t} />)
}

function stubFetch(handler: (url: string) => Response | Promise<Response> | never): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(handler(url))))
}

describe('AlbertaGridView', () => {
  it('renders Wilke-honest bars, AIL, price, and poll health without a CSD stamp', async () => {
    stubFetch(url => new Response(url === CSD_URL ? CSD_FIXTURE : PRICE_FIXTURE, { status: 200 }))
    renderView()
    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('Live AESO feed')).toBeTruthy()
    })
    const root = document.querySelector('[data-view="alberta-grid"]')!
    expect(root.getAttribute('data-encoding')).toBe('wilke-v2')
    expect(root.textContent).not.toContain('Last update')
    expect(root.textContent).not.toContain('Sep 02, 2026 08:05')
    expect(screen.getByText('v2 / Wilke')).toBeTruthy()
    expect(document.querySelector('[data-metric="ail"]')?.textContent).toBe('10,354 MW')
    expect(document.querySelector('[data-metric="price"]')?.textContent).toBe('$13.90/MWh')
    expect(screen.getByText(/290 MW/)).toBeTruthy()
    expect(screen.getByText(/2\.8% of AIL/)).toBeTruthy()
    expect(document.querySelector('[data-fuel="gas"]')?.textContent).toContain('Gas (cogen+CC+steam+SC)')
    expect(document.querySelector('[data-intertie="bc"]')?.textContent).toContain('68 MW')
    expect(document.querySelector('[data-intertie="montana"]')?.textContent).toContain('-19 MW')
    expect(document.querySelector('[data-orbit]')?.getAttribute('data-orbit')).toBe('off')
    expect(screen.getByText(/2D mode/)).toBeTruthy()
  })

  it('shows MW and % of AIL on hover and keeps a selected row', async () => {
    stubFetch(url => new Response(url === CSD_URL ? CSD_FIXTURE : PRICE_FIXTURE, { status: 200 }))
    renderView()
    const solar = await waitFor(() => document.querySelector('[data-fuel="solar"]') as HTMLButtonElement)
    fireEvent.mouseEnter(solar)
    expect(screen.getByText('Solar (AESO-visible (>5 MW))')).toBeTruthy()
    expect(document.querySelector('[class]') && screen.getAllByText(/2\.8% of AIL/).length).toBeGreaterThan(0)
    fireEvent.click(solar)
    expect(solar.getAttribute('data-selected')).toBe('true')
    fireEvent.mouseLeave(solar)
    fireEvent.focus(solar)
    fireEvent.blur(solar)

    const montana = document.querySelector('[data-intertie="montana"]') as HTMLButtonElement
    fireEvent.mouseEnter(montana)
    fireEvent.click(montana)
    expect(montana.getAttribute('data-selected')).toBe('true')
    fireEvent.mouseLeave(montana)
    fireEvent.focus(montana)
    fireEvent.blur(montana)
  })

  it('surfaces an Error and a non-Error fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    const first = renderView()
    await waitFor(() => {
      expect(screen.getByText(/network down/)).toBeTruthy()
    })
    expect(document.querySelector('[data-poll]')?.getAttribute('data-poll')).toBe('error')
    first.unmount()

    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- view String(err) path
        return Promise.reject('string-fail')
      }),
    )
    renderView()
    await waitFor(() => {
      expect(screen.getByText(/string-fail/)).toBeTruthy()
    })
  })

  it('keeps the numeric price empty when the price table has no number', async () => {
    stubFetch(url => new Response(url === CSD_URL ? CSD_FIXTURE : PRICE_EMPTY, { status: 200 }))
    renderView()
    await waitFor(() => {
      expect(document.querySelector('[data-metric="ail"]')?.textContent).toBe('10,354 MW')
    })
    expect(document.querySelector('[data-metric="price"]')?.textContent).toBe('—')
  })

  it('marks a live snapshot stale when a later poll fails', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      n += 1
      if (n > 2) throw new Error('later')
      return new Response(url === CSD_URL ? CSD_FIXTURE : PRICE_FIXTURE, { status: 200 })
    }))
    renderView()
    await waitFor(() => {
      expect(screen.getByText('Live AESO feed')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(screen.getByText('AESO feed stale')).toBeTruthy()
    })
    expect(document.querySelector('[data-metric="ail"]')?.textContent).toBe('10,354 MW')
  })

  it('refreshes on the toolbar button', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      new Response(url === PRICE_URL ? PRICE_FIXTURE : CSD_FIXTURE, { status: 200 }))
    vi.stubGlobal('fetch', fetchFn)
    renderView()
    await waitFor(() => {
      expect(screen.getByText('Live AESO feed')).toBeTruthy()
    })
    const before = fetchFn.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(fetchFn.mock.calls.length).toBeGreaterThan(before)
    })
  })
})
