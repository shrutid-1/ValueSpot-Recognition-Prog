import { useQuery, useMutation, useInfiniteQuery } from '@tanstack/react-query'
import {
  recognitionsApi,
  type MyRecognitionsTab,
  type ApprovalAction,
  type FeedSort,
} from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'
import { PAGE_SIZE } from '@/lib/constants'

/**
 * Recognitions — the company feed, one person's lists, and an approver's queue.
 */

/**
 * The company feed, page by page.
 *
 * `getFeed` was already page-shaped, so this is a change of bookkeeping rather
 * than of behaviour: same page size, same ordering, same "there may be more"
 * rule. What moves is who accumulates the pages — React Query rather than the
 * component's own array, which means returning to the feed no longer starts
 * again from page one.
 *
 * Each page carries the viewer's appreciations for its own rows, so those are
 * flattened alongside the items rather than fetched separately.
 */
export function useRecognitionFeed(
  employeeId: string | undefined,
  options: { sort?: FeedSort; coreValueId?: string | null } = {},
) {
  const sort = options.sort ?? 'recent'
  const coreValueId = options.coreValueId ?? null

  return useInfiniteQuery({
    queryKey: keys.recognitions.feed(employeeId ?? '', sort, coreValueId),
    queryFn: ({ pageParam }) => recognitionsApi.getFeed({
      page: pageParam,
      pageSize: PAGE_SIZE,
      employeeId,
      sort,
      coreValueId,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
  })
}

/**
 * Recognitions this person received or gave.
 *
 * Keyed by employee AND tab, so switching tabs serves from cache instead of
 * refetching — previously every switch was a fresh request, including
 * switching straight back.
 */
export function useMyRecognitions(employeeId: string | undefined, tab: MyRecognitionsTab) {
  return useQuery({
    queryKey: keys.recognitions.mine(employeeId ?? 'none', tab),
    queryFn: () => recognitionsApi.getMine({ employeeId: employeeId!, tab }),
    enabled: Boolean(employeeId),
  })
}

/**
 * The recognitions this person may review.
 *
 * Takes no argument, because the query does not: the scope — a Manager's routed
 * recognitions, or the whole organisation for HR and a Super Admin — is decided
 * in the database from the session.
 *
 * Kept short-lived, and more so than before. Three authorities can now be
 * looking at the same item at once, so a stale queue is not just unhelpful, it
 * is how someone clicks Approve on something that was rejected a minute ago.
 * The refetch is what usually prevents that; record_nomination_decision() is
 * what actually prevents it.
 */
export function useApprovalQueue() {
  return useQuery({
    queryKey: keys.recognitions.approvalQueue(),
    queryFn: () => recognitionsApi.getApprovalQueue(),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Approved recognitions received by a manager's team.
 *
 * Keyed by manager, on the key the cache contract already reserved for it
 * (`keys.recognitions.team`). The screen previously fetched this in its own
 * useEffect, which put it outside the cache entirely — so the invalidations
 * that promise to refresh "a manager's team list" could not reach it, and a
 * failed request had nowhere to report itself.
 *
 * Disabled until the manager is known, so read `isLoading` rather than
 * `isPending` at the call site: a disabled query stays pending forever.
 */
export function useTeamRecognitions(managerId: string | undefined) {
  return useQuery({
    queryKey: keys.recognitions.team(managerId ?? 'none'),
    queryFn: () => recognitionsApi.getTeamFeedForManager(managerId!),
    enabled: Boolean(managerId),
  })
}

/**
 * Approve, reject or request clarification.
 *
 * No optimistic update, and now for a second reason as well as the first. The
 * decision runs through the process-approval Edge Function, which orchestrates
 * notifications and badge recalculation — there is no local rollback that could
 * honestly represent a partial failure of that. And the call can legitimately
 * come back refused: another authority may have decided the same recognition
 * while this one was typing a reason. Showing an optimistic "Approved" that then
 * becomes "Rejected by HR — Priya" is the confusion this feature exists to
 * remove.
 *
 * The refusal is not swallowed — `onError` is deliberately absent so the page
 * can show which authority got there first.
 */
export function useDecideApproval() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: {
      nominationId: string
      action: ApprovalAction
      reason?: string
      clarificationNote?: string
    }) => recognitionsApi.decide(vars),

    /*
      The queue is refetched whether the decision was recorded OR REFUSED.

      A refusal means somebody else decided this recognition while the modal was
      open, so the copy on screen is exactly the one that must not be left there
      — it still says "pending" and still offers three buttons. onSettled rather
      than onSuccess is the whole of that.
    */
    onSettled: () => { void invalidate.approvalQueues() },

    onSuccess: () => {
      /*
        Analytics moved too — a decision changes the pending count and the trend
        on the HR dashboard. Only on success: a refused attempt changed nothing.

        Not invalidated: the employee directory, reference lists, or admin
        listings. None of them can have changed, and refetching them would be
        the over-broad invalidation this is meant to avoid.
      */
      void invalidate.analytics()

      /*
        And every report, because a decision moves the numbers reports are
        built from — the status mix, the core-value tallies, and the badge an
        approval may just have triggered.

        This reaches the AI insights too, and that is cheap rather than
        expensive: the Edge Function keys its cache on a hash of the facts, so
        a refetch whose underlying figures did not move is a cache hit and
        costs no generation.
      */
      void invalidate.reports()

      /*
        An approval is precisely what puts a recognition into a team list, so
        the list has to be refetched or the manager who just approved it sees
        a cached page without it. This became necessary when Team Recognition
        moved into the cache — while it fetched in its own effect it happened
        to refetch on every mount.
      */
      void invalidate.teamRecognitions()
    },
  })
}

/** Answer a clarification request and put it back in the queue. */
export function useResubmitWithClarification(employeeId: string | undefined) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: {
      nominationId: string
      whatHappened: string
      whatImpact: string
    }) => recognitionsApi.resubmitWithClarification(vars),

    onSuccess: () => {
      // The author's own lists, and whichever approver now has it back.
      if (employeeId) void invalidate.myRecognitions(employeeId)
      void invalidate.approvalQueues()
    },
  })
}
