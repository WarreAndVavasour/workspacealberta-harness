/**
 * Cohere v2 chat synthesis over supplied tender evidence. The model grounds its summary in caller
 * supplied documents and returns native citation records, which are validated before they reach any
 * consumer. Credentials resolve per operation through the credential seam and never enter logs,
 * dumps, or error text; credential-bearing requests never follow redirects.
 * @module @workspacealberta/wa-procurement-base/cohere-processor
 */

import type { Context } from '@workspacealberta/cordis'
import { credentialRef } from '@workspacealberta/wa-credentials'
import type { CredentialRef } from '@workspacealberta/wa-credentials'
import { launchEnvironmentOf } from '@workspacealberta/wa-launch-environment'
import { RetryableError } from './batch-manager.ts'
import { validateCitations } from './citation-generator.ts'
import type { NativeCitation } from './citation-generator.ts'
import { prepareMedia } from './multimodal-analyzer.ts'
import type { AnalyzableImage } from './multimodal-analyzer.ts'

/** Terminal provider failure carrying its HTTP status for fixed-code mapping. */
export class CohereRequestError extends Error {
  /** Provider HTTP status. */
  readonly status: number
  /**
   * @param status - provider HTTP status.
   */
  constructor(status: number) {
    super(`procurement synthesis failed (HTTP ${status})`)
    this.name = 'CohereRequestError'
    this.status = status
  }
}

/** One evidence document supplied for grounding. */
export interface SynthesisDocument {
  /** Stable source id reused as the citation reference. */
  id: string
  /** Evidence text. */
  text: string
}

/** Synthesis input: one instruction plus grounded evidence. */
export interface SynthesisInput {
  /** Task instruction naming the trade-fit question to answer from the evidence. */
  instruction: string
  /** Evidence documents; ids become the citation manifest. */
  documents: readonly SynthesisDocument[]
  /** Media type of the image payloads, when any. */
  mediaMime?: string | undefined
  /** Base64 image data URLs, when any. */
  mediaUrls?: readonly string[] | undefined
}

/** Secret-free request record for session logging. */
export interface SynthesisLlmRequest {
  /** Fully resolved v2 chat endpoint. */
  endpoint: string
  /** Exact JSON body sent to the provider. */
  body: unknown
}

/** Synthesis options; bounds are deployment configuration, never call-site constants. */
export interface SynthesisOptions {
  /** Fully resolved v2 chat endpoint. */
  endpoint: string
  /** v2 model name. */
  model: string
  /** Resolved Cohere API key for this operation. */
  apiKey: string
  /** Upper bound on generated tokens per synthesis call. */
  maxTokens: number
  /** Maximum evidence documents per call; extras are dropped and reported. */
  maxDocuments: number
  /** Maximum characters kept per document; overlong text is cut and reported. */
  maxCharsPerDocument: number
  /** Total decoded image-byte budget per call. */
  maxImageBytes: number
  /** Fetch implementation; defaults to the global fetch. */
  fetchFn?: typeof fetch | undefined
  /** Secret-free request observer for session logging. */
  recordRequest?: ((request: SynthesisLlmRequest) => void) | undefined
}

/** Grounded synthesis result with validated citations. */
export interface SynthesisResult {
  /** Model summary text. */
  text: string
  /** Citations verified against the supplied documents. */
  citations: NativeCitation[]
  /** Native records rejected during validation. */
  rejectedCitations: number
  /** True when documents were dropped or cut to fit the configured bounds. */
  truncated: boolean
  /** Ids of the documents actually supplied, in order. */
  documentIds: string[]
}

/**
 * Resolve the Cohere credential for one operation: an explicit literal wins, then the credential
 * seam, then the launch environment. Nothing here prints or returns the value to any log.
 * @param ctx - plugin context carrying the credential and environment planes.
 * @param ref - credential reference naming the key.
 * @param literal - explicit key for tests and manual runs; never from configuration files.
 * @returns the key, or undefined when no layer supplies it.
 */
export async function resolveCredential(
  ctx: Context, ref: CredentialRef, literal?: string,
): Promise<string | undefined> {
  if (literal !== undefined && literal.length > 0) return literal
  const credentials = ctx.get('credentials') as
    | { resolve: (ref: CredentialRef) => Promise<{ value: string } | undefined> }
    | undefined
  if (credentials !== undefined) return (await credentials.resolve(ref))?.value
  const ambient = launchEnvironmentOf(ctx).get(ref)
  return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
}

/** Redirect statuses; a credential-bearing request must never follow one. */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Render one assistant content payload to text. String content passes through; content-block arrays
 * contribute their text blocks; anything else is empty (and then uncitable).
 * @param content - the wire content value.
 * @returns the rendered text.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: unknown): block is { type: string; text?: unknown } =>
      typeof block === 'object' && block !== null)
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/** Wire text block. */
interface TextBlock {
  type: 'text'
  text: string
}

/** Wire image block. */
interface ImageBlock {
  type: 'image_url'
  image_url: { url: string }
}

/**
 * Synthesize one grounded summary over the supplied evidence. Documents beyond the configured
 * bounds are dropped or cut with the truncation flag set; unsupported media throws before any
 * provider call; native citations validate against the supplied manifest.
 * @param input - instruction plus evidence.
 * @param options - endpoint, model, credential, and bounds for this operation.
 * @returns the grounded text with validated citations.
 */
export async function synthesize(
  input: SynthesisInput, options: SynthesisOptions,
): Promise<SynthesisResult> {
  const mediaUrls = input.mediaUrls ?? []
  const media = input.mediaMime === undefined && mediaUrls.length === 0
    ? { supported: true as const, images: [] as AnalyzableImage[] }
    : prepareMedia(input.mediaMime ?? 'image/png', mediaUrls, options.maxImageBytes)
  if (!media.supported) throw new Error(`procurement synthesis: media ${media.reason}`)
  let truncated = false
  const kept = input.documents.slice(0, options.maxDocuments)
  if (kept.length < input.documents.length) truncated = true
  const bodies = kept.map((document) => {
    const text = document.text.slice(0, options.maxCharsPerDocument)
    if (text.length < document.text.length) truncated = true
    // Document `data` is a plain string: the v2 Chat API rejects structured data objects here.
    return { id: document.id, data: text }
  })
  const content: (TextBlock | ImageBlock)[] = [{ type: 'text', text: input.instruction }]
  for (const url of mediaUrls) {
    content.push({ type: 'image_url', image_url: { url } })
  }
  const body = {
    model: options.model,
    messages: [{ role: 'user', content }],
    documents: bodies,
    // No citation_options: the v2 API accepts citation modes on streaming calls only, and rejects
    // this field on plain chat. Non-streaming responses still carry message.citations natively.
    temperature: 0.3,
    max_tokens: options.maxTokens,
  }
  options.recordRequest?.({ endpoint: options.endpoint, body })
  const fetchFn = options.fetchFn ?? fetch
  const response = await fetchFn(options.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
  if (isRedirectStatus(response.status)) throw new CohereRequestError(response.status)
  if (response.status === 429 || response.status >= 500) throw new RetryableError(response.status)
  if (!response.ok) throw new CohereRequestError(response.status)
  const payload = (await response.json()) as {
    message?: { content?: unknown; citations?: unknown }
  }
  const text = contentText(payload.message?.content)
  const records = Array.isArray(payload.message?.citations)
    ? (payload.message.citations as NativeCitation[])
    : []
  const documentIds = bodies.map(document => document.id)
  const validation = validateCitations(text, records, documentIds)
  return {
    text,
    citations: validation.accepted,
    rejectedCitations: validation.rejected,
    truncated,
    documentIds,
  }
}

/** Re-export the credential reference constructor for the owning plugin. */
export { credentialRef }
export type { CredentialRef }
