import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { RedemptionLifecycleStatus } from '@/types'
import type { RedemptionRequest } from '@/lib/api'
import { useRedemptionRequests, useDecideRedemption } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { formatIST, timeAgo } from '@/lib/date-utils'
import { remainingLabel } from '@/lib/reward-validity'

/*
  'Expired' is a tab even though no row is ever stored that way. The
  function matches it against the DERIVED status, so this filter asks the
  same question the employee's own screen asks and gets the same answer.
*/
const TABS: { value: RedemptionLifecycleStatus | 'all'; label: string }[] = [
  { value: 'pending',  label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired',  label: 'Expired' },
  { value: 'all',      label: 'All' },
]

/**
 * Reward requests, for HR and a Super Admin.
 *
 * WHAT A DECISION ACTUALLY DOES
 * -----------------------------
 * The coins left the employee when they pressed Redeem, not when you press
 * Approve. Approving fulfils the request; rejecting REFUNDS it — the exact
 * amount recorded on the request, as its own line in their wallet, whatever
 * the reward costs by then.
 *
 * That is why a rejection asks for a reason and approval does not: the
 * employee is getting coins back and is owed the explanation.
 *
 * TWO OF YOU CAN BE HERE AT ONCE
 * ------------------------------
 * Nothing in this component prevents that, and it does not need to. The
 * decision locks the row (051); whoever commits first wins, and the second
 * gets told what actually happened rather than overwriting it. The message
 * they see comes from the database.
 */
export function RedemptionQueue() {
  const [tab, setTab] = useState<RedemptionLifecycleStatus | 'all'>('pending')
  const requests = useRedemptionRequests(tab)

  const rows = requests.data ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Reward requests</CardTitle>
        <p className="text-sm text-text-muted mt-0.5">
          Redemptions of rewards you chose to approve yourself. Rejecting one
          returns the employee&rsquo;s coins in full.
        </p>
      </CardHeader>

      <CardContent style={{ padding: 0 }}>
        <div
          className="flex flex-wrap items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--color-divider)' }}
        >
          {TABS.map(t => (
            <Button
              key={t.value}
              size="sm"
              variant={tab === t.value ? 'default' : 'outline'}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {requests.isPending && (
          <div style={{ padding: 16 }}>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} style={{ height: 44, marginBottom: 10 }} />
            ))}
          </div>
        )}

        {!requests.isPending && rows.length === 0 && (
          <p style={{ padding: 20, fontSize: 13, color: 'var(--color-neutral-600)' }}>
            {tab === 'pending'
              ? 'No reward requests waiting. Requests appear here when an employee redeems a reward you approve.'
              : 'Nothing here yet.'}
          </p>
        )}

        {rows.map((row, i) => (
          <RequestRow key={row.id} row={row} last={i === rows.length - 1} />
        ))}
      </CardContent>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────

function RequestRow({ row, last }: { row: RedemptionRequest; last: boolean }) {
  const decide = useDecideRedemption()

  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const act = async (action: 'approve' | 'reject') => {
    setError(null)
    try {
      await decide.mutateAsync({ redemptionId: row.id, action, reason })
      setRejecting(false)
      setReason('')
    } catch (err) {
      /* Includes "That request was already approved." when somebody else got
         there first — the database's own words, which are more use than a
         generic failure. */
      setError(errorMessage(err, 'Could not record that decision.'))
    }
  }

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--color-divider)' }}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0" style={{ minWidth: 200 }}>
          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {row.employee_name}
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
            {row.reward_name_snapshot} &middot;{' '}
            {/* The price PAID, off the request. Not the reward's price now. */}
            <span className="tabular-nums">{row.coin_cost.toLocaleString()} VC</span>
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 2 }}>
            Requested {timeAgo(row.assigned_at)}
          </p>
          {/*
            Only where there is a date to show. A pending request has no
            expiry yet — the clock starts at approval — so this line is absent
            there rather than showing a hyphen nobody can interpret.

            `expires_soon` is computed in the database against the configured
            threshold, not from a number chosen here, so the warning cannot
            drift from what the employee is told.
          */}
          {row.expires_at && (
            <p style={{ fontSize: 11.5, marginTop: 2, color: row.expires_soon ? 'var(--color-accent-800)' : 'var(--color-neutral-600)' }}>
              {row.effective_status === 'expired'
                ? `Expired ${formatIST(row.expires_at, 'd MMM yyyy')}`
                : `Valid until ${formatIST(row.expires_at, 'd MMM yyyy')}`}
              {row.effective_status === 'approved' && remainingLabel(row.expires_at) && (
                <> &middot; {remainingLabel(row.expires_at)}</>
              )}
              {row.expires_soon && (
                <strong style={{ marginLeft: 6, fontWeight: 600 }}>Expires soon</strong>
              )}
            </p>
          )}
        </div>

        {row.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              loading={decide.isPending}
              onClick={() => void act('approve')}
            >
              <Check size={14} /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejecting(r => !r)}
            >
              <X size={14} /> Reject
            </Button>
          </div>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <p
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: row.status === 'approved'
                  ? 'var(--color-accent-800)'
                  : 'var(--color-neutral-600)',
              }}
            >
              {row.effective_status === 'expired'
                ? 'Expired'
                : row.status === 'approved' ? 'Approved' : 'Rejected'}
              {row.decided_by_name ? ` by ${row.decided_by_name}` : ''}
            </p>
            {row.decided_at && (
              <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>
                {formatIST(row.decided_at, 'd MMM yyyy, h:mm a')}
              </p>
            )}
            {row.status === 'rejected' && row.decision_reason && (
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3, maxWidth: 320 }}>
                {row.decision_reason}
              </p>
            )}
          </div>
        )}
      </div>

      {rejecting && row.status === 'pending' && (
        <div className="flex flex-wrap items-end gap-3 px-4 pb-4">
          <div style={{ flex: 1, minWidth: 220 }}>
            <label
              htmlFor={`why-${row.id}`}
              className="block"
              style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}
            >
              Reason (required) — the employee sees this
            </label>
            <Input
              id={`why-${row.id}`}
              placeholder="Why this request is not being approved"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!reason.trim() || decide.isPending}
            onClick={() => void act('reject')}
          >
            Reject and refund {row.coin_cost.toLocaleString()} VC
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)', padding: '0 16px 12px' }}>
          {error}
        </p>
      )}
    </div>
  )
}
