import { pathToFileURL } from 'node:url'

/**
 * Resolve an exact Node pin or the latest release of a major from Node's index.
 * @param {string} selector - Major number or complete stable version.
 * @param {{ version: string }[]} releases - Newest-first official release index.
 * @returns {string | undefined} A v-prefixed version, or undefined when a major is absent.
 */
export function resolveWineNodeVersion(selector, releases = []) {
  if (/^\d+\.\d+\.\d+$/u.test(selector)) return `v${selector}`
  if (!/^\d+$/u.test(selector)) throw new Error(`Invalid Wine Node version selector: ${selector}`)
  return releases.find(release => release.version.startsWith(`v${selector}.`))?.version
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const version = resolveWineNodeVersion(process.argv[2] ?? '', JSON.parse(input || '[]'))
  if (version !== undefined) console.log(version)
}
