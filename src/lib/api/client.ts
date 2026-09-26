/**
 * Shared plumbing for the API layer.
 *
 * WHAT THIS LAYER IS
 * ------------------
 * An abstraction boundary, not a fake backend. Supabase remains the backend;
 * these modules are the only place in the frontend allowed to know that.
 *
 * The rule: components call business operations — `employeesApi.list()`,
 * `analyticsApi.getHrDashboard()` — and never see a table name, a column
 * list, an RPC name or a PostgREST filter. When the storage shape changes,
 * one file here changes and no component does.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a generic query passthrough. There is deliberately no `api.query(table,
 * …)` or `api.rpc(name, args)` helper: that would move the same coupling
 * behind a thinner disguise and buy nothing. Every export is a named operation
 * with a domain-shaped signature.
 *
 * SECURITY
 * --------
 * This layer adds no authorization and claims none. RLS, the SECURITY DEFINER
 * functions and the 2FA gate remain the authority, exactly as before — an API
 * method is just a nicer way to make the same request the component used to
 * make, carrying the same JWT. Nothing here can grant access the database
 * would refuse, and nothing here should ever try to decide permissions.
 */
import { supabase } from '@/lib/supabase'

export { supabase }

/**
 * Error raised by API methods.
 *
 * Carries a stable `code` so callers can branch without string-matching on
 * provider text, which changes between versions and can leak internals.
 */
export class ApiError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(message: string, code = 'unknown', cause?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.cause = cause
  }
}

/** PostgREST error shape, narrowed to what we act on. */
interface PostgrestErrorLike {
  message?: string
  code?: string
  details?: string
}

/**
 * Normalise a Supabase error into an ApiError with a message fit for a user.
 *
 * Raw provider text is deliberately not surfaced: it names tables, columns and
 * constraints, which is both confusing and more than a user needs to know.
 * The exception is 42501, where the database's own message is written for a
 * person (see migrations 026/027) and is more useful than anything generic.
 */
export function toApiError(error: unknown, fallback: string): ApiError {
  const e = error as PostgrestErrorLike | null

  if (!e) return new ApiError(fallback, 'unknown', error)

  switch (e.code) {
    case '23505':
      return new ApiError('That record already exists.', 'duplicate', error)
    case '23503':
      return new ApiError('That change references something that no longer exists.', 'missing_reference', error)
    case '42501':
      // Written for humans by the database guards; pass it through.
      return new ApiError(e.message ?? 'You do not have permission to do that.', 'forbidden', error)
    case '23514':
    case 'P0002':
      /*
        The Value Coin, Value Store and recognition functions refuse with a
        sentence written for the person ("You have 400 earned Value Coins.
        Movie Voucher costs 1000.") under check_violation / no_data_found.
        Those are passed through. A table CHECK constraint raises the same
        code with Postgres' own wording, which names the table and the
        constraint — that one still gets the fallback.
      */
      if (e.message && !/violates check constraint|relation "/.test(e.message)) {
        return new ApiError(e.message, 'refused', error)
      }
      return new ApiError(fallback, e.code, error)
    case 'PGRST301':
    case '401':
      return new ApiError('Your session has expired. Please sign in again.', 'unauthenticated', error)
    case 'PGRST202':
      /*
        The function is not in PostgREST's schema cache — almost always a
        migration that has not been applied to this database, occasionally one
        applied while the cache is stale.

        Worth its own case because the generic fallback ("Could not remove that
        department") sends people looking for a bug in the screen, when the
        screen is fine and the database is simply missing the function it
        calls. Says so instead, and names the function in the console for
        whoever has to fix it.
      */
      console.warn(
        '[ValueSpot] A database function this screen needs is missing — a migration ' +
        'is probably unapplied. Run `npx supabase db push`, then `npm run doctor`.',
        e.message,
      )
      return new ApiError(
        'This feature is not installed on your database yet. Ask IT to apply the ' +
        'latest database migrations.',
        'not_installed',
        error,
      )
    default:
      return new ApiError(fallback, e.code ?? 'unknown', error)
  }
}

/**
 * Read every row a query matches, a page at a time.
 *
 * PostgREST returns at most the project's `max_rows` per response (1000 on
 * Supabase unless changed) and says nothing when it stops there, so a single
 * request for "all approved recognitions" is quietly cut short once there are
 * more — and every figure built from it is wrong without anything failing.
 *
 * `page` builds the query for one inclusive range and must ORDER it by a
 * unique key, or rows can repeat or go missing between pages. Pages are read
 * until one comes back empty, which stays correct whatever `max_rows` is set
 * to. `max` stops early once that many rows are in hand.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = Number.POSITIVE_INFINITY,
): Promise<{ data: T[]; error: unknown }> {
  const PAGE = 1000
  const rows: T[] = []

  while (rows.length < max) {
    const { data, error } = await page(rows.length, rows.length + PAGE - 1)
    if (error) return { data: rows, error }
    if (!data || data.length === 0) break
    rows.push(...data)
  }

  return { data: rows.length > max ? rows.slice(0, max) : rows, error: null }
}

/** Unwrap a Supabase `{ data, error }`, throwing a normalised ApiError. */
export function unwrap<T>(
  result: { data: T | null; error: unknown },
  fallback: string,
): T {
  if (result.error) throw toApiError(result.error, fallback)
  if (result.data === null) throw new ApiError(fallback, 'empty')
  return result.data
}

/** Same, but an absent row is legitimate rather than an error. */
export function unwrapMaybe<T>(
  result: { data: T | null; error: unknown },
  fallback: string,
): T | null {
  if (result.error) throw toApiError(result.error, fallback)
  return result.data
}

/** Filter construction lives in its own import-free module — see filters.ts. */
export { ilikeAnyFilter } from './filters'

/** Cursorless pagination, which is all the current screens need. */
export interface PageRequest {
  page?: number
  pageSize?: number
}

export interface Page<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export const DEFAULT_PAGE_SIZE = 50

/** Convert a page request into the inclusive [from, to] PostgREST wants. */
export function pageRange(req: PageRequest = {}): { from: number; to: number; page: number; pageSize: number } {
  const page = Math.max(1, req.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, req.pageSize ?? DEFAULT_PAGE_SIZE))
  const from = (page - 1) * pageSize
  return { from, to: from + pageSize - 1, page, pageSize }
}

export function toPage<T>(
  rows: T[],
  total: number | null,
  page: number,
  pageSize: number,
): Page<T> {
  const resolved = total ?? rows.length
  return {
    rows,
    total: resolved,
    page,
    pageSize,
    hasMore: page * pageSize < resolved,
  }
}
