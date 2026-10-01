/** Built-package composition probe; prints only metadata and success flags. */
import { boot } from '../../../../boot/app-boot/lib/index.js'
import { credentialRef } from '@workspacealberta/wa-credentials'
const ctx = await boot('wa-credential-check', process.argv[2])
try {
  const info = await ctx.credentials.describe(credentialRef('COHERE_API_KEY'))
  console.log(JSON.stringify({ configured: info.configured, source: info.source, writable: info.writable }))
} finally {
  await ctx.fiber.dispose()
}
