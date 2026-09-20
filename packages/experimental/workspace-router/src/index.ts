/** Opt-in Jev routing Consumer for the existing WorkspaceAlberta MCP tools. @module */
import type { Context } from '@workspacealberta/cordis'
import schema from '@workspacealberta/schemastery'
import { TypeSafeClient } from '@typesafe-ai/sdk'
import { z } from 'zod'
import { credentialRef } from '@workspacealberta/wa-credentials'
import { CallId } from '@workspacealberta/wa-llm'
import type { JsonValue } from '@workspacealberta/wa-session'
import { defineTool } from '@workspacealberta/wa-tools'
import type { ToolRunContext } from '@workspacealberta/wa-tools'
import { decide, inputSchema, operations, parseAnswer, questionsFor } from './decision.ts'
import type { DecisionPolicy, Operation, WorkspaceDecision } from './decision.ts'
import type { WorkspaceRouterEvent } from './types.ts'
export type { WorkspaceRouterEvent } from './types.ts'

/** Loader name. */
export const name = 'experimental-workspace-router'
/** Execution and server-side credential services. */
export const inject = ['tools', 'credentials']

/** Resolved plugin configuration; thresholds are explicit deployment choices. */
export interface Config extends DecisionPolicy {
  /** Credential reference; the value never enters tool arguments or logs. */
  apiKeyRef: string
  /** TypeSafe API root, also configurable for a local test server. */
  baseURL: string
  /** Jev model ID or alias. */
  model: string
  /** Maximum time for the single inference attempt. */
  timeoutMs: number
  /** Complete serialized Jev request byte limit. */
  maxRequestBytes: number
  /** Complete serialized returned router result byte limit. */
  maxResultBytes: number
  /** Maximum supplied candidate references. */
  maxReferences: number
}

/** Preserve the closed operation keys when building symmetric config fields. */
function operationFields<T>(create: () => schema<T>): Record<Operation, schema<T>> {
  return Object.fromEntries(operations.map(operation => [operation, create()])) as Record<Operation, schema<T>>
}
const toolNames = operationFields(() => schema.string().required())
const thresholds = operationFields(() => schema.number().min(0).max(1).required())

/** Validated deployment settings; no confidence threshold is assumed. */
export const Config: schema<Partial<Config>, Config> = schema.object({
  mode: schema.union(['recommend', 'execute']).default('recommend'),
  tools: schema.object(toolNames).required(),
  minConfidence: schema.object(thresholds).required(),
  referenceConfidence: schema.number().min(0).max(1).required(),
  maxEvidenceAgeMs: schema.number().step(1).min(1).default(900000),
  apiKeyRef: schema.string().role('credential-ref').default('TYPESAFE_API_KEY'),
  baseURL: schema.string().default('https://api.typesafe.ai'),
  model: schema.string().default('jev-latest'),
  timeoutMs: schema.number().step(1).min(1).default(10000),
  maxRequestBytes: schema.number().step(1).min(1).default(32768),
  maxResultBytes: schema.number().step(1).min(1).default(65536),
  maxReferences: schema.number().step(1).min(1).max(254).default(32),
})

const responseSchema = z.object({
  model: z.string().min(1).max(256),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
})

/** Project known JSON-compatible request/result objects to the shared JSON type. */
function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** Validate the complete emitted value, including wrapper fields. */
function bounded(value: unknown, maxBytes: number): JsonValue {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized) > maxBytes) throw new Error('Workspace router result exceeds maxResultBytes')
  return JSON.parse(serialized) as JsonValue
}

/** Validate only answers consumed by the selected branch of the remote response. */
function parseResponse(response: unknown, questions: ReturnType<typeof questionsFor>, policy: DecisionPolicy) {
  const result = responseSchema.parse(response)
  const operation = parseAnswer(result.answers.operation, Object.keys(questions.operation.criteria))
  const needsReference = (operation.choice === 'details' || operation.choice === 'bid_room')
    && operation.confidence >= policy.minConfidence[operation.choice]
  const reference = !needsReference || questions.reference === undefined ? undefined
    : parseAnswer(result.answers.reference, Object.keys(questions.reference.criteria))
  const answers = { operation, ...reference === undefined ? {} : { reference } }
  return { answers, evidence: json({ model: result.model, answers, usage: result.usage }) }
}

/**
 * Install the router and abort/drain its operations when unloaded.
 * @param ctx - plugin context carrying tool execution and credentials.
 * @param config - validated, resolved deployment settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const ref = credentialRef(config.apiKeyRef)
  if (!(await ctx.credentials.resolve(ref))?.value.trim()) throw new Error(`Missing credential: ${ref}`)
  const endpoint = new URL(config.baseURL)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash) throw new Error('baseURL must be an HTTP API root without credentials, query or fragment')
  if (!config.model.trim()) throw new Error('model must not be blank')
  for (const operation of operations) {
    if (!config.tools[operation].trim() || config.tools[operation] === 'workspace_route') {
      throw new Error(`Invalid target tool for ${operation}`)
    }
  }
  const lifetime = new AbortController()
  const active = new Set<Promise<JsonValue>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(active)
  })

  async function route(raw: unknown, exec: ToolRunContext): Promise<JsonValue> {
    const input = inputSchema.parse(raw)
    if ((input.references?.length ?? 0) > config.maxReferences) throw new Error('Too many candidate references')
    if (new Set(input.references?.map(item => item.reference)).size !== (input.references?.length ?? 0)) {
      throw new Error('Candidate references must be unique')
    }
    if (exec.agent === undefined) throw new Error('workspace_route requires a session-backed agent')
    const session = exec.agent.session
    const signal = AbortSignal.any([exec.signal, lifetime.signal])
    signal.throwIfAborted()
    const record = (phase: WorkspaceRouterEvent['phase'], value: unknown): void => {
      session.append('workspace/route', { callId: exec.callId, phase, value: json(value) })
    }
    const policy: DecisionPolicy = {
      mode: config.mode, tools: config.tools, minConfidence: config.minConfidence,
      referenceConfidence: config.referenceConfidence, maxEvidenceAgeMs: config.maxEvidenceAgeMs,
    }
    const questions = questionsFor(input)
    const request = { state: json(input) as Record<string, JsonValue>, model: config.model, questions }
    if (Buffer.byteLength(JSON.stringify(request)) > config.maxRequestBytes) {
      throw new Error('Jev request exceeds maxRequestBytes')
    }
    const credential = await ctx.credentials.resolve(ref)
    signal.throwIfAborted()
    if (!credential?.value.trim()) throw new Error(`Missing credential: ${ref}`)
    const client = new TypeSafeClient({
      apiKey: credential.value, baseURL: config.baseURL, defaultModel: config.model,
      timeout: config.timeoutMs, retry: { maxRetries: 0 }, logLevel: 'off',
    })
    record('request', { version: 1, body: request, policy })
    let response: unknown
    try {
      response = await client.systemOne(request, { signal })
    } catch {
      // Only the remote inference is contained; cancellation keeps its caller-owned outcome.
      signal.throwIfAborted()
      const decision: WorkspaceDecision = { kind: 'fallback', reason: 'provider_unavailable' }
      record('decision', { decision })
      return bounded({ decision }, config.maxResultBytes)
    }
    signal.throwIfAborted()
    let parsed: ReturnType<typeof parseResponse>
    try {
      parsed = parseResponse(response, questions, policy)
    } catch {
      // Malformed network fields or Choice distributions cannot authorize a branch.
      const decision: WorkspaceDecision = { kind: 'fallback', reason: 'invalid_response' }
      record('decision', { decision, evidence: null })
      return bounded({ decision, evidence: null }, config.maxResultBytes)
    }
    const { evidence } = parsed
    const decision = decide(input, parsed.answers, policy, Date.now())
    record('decision', { decision, evidence })
    if (decision.kind !== 'execute' && decision.kind !== 'recommend') return bounded({ decision, evidence }, config.maxResultBytes)
    signal.throwIfAborted()
    const target = ctx.tools.get(decision.tool, exec.agent)
    if (target === undefined) throw new Error(`Configured WorkspaceAlberta tool is unavailable: ${decision.tool}`)
    if (decision.kind === 'recommend') return bounded({ decision, evidence }, config.maxResultBytes)
    const result = await ctx.tools.execute({
      callId: CallId(`${exec.callId}:workspace`), name: decision.tool, arguments: decision.arguments,
      agent: exec.agent, signal, parent: exec.token,
    })
    for (const context of result.additionalContexts ?? []) exec.deferContext(context)
    const outcome = { decision, evidence, execution: {
      isError: result.isError, content: result.content,
      ...result.isError ? { error: result.error } : { value: result.value },
    } }
    let value: JsonValue
    try {
      value = bounded(outcome, config.maxResultBytes)
    } catch (error) {
      record('result', { decision, error: 'result_too_large', actionMayHaveCompleted: true })
      throw new Error('Workspace router result exceeds maxResultBytes. '
        + 'The selected tool may have completed; do not repeat it without checking its artifacts.', { cause: error })
    }
    record('result', value)
    return value
  }

  ctx.tools.register(defineTool({
    name: 'workspace_route',
    description: 'Choose a WorkspaceAlberta procurement operation from a user request. '
      + 'Supply exact keywords, business facts and known tender references; do not invent missing inputs. '
      + 'The result states whether an operation was recommended, executed, needs clarification, or needs general reasoning. '
      + 'Do not repeat an executed operation.',
    parameters: {
      request: { type: 'string', required: true, description: 'The user request to route.' },
      keywords: { type: 'string', description: 'Explicit search keywords, when known.' },
      profile: { type: 'object', additionalProperties: false, properties: {
        description: { type: 'string', required: true },
        company_name: { type: 'string' }, location: { type: 'string' },
      } },
      source: { type: 'string', enum: ['all', 'federal', 'alberta'] },
      days: { type: 'number', description: 'Explicit deadline or matching horizon, 1–365 days.' },
      limit: { type: 'number', description: 'Explicit result limit, 1–30.' },
      references: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        reference: { type: 'string', required: true }, title: { type: 'string', required: true },
        observedAt: { type: 'number', required: true, description: 'Time this reference was retrieved, Unix milliseconds.' },
      } } },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      const operation = route(args, exec)
      active.add(operation)
      void operation.then(() => active.delete(operation), () => active.delete(operation))
      return operation
    },
  }))
}
