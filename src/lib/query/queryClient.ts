import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'

/**
 * Server-state cache.
 *
 * The problem it solves: every navigation refetched everything from zero,
 * because there was nowhere for a previous result to live. Returning to a
 * screen you left ten seconds ago meant running the same queries again.
 *
 * Defaults are deliberately conservative. Several people edit this data, and an
 * approval queue that is stale is worse than one that is slow — so nothing is
 * cached aggressively and nothing is served indefinitely.
 *
 * It caches SERVER state only. Authentication, the session and the emailed
 * second factor stay with AuthContext: putting a security-relevant value behind
 * a stale-time is the mistake this library makes easy, and none of it is
 * request/response shaped anyway.
 */

/** Refusals that will not become allowals by asking again. */
const SETTLED_ANSWERS = [
  'forbidden',
  'unauthenticated',
  'not_found',
  'duplicate',
  'last_admin',
  'invalid_domain',
]

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /*
        Fresh for 30 seconds. Long enough that navigating away and back is
        instant; short enough that a colleague's approval appears promptly.
        Screens needing tighter or looser behaviour override it per query —
        reference data sets minutes, an approval queue could set less.
      */
      staleTime: 30_000,

      // Keep unused data for five minutes, so back-navigation is instant, then
      // let it go rather than growing the cache for the life of the tab.
      gcTime: 5 * 60_000,

      /*
        No refetch on window focus. Alt-tabbing back to a dashboard should not
        re-run its whole request wave — that is precisely the refetch storm this
        layer exists to remove. Mutations invalidate what they affect, which is
        both cheaper and more accurate than polling on focus.
      */
      refetchOnWindowFocus: false,

      // Reconnecting is a better signal than focus: data may genuinely have
      // moved on while the machine was offline.
      refetchOnReconnect: true,

      retry: (failureCount, error) => {
        /*
          Never retry a settled answer. A 'forbidden' from RLS or from one of
          the SECURITY DEFINER guards is the database's considered response;
          asking twice more just produces three identical refusals and delays
          the error the user needs to see.
        */
        if (error instanceof ApiError && SETTLED_ANSWERS.includes(error.code)) {
          return false
        }
        return failureCount < 2
      },
    },

    mutations: {
      // A failed write must never be replayed automatically — it may have
      // partially succeeded server-side, and several of these operations write
      // audit rows or queue email.
      retry: false,
    },
  },
})
