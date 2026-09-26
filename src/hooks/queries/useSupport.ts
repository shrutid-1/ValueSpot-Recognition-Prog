import { useQuery, useMutation } from '@tanstack/react-query'
import {
  supportApi, moderationApi,
  type SupportRequestStatus, type RecognitionCorrection,
} from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Correction requests and recognition moderation.
 *
 *     component → hook → supportApi/moderationApi → RPC → RLS + role check
 *
 * The hooks know nothing about tables or privileges. What they DO own is cache
 * correctness after a moderation write, which is easy to get wrong: a
 * corrected Core Value has to stop being displayed everywhere at once, not
 * just on the screen that made the change.
 */

// ── Employee ────────────────────────────────────────────────

/** This person's own correction requests, newest first. */
export function useMySupportRequests() {
  return useQuery({
    queryKey: keys.support.mine(),
    queryFn: () => supportApi.listMine(),
  })
}

export function useCreateSupportRequest() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: supportApi.createRequest,
    onSuccess: () => {
      // Their own list, and the admin queue that just gained a row — one
      // prefix covers both, because they are the same rows.
      void invalidate.support()
    },
  })
}

// ── HR and Super Admin ──────────────────────────────────────

/** The shared queue. Same rows for both roles; `status` only filters them. */
export function useSupportQueue(status: SupportRequestStatus | 'all' = 'all') {
  return useQuery({
    queryKey: keys.support.queue(status),
    queryFn: () => moderationApi.listRequests(status),
    // The whole point of the queue is that two administrators are looking at
    // it at once. Keeping the previous page on screen while refetching avoids
    // a blank table every time the filter changes.
    placeholderData: previous => previous,
  })
}

/**
 * Recalculation after a moderation write, in one place.
 *
 * Both edits and removals change what the badge engine should conclude, and
 * both need the same three things invalidated. Written once so the two
 * mutations below cannot drift.
 */
function useAfterModeration() {
  const invalidate = useInvalidate()

  return async () => {
    /*
      Badges are derived, not stored per recognition: calculate-badges
      re-aggregates approved nominations by their CURRENT core_value_id. So the
      fix for "the recognition moved to another Core Value" is to re-run it,
      not to patch anything.

      Deliberately not allowed to fail the mutation. The correction is already
      committed by the time this runs; if the recalculation cannot be reached,
      badges are briefly stale and converge on the next approval, which is a
      far better outcome than telling the moderator their correction failed
      when it did not.
    */
    await moderationApi.recalculateBadges()

    await Promise.all([
      invalidate.recognitionsAll(),
      invalidate.analytics(),
      invalidate.support(),
    ])
  }
}

export function useEditRecognition() {
  const after = useAfterModeration()

  return useMutation({
    mutationFn: (vars: { nominationId: string; correction: RecognitionCorrection }) =>
      moderationApi.editRecognition(vars.nominationId, vars.correction),
    onSuccess: after,
  })
}

export function useRemoveRecognition() {
  const after = useAfterModeration()

  return useMutation({
    mutationFn: (vars: { nominationId: string; reason?: string }) =>
      moderationApi.removeRecognition(vars.nominationId, vars.reason),
    onSuccess: after,
  })
}

export function useClaimSupportRequest() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (requestId: string) => moderationApi.claimRequest(requestId),
    onSuccess: () => { void invalidate.support() },
  })
}

/**
 * Resolve a request, applying the correction in the same call.
 *
 * `onSettled` rather than `onSuccess` for the refresh: losing the race to the
 * other administrator throws AlreadySettledError, and that is exactly when the
 * queue most needs refetching — the screen is showing an open request that is
 * no longer open.
 */
export function useResolveSupportRequest() {
  const after = useAfterModeration()

  return useMutation({
    mutationFn: (vars: {
      requestId: string
      note?: string
      correction?: RecognitionCorrection
    }) => moderationApi.resolveRequest(vars),
    onSettled: after,
  })
}

export function useRejectSupportRequest() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: { requestId: string; reason: string }) =>
      moderationApi.rejectRequest(vars.requestId, vars.reason),
    onSettled: () => { void invalidate.support() },
  })
}
