import { describe, expect, it } from 'vitest'
import { decide, inputSchema, operations, parseAnswer, questionsFor } from '../src/decision.ts'
import type { ChoiceAnswer, DecisionPolicy, Operation } from '../src/decision.ts'

const policy: DecisionPolicy = {
  mode: 'execute', tools: { search: 'search', match: 'match', details: 'details', deadlines: 'deadlines', bid_room: 'bid_room' },
  minConfidence: { search: 0.8, match: 0.8, details: 0.8, deadlines: 0.8, bid_room: 0.95 },
  referenceConfidence: 0.9, maxEvidenceAgeMs: 1000,
}
const answer = (choice: string, confidence = 1): ChoiceAnswer => ({ type: 'choice', choice, confidence, probabilities: { [choice]: 1 } })
const input = inputSchema.parse({ request: 'Find opportunities', keywords: 'steel', profile: { description: 'fabrication' },
  source: 'federal', days: 14, limit: 3, references: [{ reference: 'AB-2026-12345', title: 'Steel', observedAt: 1000 }] })

describe('WorkspaceAlberta decision tree', () => {
  it.each<[Operation, object]>([
    ['search', { keywords: 'steel', source: 'federal', limit: 3 }],
    ['match', { profile: { description: 'fabrication' }, days: 14, limit: 3 }],
    ['details', { reference: 'AB-2026-12345' }],
    ['deadlines', { source: 'federal', days: 14, limit: 3 }],
    ['bid_room', { reference: 'AB-2026-12345', profile: { description: 'fabrication' } }],
  ])('selects %s with only applicable arguments', (operation, args) => {
    expect(decide(input, { operation: answer(operation), reference: answer('reference_0') }, policy, 1500))
      .toEqual({ kind: 'execute', reason: 'accepted', operation, tool: operation, arguments: args })
  })
  it('retains general reasoning for unsupported and compound requests', () => {
    expect(decide(input, { operation: answer('reason') }, policy, 1500)).toEqual({ kind: 'fallback', reason: 'general_reasoning' })
    expect(decide(input, { operation: answer('clarify') }, policy, 1500)).toEqual({ kind: 'clarify', reason: 'unclear_operation' })
  })
  it('does not infer missing keywords, profiles or references', () => {
    const empty = { request: 'Help' }
    for (const [operation, reason] of [['search', 'missing_keywords'], ['match', 'missing_profile'], ['details', 'unresolved_reference']] as const) {
      expect(decide(empty, { operation: answer(operation) }, policy, 1500)).toMatchObject({ kind: 'clarify', reason })
    }
  })
  it('uses branch-specific thresholds and rejects stale or future evidence', () => {
    expect(decide(input, { operation: answer('bid_room', 0.9) }, policy, 1500).reason).toBe('uncertain_operation')
    expect(decide(input, { operation: answer('details'), reference: answer('reference_0', 0.8) }, policy, 1500).reason).toBe('unresolved_reference')
    for (const now of [500, 2001]) {
      expect(decide(input, { operation: answer('details'), reference: answer('reference_0') }, policy, now).reason).toBe('stale_reference')
    }
    expect(decide(input, { operation: answer('details'), reference: answer('none') }, policy, 1500).reason).toBe('unresolved_reference')
  })
  it('offers an explicit no-match reference and does not ask for nonexistent candidates', () => {
    expect(questionsFor(input).reference?.criteria.reference_0).toBe('AB-2026-12345: Steel')
    expect(questionsFor(input).reference?.criteria.none).toBeTypeOf('string')
    expect(questionsFor({ request: 'hello' }).reference).toBeUndefined()
    expect(Object.keys(questionsFor(input).operation.criteria)).toEqual([...operations, 'reason', 'clarify'])
  })
  it('accepts an exact calibrated threshold in recommendation mode', () => {
    expect(decide(input, { operation: answer('search', 0.8) }, { ...policy, mode: 'recommend' }, 1500).kind).toBe('recommend')
  })
  it('preserves optional business facts and omits an unspecified deadline horizon', () => {
    const profile = { description: 'fabrication', company_name: 'Example', location: 'Edmonton' }
    expect(decide({ request: 'Match us', profile }, { operation: answer('match') }, policy, 1500))
      .toMatchObject({ arguments: { profile } })
    expect(decide({ request: 'Closing dates' }, { operation: answer('deadlines') }, policy, 1500))
      .toMatchObject({ arguments: {} })
  })
  it('rejects answers that do not belong to the operation or candidate set', () => {
    expect(() => decide(input, { operation: answer('other') }, policy, 1500)).toThrow('Unknown validated operation')
    expect(() => decide(input, { operation: answer('details'), reference: answer('reference_9') }, policy, 1500))
      .toThrow('Unknown validated reference')
  })
  it.each([
    { ...answer('a'), choice: 'unknown' },
    { ...answer('a'), probabilities: { a: 0.2 } },
    { ...answer('a'), probabilities: { a: 0.1, b: 0.9 } },
    { ...answer('a'), confidence: 2 },
    { ...answer('a'), probabilities: { a: 1, extra: 0 } },
  ])('rejects inconsistent network judgments', (value) => {
    expect(() => parseAnswer(value, ['a'])).toThrow()
  })
  it('validates distributions and malformed tool input', () => {
    expect(parseAnswer({ ...answer('a'), probabilities: { a: 0.8, b: 0.2 } }, ['a', 'b']).choice).toBe('a')
    expect(() => inputSchema.parse({ request: ' ' })).toThrow()
    expect(() => inputSchema.parse({ request: 'deadlines', days: 0 })).toThrow()
    expect(() => inputSchema.parse({ request: 'search', source: 'canadabuys' })).toThrow()
    expect(() => inputSchema.parse({ request: 'search', unknown: 'value' })).toThrow()
  })
})

it('accepts two-decimal API rounding without changing the recorded probabilities', () => {
  const value = { type: 'choice', choice: 'a', confidence: 0.7, probabilities: { a: 0.67, b: 0.16, c: 0.16 } }
  expect(parseAnswer(value, ['a', 'b', 'c']).probabilities).toEqual(value.probabilities)
  expect(() => parseAnswer({ ...value, probabilities: { a: 0.6, b: 0.1, c: 0.1 } }, ['a', 'b', 'c'])).toThrow()
})
