/**
 * PostgREST filter construction.
 *
 * Deliberately free of imports: this module holds the string-building rules
 * only, so they can be exercised directly without instantiating a Supabase
 * client. `client.ts` re-exports everything here.
 */

/**
 * Build a PostgREST `or=(...)` filter matching `term` against several columns
 * with ILIKE, treating the term strictly as text.
 *
 * Why this exists: the filter grammar separates conditions with commas, so
 * interpolating raw user input let a search term add conditions of its own.
 * A search for
 *
 *     a,role.eq.super_admin
 *
 * produced `full_name.ilike.%a,role.eq.super_admin%,...`, which PostgREST
 * parsed as an extra OR predicate — a way to enumerate employees by a chosen
 * column rather than by name. RLS still filtered every row, so this disclosed
 * nothing the caller could not already read, but the SHAPE of the query was
 * under the user's control, and that is not something to leave open.
 *
 * The fix is to quote the value. Inside double quotes PostgREST treats commas,
 * parentheses and dots as literal characters, so the term can only ever be a
 * term. Backslashes and double quotes are escaped, because they are what would
 * otherwise end the quoting — and backslashes first, so the escape character
 * introduced by the second replacement is not itself escaped again.
 *
 * `%` and `_` are deliberately NOT escaped: they are ILIKE wildcards, not
 * PostgREST syntax, and they behaved as wildcards before this change. Leaving
 * them alone keeps search results identical.
 */
export function ilikeAnyFilter(columns: readonly string[], term: string): string {
  const escaped = term
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

  return columns.map(column => `${column}.ilike."%${escaped}%"`).join(',')
}
