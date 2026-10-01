/** Suppress literal credential fields in diagnostic configuration exports. */
const SECRET_FIELD = new RegExp(
  '^(key|password|secret|token|authorization|proxy-authorization|cookie|set-cookie)$'
  + '|(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key)$'
  + '|^OP_|^AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)$', 'i',
)

/**
 * Copy composed YAML data for display, keeping references and unevaluated expressions while hiding literal credentials.
 * @param value - parsed, unevaluated configuration.
 * @returns diagnostic configuration with credential literals replaced.
 */
export function redactConfigDump(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfigDump)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record['__jsExpr'] === 'string') return value
  return Object.fromEntries(Object.entries(record).map(([name, item]) => {
    const reference = typeof item === 'string' && item.startsWith('op://')
    const expression = item !== null && typeof item === 'object' && '__jsExpr' in item
    return [name, SECRET_FIELD.test(name) && item !== undefined && item !== '' && !reference && !expression
      ? '[REDACTED]' : redactConfigDump(item)]
  }))
}
