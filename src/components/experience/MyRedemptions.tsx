import { useState } from 'react'
import type { MyRedemption } from '@/lib/api'
import { useMyRedemptions } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { errorMessage } from '@/lib/query'
import { formatIST } from '@/lib/date-utils'
import { remainingLabel, statusTone } from '@/lib/reward-validity'
import { useCategoryMark } from './rewardMarks'
import { RedemptionDetail } from './RedemptionDetail'
import { ValueCoin } from './ValueCoin'

/**
 * Everything this person has redeemed.
 *
 * THE QUESTION IT ANSWERS
 * -----------------------
 * "I redeemed this. Where is it now?" The Wallet already answers "where did
 * my coins go" and answers it well; it cannot also answer this one, because a
 * ledger row knows an amount and a date and nothing about whether HR has
 * looked at the request yet.
 *
 * WHY THE STATUS IS NOT COMPUTED HERE
 * -----------------------------------
 * `effective_status` arrives decided. Working out "expired" in the browser
 * would make the viewer's system clock the authority on whether a reward is
 * still usable — see the note in lib/reward-validity.ts. The countdowns below
 * are cosmetic and the server's word overrides them.
 */

function StatusPill({ redemption }: { redemption: MyRedemption }) {
  const tone = statusTone(redemption.effective_status)
  return (
    <span className="vsx-redemption-status" style={{ color: tone.color }}>
      <i aria-hidden="true" style={{ background: tone.color }} />
      {tone.label}
    </span>
  )
}

/**
 * The line under the status, which is a different fact in each state.
 *
 * Deliberately not one template with holes in it. A pending request has no
 * expiry date — the clock starts at approval — so showing "valid until" there
 * would be inventing a date, and showing a blank would look broken.
 */
function ValidityLine({ redemption }: { redemption: MyRedemption }) {
  const { effective_status: status, expires_at, validity_days_snapshot } = redemption

  if (status === 'rejected') {
    return (
      <p className="vsx-redemption-line is-good">
        +{redemption.coin_cost.toLocaleString()} VC returned
      </p>
    )
  }

  if (status === 'pending') {
    return (
      <p className="vsx-redemption-line">
        {validity_days_snapshot
          ? `${validity_days_snapshot}-day validity · starts when approved`
          : 'Waiting on HR'}
      </p>
    )
  }

  if (status === 'expired') {
    return (
      <>
        <p className="vsx-redemption-line">
          Expired {expires_at ? formatIST(expires_at, 'd MMM') : ''}
        </p>
        <p className="vsx-redemption-line is-muted">
          {redemption.coin_cost.toLocaleString()} VC not returned
        </p>
      </>
    )
  }

  // Approved. A legacy row (pre-052) genuinely has no expiry and says so.
  if (!expires_at) {
    return <p className="vsx-redemption-line">No expiry</p>
  }

  const left = remainingLabel(expires_at)
  return (
    <>
      <p className="vsx-redemption-line">Valid until {formatIST(expires_at, 'd MMM')}</p>
      {left && <p className="vsx-redemption-line is-muted">{left}</p>}
    </>
  )
}

function RedemptionCard({
  redemption,
  onOpen,
}: {
  redemption: MyRedemption
  onOpen: () => void
}) {
  const categoryMark = useCategoryMark()
  const mark = categoryMark(redemption.reward_category)
  const Mark = mark.icon
  const spent = redemption.effective_status === 'expired'

  return (
    <article className={spent ? 'vsx-reward vsx-redemption-card is-spent' : 'vsx-reward vsx-redemption-card'}>
      <p className="vsx-reward-shelf">
        <Mark size={14} aria-hidden="true" strokeWidth={1.8} />
        {mark.label}
      </p>

      <h3 className="vsx-reward-name">{redemption.reward_name_snapshot}</h3>

      <StatusPill redemption={redemption} />

      <div className="vsx-redemption-lines">
        <ValidityLine redemption={redemption} />
      </div>

      {/* HR's reason belongs on the card, not only behind a click: a rejection
          the employee has to go looking for reads as a system hiding it. */}
      {redemption.effective_status === 'rejected' && redemption.decision_reason && (
        <p className="vsx-reward-note vsx-redemption-reason-inline">
          {redemption.decision_reason}
        </p>
      )}

      <div className="vsx-reward-foot">
        <p className="vsx-reward-price">
          <ValueCoin size={17} />
          <span className="vsx-fig" style={{ fontSize: 22 }}>
            {redemption.coin_cost.toLocaleString()}
          </span>
        </p>
        <p className="vsx-reward-note" style={{ marginTop: 0 }}>
          Redeemed {formatIST(redemption.assigned_at, 'd MMM')}
        </p>
      </div>

      <button
        type="button"
        className="vsx-btn vsx-btn-sm vsx-reward-action"
        onClick={onOpen}
      >
        View details
      </button>
    </article>
  )
}

export function MyRedemptions({ onBrowseStore }: { onBrowseStore: () => void }) {
  const { employee } = useAuth()
  const query = useMyRedemptions(employee?.id)
  const [open, setOpen] = useState<MyRedemption | null>(null)

  const rows = query.data ?? []

  if (query.isPending) {
    return (
      <div className="vsx-store-grid">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="vsx-panel" style={{ height: 216 }} aria-hidden="true">
            <div className="vsx-skeleton" style={{ height: 13, width: '38%' }} />
            <div className="vsx-skeleton" style={{ height: 19, width: '70%', marginTop: 16 }} />
            <div className="vsx-skeleton" style={{ height: 13, marginTop: 14 }} />
            <div className="vsx-skeleton" style={{ height: 13, width: '54%', marginTop: 10 }} />
          </div>
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <p className="vsx-comment-note is-error" role="alert">
        {errorMessage(query.error, 'We could not load your redemptions.')}
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <section className="vsx-panel vsx-store-empty">
        <h2 className="vsx-panel-title">You haven&rsquo;t redeemed a reward yet</h2>
        <p className="vsx-meta" style={{ fontSize: 14, marginTop: 10, maxWidth: '46ch', lineHeight: 1.6 }}>
          Your redeemed rewards will appear here, with what you paid and how
          long each one stays valid.
        </p>
        <button
          type="button"
          className="vsx-btn vsx-btn-primary"
          style={{ marginTop: 18, alignSelf: 'flex-start' }}
          onClick={onBrowseStore}
        >
          Browse Value Store
        </button>
      </section>
    )
  }

  return (
    <>
      <div className="vsx-store-grid">
        {rows.map(r => (
          <RedemptionCard key={r.id} redemption={r} onOpen={() => setOpen(r)} />
        ))}
      </div>

      {open && <RedemptionDetail redemption={open} onClose={() => setOpen(null)} />}
    </>
  )
}
