/** Durable project checkpoints and dependency validation for continuing business work. @module */
import { z } from 'zod'
import type { Session } from '@workspacealberta/wa-session'

const text = z.string().trim().min(1)
const source = z.object({ id: text, location: text, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const task = z.object({
  id: text, description: text,
  status: z.enum(['pending', 'in_progress', 'blocked', 'ready_for_review', 'completed']),
  dependsOn: z.array(text), sourceIds: z.array(text), toolNames: z.array(text),
  artifacts: z.array(text), acceptance: text,
}).strict()

/** Validated whole project state; identifiers originate in supplied documents or the lead's explicit plan. */
export const planSchema = z.object({
  title: text, business: text, objective: text,
  sources: z.array(source), tasks: z.array(task).min(1), blockers: z.array(text), decisions: z.array(text),
}).strict()

/** Serializable project checkpoint stored in the owning conversation. */
export type ProjectCheckpoint = z.infer<typeof planSchema> & { revision: number }

declare module '@workspacealberta/wa-session/types' {
  interface SessionEventMap {
    /** Complete project state; survives turns, compaction and session resume. Required for interpreting project revisions. */
    'workspace/project': { checkpoint: ProjectCheckpoint }
    /** Exact secret-free auxiliary inference request and response, associated with a document batch. */
    'workspace/intake': { callId: import('@workspacealberta/wa-llm').ToolCallId; phase: 'request' | 'response'; value: import('@workspacealberta/wa-util-values').JsonValue }
  }
}

/**
 * Recover the latest checkpoint from the complete session log.
 * @param session - owning project conversation.
 * @returns the last committed state, or null before the first checkpoint.
 */
export function readProject(session: Session): ProjectCheckpoint | null {
  const events = session.snapshotEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'workspace/project') return planSchema.extend({ revision: z.number().int().positive() }).parse(event.data.checkpoint)
  }
  return null
}

/**
 * Validate a complete revision before recording it; no asynchronous gap separates comparison and append.
 * @param session - owning project conversation.
 * @param expectedRevision - revision read before the caller changed its plan, zero for creation.
 * @param raw - untrusted model tool input.
 * @returns the committed checkpoint.
 */
export function checkpointProject(session: Session, expectedRevision: number, raw: unknown): ProjectCheckpoint {
  const previous = readProject(session)
  if (expectedRevision !== (previous?.revision ?? 0)) throw new Error('Project revision changed. Read project_read and reconcile before retrying.')
  const plan = planSchema.parse(raw)
  const tasks = new Map(plan.tasks.map(item => [item.id, item]))
  const sources = new Set(plan.sources.map(item => item.id))
  if (tasks.size !== plan.tasks.length || sources.size !== plan.sources.length) throw new Error('Project task and source IDs must be unique')
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Project task dependencies contain a cycle')
    if (visited.has(id)) return
    visiting.add(id)
    const item = tasks.get(id)
    if (item === undefined) throw new Error(`Unknown dependency: ${id}`)
    for (const dependency of item.dependsOn) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const item of plan.tasks) {
    visit(item.id)
    if (item.sourceIds.some(id => !sources.has(id))) throw new Error(`Unknown source on task: ${item.id}`)
    if (['in_progress', 'ready_for_review', 'completed'].includes(item.status)
      && item.dependsOn.some(id => tasks.get(id)?.status !== 'completed')) throw new Error(`Unfinished dependency on task: ${item.id}`)
    if (['ready_for_review', 'completed'].includes(item.status) && item.artifacts.length === 0) throw new Error(`Task requires artifact locations: ${item.id}`)
  }
  const checkpoint = { ...plan, revision: expectedRevision + 1 }
  session.append('workspace/project', { checkpoint })
  return checkpoint
}
