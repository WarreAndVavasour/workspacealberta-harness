/**
 * Explicit media handling for procurement synthesis. Cohere vision accepts bounded image inputs;
 * raw PDFs and video have no direct model path, so they are reported as unsupported rather than
 * claimed as analyzed. Remote URLs are refused outright: acquisition stays inside the existing
 * web/file permission seams instead of letting a document smuggle an arbitrary fetch past them.
 * @module @workspacealberta/wa-procurement-base/multimodal-analyzer
 */

/** Maximum images per synthesis request (Cohere image-count bound). */
export const MAX_IMAGES = 20

/** Image media types with a direct Cohere vision path. */
const SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']

/** One validated image payload, sized in bytes for budget accounting. */
export interface AnalyzableImage {
  /** Declared media type, echoed back for the request builder. */
  mime: string
  /** Decoded payload size in bytes. */
  bytes: number
}

/** Media readiness for one synthesis request. `images` is always present (empty when unsupported). */
export interface MediaPlan {
  /** Whether the request may proceed to the model. */
  supported: boolean
  /** Machine reason when unsupported (`UNSUPPORTED_PDF`, `UNSUPPORTED_VIDEO`, `UNSUPPORTED_MEDIA`). */
  reason?: string | undefined
  /** Validated images; empty when unsupported or when no media was supplied. */
  images: AnalyzableImage[]
}

/**
 * Decode one base64 data URL into its byte size. The URL must name the declared media type exactly;
 * anything else (remote URLs, mismatched types, bare payloads) is refused.
 * @param mime - the declared media type.
 * @param url - the candidate data URL.
 * @returns the validated image payload descriptor.
 */
function decodeImage(mime: string, url: string): AnalyzableImage {
  const prefix = `data:${mime};base64,`
  if (!url.startsWith(prefix)) {
    throw new Error('procurement media: images must be base64 data URLs naming their media type')
  }
  return { mime, bytes: Buffer.from(url.slice(prefix.length), 'base64').length }
}

/**
 * Decide whether one synthesis request's media may proceed. PDFs and video return an explicit
 * unsupported outcome (the caller records a coverage gap); oversized or remote image payloads
 * throw before any provider call.
 * @param mime - media type of the supplied payloads.
 * @param dataUrls - base64 data URLs (images only).
 * @param maxBytes - total decoded-byte budget for the request.
 * @returns the media plan for the request.
 */
export function prepareMedia(mime: string, dataUrls: readonly string[], maxBytes: number): MediaPlan {
  if (mime === 'application/pdf') return { supported: false, reason: 'UNSUPPORTED_PDF', images: [] }
  if (mime.startsWith('video/')) return { supported: false, reason: 'UNSUPPORTED_VIDEO', images: [] }
  if (!SUPPORTED_IMAGE_MIMES.includes(mime)) {
    return { supported: false, reason: 'UNSUPPORTED_MEDIA', images: [] }
  }
  if (dataUrls.length > MAX_IMAGES) {
    throw new Error(`procurement media: at most ${MAX_IMAGES} images per request (got ${dataUrls.length})`)
  }
  const images = dataUrls.map(url => decodeImage(mime, url))
  const total = images.reduce((sum, image) => sum + image.bytes, 0)
  if (total > maxBytes) {
    throw new Error(`procurement media: payload ${total} bytes exceeds ${maxBytes} byte budget`)
  }
  return { supported: true, images }
}
