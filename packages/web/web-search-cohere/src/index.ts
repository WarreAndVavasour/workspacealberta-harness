/**
 * Register a Cohere-backed provider in `ctx.web`. It runs the v2 Chat
 * tool-use loop Cohere's migration guide prescribes for web search: the model
 * plans `web_search` tool calls, this provider executes them against
 * anonymous DuckDuckGo HTML, and the model's final message synthesizes the
 * cited answer. The key is Cohere's own `COHERE_API_KEY` (v2 native, shared with the
 * OpenAI-compatibility route the LLM seam uses, so one secret serves both).
 * @module @workspacealberta/web-search-cohere
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  CohereSearchProvider,
  COHERE_DEFAULT_ACQUIRE_MAX_RESULTS,
  COHERE_DEFAULT_BASE_URL,
  COHERE_DEFAULT_MAX_ACQUISITIONS,
  COHERE_DEFAULT_MAX_TOKENS,
  COHERE_DEFAULT_MODEL,
} from './provider.ts'
import type { CohereSearchProviderOptions } from './provider.ts'

export {
  CohereSearchProvider,
  COHERE_DEFAULT_ACQUIRE_MAX_RESULTS,
  COHERE_DEFAULT_BASE_URL,
  COHERE_DEFAULT_MAX_ACQUISITIONS,
  COHERE_DEFAULT_MAX_TOKENS,
  COHERE_DEFAULT_MODEL,
  COHERE_PROVIDER_ID,
} from './provider.ts'
export type { CohereSearchLlmRequest, CohereSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-cohere'

/** The web seam this provider registers into. */
export const inject = ['web', 'settings']

const DEFAULT_API_KEY_ENV = 'COHERE_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Cohere API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `COHERE_API_KEY`. */
  apiKeyEnv?: string
  /** v2 endpoint base; `/v2/chat` is appended. */
  baseURL?: string
  /** v2 model name. Defaults to `command-a-plus-05-2026`. */
  model?: string
  /** Upper bound on generated tokens per synthesis call. Defaults to 1024. */
  maxTokens?: number
  /** Maximum `web_search` tool calls executed per search. Defaults to 2. */
  maxAcquisitions?: number
  /** DuckDuckGo results acquired per query. Defaults to 6. */
  acquireMaxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(COHERE_DEFAULT_MODEL),
  maxTokens: z.number().step(1).min(1).default(COHERE_DEFAULT_MAX_TOKENS),
  maxAcquisitions: z.number().step(1).min(1).default(COHERE_DEFAULT_MAX_ACQUISITIONS),
  acquireMaxResults: z.number().step(1).min(1).default(COHERE_DEFAULT_ACQUIRE_MAX_RESULTS),
})

/**
 * Environment variable naming this provider's endpoint. Deliberately the
 * Cohere-standard `COHERE_BASE_URL` rather than anything shared with the LLM
 * seam's compatibility route: the two adapters speak different Cohere APIs.
 */
const SEARCH_BASE_URL_ENV = 'COHERE_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_COHERE_SETTINGS_NAMESPACE = 'web-search-cohere'

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): CohereSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? COHERE_DEFAULT_BASE_URL,
    model: config.model ?? COHERE_DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? COHERE_DEFAULT_MAX_TOKENS,
    maxAcquisitions: config.maxAcquisitions ?? COHERE_DEFAULT_MAX_ACQUISITIONS,
    acquireMaxResults: config.acquireMaxResults ?? COHERE_DEFAULT_ACQUIRE_MAX_RESULTS,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/cohere-search-llm-request',
        request,
      )
    },
  }
}

/** Register the Cohere search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.settings.installSection(ctx, WEB_SEARCH_COHERE_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new CohereSearchProvider(() => resolveOptions(ctx, current())))
}
