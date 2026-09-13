/**
 * Model-facing bounded batch procurement review. Each call queues the requested opportunities
 * through a fixed worker pool: Cohere v2 synthesizes one grounded summary per opportunity over
 * caller-supplied evidence, native citations validate against the supplied documents, and every
 * requested item settles with its own outcome. Queue bounds, models, and credentials are deployment
 * configuration; fit labels stay with the calling agent and its rubric, not with this tool.
 * @module @workspacealberta/wa-procurement-base
 */

import type { Context } from '@workspacealberta/cordis'
import z from '@workspacealberta/schemastery'
import { credentialRef } from '@workspacealberta/wa-credentials'
import type { CredentialRef } from '@workspacealberta/wa-credentials'
import { launchEnvironmentOf } from '@workspacealberta/wa-launch-environment'
import { defineTool } from '@workspacealberta/wa-tools'
import { runBatch } from './batch-manager.ts'
import type { BatchPolicy } from './batch-manager.ts'
import { resolveCredential, synthesize } from './cohere-processor.ts'
import { prepareMedia } from './multimodal-analyzer.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'procurement-cohere'

/** The seam this plugin registers into. */
export const inject = ['tools']

/** Default credential reference naming the Cohere key. */
const DEFAULT_API_KEY_ENV = 'COHERE_API_KEY'

/** Environment variable naming a deployment endpoint override. */
const BASE_URL_ENV = 'COHERE_BASE_URL'

/** Default v2 endpoint base; `/v2/chat` is appended per call. */
const DEFAULT_BASE_URL = 'https://api.cohere.ai'

/** Default v2 model name (the deployment's Cohere Command route). */
const DEFAULT_MODEL = 'command-a-plus-05-2026'

/** Model-facing batch review configuration. */
export interface Config {
  /** Literal Cohere API key for tests and manual runs; prefer {@link apiKeyEnv} elsewhere. */
  apiKey?: string
  /** Credential reference resolved for each batch; defaults to `COHERE_API_KEY`. */
  apiKeyEnv?: string
  /** v2 endpoint base; `/v2/chat` is appended. */
  baseURL?: string
  /** v2 model name. */
  model?: string
  /** Upper bound on generated tokens per synthesis call. */
  maxTokens?: number
  /** Maximum simultaneous in-flight synthesis calls. */
  concurrency?: number
  /** Maximum opportunities accepted per batch. */
  maxJobs?: number
  /** Maximum retries per opportunity after a retryable failure. */
  maxRetries?: number
  /** Base backoff between retries in milliseconds; doubles per attempt. */
  retryBaseMs?: number
  /** Upper bound for any single retry delay in milliseconds. */
  retryMaxMs?: number
  /** Maximum evidence documents synthesized per opportunity. */
  maxDocuments?: number
  /** Maximum characters kept per evidence document. */
  maxCharsPerDocument?: number
  /** Total decoded image-byte budget per synthesis call. */
  maxImageBytes?: number
}

/** Schemastery configuration for the batch review tool. */
export const Config: z<Config> = z.object({
  apiKey: z.string(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string().default(DEFAULT_MODEL),
  maxTokens: z.number().step(1).min(1).default(1024),
  concurrency: z.number().step(1).min(1).default(3),
  maxJobs: z.number().step(1).min(1).default(200),
  maxRetries: z.number().step(1).min(0).default(2),
  retryBaseMs: z.number().min(1).default(200),
  retryMaxMs: z.number().min(1).default(5000),
  maxDocuments: z.number().step(1).min(1).default(12),
  maxCharsPerDocument: z.number().step(1).min(1).default(6000),
  maxImageBytes: z.number().min(1).default(20 * 1024 * 1024),
})

/**
 * Fully resolved deployment spec: every optional config value defaulted in one explicit step.
 * Test seam for proving configured bounds change behavior without booting a loader.
 */
export interface Spec {
  /** Literal key, when the deployment carries one directly. */
  apiKey?: string | undefined
  /** Credential reference resolved per batch. */
  apiKeyRef: CredentialRef
  /** v2 endpoint base. */
  baseURL: string
  /** v2 model name. */
  model: string
  /** Upper bound on generated tokens per synthesis call. */
  maxTokens: number
  /** Queue bounds for the worker pool. */
  policy: BatchPolicy
  /** Maximum evidence documents per opportunity. */
  maxDocuments: number
  /** Maximum characters kept per evidence document. */
  maxCharsPerDocument: number
  /** Total decoded image-byte budget per synthesis call. */
  maxImageBytes: number
}

/**
 * Resolve one deployment spec from plugin config: an explicit value wins, otherwise the endpoint
 * falls back to the launch environment and every other field to its schema default.
 * @param config - raw plugin config.
 * @param envBaseURL - endpoint override from the launch environment, when present.
 * @returns the resolved spec.
 */
export function resolveSpec(config: Config, envBaseURL?: string): Spec {
  return {
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
    apiKeyRef: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL: config.baseURL ?? envBaseURL ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? 1024,
    policy: {
      concurrency: config.concurrency ?? 3,
      maxJobs: config.maxJobs ?? 200,
      maxRetries: config.maxRetries ?? 2,
      retryBaseMs: config.retryBaseMs ?? 200,
      retryMaxMs: config.retryMaxMs ?? 5000,
    },
    maxDocuments: config.maxDocuments ?? 12,
    maxCharsPerDocument: config.maxCharsPerDocument ?? 6000,
    maxImageBytes: config.maxImageBytes ?? 20 * 1024 * 1024,
  }
}

/**
 * Register the `procurement_review_batch` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's explicit batch review policy.
 */
export function apply(ctx: Context, config: Config): void {
  const spec = resolveSpec(config, launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value)
  ctx.tools.register(defineTool({
    name: 'procurement_review_batch',
    description: 'Review a batch of procurement opportunities with Cohere-backed synthesis. '
      + 'Each opportunity is analyzed over its supplied evidence text with native citations; '
      + 'a bounded worker pool caps simultaneous provider calls, and every requested item settles '
      + 'with its own outcome. Unsupported media and failed items report explicit reasons — '
      + 'a batch with failures is partial coverage, never a complete review.',
    parameters: {
      opportunities: {
        type: 'array',
        required: true,
        description: 'Opportunities to review, each with its evidence text.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Stable opportunity reference.' },
            title: { type: 'string', required: true, description: 'Opportunity title.' },
            text: { type: 'string', required: true, description: 'Evidence text: notice fields plus accessible document excerpts.' },
            mediaMime: { type: 'string', description: 'Media type of imageUrls; defaults to image/png.' },
            imageUrls: {
              type: 'array',
              description: 'Base64 image data URLs (at most 20, within the byte budget).',
              items: { type: 'string' },
            },
          },
        },
      },
      profile: {
        type: 'object',
        additionalProperties: true,
        description: 'Subscriber capability snapshot for fit context (recorded with its timestamp by the caller).',
      },
      instruction: {
        type: 'string',
        description: 'Extra review guidance; defaults to a fit assessment against the profile.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                status: {
                  type: 'string',
                  required: true,
                  enum: ['succeeded', 'failed', 'cancelled'],
                },
                attempts: { type: 'integer', required: true },
                summary: { type: 'string', required: true },
                citationCount: { type: 'integer', required: true },
                rejectedCitations: { type: 'integer', required: true },
                truncated: { type: 'boolean', required: true },
                error: { type: 'string' },
              },
            },
          },
          counts: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              succeeded: { type: 'integer', required: true },
              failed: { type: 'integer', required: true },
              cancelled: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Batch review: ${value.counts.succeeded} ready, ${value.counts.failed} failed, `
          + `${value.counts.cancelled} cancelled.`,
      }],
    },
    async execute(args, exec) {
      const opportunities = args.opportunities
      if (opportunities.length === 0) {
        throw new Error('procurement_review_batch needs at least one opportunity')
      }
      const apiKey = await resolveCredential(ctx, spec.apiKeyRef, spec.apiKey)
      if (apiKey === undefined) {
        throw new Error(
          `procurement_review_batch needs ${spec.apiKeyRef}: store it through the credentials `
          + 'service (the web Models page writes it) or export it',
        )
      }
      const profileText = JSON.stringify(args.profile ?? {})
      const instruction = args.instruction
        ?? `Assess trade fit for subscriber profile ${profileText}. Quote decisive requirements, `
        + 'name every unknown that blocks a fit decision, and never invent capacity, bonding, '
        + 'certifications, or deadlines.'
      const wrapped = opportunities.map(opportunity => ({ opportunity }))
      const settled = await runBatch(
        wrapped,
        spec.policy,
        exec.signal,
        async ({ opportunity }) => {
          const mediaUrls = opportunity.imageUrls ?? []
          const media = opportunity.mediaMime === undefined && mediaUrls.length === 0
            ? { supported: true as const, reason: '' }
            : prepareMedia(opportunity.mediaMime ?? 'image/png', mediaUrls, spec.maxImageBytes)
          if (!media.supported) {
            return {
              summary: '', citationCount: 0, rejectedCitations: 0, truncated: false, error: media.reason,
            }
          }
          const result = await synthesize(
            {
              instruction,
              documents: [{ id: opportunity.id, text: `${opportunity.title}\n${opportunity.text}` }],
              mediaMime: opportunity.mediaMime,
              mediaUrls,
            },
            {
              endpoint: `${spec.baseURL}/v2/chat`,
              model: spec.model,
              apiKey,
              maxTokens: spec.maxTokens,
              maxDocuments: spec.maxDocuments,
              maxCharsPerDocument: spec.maxCharsPerDocument,
              maxImageBytes: spec.maxImageBytes,
            },
          )
          return {
            summary: result.text,
            citationCount: result.citations.length,
            rejectedCitations: result.rejectedCitations,
            truncated: result.truncated,
            error: undefined as string | undefined,
          }
        },
      )
      const items = settled.map((outcome) => {
        const opportunity = (wrapped[outcome.index] as (typeof wrapped)[number]).opportunity
        const value = outcome.value ?? {
          summary: '', citationCount: 0, rejectedCitations: 0, truncated: false, error: undefined,
        }
        const error = value.error ?? outcome.error
        return {
          id: opportunity.id,
          status: error === undefined ? outcome.status : 'failed',
          attempts: outcome.attempts,
          summary: value.summary,
          citationCount: value.citationCount,
          rejectedCitations: value.rejectedCitations,
          truncated: value.truncated,
          ...(error === undefined ? {} : { error }),
        }
      })
      const counts = {
        succeeded: items.filter(item => item.status === 'succeeded').length,
        failed: items.filter(item => item.status === 'failed').length,
        cancelled: items.filter(item => item.status === 'cancelled').length,
      }
      return { results: items, counts }
    },
  }))
}
