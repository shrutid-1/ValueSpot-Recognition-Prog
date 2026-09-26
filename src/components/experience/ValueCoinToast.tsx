import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useValueCoins, type ValueCoinEvent } from '@/context/ValueCoinContext'
import { COIN_MOTION } from '@/lib/value-coins'
import { ValueCoin } from './ValueCoin'
import { ValueCoinDelta } from './ValueCoinFigure'

/**
 * What a coin movement says when it lands.
 *
 * ONE AT A TIME
 * -------------
 * The queue is drained one event per toast, never stacked. Three colleagues
 * sending coins on the same recognition is one arrival to read, not a column
 * of three cards — and the context has already merged them into a single
 * figure before they reach here.
 *
 * IT IS NOT A CELEBRATION
 * -----------------------
 * A compact panel in the corner, the same soft-black as everything else,
 * carrying the delta chip and the sentence the database wrote. It does not
 * cover the screen, does not take focus and does not stop anybody doing what
 * they were doing. Recognition is the event; coins are the receipt.
 *
 * READABLE WITHOUT THE ANIMATION
 * ------------------------------
 * The title states the movement in words and the chip states the figure.
 * Neither depends on motion or on colour to be understood, which is why the
 * reduced-motion path can collapse the movement entirely and lose nothing.
 *
 * The SPOKEN version is a separate, permanently mounted region — see the
 * host. This panel is not itself a live region, because one that appears at
 * the same moment as its text is unreliably announced: several screen
 * readers only watch regions that were already in the document.
 */
function CoinToast({ event, onDone }: { event: ValueCoinEvent; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)

  const moment = event.moment

  useEffect(() => {
    // A once-only moment is held a little longer, because it says more.
    const life = moment ? COIN_MOTION.toastMoment : COIN_MOTION.toast

    const hold = setTimeout(() => setLeaving(true), life)
    const clear = setTimeout(onDone, life + COIN_MOTION.move)

    return () => { clearTimeout(hold); clearTimeout(clear) }
  }, [moment, onDone])

  return (
    <div
      className={leaving ? 'vsx-coin-toast is-leaving' : 'vsx-coin-toast'}
      data-flow={event.flow}
      data-moment={moment ? '' : undefined}
    >
      {moment && (
        <p className="vsx-coin-moment">
          {moment.kind === 'first-coins'
            ? 'Your first Value Coins'
            : `Value milestone · ${(moment.threshold ?? 0).toLocaleString()} earned`}
        </p>
      )}

      <div className="vsx-coin-toast-body">
        <span className="vsx-coin-toast-mark" aria-hidden="true">
          <ValueCoin size={22} />
        </span>

        <div style={{ minWidth: 0, flex: 1 }}>
          {event.amount > 0 && (
            <p className="vsx-coin-toast-sum">
              <ValueCoinDelta flow={event.flow} amount={event.amount} size="lg" />
              <span className="vsx-coin-toast-unit">
                {event.flow === 'in' ? 'Value Coins' : 'Value Coins given'}
              </span>
            </p>
          )}

          <p className="vsx-coin-toast-title">{event.title}</p>
          {event.detail && <p className="vsx-coin-toast-detail">{event.detail}</p>}
        </div>

        <button
          type="button"
          className="vsx-icon-btn vsx-coin-toast-close"
          onClick={onDone}
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

/** The same movement as one sentence, for anybody listening rather than looking. */
function spoken(event: ValueCoinEvent): string {
  const parts: string[] = []

  if (event.moment?.kind === 'first-coins') parts.push('Your first Value Coins')
  if (event.moment?.kind === 'milestone') {
    parts.push(`Value milestone: ${(event.moment.threshold ?? 0).toLocaleString()} Value Coins earned`)
  }

  parts.push(event.title)

  /* Spelled out rather than signed. "−500" is read inconsistently, and this
     is the only place the figure is available to a screen reader — the chip
     itself is hidden precisely so it is not read out twice. */
  if (event.amount > 0) {
    parts.push(
      `${event.flow === 'in' ? 'Plus' : 'Minus'} ${event.amount.toLocaleString()} Value Coins`,
    )
  }

  if (event.detail) parts.push(event.detail)

  return `${parts.join('. ')}.`
}

/**
 * Where coin events surface.
 *
 * Mounted once, inside the employee shell so the theme tokens resolve, and
 * bottom-right so it never sits under the Give recognition action in the
 * opposite corner.
 *
 * The host itself never unmounts. That is what makes the live region inside
 * it work: it is in the document from the start, waiting, so text put into
 * it later is actually announced. The visible panel comes and goes.
 */
export function ValueCoinToastHost() {
  const { events, dismiss } = useValueCoins()

  const showing = events[0]

  return (
    <div data-vs-theme="dark" className="vsx-coin-toast-host">
      {/* `status`, not `alert`: coins arriving is worth knowing and is never
          urgent enough to cut across what somebody is in the middle of. */}
      <div role="status" aria-live="polite" className="sr-only">
        {showing ? spoken(showing) : ''}
      </div>

      {/* Keyed by event id so a replacement is a NEW element: React would
          otherwise reuse the node and the next toast would inherit the
          previous one's leaving state and finish its exit instead of
          starting its entrance. */}
      {showing && (
        <CoinToast key={showing.id} event={showing} onDone={() => dismiss(showing.id)} />
      )}
    </div>
  )
}
