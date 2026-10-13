/** Browser-safe connection metadata. OAuth credentials never cross this API. */
export interface ConnectionInput {
  id?: string
  name: string
  transport: 'streamable-http' | 'stdio'
  url: string
  command: string
  args: string[]
  envRefs: Record<string, string>
  enabled: boolean
  oauth: boolean
}

/** One saved connection and its current host status. */
export interface ConnectionView extends ConnectionInput {
  id: string
  status: 'disabled' | 'connecting' | 'connected' | 'sign-in-required' | 'failed'
  signedIn: boolean
}

/** Human-initiated OAuth request, bound to the browser's approved origin. */
export interface SignInRequest { id: string; origin: string }

/** OAuth completion received from the browser redirect. */
export interface OAuthCallback { state: string; code: string; error: string }

/** A temporary browser authorization URL, or an already completed sign-in. */
export interface SignInResult { authorizationUrl: string | null }
