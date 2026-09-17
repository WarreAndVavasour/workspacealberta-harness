import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@workspacealberta/wa-api-workspace-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
