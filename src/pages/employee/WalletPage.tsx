import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Gift, RotateCcw, ShoppingBag } from 'lucide-react'
import type { ActivityFilter, ValueCoinActivity } from '@/lib/api'
import { useWalletSummary, useWalletActivity } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { useCoinPulse } from '@/hooks/useCoinPulse'
import { errorMessage } from '@/lib/query'
import { ROUTES } from '@/lib/constants'
import { timeAgo, formatIST } from '@/lib/date-utils'
import { Avatar } from '@/components/experience/Avatar'
import { ValueCoin, ValueCoinAmount } from '@/components/experience/ValueCoin'
import { ValueCoinFigure } from '@/components/experience/ValueCoinFigure'
import { WalletActivityChart } from '@/components/experience/WalletActivityChart'

/*
  Plain words, not ledger words.

  "Earned", "Given", "Rewards" and "Adjustments" are what an employee would
  say about their own coins. Credit, debit and ledger entry are accurate and
  belong nowhere on this screen.
*/
const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all',      label: 'Everything' },
  { value: 'received', label: 'Earned' },
  { value: 'given',    label: 'Given' },
  { value: 'rewards',  label: 'Rewards' },
  { value: 'adjusted', label: 'Adjustments' },
]

/**
 * The Value Wallet.
 *
 * A balance on its own is a number somebody has to take on trust. This screen
 * is the same number with its working shown: what arrived this month, which
 * recognitions produced it, how the last six months went, and every movement
 * with the recognition that caused it attached.
 *
 * WHAT "GIVEN" MEANS, AND WHY THERE IS NO "SPENT"
 * -----------------------------------------------
 * Coins leave a wallet exactly one way right now — sent to a colleague on a
 * recognition. A separate "Coins spent" tab would be a third filter over the
 * same rows as "Coins given", which is a promise of a redemption that does
 * not exist yet. When there is something to spend coins ON, it earns its own
 * kind in the ledger (048 already has the column) and its own tab here.
 *
 * Every figure comes from ONE call. A screen about money that fetches six
 * numbers at six moments will occasionally show six numbers that do not add
 * up, and a reader is right to believe the screen rather than assume a race.
 *
 * WHAT MOVES, AND WHAT DOES NOT
 * -----------------------------
 * Only the two balances, and only when they actually change. They settle
 * into their new figure and the panel around them warms briefly before
 * cooling back — the whole of it under two seconds, and none of it on load.
 *
 * The lifetime totals below them stay still on purpose. They move for the
 * same reasons the balances do, so animating them would restate the same
 * event three more times, and a page where everything reacts at once is a
 * page where nothing reads as important.
 */
export default function WalletPage() {
  const { employee } = useAuth()
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const summary = useWalletSummary(employee?.id)
  const activity = useWalletActivity(employee?.id, filter)

  /* Which balance moved a moment ago, if either. Null on arrival — a wallet
     opened after the fact shows the new number without re-enacting how it
     got there. */
  const budgetPulse = useCoinPulse('budget')
  const earnedPulse = useCoinPulse('earned')

  const data = summary.data
  const rows = activity.data ?? []

  const loadError = summary.isError
    ? errorMessage(summary.error, 'We could not load your Value Wallet.')
    : null

  return (
    <div data-vs-theme="dark" className="vsx-wallet-page">
      <header style={{ marginBottom: 22 }}>
        <p className="vsx-heading" style={{ fontSize: 12, color: 'var(--vsx-text-3)' }}>
          Value Coins
        </p>
        <h1 className="vsx-title" style={{ fontSize: 'clamp(34px, 5vw, 52px)', marginTop: 8 }}>
          Your Value Wallet
        </h1>
      </header>

      {loadError && (
        <p className="vsx-comment-note is-error" role="alert" style={{ marginBottom: 18 }}>
          {loadError}
        </p>
      )}

      {/*
        ── The two balances ──

        The BUDGET leads. It is the number that decides whether the reader can
        do the thing this product is for, and it is the one that runs out; the
        earned balance is a record of how they are thought of, and changes
        only when somebody else acts. Side by side with the budget first is
        the whole scarcity mechanic stated as a layout.
      */}
      <div className="vsx-wallet-pair">
        <section
          className="vsx-panel vsx-coin-lit"
          data-lit={budgetPulse ? budgetPulse.flow : undefined}
          aria-label="Recognition budget"
        >
          <p className="vsx-heading" style={{ fontSize: 11.5, color: 'var(--vsx-text-3)' }}>
            Giving balance
          </p>

          <div className="vsx-wallet-hero" style={{ marginTop: 14 }}>
            <ValueCoin size={40} />
            <div style={{ minWidth: 0 }}>
              <ValueCoinFigure
                value={data?.budget ?? 0}
                account="budget"
                pending={!data}
                deltaSize="lg"
                style={{ fontSize: 'clamp(36px, 5vw, 50px)', lineHeight: 1 }}
              />
              <p className="vsx-meta" style={{ fontSize: 13.5, marginTop: 7 }}>
                remaining to give
              </p>
            </div>
          </div>

          {data && (
            <>
              {/* How much of the allowance is left, as a bar. A number alone
                  does not say whether 200 is most of a budget or the end of
                  one. */}
              <div
                className="vsx-budget-bar"
                role="img"
                aria-label={`${data.budget} of ${data.monthlyAllowance} Value Coins remaining this period`}
              >
                <span
                  style={{
                    width: `${data.monthlyAllowance > 0
                      ? Math.min(100, (data.budget / data.monthlyAllowance) * 100)
                      : 0}%`,
                  }}
                />
              </div>

              <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 10 }}>
                {data.monthlyAllowance.toLocaleString()} each period &middot;{' '}
                {data.carryOver ? 'unused coins carry over' : 'unused coins expire'}
                {' on '}
                {formatIST(`${data.periodEnd}T00:00:00Z`, 'd MMM')}
              </p>
            </>
          )}
        </section>

        <section
          className="vsx-panel vsx-coin-lit"
          data-lit={earnedPulse ? earnedPulse.flow : undefined}
          aria-label="Coins earned"
        >
          <p className="vsx-heading" style={{ fontSize: 11.5, color: 'var(--vsx-text-3)' }}>
            Earned value
          </p>

          <div className="vsx-wallet-hero" style={{ marginTop: 14 }}>
            <ValueCoin size={40} />
            <div style={{ minWidth: 0 }}>
              <ValueCoinFigure
                value={data?.earned ?? 0}
                account="earned"
                pending={!data}
                deltaSize="lg"
                style={{ fontSize: 'clamp(36px, 5vw, 50px)', lineHeight: 1 }}
              />
              <p className="vsx-meta" style={{ fontSize: 13.5, marginTop: 7 }}>
                sent to you by colleagues &middot;{' '}
                <Link to={ROUTES.VALUE_STORE} className="vsx-store-link">
                  spend in the Value Store
                </Link>
              </p>
            </div>
          </div>

          {data && (
            <div className="vsx-wallet-thismonth">
              {/*
                Two facts about the month, because they answer different
                questions: how much arrived, and how many separate
                recognitions were behind it. One large number from a single
                generous colleague is a different month from the same number
                spread across five.
              */}
              <p className="vsx-wallet-delta">
                {data.receivedThisMonth > 0 ? (
                  <><span style={{ color: 'var(--vsx-red)' }}>+{data.receivedThisMonth}</span> this month</>
                ) : (
                  <span style={{ color: 'var(--vsx-text-3)' }}>Nothing received this month</span>
                )}
              </p>
              <span className="vsx-wallet-dot" aria-hidden="true">·</span>
              <p className="vsx-wallet-delta">
                {data.recognitionsEarningThisMonth}{' '}
                {data.recognitionsEarningThisMonth === 1 ? 'recognition' : 'recognitions'} earned coins
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ── Lifetime, in three figures ──────────────────── */}
      {data && (
        <div className="vsx-wallet-stats">
          <Stat
            label="Coins received"
            value={data.receivedTotal}
            hint={`from ${data.recognitionsEarningTotal} ${data.recognitionsEarningTotal === 1 ? 'recognition' : 'recognitions'}`}
          />
          <Stat label="Coins given" value={data.givenTotal} hint="sent to colleagues" />
          <Stat label="Welcome grant" value={data.grantedTotal} hint="one-time, on joining" />
        </div>
      )}

      {/* ── Six months ──────────────────────────────────── */}
      <section className="vsx-panel" aria-labelledby="vsx-activity-title">
        <header className="vsx-panel-head">
          <h2 id="vsx-activity-title" className="vsx-panel-title">Monthly activity</h2>
        </header>
        {data
          ? <WalletActivityChart months={data.months} />
          : <p className="vsx-comment-note">Loading activity…</p>}
      </section>

      {/* ── Every movement ──────────────────────────────── */}
      <section className="vsx-panel" aria-labelledby="vsx-history-title">
        <header className="vsx-panel-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <h2 id="vsx-history-title" className="vsx-panel-title">Transaction history</h2>

          <div className="vsx-wallet-tabs ml-auto" role="tablist" aria-label="Filter activity">
            {FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                className={filter === f.value ? 'vsx-wallet-tab is-on' : 'vsx-wallet-tab'}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </header>

        {activity.isPending && <p className="vsx-comment-note">Loading transactions…</p>}

        {!activity.isPending && rows.length === 0 && (
          <p className="vsx-comment-note">
            {filter === 'given'
              ? 'You have not sent any Value Coins yet. Send some from a recognition in the feed.'
              : filter === 'received'
                ? 'No Value Coins earned yet. They arrive when a colleague sends them on a recognition.'
                : filter === 'rewards'
                  ? 'No rewards redeemed yet. Earned coins can be spent in the Value Store.'
                  : filter === 'adjusted'
                    ? 'No adjustments. HR has not changed either of your balances by hand.'
                    : 'No activity yet.'}
          </p>
        )}

        <ul className="vsx-wallet-list">
          {rows.map(row => <ActivityRow key={row.id} row={row} />)}
        </ul>
      </section>
    </div>
  )
}

// ────────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="vsx-panel vsx-wallet-stat">
      <p className="vsx-heading" style={{ fontSize: 11.5, color: 'var(--vsx-text-3)' }}>
        {label}
      </p>
      <ValueCoinAmount amount={value} size={18} fontSize={28} />
      <p className="vsx-meta" style={{ fontSize: 12.5 }}>{hint}</p>
    </div>
  )
}

/**
 * One movement, read from the wallet-holder's side.
 *
 * The recognition line is the point of the row. "+50" is a number; "+50 from
 * Vaibhav, Collaborative, Project Alpha" is a thing that happened, and it is
 * the reason the activity view joins through to the nomination rather than
 * leaving the ledger to speak for itself.
 */
function ActivityRow({ row }: { row: ValueCoinActivity }) {
  const incoming = row.direction === 'in'
  /* Every kind that is the system acting rather than a colleague. None of
     them has a counterparty, so none gets a face. */
  const systemRow = row.kind !== 'recognition_tip'

  const who =
    row.kind === 'signup_grant' ? 'Welcome grant'
      : row.kind === 'monthly_allowance' ? 'Giving balance added'
        : row.kind === 'allowance_expired' ? 'Unused giving balance expired'
          : row.kind === 'admin_adjustment' ? 'Adjusted by HR'
            : row.kind === 'reward_redemption' ? `${row.note ?? 'Reward'} redeemed`
              : row.kind === 'reward_refund' ? `${row.note ?? 'Reward'}`
                : incoming
                  ? `From ${row.counterparty_name ?? 'a former colleague'}`
                  : `To ${row.counterparty_name ?? 'a former colleague'}`

  /* The recognition, as the product names one: value first, then where it
     happened. Either can be absent — a recognition need not name a project —
     so the line is assembled from what is actually there rather than from a
     template with holes in it. */
  const context = [row.core_value_name, row.project_name].filter(Boolean).join(' · ')

  return (
    <li className="vsx-wallet-row">
      <span className={incoming ? 'vsx-wallet-icon is-in' : 'vsx-wallet-icon is-out'} aria-hidden="true">
        {row.kind === 'reward_redemption'
          ? <ShoppingBag size={15} />
          : row.kind === 'reward_refund'
            ? <RotateCcw size={15} />
            : systemRow
              ? <Gift size={15} />
              : incoming
                ? <ArrowDownLeft size={15} strokeWidth={2.2} />
                : <ArrowUpRight size={15} strokeWidth={2.2} />}
      </span>

      {!systemRow && row.counterparty_name && (
        <Avatar name={row.counterparty_name} avatarUrl={row.counterparty_avatar} size="xs" />
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="vsx-wallet-who">{who}</p>

        {context && <p className="vsx-wallet-context">{context}</p>}
        {/* Which pool moved. Without it, a budget top-up and an earned credit
            are the same row twice, and the difference between them is the
            whole point of there being two. */}
        {!context && (
          <p className="vsx-wallet-context">
            {row.account === 'budget' ? 'Giving balance' : 'Earned value'}
          </p>
        )}

        {row.note && row.kind !== 'reward_redemption' && row.kind !== 'reward_refund' && (
          <p className="vsx-wallet-note">“{row.note}”</p>
        )}

        <p className="vsx-wallet-when" title={formatIST(row.created_at, 'd MMM yyyy, h:mm a')}>
          {timeAgo(row.created_at)}
        </p>
      </div>

      <ValueCoinAmount
        amount={row.amount}
        size={15}
        fontSize={17}
        tone={incoming ? 'credit' : 'debit'}
      />
    </li>
  )
}
