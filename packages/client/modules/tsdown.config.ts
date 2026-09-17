import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@workspacealberta/wa-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
