import { describe, expect, it, vi } from 'vitest'
import { runBatch, RetryableError } from '../src/batch-manager.ts'
import { validateCitations } from '../src/citation-generator.ts'
import { prepareMedia } from '../src/multimodal-analyzer.ts'

const policy = { concurrency: 3, maxJobs: 200, maxRetries: 2, retryBaseMs: 1, retryMaxMs: 5 }

describe('bounded procurement queue', () => {
  it('settles all 125 fixture jobs with at most three active requests and isolated errors', async () => {
    let active = 0
    let peak = 0
    const events: Array<{ completed: number; active: number }> = []
    const jobs = Array.from({ length: 125 }, (_, id) => id)
    const results = await runBatch(jobs, policy, new AbortController().signal, async (job) => {
      active++
      peak = Math.max(peak, active)
      try {
        await new Promise(resolve => setTimeout(resolve, 1))
        if (job === 12) throw new Error('secret provider error must not leak')
        return job
      } finally { active-- }
    }, event => events.push(event))
    expect(results).toHaveLength(125)
    expect(results.filter(item => item.status === 'succeeded')).toHaveLength(124)
    expect(results[12]).toMatchObject({ status: 'failed', error: 'PROCESSING_FAILED' })
    expect(peak).toBe(3)
    expect(active).toBe(0)
    expect(events.at(-1)).toMatchObject({ completed: 125, active: 0 })
    expect(JSON.stringify(results)).not.toContain('secret')
  })

  it('caps retries, records retry progress, and never retries terminal failures', async () => {
    const work = vi.fn(async () => { throw new RetryableError(429, 100000) })
    const events: string[] = []
    const result = await runBatch([1], policy, new AbortController().signal, work, e => events.push(e.phase))
    expect(work).toHaveBeenCalledTimes(3)
    expect(result[0]).toMatchObject({ status: 'failed', attempts: 3, error: 'COHERE_HTTP_429' })
    expect(events.filter(e => e === 'retry')).toHaveLength(2)
  })

  it('cancels in-flight work and never starts queued jobs', async () => {
    const controller = new AbortController()
    const work = vi.fn(async (_job: number, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          resolve()
        }, { once: true })
        controller.abort()
      })
      signal.throwIfAborted()
    })
    const result = await runBatch(Array.from({ length: 120 }, (_, i) => i), policy, controller.signal, work, () => {})
    expect(work).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(120)
    expect(result.every(item => item.status === 'cancelled')).toBe(true)
  })

  it('rejects oversized queues before work', async () => {
    const work = vi.fn()
    await expect(runBatch(Array(201).fill(0), policy, new AbortController().signal, work, () => {})).rejects.toThrow('maxJobs')
    expect(work).not.toHaveBeenCalled()
  })
})

describe('native citation evidence', () => {
  it('preserves original document IDs and rejects invented IDs, spans, and mismatched text', () => {
    const good = { start: 2, end: 6, text: 'bond', sources: [{ type: 'document', id: 'original' }] }
    const result = validateCitations('A bond is required.', [good, { ...good, end: 100 }, { ...good, text: 'insured' }, { ...good, sources: [{ id: 'invented' }] }], ['original'])
    expect(result.accepted).toEqual([good])
    expect(result.rejected).toBe(3)
  })
  it('uses Unicode codepoint citation offsets without splitting emoji', () => {
    const citation = { start: 2, end: 6, text: 'bond', sources: [{ type: 'document', id: 'source' }] }
    expect(validateCitations('😀 bond', [citation], ['source']).accepted).toEqual([citation])
  })
})

describe('explicit media handling', () => {
  it('rejects raw PDF and video rather than claiming analysis', () => {
    expect(prepareMedia('application/pdf', [], 1024)).toMatchObject({ supported: false, reason: 'UNSUPPORTED_PDF' })
    expect(prepareMedia('video/mp4', [], 1024)).toMatchObject({ supported: false, reason: 'UNSUPPORTED_VIDEO' })
  })
  it('rejects remote images, excessive images, and oversized payloads', () => {
    expect(() => prepareMedia('image/png', ['https://private.invalid/image'], 1024)).toThrow('data URL')
    expect(() => prepareMedia('image/png', Array(21).fill('data:image/png;base64,aGVsbG8='), 1024)).toThrow('20')
    expect(() => prepareMedia('image/png', ['data:image/png;base64,aGVsbG8='], 1)).toThrow('bytes')
  })
})
