import { TypeSafeClient } from '@typesafe-ai/sdk'
import { expect, it } from 'vitest'
import { parseAnswer, questionsFor } from '../src/decision.ts'

const cases = [
  ['Search procurement opportunities for steel fabrication.', 'search'],
  ['Find opportunities that match our business capabilities.', 'match'],
  ['Show the details of tender AB-2026-12345.', 'details'],
  ['List procurement closing dates over the next two weeks.', 'deadlines'],
  ['Analyze the attachments and requirements for tender AB-2026-12345 in the bid room.', 'bid_room'],
  ['Fix a TypeScript compiler error in my application.', 'reason'],
  ['Search for fabrication tenders and analyze the attachments of every match.', 'reason'],
] as const

it.skipIf(!process.env.TYPESAFE_API_KEY).each(cases)(
  'live Jev classifies %s', { retry: 0 }, async (request, expected) => {
    const apiKey = process.env.TYPESAFE_API_KEY
    if (!apiKey) throw new Error('TYPESAFE_API_KEY is required for live Jev verification')
    const client = new TypeSafeClient({ apiKey,
      defaultModel: process.env.TYPESAFE_MODEL ?? 'jev-latest', timeout: 30000, retry: { maxRetries: 0 }, logLevel: 'off' })
    const state = { request, keywords: 'steel fabrication', profile: { description: 'Edmonton steel fabricator' },
      references: [{ reference: 'AB-2026-12345', title: 'Steel fabrication', observedAt: Date.now() }],
    }
    const questions = questionsFor(state)
    const start = performance.now()
    const response = await client.systemOne({ state, questions })
    const operation = parseAnswer(response.answers.operation, Object.keys(questions.operation.criteria))
    console.info(JSON.stringify({ expected, selected: operation.choice, confidence: operation.confidence,
      elapsedMs: Math.round(performance.now() - start), model: response.model, usage: response.usage }))
    expect(operation.choice).toBe(expected)
  },
)
