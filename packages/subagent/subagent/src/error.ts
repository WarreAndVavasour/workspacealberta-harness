/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @workspacealberta/wa-subagent
 */

import { HarnessError } from '@workspacealberta/wa-llm'

/** Typed failure for the subagent seam. */
export class SubagentError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
