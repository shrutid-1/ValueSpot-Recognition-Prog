import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely, resolving conflicts */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Generate a UUID v4 */
export function generateUUID(): string {
  return crypto.randomUUID()
}

/**
 * Build a deterministic idempotency key from the content of a submission.
 *
 * A random key per click gives no protection at all — each click produces a
 * different key and so a different row. Deriving the key from the content means
 * a double-click, a retry, and a browser refresh followed by re-submission all
 * collide on the same key and are rejected by the UNIQUE constraint
 * (REQ-010-06).
 */
export async function contentIdempotencyKey(parts: (string | null)[]): Promise<string> {
  // NUL separator so ["ab","c"] and ["a","bc"] cannot collide.
  const input = parts.map(p => p ?? '').join('\u0000')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Truncate text to a maximum length with ellipsis */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/** Get initials from a full name (up to 2 letters) */
export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/** Pluralize a word based on count */
export function pluralize(count: number, singular: string, plural?: string): string {
  const pluralForm = plural ?? singular + 's'
  return count === 1 ? singular : pluralForm
}

/** Determine recognition source based on nominator/nominee roles */
export function classifyRecognitionSource(
  nominatorRole: string,
  _nomineeRole: string,
  nominatorId: string,
  projectManagerId: string | null
): 'peer' | 'manager' | 'hr' | 'leadership' {
  if (nominatorRole === 'hr_admin') return 'hr'
  if (nominatorRole === 'super_admin') return 'leadership'
  /*
    'manager' means the recognizer runs the project this was filed against.
    It used to mean "is the nominee's line manager", but employees no longer
    have one (migration 030) — managers relate to projects now.
  */
  if (nominatorRole === 'manager' && nominatorId === projectManagerId) return 'manager'
  if (nominatorRole === 'manager') return 'peer' // manager recognising work on someone else's project
  return 'peer'
}
