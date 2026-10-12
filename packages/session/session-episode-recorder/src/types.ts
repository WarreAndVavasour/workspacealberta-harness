/**
 * Pure types of the episode-recorder domain: the ONE home of the
 * `episodeRecorder` projection-key declaration, free of this package's
 * host-side value imports. Host-only unit — the key appears only in
 * {@link SessionProjectionStateMap}, never in the wire table.
 *
 * @module @workspacealberta/wa-session-episode-recorder/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/** One recorded tool step inside an episode. */
export interface EpisodeStep {
  /** Session event seq of the `tool/result` that closed the step. */
  seq: number
  /** Provider-minted call id pairing `tool/call` → `tool/result`. */
  callId: string
  /** Tool name exactly as dispatched (MCP names keep their `mcp__…` prefix). */
  tool: string
  /** First 16 hex chars of SHA-256 over the raw arguments string. */
  argsDigest: string
  /** Raw `arguments` JSON string exactly as the model produced it. Redact at export. */
  args: string
  /** Whether the result carried no `error` identity. */
  ok: boolean
  /** Tool-private failure identity (`error.code`) when the call failed. */
  errorCode: string | null
  /** Result-landing wall time (session clock, ms). */
  time: number
  /** `tool/call` → `tool/result` latency, ms; null when no call landed. */
  latencyMs: number | null
  /** Human decision attached to this call: auto (no ask), or the decided outcome. */
  approval: 'auto' | 'approved' | 'denied' | 'canceled' | 'unavailable'
}

/** One requirement-scoped episode: the trajectory that served one RFP requirement. */
export interface EpisodeRecord {
  /** Requirement id from the classify_tender manifest (`R01`…); null for unscoped steps. */
  requirementId: string | null
  /** Classifier tag (`security_bond`, `attach_document.surety_letter`, …). */
  tag: string | null
  /** WorkspaceAlberta connector that would collect this requirement. */
  connector: string | null
  /** Who answers: company_profile, third_party, calculation, calendar_action, … */
  answerSource: string | null
  /** Lead time bucket: weeks, days or minutes. */
  leadTime: string | null
  /** Mandatory flag from the manifest. */
  mandatory: boolean | null
  /** RFP reference from the manifest (`AB-2026-06584`). */
  reference: string | null
  /** Reported closing time from the manifest, as written. */
  closesAt: string | null
  /** Completed tool steps attributed to this requirement, in result order. */
  steps: EpisodeStep[]
}

/** Requirement facts lifted from a `classify_tender` result manifest. */
export interface EpisodeRequirementInfo {
  tag: string
  mandatory: boolean
  connector: string
  answerSource: string
  leadTime: string
}

/**
 * Whole-log episode fold state: the sniffed RFP manifest, the requirement
 * catalog, in-flight calls and approvals, and one episode record per
 * requirement plus the `unscoped` bucket. Plain JSON per the unit contract
 * (persisted-cache precondition).
 */
export interface EpisodeRecorderState {
  /** RFP reference from the last `classify_tender` result; null before one lands. */
  reference: string | null
  /** Reported closing time from the last `classify_tender` result. */
  closesAt: string | null
  /** Requirement catalog from the last manifest, by requirement id. */
  requirements: Record<string, EpisodeRequirementInfo>
  /** Dispatched calls whose result has not landed, by callId. */
  openCalls: Record<string, { name: string; args: string; time: number; seq: number }>
  /** Approval asks in flight, by ask id — joins a decided outcome to its call. */
  openApprovals: Record<string, { toolName: string; callId: string | null }>
  /** Decided approval outcomes awaiting their result, by callId. */
  pendingApprovals: Record<string, EpisodeStep['approval']>
  /** Episode records keyed by requirement id, plus `unscoped` for unattributed steps. */
  episodes: Record<string, EpisodeRecord>
  /** Completed step count (sum over episodes; the change-feed's cheap delta signal). */
  stepCount: number
}

declare module '@workspacealberta/wa-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Per-requirement episode trajectories; see {@link EpisodeRecorderState}. */
    episodeRecorder: EpisodeRecorderState
  }
}
