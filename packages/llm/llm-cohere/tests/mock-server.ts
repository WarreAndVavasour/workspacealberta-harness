import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** One scripted behavior for the next request the mock server receives. */
export type Behavior =
  | { kind: 'sse'; events: string[]; delayMs?: number }
  | { kind: 'http-error'; status: number; body: string; contentType?: string; headers?: Record<string, string> }
  | { kind: 'close-early'; events: string[] }
  | { kind: 'empty-body'; status?: number }
  | { kind: 'redirect'; location: string }

export interface MockServer {
  url: string
  /** Bodies of received requests, in order. */
  requests: unknown[]
  /** Header bags of received requests, in order (parallel to `requests`). */
  headers: IncomingMessage['headers'][]
  script: Behavior[]
  close(): Promise<void>
}

const servers: Server[] = []

/** Close every server opened since the last call; run from each spec's afterEach. */
export async function closeMockServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
}

/** Frame one Cohere v2 Chat SSE event. */
export function sseEvent(event: object): string {
  return JSON.stringify(event)
}

/** A minimal complete text generation, reused by request-shape assertions. */
export const textEvents = [
  sseEvent({ type: 'message-start', delta: { message: { role: 'assistant' } } }),
  sseEvent({ type: 'content-start', index: 0, delta: { message: { content: { type: 'text', text: '' } } } }),
  sseEvent({ type: 'content-delta', index: 0, delta: { message: { content: { text: 'hello' } } } }),
  sseEvent({ type: 'content-end', index: 0 }),
  sseEvent({
    type: 'message-end',
    delta: {
      finish_reason: 'COMPLETE',
      usage: { tokens: { input_tokens: 3, output_tokens: 1 } },
    },
  }),
]

/** Local v2 Chat stand-in: replays scripted behaviors per request. */
export async function mockServer(script: Behavior[]): Promise<MockServer> {
  const requests: unknown[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      headers.push(request.headers)
      const behavior = script.shift()
      if (!behavior) {
        response.writeHead(500).end('mock script exhausted')
        return
      }
      if (behavior.kind === 'http-error') {
        response.writeHead(behavior.status, {
          'content-type': behavior.contentType ?? 'application/json',
          ...behavior.headers,
        })
        response.end(behavior.body)
        return
      }
      if (behavior.kind === 'empty-body') {
        response.writeHead(behavior.status ?? 200)
        response.end()
        return
      }
      if (behavior.kind === 'redirect') {
        response.writeHead(302, { location: behavior.location })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const write = (index: number): void => {
        if (index >= behavior.events.length) {
          if (behavior.kind === 'sse') response.end()
          else response.destroy()
          return
        }
        const payload = behavior.events[index] ?? ''
        const parsed = (() => {
          try {
            return JSON.parse(payload) as { type?: string }
          } catch {
            return {}
          }
        })()
        const eventName = parsed.type ?? 'message'
        response.write(`event: ${eventName}\ndata: ${payload}\n\n`)
        setTimeout(() => { write(index + 1) }, behavior.kind === 'sse' ? behavior.delayMs ?? 0 : 5)
      }
      write(0)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    headers,
    script,
    close: () => new Promise(resolve => server.close(() => { resolve() })),
  }
}
