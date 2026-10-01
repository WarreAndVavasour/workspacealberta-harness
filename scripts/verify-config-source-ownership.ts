/**
 * Gate for forbidden credential or endpoint environment inlines in shipped
 * Cordis configuration.
 * @module scripts/verify-config-source-ownership
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml'
import type { Node } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')

/** Shipped Cordis configuration these rules apply to. */
const SHIPPED_CONFIG_GLOBS = [
  'workspace-alberta*.yml',
  'apps/*/config/**/*.yml',
  // Bundle identity comes from the package manifest, not the domain directory.
  'packages/*/*/cordis.patch.yml',
  // The Python runtime ships its own default composition inside the wheel.
  'python/*/src/**/cordis.yml',
]

/** Environment expressions owned by credential and endpoint resolvers. */
const INLINE_FIELDS = new Set(['apiKey', 'baseURL', 'apiKeyEnv', 'authToken', 'headers'])
const SECRET_FIELD = new RegExp(
  '^(key|password|secret|token|authorization|proxy-authorization|cookie|set-cookie)$'
  + '|(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key)$'
  + '|^OP_|^AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)$', 'i',
)

/** Return every forbidden inline environment form in shipped configuration. */
export function collectConfigSourceOwnershipViolations(root: string): string[] {
  const failures: string[] = []
  for (const glob of SHIPPED_CONFIG_GLOBS) {
    for (const file of globSync(glob, { cwd: root })) {
      const rel = file.split(sep).join('/')
      const source = readFileSync(resolve(root, rel), 'utf8')
      const document = parseDocument(source)
      if (document.errors.length > 0) {
        failures.push(`${rel}: invalid YAML; source details concealed.`)
        continue
      }
      const seen = new Set<Node>()
      const lineAt = (node: Node): number => source.slice(0, node.range?.[0] ?? 0).split('\n').length
      const visit = (node: unknown): void => {
        if (!isNode(node) || seen.has(node)) return
        seen.add(node)
        if (isAlias(node)) {
          visit(node.resolve(document) ?? null)
        } else if (isSeq(node)) {
          for (const item of node.items) visit(item)
        } else if (isMap(node)) {
          for (const pair of node.items) {
            const key = isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : undefined
            const value = isAlias(pair.value) ? pair.value.resolve(document) : pair.value
            const location = isScalar(pair.key) ? pair.key : node
            if (key !== undefined && value !== null && value !== undefined) {
              if (INLINE_FIELDS.has(key) && isScalar(value) && value.tag === 'tag:yaml.org,2002:js') {
                failures.push(
                  `${rel}:${String(lineAt(location))}: inlines a credential or endpoint from the environment.`
                  + ' The adapter resolves apiKeyEnv through ctx.credentials and the endpoint through the'
                  + ' environment snapshot; inlining here bypasses both ladders.',
                )
              } else if (SECRET_FIELD.test(key) && isScalar(value) && typeof value.value === 'string'
                && value.value.length > 0 && !value.value.startsWith('op://')) {
                failures.push(`${rel}:${String(lineAt(location))}: contains a credential literal; use a credential reference.`)
              }
            }
            visit(pair.value)
          }
        }
      }
      visit(document.contents)
    }
  }
  return failures
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const failures = collectConfigSourceOwnershipViolations(ROOT)
  if (failures.length > 0) {
    process.stderr.write('verify-config-source-ownership: configuration source ownership violated:\n')
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    process.exit(1)
  }

  process.stdout.write(
    'verify-config-source-ownership: shipped configuration has no forbidden credential literals or inline environment forms.\n',
  )
}
