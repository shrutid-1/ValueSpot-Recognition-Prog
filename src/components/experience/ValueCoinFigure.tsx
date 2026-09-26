import type { CSSProperties } from 'react'
import { useCountUp } from '@/hooks/useCountUp'
import { useCoinPulse } from '@/hooks/useCoinPulse'
import type { CoinAccount, CoinFlow } from '@/context/ValueCoinContext'
import { ValueCoin } from './ValueCoin'

/**
 * The one gesture the whole Value Coin system is built from.
 *
 * A small pill carrying the change — +100, −500 — which rises a few pixels
 * and fades while the figure beneath it settles to its new value. That is
 * the entire animation language: it appears on the wallet hero, in the
 * navigation chip, inside the redeem dialog and on the toast, at different
 * sizes and nowhere in a different shape.
 *
 * It is aria-hidden on purpose. The chip is a duplicate — the figure beside
 * it is already correct, and a toast states the movement in words — so
 * announcing it again would read the same event out twice. Nothing here is
 * the only carrier of anything.
 */
export function ValueCoinDelta({
  flow, amount, size = 'sm',
}: {
  flow: CoinFlow
  amount: number
  size?: 'sm' | 'lg'
}) {
  return (
    <span
      className={size === 'lg' ? 'vsx-coin-delta is-lg' : 'vsx-coin-delta'}
      data-flow={flow}
      aria-hidden="true"
    >
      {flow === 'in' ? '+' : '−'}{amount.toLocaleString()}
    </span>
  )
}

interface ValueCoinFigureProps {
  /** The balance, exactly as the backend reported it. */
  value: number
  /** Which balance this is, so it lights up when that one moves. */
  account: CoinAccount
  /** Shown instead of the figure while the first read is in flight. */
  pending?: boolean
  className?: string
  style?: CSSProperties
  /** Large enough to carry the delta chip beside rather than above it. */
  deltaSize?: 'sm' | 'lg'
}

/**
 * A balance that settles rather than jumps.
 *
 * Three things happen when the number changes, and they are deliberately
 * the same three everywhere: the figure counts to its new value over a short
 * ease, the delta floats off, and the figure warms to the direction colour
 * before returning to white.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * Predict. `value` is the balance the database reported and the count always
 * ends exactly there. The pulse comes from a confirmed movement, so a figure
 * cannot animate towards a number that turned out not to be true.
 *
 * On first paint the figure is simply correct — no winding up from zero. A
 * balance is what the reader came to check, and making them watch it arrive
 * is the slot-machine effect this system avoids.
 */
export function ValueCoinFigure({
  value, account, pending = false, className, style, deltaSize = 'sm',
}: ValueCoinFigureProps) {
  const pulse = useCoinPulse(account)
  /* `live` is what stops the first real balance counting up from the
     placeholder zero a caller passes while its fetch is in flight. */
  const shown = useCountUp(value, { live: !pending })

  return (
    <span className="vsx-coin-figure" data-lit={pulse ? pulse.flow : undefined}>
      <span className={className ? `vsx-fig ${className}` : 'vsx-fig'} style={style}>
        {pending ? '—' : shown.toLocaleString()}
      </span>

      {pulse && <ValueCoinDelta flow={pulse.flow} amount={pulse.amount} size={deltaSize} />}
    </span>
  )
}

/**
 * Coins carried by one recognition, as a quiet reading rather than a badge.
 *
 * Not a balance, so it has no account and never pulses — it belongs to the
 * post, not to the reader. It still SETTLES, because sending coins on a
 * recognition refetches the feed and watching that post's total tick up is
 * the confirmation the send actually landed on the right one.
 *
 * Set in the muted text colour on purpose. The person, the story, the Core
 * Value and the behaviour are what a recognition is for; coins are the
 * reward layer, and a gold pill shouting a number would invert that.
 */
export function ValueCoinTotal({ amount }: { amount: number }) {
  const shown = useCountUp(amount)

  return (
    <span
      className="vsx-post-coins"
      aria-label={`${amount} Value Coin${amount === 1 ? '' : 's'} on this recognition`}
    >
      <ValueCoin size={14} />
      <span className="vsx-fig" style={{ fontSize: 14 }}>{shown.toLocaleString()}</span>
      <span>Value Coins</span>
    </span>
  )
}
