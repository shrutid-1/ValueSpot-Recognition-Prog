import { useEffect, useRef, useState } from 'react'
import { useValueCoins, type CoinAccount, type CoinFlow } from '@/context/ValueCoinContext'
import { COIN_MOTION } from '@/lib/value-coins'

export interface CoinPulse {
  flow: CoinFlow
  amount: number
}

/**
 * Whether this balance moved a moment ago, and by how much.
 *
 * Used by anything showing a balance to light itself briefly and to float
 * the delta — the whole highlight-and-return described in the wallet brief,
 * in one subscription.
 *
 * WHY IT DOES NOT FIRE ON MOUNT
 * -----------------------------
 * The last movement is remembered for as long as the session lasts, so a
 * component mounting after one would otherwise replay it — and every visit
 * back to the wallet would re-announce the same 100 coins. The movement
 * already on the books when this mounts is recorded as seen, so only a
 * change WHILE WATCHING lights anything up. The toast has already told
 * somebody who was elsewhere at the time.
 *
 * The timer is cleared on unmount and whenever a newer movement supersedes
 * the one being shown, so nothing is left running after the moment passes.
 */
export function useCoinPulse(account: CoinAccount): CoinPulse | null {
  const { movement } = useValueCoins()
  const current = movement[account]

  const seen = useRef<string | null>(current?.id ?? null)
  const [pulse, setPulse] = useState<CoinPulse | null>(null)

  useEffect(() => {
    if (!current || current.id === seen.current) return

    seen.current = current.id
    setPulse({ flow: current.flow, amount: current.amount })

    const timer = setTimeout(() => setPulse(null), COIN_MOTION.hold + COIN_MOTION.event)
    return () => clearTimeout(timer)
  }, [current])

  return pulse
}
