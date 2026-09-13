/**
 * Bounded concurrent job queue for procurement batch review. A fixed worker pool pulls from a shared
 * queue, so requesting 100 or more opportunities never opens 100 simultaneous provider requests.
 * Every requested job settles exactly once with its own outcome; one job's failure, retry, or
 * cancellation never rewrites another job's result, and provider error text never reaches the outcome.
 * @module @workspacealberta/wa-procurement-base/batch-manager
 */

/** Terminal outcome of one queued job. */
export type JobStatus = 'succeeded' | 'failed' | 'cancelled'

/** Progress event phase: forward movement or a scheduled retry. */
export type BatchPhase = 'progress' | 'retry'

/**
 * Settled outcome of one queued job. `value` is present on success; `error` carries a fixed
 * machine code (never provider prose) on failure; both are absent on cancellation.
 */
export interface JobResult<T> {
  /** Position of the job in the requested queue. */
  index: number
  /** Terminal outcome. */
  status: JobStatus
  /** Provider attempts made for this job, including retries. */
  attempts: number
  /** Work value on success. */
  value?: T | undefined
  /** Fixed failure code on failure. */
  error?: string | undefined
}

/** Queue-wide bounds, supplied by the owning plugin's validated configuration. */
export interface BatchPolicy {
  /** Maximum simultaneous in-flight jobs. */
  concurrency: number
  /** Maximum jobs accepted per batch; larger queues are rejected before any work starts. */
  maxJobs: number
  /** Maximum retries per job after a retryable failure. */
  maxRetries: number
  /** Base backoff between retries in milliseconds; doubles per attempt. */
  retryBaseMs: number
  /** Upper bound for any single retry delay in milliseconds, including server hints. */
  retryMaxMs: number
}

/** Progress snapshot emitted after every settle, retry, and at batch end. */
export interface BatchProgress {
  /** Jobs settled so far (any terminal outcome). */
  completed: number
  /** Jobs currently in flight. */
  active: number
  /** Whether the batch moved forward or scheduled a retry. */
  phase: BatchPhase
}

/**
 * Work callback for one job. It may throw {@link RetryableError} for transient provider failures;
 * any other throw is terminal for that job only.
 */
export type BatchWork<T, R> = (job: T, signal: AbortSignal) => Promise<R>

/**
 * Transient provider failure (rate limit, overloaded backend). Carries an optional server
 * retry-after hint in milliseconds; the queue still caps the delay at the policy maximum.
 */
export class RetryableError extends Error {
  /** Provider HTTP status. */
  readonly status: number
  /** Server retry-after hint in milliseconds, when the provider supplied one. */
  readonly retryAfterMs?: number | undefined
  /**
   * @param status - provider HTTP status.
   * @param retryAfterMs - server retry-after hint in milliseconds, when supplied.
   */
  constructor(status: number, retryAfterMs?: number) {
    super(`retryable provider failure (HTTP ${status})`)
    this.name = 'RetryableError'
    this.status = status
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

/** Internal cancellation marker; never surfaces in a job outcome. */
class JobCancelled extends Error {
  constructor() {
    super('batch job cancelled')
    this.name = 'JobCancelled'
  }
}

/** No-op rejection handler keeping abandoned in-flight work from tripping unhandled-rejection guards. */
function swallow(): void {}

/**
 * Map one job's throw to a fixed failure code. Provider prose never leaves this function: retryable
 * failures name their HTTP status, credentialed HTTP failures name theirs, and everything else is a
 * single opaque code.
 * @param error - the job's throw, of any shape.
 * @returns the fixed failure code recorded on the outcome.
 */
function sanitizeFailure(error: unknown): string {
  if (error instanceof RetryableError) return `COHERE_HTTP_${error.status}`
  if (typeof error === 'object' && error !== null && 'status' in error
    && typeof error.status === 'number') {
    return `COHERE_HTTP_${(error as { status: number }).status}`
  }
  return 'PROCESSING_FAILED'
}

/**
 * Delay before the next retry: exponential backoff from the policy base, honoring a server
 * retry-after hint, always capped at the policy maximum so a distant hint cannot stall the batch.
 * @param error - the retryable failure just observed.
 * @param retryIndex - zero-based retry number.
 * @param policy - the batch bounds.
 * @returns milliseconds to wait before retrying.
 */
function retryDelayMs(error: RetryableError, retryIndex: number, policy: BatchPolicy): number {
  const backoff = policy.retryBaseMs * 2 ** retryIndex
  return Math.min(error.retryAfterMs ?? backoff, policy.retryMaxMs)
}

/**
 * Sleep that settles early on abort.
 * @param ms - milliseconds to wait; always positive under a validated policy.
 * @param signal - batch cancellation signal.
 * @returns true when the sleep was interrupted by cancellation.
 */
function sleepAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Race in-flight work against batch cancellation without forwarding foreign rejection values
 * through `reject`: the queue maps the original reason itself. Late-settling work stays handled
 * through the attached handlers and never trips unhandled-rejection guards.
 * @param pending - the in-flight work promise.
 */
type Settlement<T> = { settled: true; value: T } | { settled: false; reason: unknown }

/**
 * Settle in-flight work against batch cancellation.
 * @param pending - the in-flight work promise.
 * @param signal - batch cancellation signal.
 * @returns the settlement: the work value, or the original rejection reason.
 */
function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<Settlement<T>> {
  return new Promise<Settlement<T>>((resolve) => {
    const onAbort = (): void => {
      resolve({ settled: false, reason: new JobCancelled() })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ settled: true, value })
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ settled: false, reason })
      },
    )
  })
}

/**
 * Settle every requested job through a fixed worker pool.
 *
 * Workers pull indexes from one shared counter, so at most `policy.concurrency` jobs are ever in
 * flight. Cancellation marks the settling job and every unstarted job `cancelled` without starting
 * further work; oversized queues are rejected before any work starts.
 * @param jobs - the requested jobs, in outcome order.
 * @param policy - validated queue bounds.
 * @param signal - batch cancellation signal, honored between jobs and during backoff.
 * @param work - per-job work callback.
 * @param onProgress - progress observer; invoked after every settle, retry, and at batch end.
 * @returns one outcome per requested job, in request order.
 */
export async function runBatch<T, R>(
  jobs: readonly T[],
  policy: BatchPolicy,
  signal: AbortSignal,
  work: BatchWork<T, R>,
  onProgress?: (progress: BatchProgress) => void,
): Promise<JobResult<R>[]> {
  if (jobs.length > policy.maxJobs) {
    throw new Error(`procurement batch: ${jobs.length} jobs exceeds maxJobs ${policy.maxJobs}`)
  }
  const results: JobResult<R>[] = new Array<JobResult<R>>(jobs.length)
  let next = 0
  let active = 0
  let completed = 0
  const emit = (phase: BatchPhase): void => {
    onProgress?.({ completed, active, phase })
  }
  const complete = (
    index: number, status: JobStatus, attempts: number, value?: R, error?: string,
  ): void => {
    completed += 1
    results[index] = { index, status, attempts, value, error }
    emit('progress')
  }
  const cancelFrom = (from: number): void => {
    for (let index = from; index < jobs.length; index++) {
      if (results[index] === undefined) complete(index, 'cancelled', 0)
    }
  }
  const runOne = async (index: number): Promise<void> => {
    const job = jobs[index] as T
    let attempts = 0
    for (;;) {
      attempts += 1
      const pending = (async (): Promise<R> => await work(job, signal))()
      pending.catch(swallow)
      if (signal.aborted) {
        complete(index, 'cancelled', attempts)
        return
      }
      active += 1
      try {
        const settlement = await raceAbort(pending, signal)
        if (!settlement.settled) throw settlement.reason
        complete(index, 'succeeded', attempts, settlement.value)
        return
      } catch (error: unknown) {
        if (error instanceof JobCancelled) {
          complete(index, 'cancelled', attempts)
          return
        }
        if (error instanceof RetryableError && attempts <= policy.maxRetries) {
          emit('retry')
          if (await sleepAbortable(retryDelayMs(error, attempts - 1, policy), signal)) {
            complete(index, 'cancelled', attempts)
            return
          }
          continue
        }
        complete(index, 'failed', attempts, undefined, sanitizeFailure(error))
        return
      } finally {
        active -= 1
      }
    }
  }
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal.aborted) {
        cancelFrom(next)
        return
      }
      const index = next
      if (index >= jobs.length) return
      next = index + 1
      await runOne(index)
    }
  }
  const pool: Promise<void>[] = []
  for (let workerId = 0; workerId < Math.min(policy.concurrency, jobs.length); workerId++) {
    pool.push(worker())
  }
  await Promise.all(pool)
  emit('progress')
  return results
}
