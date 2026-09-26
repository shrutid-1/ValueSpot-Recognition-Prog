import type { Session } from '@supabase/supabase-js'

/**
 * Reading facts out of the current access token.
 *
 * Presentation only. Whether a session may do anything is decided by
 * session_second_factor_ok() in the database, which reads a table the browser
 * cannot touch — never by anything computed here.
 *
 * Supabase stamps every token with `amr` (which methods authenticated it) and
 * `session_id`. The database uses `amr` to insist a code is only ever issued
 * to a password-authenticated session, and `session_id` to bind the code to
 * that session. Measured on this project, `session_id` survives access-token
 * refresh unchanged, which is why verification does not have to be repeated.
 */

/** Decode a JWT payload without a library. Returns null on anything odd. */
function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    // base64url -> base64, then restore the padding atob() insists on.
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The authentication methods recorded on this session, e.g. ['password']. */
export function sessionAuthMethods(session: Session | null): string[] {
  if (!session?.access_token) return []
  const payload = decodePayload(session.access_token)
  const amr = payload?.amr

  if (!Array.isArray(amr)) return []
  return amr
    .map(entry =>
      typeof entry === 'string'
        ? entry
        : (entry as { method?: unknown } | null)?.method,
    )
    .filter((m): m is string => typeof m === 'string')
}

/** The session id this token belongs to; stable across token refreshes. */
export function sessionId(session: Session | null): string | null {
  if (!session?.access_token) return null
  const value = decodePayload(session.access_token)?.session_id
  return typeof value === 'string' ? value : null
}
