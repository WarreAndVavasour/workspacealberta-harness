// Extended unit coverage for the procurement batch pipeline: every branch the
// integration spec does not reach. Fixture values only; no network calls.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import { runBatch, RetryableError } from '../src/batch-manager.ts'
import type { BatchPolicy } from '../src/batch-manager.ts'
import { validateCitations } from '../src/citation-generator.ts'
import { prepareMedia } from '../src/multimodal-analyzer.ts'
import {
  CohereRequestError,
  credentialRef,
  resolveCredential,
  synthesize,
} from '../src/cohere-processor.ts'
import { resolveSpec } from '../src/index.ts'
import type { NativeCitation } from '../src/citation-generator.ts'

const POLICY: BatchPolicy = { concurrency: 3, maxJobs: 200, maxRetries: 2, retryBaseMs: 1, retryMaxMs: 5 }
const IMAGE_URL = 'data:image/png;base64,aGVsbG8='

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.WA_PROC_TEST_CRED
  delete process.env.WA_PROC_TEST_MISSING
})

function okFetch(payload: unknown, onCall?: (url: string, init: RequestInit) => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    onCall?.(url, init as RequestInit)
    return { status: 200, ok: true, json: async () => payload }
  })
}

describe('runBatch edge behavior', () => {
  it('settles an empty queue with a final progress event', async () => {
    const events: unknown[] = []
    const results = await runBatch([], POLICY, new AbortController().signal, async () => 1, (e) => {
      events.push(e)
    })
    expect(results).toEqual([])
    expect(events).toEqual([{ completed: 0, active: 0, phase: 'progress' }])
  })

  it('runs without a progress observer', async () => {
    const results = await runBatch([7], POLICY, new AbortController().signal, async job => job * 2)
    expect(results[0]).toMatchObject({ status: 'succeeded', attempts: 1, value: 14 })
  })

  it('records a synchronous throw as a terminal failure', async () => {
    const results = await runBatch([1], POLICY, new AbortController().signal, () => {
      throw new Error('sync boom')
    })
    expect(results[0]).toMatchObject({ status: 'failed', attempts: 1, error: 'PROCESSING_FAILED' })
  })

  it('maps credentialed HTTP failures to fixed codes without leaking prose', async () => {
    const results = await runBatch([1], POLICY, new AbortController().signal, async () => {
      throw { status: 401, message: 'super-secret-provider-prose' }
    })
    expect(results[0]).toMatchObject({ status: 'failed', error: 'COHERE_HTTP_401' })
    expect(JSON.stringify(results)).not.toContain('super-secret-provider-prose')
  })

  it('retries a hintless failure with backoff, then succeeds', async () => {
    let calls = 0
    const results = await runBatch([1], POLICY, new AbortController().signal, async () => {
      calls += 1
      if (calls === 1) throw new RetryableError(503)
      return 'recovered'
    })
    expect(results[0]).toMatchObject({ status: 'succeeded', attempts: 2, value: 'recovered' })
    expect(calls).toBe(2)
  })

  it('cancels during backoff without further attempts', async () => {
    const controller = new AbortController()
    const policy: BatchPolicy = { ...POLICY, retryBaseMs: 50, retryMaxMs: 1000 }
    const results = await runBatch([1], policy, controller.signal, async () => {
      setTimeout(() => {
        controller.abort()
      }, 10)
      throw new RetryableError(503)
    })
    expect(results[0]).toMatchObject({ status: 'cancelled', attempts: 1 })
  })

  it('cancels queued work when the first job aborts then throws', async () => {
    const controller = new AbortController()
    const work = vi.fn(async () => {
      controller.abort()
      throw new Error('late failure')
    })
    const results = await runBatch([1, 2], { ...POLICY, concurrency: 1 }, controller.signal, work)
    expect(work).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(2)
    expect(results.every(item => item.status === 'cancelled')).toBe(true)
  })

  it('abandons hung work on abort and never starts the drained remainder', async () => {
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
    }, 10)
    const work = vi.fn(
      (_job: number, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('late'))
          }, { once: true })
        }),
    )
    const results = await runBatch([1, 2, 3], POLICY, controller.signal, work)
    expect(work).toHaveBeenCalledTimes(3)
    expect(results).toHaveLength(3)
    expect(results.every(item => item.status === 'cancelled')).toBe(true)
  })
})

describe('citation validation edge cases', () => {
  const good = { start: 0, end: 4, text: 'Bond', sources: [{ id: 'a' }] }
  it.each([
    ['non-integer offsets', { ...good, start: 0.5 }],
    ['empty span', { ...good, end: 0 }],
    ['negative start', { ...good, start: -1 }],
    ['empty sources', { ...good, sources: [] }],
    ['non-array sources', { ...good, sources: {} as unknown as readonly unknown[] }],
    ['null source entry', { ...good, sources: [null] }],
    ['non-string source id', { ...good, sources: [{ id: 7 }] }],
  ])('rejects a citation with %s', (_label, citation: NativeCitation) => {
    const result = validateCitations('Bond required', [citation], ['a'])
    expect(result.accepted).toEqual([])
    expect(result.rejected).toBe(1)
  })

  it('accepts multi-source citations naming only supplied documents', () => {
    const citation = { ...good, sources: [{ id: 'a' }, { type: 'document', id: 'b' }] }
    const result = validateCitations('Bond required', [citation], ['a', 'b'])
    expect(result.accepted).toEqual([citation])
    expect(result.rejected).toBe(0)
  })
})

describe('media plan edge cases', () => {
  it('reports an unsupported image type without images', () => {
    expect(prepareMedia('image/tiff', [], 1024)).toEqual({ supported: false, reason: 'UNSUPPORTED_MEDIA', images: [] })
  })

  it('accepts one bounded image with its byte size', () => {
    expect(prepareMedia('image/png', [IMAGE_URL], 1024)).toEqual({
      supported: true,
      images: [{ mime: 'image/png', bytes: 5 }],
    })
  })
})

describe('credential resolution', () => {
  it('prefers an explicit literal over every layer', async () => {
    const ctx = new Context()
    await expect(resolveCredential(ctx, credentialRef('WA_PROC_TEST_MISSING'), 'literal-key')).resolves.toBe(
      'literal-key',
    )
  })

  it('treats an empty literal as absent and uses the credential service', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: async () => ({ value: 'service-key', source: 'file' }),
    })
    await expect(resolveCredential(ctx, credentialRef('WA_PROC_TEST_MISSING'), '')).resolves.toBe('service-key')
  })

  it('returns undefined when the service resolves nothing', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined })
    await expect(resolveCredential(ctx, credentialRef('WA_PROC_TEST_MISSING'))).resolves.toBeUndefined()
  })

  it('falls back to the launch environment, then to absent', async () => {
    const ctx = new Context()
    process.env.WA_PROC_TEST_CRED = 'env-key'
    await expect(resolveCredential(ctx, credentialRef('WA_PROC_TEST_CRED'))).resolves.toBe('env-key')
    await expect(resolveCredential(ctx, credentialRef('WA_PROC_TEST_MISSING'))).resolves.toBeUndefined()
    process.env.WA_PROC_TEST_CRED = ''
    await expect(resolveCredential(ctx, credentialRef('WA_PROC_TEST_CRED'))).resolves.toBeUndefined()
  })
})

describe('spec resolution', () => {
  it('defaults every field', () => {
    expect(resolveSpec({}, undefined)).toMatchObject({
      baseURL: 'https://api.cohere.ai',
      model: 'command-a-plus-05-2026',
      maxTokens: 1024,
      policy: { concurrency: 3, maxJobs: 200, maxRetries: 2, retryBaseMs: 200, retryMaxMs: 5000 },
      maxDocuments: 12,
      maxCharsPerDocument: 6000,
    })
  })

  it('lets explicit config win over the environment', () => {
    const spec = resolveSpec(
      { apiKey: 'k', apiKeyEnv: 'OTHER_REF', baseURL: 'https://explicit.invalid', model: 'm', concurrency: 5 },
      'https://env.invalid',
    )
    expect(spec).toMatchObject({ apiKey: 'k', baseURL: 'https://explicit.invalid', model: 'm' })
    expect(spec.policy.concurrency).toBe(5)
  })

  it('uses the environment endpoint when unconfigured', () => {
    expect(resolveSpec({}, 'https://env.invalid').baseURL).toBe('https://env.invalid')
  })
})

describe('cohere synthesis', () => {
  const base = {
    endpoint: 'https://cohere.invalid/v2/chat',
    model: 'command-a-plus-05-2026',
    apiKey: 'sk-test-secret',
    maxTokens: 64,
    maxDocuments: 12,
    maxCharsPerDocument: 6000,
    maxImageBytes: 1024,
  }
  const text = 'Bond of 500 CAD is required.'
  const citation = { start: 0, end: 4, text: 'Bond', sources: [{ type: 'document', id: 'opp-1' }] }

  it('grounds synthesis in supplied documents with validated citations', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchFn = okFetch({ message: { content: text, citations: [citation] } }, (url, init) => {
      calls.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> })
    })
    const result = await synthesize(
      { instruction: 'Assess fit.', documents: [{ id: 'opp-1', text }] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(result).toMatchObject({
      text,
      rejectedCitations: 0,
      truncated: false,
      documentIds: ['opp-1'],
    })
    expect(result.citations).toEqual([citation])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://cohere.invalid/v2/chat')
    const body = calls[0]?.body as { temperature: number; documents: unknown[] }
    expect(body.temperature).toBe(0.3)
    expect('citation_options' in (calls[0]?.body as Record<string, unknown>)).toBe(false)
    expect(body.documents).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('sk-test-secret')
  })

  it('joins text content blocks and ignores non-text blocks', async () => {
    const fetchFn = okFetch({
      message: { content: [{ type: 'text', text: 'Bond' }, { type: 'image', text: 'x' }, 42] },
    })
    const result = await synthesize(
      { instruction: 'i', documents: [] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(result.text).toBe('Bond')
  })

  it('treats missing content and citations as empty evidence', async () => {
    const fetchFn = okFetch({})
    const result = await synthesize(
      { instruction: 'i', documents: [] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(result).toMatchObject({ text: '', rejectedCitations: 0, documentIds: [] })
    expect(result.citations).toEqual([])
  })

  it('marks truncation when documents are dropped or cut', async () => {
    const seen: unknown[][] = []
    const fetchFn = okFetch({ message: { content: 'ok' } }, (_url, init) => {
      seen.push((JSON.parse(init.body as string) as { documents: unknown[] }).documents)
    })
    const documents = Array.from({ length: 13 }, (_, index) => ({ id: `d${index}`, text: 'y' }))
    const cut = await synthesize(
      { instruction: 'i', documents: [...documents, { id: 'long', text: 'z'.repeat(7000) }] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(cut.truncated).toBe(true)
    expect(seen[0]).toHaveLength(12)
    const plain = await synthesize(
      { instruction: 'i', documents: [{ id: 'a', text: 'short' }] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(plain.truncated).toBe(false)
    const cutChars = await synthesize(
      { instruction: 'i', documents: [{ id: 'long', text: 'z'.repeat(7000) }] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    expect(cutChars.truncated).toBe(true)
    expect(seen[2]).toHaveLength(1)
  })

  it('sends image blocks for supplied media', async () => {
    const seen: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> = []
    const fetchFn = okFetch({ message: { content: 'seen' } }, (_url, init) => {
      seen.push((JSON.parse(init.body as string) as { messages: Array<{ content: never }> }).messages[0] as never)
    })
    await synthesize(
      { instruction: 'i', documents: [], mediaUrls: [IMAGE_URL] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch },
    )
    const content = seen[0]?.content ?? []
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(content[1]).toMatchObject({ type: 'image_url', image_url: { url: IMAGE_URL } })
  })

  it('refuses unsupported media before any provider call', async () => {
    const fetchFn = okFetch({ message: { content: 'x' } })
    await expect(
      synthesize(
        { instruction: 'i', documents: [], mediaMime: 'application/pdf', mediaUrls: [] },
        { ...base, fetchFn: fetchFn as unknown as typeof fetch },
      ),
    ).rejects.toThrow('UNSUPPORTED_PDF')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    ['redirect', 301, CohereRequestError],
    ['rate limit', 429, RetryableError],
    ['overloaded backend', 503, RetryableError],
    ['rejected key', 401, CohereRequestError],
  ])('maps HTTP %s (%s) to a fixed error', async (_label, status, kind) => {
    const fetchFn = vi.fn(
      async (): Promise<Response> => ({ status, ok: false, json: async () => ({}) }) as unknown as Response,
    )
    const failure = await synthesize(
      { instruction: 'i', documents: [] },
      { ...base, fetchFn },
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(kind)
    expect(failure).toMatchObject({ status })
  })

  it('lets transport failures propagate for fixed-code mapping', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('connection reset')
    })
    await expect(
      synthesize(
        { instruction: 'i', documents: [] },
        { ...base, fetchFn },
      ),
    ).rejects.toThrow('connection reset')
  })

  it('records the secret-free request when observed', async () => {
    const seen: unknown[] = []
    const fetchFn = okFetch({ message: { content: 'ok' } })
    await synthesize(
      { instruction: 'i', documents: [] },
      { ...base, fetchFn: fetchFn as unknown as typeof fetch, recordRequest: request => seen.push(request) },
    )
    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0])).not.toContain('sk-test-secret')
  })
})
