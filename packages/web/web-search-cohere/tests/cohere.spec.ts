import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@workspacealberta/cordis'
import WebRuntime from '@workspacealberta/wa-web'
import {
  CohereSearchProvider,
  COHERE_PROVIDER_ID,
  buildWebSearchToolDefinition,
  mapCohereFinalResponse,
  parseDuckDuckGoResults,
  parseToolCallQuery,
  unwrapDuckDuckGoHref,
} from '../src/provider.ts'
import type { CohereSearchProviderOptions } from '@workspacealberta/web-search-cohere'

/** Construct the provider over a fixed options value; production passes a live thunk. */
const searchProvider = (options: CohereSearchProviderOptions): CohereSearchProvider =>
  new CohereSearchProvider(() => options)

const options = {
  apiKey: 'co-key',
  baseURL: 'https://api.cohere.test',
  model: 'command-a-plus-05-2026',
  maxTokens: 1024,
  maxAcquisitions: 2,
  acquireMaxResults: 6,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** DuckDuckGo-style HTML: redirect hrefs, entities, and tagged snippets. */
const DDG_HTML = `
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fone&amp;rut=abc">A &amp; One</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fone">The <b>first</b> result&#x27;s snippet</a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://b.test/two">B: &quot;Two&quot;</a>
  </h2>
  <a class="result__snippet" href="https://b.test/two">Second snippet</a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://a.test/one">Duplicate of A</a>
  </h2>
</div>
`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('unwrapDuckDuckGoHref', () => {
  it('unwraps uddg redirect links to their target', () => {
    expect(unwrapDuckDuckGoHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fone&rut=abc'))
      .toBe('https://a.test/one')
  })

  it('passes direct and unparseable hrefs through', () => {
    expect(unwrapDuckDuckGoHref('https://b.test/two')).toBe('https://b.test/two')
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/l/?uddg=')).toBe('https://duckduckgo.com/l/?uddg=')
  })
})

describe('parseDuckDuckGoResults', () => {
  it('pairs titles with snippets in order, decodes entities and tags, dedupes by url', () => {
    const sources = parseDuckDuckGoResults(DDG_HTML, 6)
    expect(sources).toEqual([
      { url: 'https://a.test/one', title: 'A & One', snippet: 'The first result\'s snippet' },
      { url: 'https://b.test/two', title: 'B: "Two"', snippet: 'Second snippet' },
    ])
  })

  it('honors the acquisition limit', () => {
    expect(parseDuckDuckGoResults(DDG_HTML, 1)).toHaveLength(1)
  })

  it('returns empty for markup without result anchors', () => {
    expect(parseDuckDuckGoResults('<html><body>anomaly page</body></html>', 6)).toEqual([])
  })
})

describe('parseToolCallQuery', () => {
  it('reads the query from the JSON-encoded arguments string', () => {
    expect(parseToolCallQuery('{"query":"  canada buys  "}')).toBe('canada buys')
  })

  it('yields undefined for malformed or query-less arguments', () => {
    expect(parseToolCallQuery('not json')).toBeUndefined()
    expect(parseToolCallQuery('{"other":1}')).toBeUndefined()
    expect(parseToolCallQuery('{"query":"   "}')).toBeUndefined()
  })
})

describe('buildWebSearchToolDefinition', () => {
  it('matches the Cohere v2 client-side function tool shape', () => {
    expect(buildWebSearchToolDefinition()).toEqual({
      type: 'function',
      function: {
        name: 'web_search',
        description: expect.any(String),
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: expect.any(String) } },
          required: ['query'],
        },
      },
    })
  })
})

describe('assistantText', () => {
  it('joins text blocks from a block-array content', async () => {
    const { assistantText } = await import('../src/provider.ts')
    expect(assistantText({
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'internal plan' },
        { type: 'text', text: 'Answer one.' },
        { type: 'text', text: 'Answer two.' },
      ],
    })).toBe('Answer one.\nAnswer two.')
  })

  it('passes string content through and yields undefined when empty', async () => {
    const { assistantText } = await import('../src/provider.ts')
    expect(assistantText({ role: 'assistant', content: '  direct  ' })).toBe('direct')
    expect(assistantText({ role: 'assistant', content: '' })).toBeUndefined()
    expect(assistantText({ role: 'assistant' })).toBeUndefined()
  })
})

describe('mapCohereFinalResponse', () => {
  const a = { url: 'https://a.test/one', title: 'A' }
  const b = { url: 'https://b.test/two', title: 'B' }
  const c = { url: 'https://c.test', title: 'C' }
  const acquisitions = new Map([['call1:0', a], ['call1:1', b], ['call2:0', c]])

  it('orders cited sources by citation, appends uncited, and carries the answer', () => {
    const result = mapCohereFinalResponse({
      role: 'assistant',
      content: '  Grounded answer.  ',
      citations: [
        { sources: [{ type: 'tool', id: 'call2:0' }] },
        { sources: [{ type: 'tool', id: 'call1:1' }, { type: 'tool', id: 'call1:1' }] },
      ],
    }, acquisitions)
    expect(result).toEqual({
      content: 'Grounded answer.',
      sources: [c, b, a],
      truncated: false,
    })
  })

  it('omits content when the final message has none and ignores unknown citation ids', () => {
    const result = mapCohereFinalResponse({
      role: 'assistant',
      citations: [{ sources: [{ type: 'tool', id: 'missing:0' }] }],
    }, acquisitions)
    expect(result).toEqual({ sources: [a, b, c], truncated: false })
  })
})

describe('CohereSearchProvider.search', () => {
  it('runs the documented tool-use loop and maps citations onto sources', async () => {
    const recorded: unknown[] = []
    const provider = searchProvider({
      ...options,
      recordRequest: (request) => { recorded.push(request) },
    })
    const calls = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url === 'https://api.cohere.test/v2/chat') {
        const body = JSON.parse(String(init?.body)) as { messages: unknown[] }
        if (body.messages.length === 1) {
          return jsonResponse({
            message: {
              role: 'assistant',
              tool_plan: 'plan',
              tool_calls: [{
                id: 'call1',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"alberta manufacturing"}' },
              }],
            },
            finish_reason: 'TOOL_CALLS',
          })
        }
        return jsonResponse({
          message: {
            role: 'assistant',
            content: 'Answer with citations.',
            citations: [{ start: 0, end: 6, text: 'Answer', sources: [{ type: 'tool', id: 'call1:0' }] }],
          },
          finish_reason: 'COMPLETE',
        })
      }
      if (url.startsWith('https://html.duckduckgo.com/html/?')) {
        expect(url).toContain('q=alberta%20manufacturing')
        return new Response(DDG_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', calls)

    const result = await provider.search({ query: 'alberta manufacturing' })
    expect(result.sources.map(source => source.url)).toEqual(['https://a.test/one', 'https://b.test/two'])
    expect(result.content).toBe('Answer with citations.')
    expect(result.truncated).toBe(false)
    expect(calls).toHaveBeenCalledTimes(3)
    // Both synthesis dispatches were recorded secret-free before dispatch.
    expect(recorded).toHaveLength(2)

    const firstRequest = recorded[0] as { endpoint: string; body: { tools: unknown[] } }
    expect(firstRequest.endpoint).toBe('https://api.cohere.test/v2/chat')
    expect(firstRequest.body.tools).toEqual([buildWebSearchToolDefinition()])
  })

  it('degrades to direct acquisition when the model answers without the tool', async () => {
    const provider = searchProvider(options)
    const calls = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input)
      if (url === 'https://api.cohere.test/v2/chat') {
        return jsonResponse({ message: { role: 'assistant', content: 'I can answer directly.' }, finish_reason: 'COMPLETE' })
      }
      expect(url).toContain('q=direct%20query')
      return new Response(DDG_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', calls)

    const result = await provider.search({ query: 'direct query' })
    // Ungrounded prose is not passed off as a search answer.
    expect(result.content).toBeUndefined()
    expect(result.sources).toHaveLength(2)
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('maps a Cohere HTTP error body onto WEB_PROVIDER_ERROR', async () => {
    const provider = searchProvider(options)
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> =>
      jsonResponse({ message: 'invalid model id' }, { status: 400 })))
    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'invalid model id',
    })
  })

  it('reports a missing credential as WEB_PROVIDER_CREDENTIAL_MISSING', async () => {
    const provider = searchProvider({
      baseURL: options.baseURL,
      model: options.model,
      maxTokens: options.maxTokens,
      maxAcquisitions: options.maxAcquisitions,
      acquireMaxResults: options.acquireMaxResults,
    })
    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
    })
  })
})

describe('plugin registration', () => {
  it('registers the cohere provider into the web seam under its stable id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => { throw new Error('offline test') }))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    const plugin = await import('@workspacealberta/web-search-cohere')
    const pluginFiber = ctx.plugin(plugin, { apiKey: 'co-key' })
    await pluginFiber.await()
    // Selection resolves the sole registered provider; the offline fetch maps
    // to the provider error the seam's callers route on.
    await expect(ctx.web.search({ query: 'unused' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(COHERE_PROVIDER_ID).toBe('cohere')
  })
})
