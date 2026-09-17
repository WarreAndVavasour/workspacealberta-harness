import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@workspacealberta/wa-api-remotes',
  ['lib/types/index.js'],
  { hostPhase: true },
)
