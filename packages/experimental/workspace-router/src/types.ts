/** Durable auxiliary-model and dispatch records for the WorkspaceAlberta router. @module */
import type { CallId } from '@workspacealberta/wa-llm'
import type { JsonValue } from '@workspacealberta/wa-session'

/** Secret-free record of one router operation. */
export interface WorkspaceRouterEvent {
  /** The enclosing workspace_route call. */
  callId: CallId
  /** Request before inference, decision before dispatch, or settled child result. */
  phase: 'request' | 'decision' | 'result'
  /** Full request and policy, decision and raw answers, or child tool result. */
  value: JsonValue
}

declare module '@workspacealberta/wa-session/types' {
  interface SessionEventMap {
    /** Auxiliary Jev inference and routed execution, correlated to a logged tool call. */
    'workspace/route': WorkspaceRouterEvent
  }
}
