import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Reward } from '@/types'
import { ApiError } from '@/lib/api'
import type { RedeemResult } from '@/lib/api'
import { useRedeemReward } from '@/hooks/queries'
import { useValueCoins } from '@/context/ValueCoinContext'
import { validityLabel } from '@/lib/reward-validity'
import { formatIST } from '@/lib/date-utils'
import { CATEGORY_MARK } from './rewardMarks'
import { ValueCoin } from './ValueCoin'
import { ValueCoinDelta } from './ValueCoinFigure'
import { dismissOnBackdrop } from '@/lib/backdrop'

interface RewardCardProps {
  reward: Reward
  /** The viewer's EARNED balance. Never their giving budget. */
  earned: number
}

/**
 * One reward in the Value Store.
 *
 * THE CARD HAS TWO STATES AND THEY ARE DIFFERENT OBJECTS
 * -----------------------------------------------------
 * A reward you can afford and one you cannot are not the same card with one
 * button greyed out. Within reach, the card is at full contrast and ends in
 * an action. Out of reach, it recedes and ends in a DISTANCE — "300 more to
 * go", over a thin rule showing how far along you are.
 *
 * That is the one deliberate flourish on this screen, and it earns its place:
 * a dead button tells somebody they cannot have something, while a distance
 * tells them what it would take. In a product whose currency is earned by
 * colleagues recognising you, the second is the truer reading.
 *
 * Everything else stays quiet — no per-card hover lift, no gradient, no
 * shadow. The price carries the card.
 */
export function RewardCard({ reward, earned }: RewardCardProps) {
  const [confirming, setConfirming] = useState(false)

  const affordable = earned >= reward.coin_price
  const shortfall = Math.max(reward.coin_price - earned, 0)
  const progress = reward.coin_price > 0
    ? Math.min(100, (earned / reward.coin_price) * 100)
    : 0

  const mark = CATEGORY_MARK[reward.category] ?? CATEGORY_MARK.everyday
  const Mark = mark.icon

  return (
    <>
      <article className={affordable ? 'vsx-reward' : 'vsx-reward is-locked'}>
        <p className="vsx-reward-shelf">
          <Mark size={14} aria-hidden="true" strokeWidth={1.8} />
          {mark.label}
        </p>

        <h3 className="vsx-reward-name">{reward.name}</h3>

        {reward.description && (
          <p className="vsx-reward-desc">{reward.description}</p>
        )}

        {/* Eligibility is free text HR writes for people to read — it is not
            a rule anything enforces, so it is shown as the note it is. */}
        {reward.eligibility_criteria && (
          <p className="vsx-reward-note">{reward.eligibility_criteria}</p>
        )}

        <div className="vsx-reward-foot">
          <p className="vsx-reward-price">
            <ValueCoin size={19} />
            <span className="vsx-fig" style={{ fontSize: 26 }}>
              {reward.coin_price.toLocaleString()}
            </span>
          </p>

          {/*
            "14-day validity", never "expires in 14 days". Nothing on a shelf
            has an expiry date yet — the clock starts when the reward is
            approved, which has not happened and might not. A date here would
            be one the product cannot honour.
          */}
          <p className="vsx-reward-note" style={{ marginTop: 0 }}>
            {[validityLabel(reward.redemption_validity_days),
              reward.requires_approval ? 'needs HR approval' : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        {affordable ? (
          <button
            type="button"
            className="vsx-btn vsx-btn-primary vsx-btn-sm vsx-reward-action"
            onClick={() => setConfirming(true)}
          >
            Redeem
          </button>
        ) : (
          <div className="vsx-reward-progress">
            <div className="vsx-reward-track" role="img" aria-label={`${shortfall} more Value Coins needed`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="vsx-reward-note" style={{ marginTop: 8 }}>
              {shortfall.toLocaleString()} more to go
            </p>
          </div>
        )}
      </article>

      {confirming && (
        <RedeemDialog
          reward={reward}
          earned={earned}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────

/**
 * The confirmation.
 *
 * It states the three numbers that matter — the cost, what you have, what is
 * left — because redeeming is the one action in this product that spends
 * something, and the arithmetic should be done for the reader rather than by
 * them.
 *
 * The button says what happens and keeps saying it: "Redeem" opens this,
 * "Redeem reward" commits it, and what comes back names the state the
 * backend actually reached — "Reward redeemed" when it is done, "Redemption
 * requested" when HR still has to decide. Those are different outcomes and
 * saying the first for the second would be announcing a reward nobody has
 * approved yet.
 *
 * THE RECEIPT
 * -----------
 * The success state leads with what left the wallet — −500, beside the
 * reward it bought — because that is the part a reader needs to reconcile
 * against their balance later. Every figure on it comes back from
 * redeem_reward() rather than from the card that opened the dialog: HR can
 * reprice a reward between the catalogue loading and somebody pressing
 * Redeem, and the receipt has to state what was actually charged.
 *
 * No toast accompanies it. The dialog is already explaining the movement, so
 * the hint is marked `inline` — the balances still settle everywhere else,
 * they just do not get announced twice.
 */
function RedeemDialog({
  reward, earned, onClose,
}: { reward: Reward; earned: number; onClose: () => void }) {
  const redeem = useRedeemReward()
  const { attribute } = useValueCoins()
  const [error, setError] = useState<string | null>(null)
  /* Held as the RESULT, not as a flag: the cost, the name and the term on
     the receipt are the ones the database recorded, which may not be the
     ones this card was rendered from. */
  const [done, setDone] = useState<RedeemResult | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const confirm = async () => {
    if (redeem.isPending) return
    setError(null)
    try {
      const result = await redeem.mutateAsync(reward.id)

      attribute({
        account: 'earned',
        flow: 'out',
        title: result.status === 'pending' ? 'Redemption requested' : 'Reward redeemed',
        detail: result.rewardName,
        inline: true,
      })

      setDone(result)
    } catch (err) {
      /* The database writes these — "You have 400 earned Value Coins. Movie
         Voucher costs 1000." — so a shortfall, a deactivated reward or a
         second tab that got there first each explain themselves. */
      setError(err instanceof ApiError ? err.message : 'We could not redeem that reward.')
    }
  }

  const remaining = earned - reward.coin_price

  return (
    <div
      /* The tokens live on [data-vs-theme='dark'], which is a div inside the
         app; this dialog is fixed over everything, so it carries the
         attribute itself or nothing it draws resolves. */
      data-vs-theme="dark"
      className="vsx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vsx-redeem-title"
      {...dismissOnBackdrop(() => onClose())}
    >
      <div className="vsx-redeem" onClick={e => e.stopPropagation()}>
        <header className="vsx-redeem-head">
          <h2 id="vsx-redeem-title" className="vsx-panel-title">
            {!done
              ? 'Redeem this reward'
              : done.status === 'pending' ? 'Redemption requested' : 'Reward redeemed'}
          </h2>
          <button type="button" className="vsx-icon-btn" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </header>

        {done ? (
          <>
            {/* What left the wallet, as the one thing the eye lands on. */}
            <div className="vsx-redeem-receipt">
              <ValueCoinDelta flow="out" amount={done.coinCost} size="lg" />
              <div style={{ minWidth: 0 }}>
                <p className="vsx-redeem-receipt-what">{done.rewardName}</p>
                <p className="vsx-redeem-receipt-sub">
                  {done.coinCost.toLocaleString()} Value Coins
                  {done.status === 'pending' ? ' held' : ' spent'}
                </p>
              </div>
            </div>

            {/*
              The term comes back from redeem_reward(), which read it off the
              reward and wrote it onto the redemption. A pending request has no
              expiry date to quote yet, so it is told what it will get and when
              the clock starts, rather than a date that does not exist.
            */}
            <p className="vsx-redeem-said">
              {done.status === 'pending'
                ? `Your ${done.rewardName} request is with HR. Your coins are held until they decide — if the request is turned down, you get them back in full.`
                : `${done.rewardName} is yours.`}
              {done.status === 'pending'
                ? ` Once approved, you will have ${done.validityDays} days to use it.`
                : done.expiresAt
                  ? ` Use it by ${formatIST(done.expiresAt, 'd MMM yyyy')}.`
                  : ''}
              {' '}Track it under My Redemptions in the Value Store.
            </p>
            <div className="vsx-redeem-foot">
              <button type="button" className="vsx-btn vsx-btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="vsx-redeem-said">{reward.name}</p>

            {/* The arithmetic, spelled out. */}
            <dl className="vsx-redeem-sums">
              <div>
                <dt>Cost</dt>
                <dd><ValueCoin size={14} /> {reward.coin_price.toLocaleString()}</dd>
              </div>
              <div>
                <dt>You have earned</dt>
                <dd><ValueCoin size={14} /> {earned.toLocaleString()}</dd>
              </div>
              <div className="is-total">
                <dt>Left after this</dt>
                <dd><ValueCoin size={14} /> {remaining.toLocaleString()}</dd>
              </div>
            </dl>

            {reward.requires_approval && (
              <p className="vsx-reward-note">
                HR approves this one. Your coins are taken now and returned in
                full if the request is turned down.
              </p>
            )}

            {error && <p className="vsx-comment-note is-error" role="alert">{error}</p>}

            <div className="vsx-redeem-foot">
              <button
                type="button"
                className="vsx-btn"
                onClick={onClose}
                disabled={redeem.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vsx-btn vsx-btn-primary"
                onClick={() => void confirm()}
                disabled={redeem.isPending}
              >
                {redeem.isPending ? 'Redeeming…' : 'Redeem reward'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
