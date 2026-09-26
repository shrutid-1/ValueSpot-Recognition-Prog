import { useQuery, useMutation } from '@tanstack/react-query'
import { walletApi, type ActivityFilter } from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Value Coins.
 *
 *     component → hook → walletApi → RPC / view → locked wallets + ledger
 *
 * The hooks own cache correctness after a send and nothing else. Whether a
 * send is allowed, whether the balance covers it and who the coins may go to
 * are decided inside send_value_coins(), which is the only thing in the
 * system that can move a balance.
 */

/**
 * This person's balance, opening the wallet on first use.
 *
 * The query function is the OPENING call, not a plain read, which is what
 * makes "granted once, on first login" true without a separate bootstrap step
 * somewhere in AuthContext. It is idempotent — the grant happens on the
 * insert that created the row and never again, and the function takes a read
 * fast-path for everybody who already has one — so running it wherever the
 * balance is shown costs one cheap round trip and removes a whole class of
 * "the new joiner never got their coins" bug.
 */
export function useWalletBalance(employeeId: string | undefined) {
  return useQuery({
    queryKey: keys.wallet.balance(employeeId ?? 'none'),
    queryFn: () => walletApi.ensure(),
    enabled: Boolean(employeeId),
  })
}

/**
 * Every figure the wallet screen states, in one query.
 *
 * One query because they are one fact from six angles. Fetched separately,
 * a balance from one moment can sit beside a month total from another, and
 * the two will occasionally not add up — on a screen about money, the reader
 * is right to believe the screen rather than to assume a race.
 */
export function useWalletSummary(employeeId: string | undefined) {
  return useQuery({
    queryKey: keys.wallet.summary(employeeId ?? 'none'),
    queryFn: () => walletApi.summary(),
    enabled: Boolean(employeeId),
  })
}

/** This person's movements, newest first, filtered in the database. */
export function useWalletActivity(
  employeeId: string | undefined,
  filter: ActivityFilter = 'all',
  limit = 40,
) {
  return useQuery({
    queryKey: keys.wallet.activity(employeeId ?? 'none', filter, limit),
    queryFn: () => walletApi.activity(filter, limit),
    enabled: Boolean(employeeId),
    // Switching tabs should not blank the list it is replacing.
    placeholderData: previous => previous,
  })
}

/**
 * Send Value Coins on a recognition.
 *
 * No optimistic anything. A balance is the one number in this product where
 * showing a hopeful value is worse than showing a stale one: a send that
 * fails after the balance has already dropped leaves somebody believing they
 * spent coins they still have, and the failure they would have to notice is
 * a toast that may already be gone.
 *
 * So the balance moves when the database says it moved — and it comes back in
 * the same response, read inside the same lock as the debit, which is as
 * current as a balance can be.
 */
export function useSendValueCoins() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: walletApi.send,
    onSuccess: () => invalidate.wallet(),
  })
}
