/**
 * Decode an SSE byte stream into event `data` payloads. Framing — chunk
 * reassembly, UTF-8/CRLF/BOM handling, comment and non-data field skipping,
 * multi-`data:` joining — is `eventsource-parser`'s. Comments are reported
 * only through an optional transport-activity callback. This module yields
 * every terminated event; the translator treats `message-end` as the
 * protocol terminator, and EOF without that event is `STREAM_CLOSED` there.
 *
 * @module @workspacealberta/wa-llm-cohere/sse
 */

import { EventSourceParserStream } from 'eventsource-parser/stream'

/**
 * Parse an SSE byte stream into data payloads. Yields each terminated
 * event's `data` field in arrival order and returns at EOF. An unterminated
 * tail is dropped by spec-strict framing and is not a flushable payload.
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8 sequence.
 * @param onComment - optional transport-activity callback; comments never enter the yielded payload stream.
 * @returns each event's data payload in arrival order.
 */
export async function* parseSse(
  stream: ReadableStream<BufferSource>,
  onComment?: (comment: string) => void,
): AsyncGenerator<string> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const { data } of events) {
    yield data
  }
}
