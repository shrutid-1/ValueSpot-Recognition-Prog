import { useQuery, useMutation } from '@tanstack/react-query'
import { storeApi } from '@/lib/api'
import type { RedemptionLifecycleStatus } from '@/types'
import { keys, useInvalidate } from '@/lib/query'

/**
 * The Value Store.
 *
 *     component → hook → storeApi → RPC / RLS → locked wallet + ledger
 *
 * The store page mounts exactly two queries — the catalogue and the wallet —
 * and renders every card from the first. No card fetches anything of its own,
 * so a hundred rewards is still two requests.
 */

/** The rewards on offer. Slow-moving, so it stays fresh for a while. */
export function useStoreRewards() {
  return useQuery({
    queryKey: keys.store.rewards(),
    queryFn: () => storeApi.listRewards(),
    // A catalogue changes when HR edits it, which is rare. Five minutes
    // spares every visit to the store a refetch of the same seven rows.
    staleTime: 5 * 60_000,
  })
}

/** This person's own redemptions, newest first. */
export function useMyRedemptions(employeeId: string | undefined) {
  return useQuery({
    queryKey: keys.store.myRedemptions(employeeId ?? 'none'),
    queryFn: () => storeApi.listMyRedemptions(),
    enabled: Boolean(employeeId),
  })
}

/**
 * Redeem a reward.
 *
 * No optimistic anything, for the reason the whole coin system avoids it: a
 * balance that drops before the database agreed leaves somebody believing
 * they spent coins they still have. The new balance comes back in the same
 * response, read inside the same lock as the debit.
 */
export function useRedeemReward() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (rewardId: string) => storeApi.redeem(rewardId),
    onSuccess: () => invalidate.store(),
  })
}

/**
 * The organisation's reward requests, for HR and a Super Admin.
 *
 * 'expired' is a legal filter although nothing stores that status: the
 * function matches it against the value derived at read time (052).
 */
export function useRedemptionRequests(status: RedemptionLifecycleStatus | 'all') {
  return useQuery({
    queryKey: keys.store.requests(status),
    queryFn: () => storeApi.listRedemptions(status),
    // Two administrators can be working this queue at once, so it must not
    // sit on a stale copy — and switching tabs should not blank the table.
    staleTime: 15_000,
    placeholderData: previous => previous,
  })
}

/** Approve or reject one request. */
export function useDecideRedemption() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: storeApi.decide,
    onSuccess: () => invalidate.store(),
  })
}
