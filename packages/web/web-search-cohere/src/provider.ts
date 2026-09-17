/**
 * Cohere search over the v2 Chat tool-use loop Cohere's own migration guide
 * prescribes for web search: the model is offered a client-side `web_search`
 * function tool, the provider executes each call against anonymous
 * DuckDuckGo HTML, returns the acquired sources as `document` tool-result
 * blocks, and the model's final message carries the answer plus citations the
 * provider maps back onto citeable sources. Cohere v2 ships no hosted search
 * endpoint, so acquisition is local and only synthesis is a model call — one
 * provider, two transports, zero Anthropic or DeepSeek traffic.
 * The wire format and native `fetch` client are provider-private and do not
 * use `ctx.llm`.
 * @module @workspacealberta/web-search-cohere/provider
 */

import { WebError } from '@workspacealberta/wa-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@workspacealberta/wa-web'
import type { CredentialRef } from '@workspacealberta/wa-credentials'
import type {} from '@workspacealberta/wa-session'
import type {
  CohereChatMessage,
  CohereChatRequest,
  CohereChatResponse,
  CohereError,
  CohereResponseMessage,
  CohereToolDefinition,
} from './types.ts'

/** Stable id this provider registers under. */
export const COHERE_PROVIDER_ID = 'cohere'

/** Default endpoint base; `/v2/chat` is appended. */
export const COHERE_DEFAULT_BASE_URL = 'https://api.cohere.ai'

/** Default v2 model name (the deployment's Cohere Command route). */
export const COHERE_DEFAULT_MODEL = 'command-a-plus-05-2026'

/** Default upper bound on generated tokens per synthesis call. */
export const COHERE_DEFAULT_MAX_TOKENS = 1024

/** Default maximum `web_search` tool calls executed per search operation. */
export const COHERE_DEFAULT_MAX_ACQUISITIONS = 2

/** Default DuckDuckGo result count acquired per query (request-layer cost bound). */
export const COHERE_DEFAULT_ACQUIRE_MAX_RESULTS = 6

/** Anonymous acquisition endpoint; no credential is ever sent here. */
const ACQUISITION_URL = 'https://html.duckduckgo.com/html/'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'workspacealberta-harness/0.1.0 (+cohere-v2-tool-use)'

/**
 * Exact secret-free Cohere v2 Chat request recorded immediately before one
 * synthesis dispatch.
 */
export interface CohereSearchLlmRequest {
  /** Fully resolved v2 Chat endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to the provider. */
  readonly body: CohereChatRequest
}

declare module '@workspacealberta/wa-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary Cohere search request recorded before dispatch. */
    'web/cohere-search-llm-request': CohereSearchLlmRequest
  }
}

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface CohereSearchProviderOptions {
  /** Literal Cohere API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Cohere API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/v2/chat` is appended. */
  baseURL: string
  /** v2 model name. */
  model: string
  /** Upper bound on generated tokens per synthesis call. */
  maxTokens: number
  /** Maximum `web_search` tool calls executed per search operation. */
  maxAcquisitions: number
  /** DuckDuckGo result count acquired per query. */
  acquireMaxResults: number
  /**
   * Record the exact secret-free request immediately before dispatch. A throw
   * prevents dispatch so model-visible auxiliary input cannot escape logging.
   */
  recordRequest?: (request: CohereSearchLlmRequest) => void
}

/**
 * The client-side function tool offered to the model, matching the v2 shape
 * from Cohere's tool-use documentation (`type: "function"`, JSON-Schema
 * `parameters`, name the model plans against).
 */
export function buildWebSearchToolDefinition(): CohereToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the public web. Returns a list of sources with title, URL, and snippet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to look up.' },
        },
        required: ['query'],
      },
    },
  }
}

/**
 * Decode the small entity set DuckDuckGo HTML uses in titles and snippets.
 * Numeric references cover the rest without a dependency.
 * @param text - raw HTML text content.
 * @returns entity-decoded plain text.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&nbsp;/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

/** Strip tags and collapse whitespace. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/gu, '')).replace(/\s+/gu, ' ').trim()
}

/**
 * Resolve one DuckDuckGo result href to its target URL. Result anchors point
 * at `duckduckgo.com/l/?uddg=<percent-encoded target>`; the parameter is
 * unwrapped so the seam's sources carry the real destination.
 * @param href - the anchor's href attribute value.
 * @returns the target URL, or the href itself when it is already direct.
 */
export function unwrapDuckDuckGoHref(href: string): string {
  const resolved = href.startsWith('//') ? `https:${href}` : href
  if (!resolved.includes('duckduckgo.com/l/')) return resolved
  try {
    const url = new URL(resolved)
    const target = url.searchParams.get('uddg')
    return target !== null && target.length > 0 ? target : resolved
  } catch {
    return resolved
  }
}

/**
 * Parse DuckDuckGo HTML results into seam sources. Anchors are bucketed by
 * their `result__a` / `result__snippet` class tokens and paired in document
 * order; attribute order inside the tags varies, so the whole opening tag is
 * captured and inspected rather than assumed.
 * @param html - the acquired HTML document.
 * @param limit - maximum sources returned (the acquisition cost bound).
 * @returns parsed sources; empty when nothing matched.
 */
export function parseDuckDuckGoResults(html: string, limit: number): WebSearchSource[] {
  const titles: { url: string; title: string }[] = []
  const snippets: string[] = []
  for (const [, attrs = '', inner = ''] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gu)) {
    const classMatch = /class="([^"]*)"/u.exec(attrs)
    if (classMatch === null) continue
    const classes = classMatch[1]?.split(/\s+/u) ?? []
    const hrefMatch = /href="([^"]*)"/u.exec(attrs)
    if (classes.includes('result__a') && hrefMatch !== null) {
      const url = unwrapDuckDuckGoHref(decodeEntities(hrefMatch[1] ?? ''))
      const title = plainText(inner)
      if (url.length > 0 && title.length > 0) titles.push({ url, title })
    } else if (classes.includes('result__snippet')) {
      snippets.push(plainText(inner))
    }
  }
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const [index, { url, title }] of titles.entries()) {
    if (sources.length >= limit) break
    if (seen.has(url)) continue
    seen.add(url)
    const snippet = snippets[index]
    sources.push({
      url,
      title,
      ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
    })
  }
  return sources
}

/**
 * Extract the `query` argument from one tool call's JSON-encoded `arguments`
 * string. Malformed or query-less arguments yield undefined so the caller
 * substitutes its own query rather than dropping the acquisition.
 * @param argumentsText - the `function.arguments` string.
 * @returns the query, or undefined when unusable.
 */
export function parseToolCallQuery(argumentsText: string): string | undefined {
  try {
    const parsed = JSON.parse(argumentsText) as { query?: unknown }
    return typeof parsed.query === 'string' && parsed.query.trim().length > 0
      ? parsed.query.trim()
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Map the final v2 assistant message onto a normalized search result.
 * Citations reference document ids (`<tool_call_id>:<index>`); cited sources
 * lead in citation order, uncited acquisitions follow in acquisition order,
 * and the message's prose becomes the result's optional answer content. The
 * web service owns the final `maxResults` truncation, so `truncated` is
 * always `false` here.
 * @param message - the final assistant message.
 * @param acquisitions - document id → acquired source, in dispatch order.
 * @returns the normalized result.
 */
export function assistantText(message: CohereResponseMessage): string | undefined {
  const content = message.content
  if (typeof content === 'string') return content.trim().length > 0 ? content.trim() : undefined
  const prose = (content ?? [])
    .filter(block => block.type === 'text' && block.text !== undefined && block.text.length > 0)
    .map(block => block.text)
    .join('\n')
    .trim()
  return prose.length > 0 ? prose : undefined
}

export function mapCohereFinalResponse(
  message: CohereResponseMessage,
  acquisitions: ReadonlyMap<string, WebSearchSource>,
): WebSearchResult {
  const cited: WebSearchSource[] = []
  const citedIds = new Set<string>()
  for (const citation of message.citations ?? []) {
    for (const source of citation.sources) {
      const id = source.id
      if (id === undefined || citedIds.has(id)) continue
      const acquired = acquisitions.get(id)
      if (acquired === undefined) continue
      citedIds.add(id)
      cited.push(acquired)
    }
  }
  const remaining: WebSearchSource[] = []
  for (const [id, acquired] of acquisitions) {
    if (!citedIds.has(id)) remaining.push(acquired)
  }
  const content = assistantText(message)
  return {
    ...content !== undefined ? { content } : {},
    sources: [...cited, ...remaining],
    truncated: false,
  }
}

/** The Cohere-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class CohereSearchProvider implements WebSearchProvider {
  readonly id = COHERE_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => CohereSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && isPositiveInteger(options.maxTokens)
      && isPositiveInteger(options.maxAcquisitions)
      && isPositiveInteger(options.acquireMaxResults)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)

    const history: CohereChatMessage[] = [{ role: 'user', content: request.query }]
    // `strict_tools` makes any generated call schema-valid — the server
    // constrains sampling to the offered definition. `tool_choice` is
    // deliberately absent: this deployment's model rejects it (`tool_choice
    // is not supported for this model`), so acquisition relies on the model
    // choosing the tool, with the direct-acquisition fallback below covering
    // the turn where it does not.
    const tool = buildWebSearchToolDefinition()
    const first = await this.chat(options, apiKey, {
      model: options.model,
      messages: history,
      max_tokens: options.maxTokens,
      tools: [tool],
      strict_tools: true,
    }, signal)

    const calls = (first.message.tool_calls ?? [])
      .filter(call => call.function.name === 'web_search')
      .slice(0, options.maxAcquisitions)
    if (calls.length === 0) {
      // The model answered without the tool: no grounded synthesis exists, so
      // the provider degrades to direct acquisition of the original query
      // rather than passing ungrounded prose off as a search answer.
      const sources = await this.acquire(request.query, options, signal)
      return { sources, truncated: false }
    }

    // Echoing the planning turn into the request history keeps only prose —
    // a block-array response content (thinking/text blocks) is request-side
    // invalid, and the plan itself adds nothing the tool results need.
    const planned = assistantText(first.message)
    history.push({
      role: 'assistant',
      ...planned !== undefined ? { content: planned } : {},
      ...first.message.tool_calls !== undefined ? { tool_calls: first.message.tool_calls } : {},
    })
    const acquisitions = new Map<string, WebSearchSource>()
    for (const call of calls) {
      const query = parseToolCallQuery(call.function.arguments) ?? request.query
      const sources = await this.acquire(query, options, signal)
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: sources.map((source, index) => ({
          type: 'document' as const,
          document: { data: JSON.stringify(source), id: `${call.id}:${index}` },
        })),
      })
      for (const [index, source] of sources.entries()) {
        acquisitions.set(`${call.id}:${index}`, source)
      }
    }

    // The closing call keeps `tools` present: v2 rejects tool-call generation
    // for tools a request does not offer as "hallucinated", so dropping them
    // after the acquisition round turns a further model-planned call into a
    // request error. The loop still ends here — one acquisition round is the
    // budget — and a final response that plans another call instead of
    // answering simply yields no synthesized content while the acquired
    // sources still return.
    const final = await this.chat(options, apiKey, {
      model: options.model,
      messages: history,
      max_tokens: options.maxTokens,
      tools: [tool],
      strict_tools: true,
    }, signal)
    return mapCohereFinalResponse(final.message, acquisitions)
  }

  /**
   * One v2 Chat POST. Records the secret-free request immediately before
   * dispatch and maps transport, HTTP, and body failures onto `WebError`.
   */
  private async chat(
    options: CohereSearchProviderOptions,
    apiKey: string,
    body: CohereChatRequest,
    signal?: AbortSignal,
  ): Promise<CohereChatResponse> {
    const endpoint = `${options.baseURL}/v2/chat`
    options.recordRequest?.({ endpoint, body })
    throwIfSearchAborted(signal)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Cohere search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Cohere API error (HTTP ${status})`
      try {
        const parsed = await response.json() as CohereError
        const detail = parsed.message
          ?? (typeof parsed.detail === 'string' ? parsed.detail : undefined)
          ?? (Array.isArray(parsed.detail) ? parsed.detail[0]?.message : undefined)
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return await response.json() as CohereChatResponse
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Cohere returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Acquire sources for one query from DuckDuckGo HTML. No credential is sent;
   * the acquisition bound keeps one query's transfer bounded.
   */
  private async acquire(
    query: string,
    options: CohereSearchProviderOptions,
    signal?: AbortSignal,
  ): Promise<WebSearchSource[]> {
    throwIfSearchAborted(signal)
    const endpoint = `${ACQUISITION_URL}?q=${encodeURIComponent(query)}`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'text/html',
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`DuckDuckGo acquisition request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      throw new WebError(`DuckDuckGo acquisition failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    try {
      const html = await response.text()
      return parseDuckDuckGoResults(html, options.acquireMaxResults)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`DuckDuckGo acquisition returned an unprocessable body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: CohereSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Cohere search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'COHERE_API_KEY'
    throw new WebError(
      `Cohere search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-cohere config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True when the error is a DOMException-style abort from `fetch`. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Build the provider's stable cancellation error. */
function searchAborted(signal?: AbortSignal, cause?: unknown): WebError {
  return new WebError(
    signal?.reason instanceof Error ? signal.reason.message : 'Cohere search aborted',
    'WEB_ABORTED',
    cause !== undefined ? { cause } : {},
  )
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}
