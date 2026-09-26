import { useEffect } from 'react'
import { Check, X, Clock, Circle, Ban } from 'lucide-react'
import type { MyRedemption } from '@/lib/api'
import { formatIST } from '@/lib/date-utils'
import { remainingLabel, statusTone } from '@/lib/reward-validity'
import { markFor } from './rewardMarks'
import { ValueCoin } from './ValueCoin'
import { dismissOnBackdrop } from '@/lib/backdrop'

/**
 * One redemption, in full.
 *
 * THE QUESTION THIS SCREEN ANSWERS
 * --------------------------------
 * "What happened to my reward?" — which is not the question the Wallet
 * answers. The Wallet accounts for coins; this accounts for the thing they
 * bought. Keeping them apart is why neither has to hedge.
 *
 * WHY A TIMELINE AND NOT A STATUS FIELD
 * -------------------------------------
 * A redemption is a sequence, and the interesting part is usually where it
 * stopped. "Rejected" on its own says the end; the timeline says the request
 * was made, the coins went, HR looked at it, and it came back — which is the
 * difference between a verdict and an explanation.
 *
 * Steps are drawn from what the row actually records. Nothing is inferred and
 * nothing is invented: there is no voucher code here because the backend has
 * no such column, and no fulfilment step beyond approval because the product
 * has no "mark as used" action.
 *
 * COINS
 * -----
 * Every state says plainly where the money went. An expiry is the one that
 * needs saying most, because nothing moved — no refund row exists, and an
 * employee looking at an unchanged balance deserves to be told that is
 * deliberate rather than left to wonder whether it failed.
 */

type StepState = 'done' | 'current' | 'todo' | 'failed'

interface Step {
  state: StepState
  label: string
  when?: string | null
  note?: string | null
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={13} strokeWidth={2.6} aria-hidden="true" />
  if (state === 'failed') return <X size={13} strokeWidth={2.6} aria-hidden="true" />
  if (state === 'current') return <Clock size={12} strokeWidth={2.2} aria-hidden="true" />
  return <Circle size={8} strokeWidth={2.4} aria-hidden="true" />
}

function buildSteps(r: MyRedemption): Step[] {
  const requested: Step = {
    state: 'done',
    label: 'Reward requested',
    when: `${formatIST(r.assigned_at, 'd MMM')} · ${formatIST(r.assigned_at, 'h:mm a')}`,
    note: `${r.coin_cost.toLocaleString()} VC deducted`,
  }

  if (r.effective_status === 'rejected') {
    return [
      requested,
      {
        state: 'failed',
        label: 'Rejected',
        when: r.decided_at ? formatIST(r.decided_at, 'd MMM · h:mm a') : null,
        note: `${r.coin_cost.toLocaleString()} VC refunded in full`,
      },
    ]
  }

  if (r.effective_status === 'pending') {
    return [
      requested,
      { state: 'current', label: 'Awaiting approval', note: 'HR has not decided yet' },
      { state: 'todo', label: 'Reward ready to use' },
    ]
  }

  /* Approved, and possibly since lapsed. A reward that needed no approval has
     no decision moment of its own — it was fulfilled by the redemption — so
     the step is worded for both and dated from whichever stamp exists. */
  const approvedWhen = r.decided_at ?? r.fulfilled_at
  const approved: Step = {
    state: 'done',
    label: r.decided_at ? 'Approved by HR' : 'Approved automatically',
    when: approvedWhen ? formatIST(approvedWhen, 'd MMM · h:mm a') : null,
    note: r.decided_at ? null : 'This reward needed no approval',
  }

  if (r.effective_status === 'expired') {
    return [
      requested,
      approved,
      {
        state: 'failed',
        label: 'Expired',
        when: r.expires_at ? formatIST(r.expires_at, 'd MMM · h:mm a') : null,
        note: 'Not refunded — see below',
      },
    ]
  }

  return [
    requested,
    approved,
    {
      state: 'done',
      label: 'Reward ready to use',
      when: r.expires_at ? `Use it by ${formatIST(r.expires_at, 'd MMM yyyy')}` : null,
    },
  ]
}

/** What became of the coins, in the words each outcome actually deserves. */
function coinOutcome(r: MyRedemption): { line: string; detail: string } {
  const cost = r.coin_cost.toLocaleString()

  switch (r.effective_status) {
    case 'pending':
      return {
        line: `${cost} VC spent`,
        detail: 'Taken when you made the request, so the request is real. If HR rejects it, every coin comes back.',
      }
    case 'approved':
      return {
        line: `${cost} VC spent`,
        detail: 'The reward is yours. Use it before the date above.',
      }
    case 'rejected':
      return {
        line: `${cost} VC returned`,
        detail: 'Refunded in full when the request was rejected. It is in your wallet as its own entry.',
      }
    case 'expired':
      return {
        line: `${cost} VC not returned`,
        detail: 'These coins were spent when the reward was approved and the reward was available for the whole period. An expiry does not return them.',
      }
  }
}

export function RedemptionDetail({
  redemption,
  onClose,
}: {
  redemption: MyRedemption
  onClose: () => void
}) {
  /* Escape closes it. A dialog that traps somebody is worse than no dialog. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tone = statusTone(redemption.effective_status)
  const mark = markFor(redemption.reward_category)
  const Mark = mark.icon
  const steps = buildSteps(redemption)
  const coins = coinOutcome(redemption)
  const left = remainingLabel(redemption.expires_at)

  return (
    <div
      /* The tokens live on [data-vs-theme='dark'], which is a div inside the
         app; this dialog is fixed over everything, so it carries the
         attribute itself or nothing it draws resolves. */
      data-vs-theme="dark"
      className="vsx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vsx-redemption-title"
      {...dismissOnBackdrop(() => onClose())}
    >
      <div className="vsx-redemption-sheet" onClick={e => e.stopPropagation()}>
        <header className="vsx-redemption-head">
          <div style={{ minWidth: 0 }}>
            <p className="vsx-reward-shelf">
              <Mark size={14} aria-hidden="true" strokeWidth={1.8} />
              {mark.label}
            </p>
            <h2 id="vsx-redemption-title" className="vsx-redemption-title">
              {redemption.reward_name_snapshot}
            </h2>
          </div>
          <button
            type="button"
            className="vsx-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="vsx-redemption-body">
          {/* Price and status, the two things read first. */}
          <div className="vsx-redemption-topline">
            <p className="vsx-redemption-price">
              <ValueCoin size={20} />
              <span className="vsx-fig" style={{ fontSize: 30 }}>
                {redemption.coin_cost.toLocaleString()}
              </span>
            </p>
            <span className="vsx-redemption-status" style={{ color: tone.color }}>
              <i aria-hidden="true" style={{ background: tone.color }} />
              {tone.label}
            </span>
          </div>

          <dl className="vsx-redemption-facts">
            <div>
              <dt>Redeemed</dt>
              <dd>{formatIST(redemption.assigned_at, 'd MMM yyyy · h:mm a')}</dd>
            </div>

            {redemption.decided_at && (
              <div>
                <dt>{redemption.effective_status === 'rejected' ? 'Rejected' : 'Approved'}</dt>
                <dd>{formatIST(redemption.decided_at, 'd MMM yyyy · h:mm a')}</dd>
              </div>
            )}

            {/*
              Three different reasons there is no date to show, each worded as
              itself rather than collapsed into one blank. A pending request
              has no expiry because the clock has not started; a pre-052
              redemption never had one at all.
            */}
            {redemption.effective_status === 'pending' ? (
              <div>
                <dt>Validity</dt>
                <dd>
                  {redemption.validity_days_snapshot
                    ? `${redemption.validity_days_snapshot} days, starting when it is approved`
                    : 'No expiry'}
                </dd>
              </div>
            ) : redemption.expires_at ? (
              <div>
                <dt>{redemption.effective_status === 'expired' ? 'Expired' : 'Valid until'}</dt>
                <dd>
                  {formatIST(redemption.expires_at, 'd MMM yyyy')}
                  {left && <span className="vsx-redemption-left"> · {left}</span>}
                </dd>
              </div>
            ) : redemption.effective_status === 'approved' ? (
              <div>
                <dt>Valid until</dt>
                <dd>No expiry</dd>
              </div>
            ) : null}
          </dl>

          {/* The reason, when there is one. HR's own words, not a paraphrase. */}
          {redemption.decision_reason && (
            <blockquote className="vsx-redemption-reason">
              <p>{redemption.decision_reason}</p>
              <cite>HR</cite>
            </blockquote>
          )}

          <section aria-label="Progress">
            <h3 className="vsx-redemption-subhead">Timeline</h3>
            <ol className="vsx-timeline">
              {steps.map((step, i) => (
                <li key={i} className={`vsx-timeline-step is-${step.state}`}>
                  <span className="vsx-timeline-mark" aria-hidden="true">
                    <StepIcon state={step.state} />
                  </span>
                  <div>
                    <p className="vsx-timeline-label">{step.label}</p>
                    {step.when && <p className="vsx-timeline-when">{step.when}</p>}
                    {step.note && <p className="vsx-timeline-note">{step.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="vsx-redemption-coins" aria-label="What happened to your coins">
            <p className="vsx-redemption-coins-line">
              {redemption.effective_status === 'expired' && (
                <Ban size={14} aria-hidden="true" strokeWidth={2} />
              )}
              {coins.line}
            </p>
            <p className="vsx-redemption-coins-detail">{coins.detail}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
