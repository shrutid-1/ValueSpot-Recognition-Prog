import { useState } from 'react'

/**
 * The Value Coin mark.
 *
 * ── TO USE YOUR OWN ARTWORK ─────────────────────────────────
 * Drop the file at `public/value-coin.png` (or .svg, .webp — update the
 * constant below to match) and it appears everywhere a coin is shown. There
 * is no other place to change: every balance, every amount and every send
 * button renders this component.
 *
 * Until that file exists, a plain gold disc stands in. It is not a logo and
 * is not meant to be one — it is a placeholder that keeps the layout honest
 * so nothing shifts when the real mark arrives.
 * ────────────────────────────────────────────────────────────
 *
 * The fallback is driven by an onError on the <img>, not by checking whether
 * the file exists: a missing file in a Vite public folder is a 404, the
 * browser reports it to the element, and the element swaps itself out. That
 * works the same in dev and in a built bundle, and needs no build step to
 * notice the artwork was added.
 */
const COIN_SRC = '/value-coin.png'

interface ValueCoinProps {
  /** Pixel size of the mark. Matches the line-height of the text beside it. */
  size?: number
  className?: string
}

export function ValueCoin({ size = 16, className }: ValueCoinProps) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          /* A struck disc: a rim and a face, so it reads as a coin at 14px
             rather than as a dot. */
          background: 'radial-gradient(circle at 35% 30%, #F5CE54 0%, #E0AE2A 62%, #B8871A 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.22)',
        }}
      />
    )
  }

  return (
    <img
      src={COIN_SRC}
      alt=""
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      onError={() => setMissing(true)}
      style={{ display: 'inline-block', flexShrink: 0, borderRadius: '50%' }}
    />
  )
}

/**
 * An amount of Value Coins: the mark, then the figure.
 *
 * One component so the coin and its number never drift apart in spacing or
 * alignment, and so the accessible reading is a phrase — "120 Value Coins" —
 * rather than an image followed by a bare number.
 */
export function ValueCoinAmount({
  amount,
  size = 16,
  fontSize = 15,
  tone = 'default',
}: {
  amount: number
  size?: number
  fontSize?: number
  /** 'credit' and 'debit' tint the figure in the ledger; posts use 'default'. */
  tone?: 'default' | 'credit' | 'debit'
}) {
  const color =
    tone === 'credit' ? 'var(--vsx-red)'
      : tone === 'debit' ? 'var(--vsx-text-3)'
        : 'inherit'

  return (
    <span
      className="inline-flex items-center"
      style={{ gap: 6 }}
      aria-label={`${amount} Value Coin${amount === 1 ? '' : 's'}`}
    >
      <ValueCoin size={size} />
      <span className="vsx-fig" style={{ fontSize, color }}>
        {tone === 'credit' ? '+' : tone === 'debit' ? '−' : ''}
        {amount.toLocaleString()}
      </span>
    </span>
  )
}
