/**
 * Validation for native Cohere v2 citation records. A citation is evidence only when its span
 * reproduces the response text exactly and every source it names was actually supplied; anything
 * else is rejected and counted, never repaired or displayed as a reference.
 * @module @workspacealberta/wa-procurement-base/citation-generator
 */

/**
 * One native citation record from a Cohere v2 chat response. Sources stay `unknown` because they
 * arrive over the wire; each must narrow to a known document id before the citation is accepted.
 */
export interface NativeCitation {
  /** Start offset in Unicode code points. */
  start: number
  /** End offset in Unicode code points (exclusive). */
  end: number
  /** Cited span text; must reproduce the response slice exactly. */
  text: string
  /** Source references, each expected to carry a known document id. */
  sources: readonly unknown[]
}

/** Accepted citations plus the count of rejected records. */
export interface CitationValidation {
  /** Citations whose spans and sources verified against the supplied manifest. */
  accepted: NativeCitation[]
  /** Records rejected for bad spans, mismatched text, or unknown sources. */
  rejected: number
}

/**
 * Check one wire value narrows to a reference to a supplied document.
 * @param value - the wire value.
 * @param known - ids of the documents actually supplied with the request.
 * @returns true when the value names a known document.
 */
function isKnownSource(value: unknown, known: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null) return false
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && known.has(id)
}

/**
 * Check one citation record against the response text and the supplied document manifest. Offsets
 * are compared in Unicode code points so multi-byte characters cannot shift a span.
 * @param citation - the record to check.
 * @param chars - response text split into code points.
 * @param known - ids of the documents actually supplied with the request.
 * @returns true when the span reproduces the response slice and all sources are known.
 */
function isCitable(
  citation: NativeCitation, chars: readonly string[], known: ReadonlySet<string>,
): boolean {
  if (!Number.isInteger(citation.start) || !Number.isInteger(citation.end)) return false
  if (citation.start < 0 || citation.end > chars.length || citation.start >= citation.end) return false
  if (chars.slice(citation.start, citation.end).join('') !== citation.text) return false
  if (!Array.isArray(citation.sources) || citation.sources.length === 0) return false
  return citation.sources.every(source => isKnownSource(source, known))
}

/**
 * Partition native citation records into verified evidence and rejections. Missing or rejected
 * citations stay visible as unverified evidence; callers must escalate decisive claims that lose
 * their citations rather than display replacement references.
 * @param responseText - the exact model response the citations annotate.
 * @param citations - native records from the response.
 * @param sourceIds - ids of the documents actually supplied with the request.
 * @returns the accepted records and the rejection count.
 */
export function validateCitations(
  responseText: string, citations: readonly NativeCitation[], sourceIds: readonly string[],
): CitationValidation {
  const known = new Set(sourceIds)
  const chars = Array.from(responseText)
  const accepted: NativeCitation[] = []
  let rejected = 0
  for (const citation of citations) {
    if (isCitable(citation, chars, known)) accepted.push(citation)
    else rejected += 1
  }
  return { accepted, rejected }
}
