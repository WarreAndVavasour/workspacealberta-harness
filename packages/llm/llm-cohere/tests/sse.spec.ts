import { describe, expect, it } from 'vitest'
import { parseSse } from '../src/sse.ts'

/** Build an SSE byte stream from string fragments (fragments = network reads). */
function bytes(...fragments: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const fragment of fragments) controller.enqueue(encoder.encode(fragment))
      controller.close()
    },
  })
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const item of stream) out.push(item)
  return out
}

describe('parseSse', () => {
  it('yields event payloads and returns at EOF', async () => {
    const events = await collect(parseSse(bytes(
      'event: content-delta\ndata: {"a":1}\n\nevent: message-end\ndata: {"type":"message-end"}\n\n',
    )))
    expect(events).toEqual(['{"a":1}', '{"type":"message-end"}'])
  })

  it('reports comments out of band without yielding them', async () => {
    const comments: string[] = []
    const events = await collect(parseSse(
      bytes(': keep-alive\n\ndata: {"a":1}\n\n'),
      (comment) => { comments.push(comment) },
    ))
    expect(comments).toEqual(['keep-alive'])
    expect(events).toEqual(['{"a":1}'])
  })

  it('returns an empty list for an empty stream', async () => {
    await expect(collect(parseSse(bytes()))).resolves.toEqual([])
  })

  it('drops an unterminated tail', async () => {
    await expect(collect(parseSse(bytes('data: {"a"')))).resolves.toEqual([])
  })
})
