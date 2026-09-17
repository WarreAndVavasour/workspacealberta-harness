import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@workspacealberta/wa-session-log-export',
  ['lib/types/index.js'],
  { hostPhase: true },
)
