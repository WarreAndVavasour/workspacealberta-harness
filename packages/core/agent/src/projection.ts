import type { TurnBoundaryProjection } from './types.ts'
import type {} from '@workspacealberta/wa-session-projection'

declare module '@workspacealberta/wa-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The agent session's open/last turn and step boundary facts (whole value). */
    turnBoundary: TurnBoundaryProjection
  }
}

export {}
