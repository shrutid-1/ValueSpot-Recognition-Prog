import { useQuery, useMutation } from '@tanstack/react-query'
import { coinAdminApi, type CoinPolicy } from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Value Coins, from HR's side.
 *
 * Both mutations invalidate broadly, which is unusual in this codebase and
 * right here. Changing the monthly allowance changes what every employee's
 * next top-up will be and what the wallet screen says the allowance is;
 * adjusting one person's balance changes a number they may be looking at in
 * another tab. Neither caller knows which of those are cached, and a wrong
 * guess leaves a stale balance on a screen about money.
 */

/** The current policy. */
export function useCoinPolicy() {
  return useQuery({
    queryKey: keys.coinAdmin.policy(),
    queryFn: () => coinAdminApi.getPolicy(),
  })
}

export function useSaveCoinPolicy() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (policy: CoinPolicy) => coinAdminApi.setPolicy(policy),
    onSuccess: () => invalidate.coinAdmin(),
  })
}

/** Every employee's balances, filtered by the database. */
export function useAdminWallets(search: string) {
  return useQuery({
    queryKey: keys.coinAdmin.wallets(search),
    queryFn: () => coinAdminApi.listWallets(search),
    // Typing in the search box should not blank the table under it.
    placeholderData: previous => previous,
  })
}

export function useAdjustWallet() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: coinAdminApi.adjust,
    onSuccess: () => invalidate.coinAdmin(),
  })
}
