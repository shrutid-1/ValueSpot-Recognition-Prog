import { useEffect, useState } from 'react'
import { Minus, Plus, Search } from 'lucide-react'
import type { CoinPolicy, AdminWalletRow } from '@/lib/api'
import type { ValueCoinAccount } from '@/types'
import {
  useCoinPolicy, useSaveCoinPolicy, useAdminWallets, useAdjustWallet,
} from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/shared/SkeletonLoader'

/**
 * Value Coins, for HR and a Super Admin.
 *
 * Two powers on one screen, and they are different in kind. The POLICY
 * decides the rules everyone plays under from the next period; an ADJUSTMENT
 * reaches into one person's wallet and changes what is already there. They
 * are separated into two cards for that reason, and only the second one asks
 * for a reason, because only the second one needs explaining afterwards.
 *
 * Nothing here is the authority. Both write paths re-read the caller's role
 * from `employees` inside the database and refuse anybody who is not HR or a
 * Super Admin — an employee who calls the RPC by hand is refused by
 * PostgreSQL, exactly as if this page did not exist.
 */

const FIELDS: {
  key: keyof Omit<CoinPolicy, 'carryOver'>
  label: string
  hint: string
  min: number
  max?: number
}[] = [
  {
    key: 'signupGrant',
    label: 'Welcome grant',
    hint: 'Earned coins a new employee starts with, once, when their wallet opens.',
    min: 0,
  },
  {
    key: 'monthlyAllowance',
    label: 'Recognition budget per period',
    hint: 'Coins every employee receives to GIVE. This is the scarcity: it does not add to what they have earned.',
    min: 0,
  },
  {
    key: 'maxPerRecognition',
    label: 'Maximum per recognition',
    hint: 'Ceiling on a single send. 0 means no limit.',
    min: 0,
  },
  {
    key: 'maxPerPersonPerDay',
    label: 'Maximum per colleague per day',
    hint: 'Most one employee may send one colleague in a day, across all their recognitions. 0 means no limit.',
    min: 0,
  },
  {
    key: 'resetDay',
    label: 'Reset day of the month',
    hint: '1–28. Capped at 28 because 29, 30 and 31 do not exist in every month, and a budget must not skip February.',
    min: 1,
    max: 28,
  },
]

export default function ValueCoinsPage() {
  const policyQuery = useCoinPolicy()
  const savePolicy = useSaveCoinPolicy()

  const [draft, setDraft] = useState<CoinPolicy | null>(null)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // The form is seeded from the server once it arrives, and again whenever a
  // save returns — so the inputs show what was actually stored, including any
  // clamping the API applied on the way in.
  useEffect(() => {
    if (policyQuery.data) setDraft(policyQuery.data)
  }, [policyQuery.data])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(t)
  }, [saved])

  const save = async () => {
    if (!draft) return
    setPolicyError(null)
    try {
      await savePolicy.mutateAsync(draft)
      setSaved(true)
    } catch (err) {
      setPolicyError(errorMessage(err, 'Could not save the Value Coin settings.'))
    }
  }

  const set = (key: keyof CoinPolicy, value: number | boolean) =>
    setDraft(d => (d ? { ...d, [key]: value } : d))

  return (
    <div
      className="animate-fade-in"
      style={{ maxWidth: 900, margin: '0 auto', paddingLeft: 24, paddingRight: 24 }}
    >
      <PageHeader
        title="Value Coins"
        subtitle="The recognition budget everyone spends from, and every employee's wallet."
      />

      {/* ── Policy ──────────────────────────────────────── */}
      <Card style={{ marginTop: 32 }}>
        <CardHeader className="pb-3">
          <CardTitle>Budget and limits</CardTitle>
          <p className="text-sm text-text-muted mt-0.5">
            Read by the database on every send. A change applies to the next
            send immediately; a change to the budget applies at the next reset.
          </p>
        </CardHeader>

        <CardContent style={{ padding: 0 }}>
          {policyQuery.isPending || !draft ? (
            <div style={{ padding: 16 }}>
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} style={{ height: 44, marginBottom: 10 }} />
              ))}
            </div>
          ) : (
            <div>
              {FIELDS.map((f, idx) => (
                <div
                  key={f.key}
                  className="flex items-center gap-4 py-3 px-4"
                  style={{
                    borderBottom: idx < FIELDS.length - 1
                      ? '1px solid var(--color-divider)'
                      : 'none',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor={`coin-${f.key}`}
                      className="block text-sm font-medium"
                      style={{ color: 'var(--color-text)', marginBottom: 4 }}
                    >
                      {f.label}
                    </label>
                    <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{f.hint}</p>
                  </div>

                  {/* A fixed, non-shrinking slot: Input wraps itself in a
                      `w-full` div, which in this row would claim the whole
                      width and crush the label column to one word a line. */}
                  <div style={{ width: 120, flexShrink: 0 }}>
                    <Input
                      id={`coin-${f.key}`}
                      type="number"
                      style={{ width: '100%' }}
                      min={f.min}
                      max={f.max}
                      value={draft[f.key]}
                      onChange={e => set(f.key, Math.max(f.min, Math.floor(Number(e.target.value) || 0)))}
                    />
                  </div>
                </div>
              ))}

              {/* The one setting that is a choice rather than a number. */}
              <div
                className="flex items-center gap-4 py-3 px-4"
                style={{ borderTop: '1px solid var(--color-divider)' }}
              >
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="coin-carry"
                    className="block text-sm font-medium"
                    style={{ color: 'var(--color-text)', marginBottom: 4 }}
                  >
                    Unused budget carries over
                  </label>
                  <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                    Off means an unspent budget is forfeited at the reset — which
                    is what makes the budget a decision rather than a balance.
                    Earned coins are never affected either way.
                  </p>
                </div>

                <div style={{ width: 120, flexShrink: 0 }}>
                  <input
                    id="coin-carry"
                    type="checkbox"
                    checked={draft.carryOver}
                    onChange={e => set('carryOver', e.target.checked)}
                    style={{ width: 18, height: 18 }}
                  />
                </div>
              </div>

              <div
                className="flex items-center gap-3 py-3 px-4"
                style={{ borderTop: '1px solid var(--color-divider)' }}
              >
                <Button
                  size="sm"
                  loading={savePolicy.isPending}
                  onClick={() => void save()}
                >
                  Save settings
                </Button>
                {saved && (
                  <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
                    Saved.
                  </span>
                )}
                {policyError && (
                  <span role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>
                    {policyError}
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <WalletTable />
    </div>
  )
}

// ────────────────────────────────────────────────────────────

function WalletTable() {
  const [search, setSearch] = useState('')
  const wallets = useAdminWallets(search)

  const rows = wallets.data ?? []

  return (
    <Card style={{ marginTop: 24 }}>
      <CardHeader className="pb-3">
        <CardTitle>Employee wallets</CardTitle>
        <p className="text-sm text-text-muted mt-0.5">
          Every balance in the organisation. An adjustment is recorded in the
          employee&rsquo;s own ledger and in the audit log, with its reason.
        </p>
      </CardHeader>

      <CardContent style={{ padding: 0 }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-divider)' }}>
          <Search size={15} style={{ color: 'var(--color-neutral-600)', flexShrink: 0 }} />
          <Input
            placeholder="Search by name, email or employee ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search employees"
          />
        </div>

        {wallets.isPending && (
          <div style={{ padding: 16 }}>
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} style={{ height: 40, marginBottom: 8 }} />
            ))}
          </div>
        )}

        {!wallets.isPending && rows.length === 0 && (
          <p style={{ padding: 20, fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No employees match that search.
          </p>
        )}

        {rows.map((row, idx) => (
          <WalletRow
            key={row.employee_id}
            row={row}
            last={idx === rows.length - 1}
          />
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * One employee's wallet, and the adjustment control for it.
 *
 * The control is collapsed until asked for. Reaching into somebody's balance
 * should take a deliberate press, not be one stray click away on every row of
 * a long table.
 */
function WalletRow({ row, last }: { row: AdminWalletRow; last: boolean }) {
  const adjust = useAdjustWallet()

  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState<ValueCoinAccount>('budget')
  const [amount, setAmount] = useState(100)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const apply = async (sign: 1 | -1) => {
    setError(null)
    try {
      await adjust.mutateAsync({
        employeeId: row.employee_id,
        account,
        delta: sign * Math.abs(Math.floor(amount)),
        reason,
      })
      setOpen(false)
      setReason('')
    } catch (err) {
      /* The database writes these — "That would take the budget below zero.
         It is currently 40." — so a refusal says what is actually wrong. */
      setError(errorMessage(err, 'Could not adjust that wallet.'))
    }
  }

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--color-divider)' }}>
      <div className="flex items-center gap-4 py-3 px-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {row.full_name}
            {!row.is_active && (
              <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}> · inactive</span>
            )}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
            {row.employee_code} · {row.email}
          </p>
        </div>

        {/* Budget first, and labelled — two bare numbers side by side would
            leave the reader guessing which pool is which. */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>Budget</p>
          <p className="tabular-nums text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {row.budget_balance.toLocaleString()}
          </p>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>Earned</p>
          <p className="tabular-nums text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {row.earned_balance.toLocaleString()}
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          Adjust
        </Button>
      </div>

      {open && (
        <div
          className="flex flex-wrap items-end gap-3 px-4 pb-4"
          style={{ background: 'var(--color-bg-subtle, transparent)' }}
        >
          <div>
            <label
              htmlFor={`acct-${row.employee_id}`}
              className="block"
              style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}
            >
              Balance
            </label>
            <select
              id={`acct-${row.employee_id}`}
              value={account}
              onChange={e => setAccount(e.target.value as ValueCoinAccount)}
              style={{
                height: 38,
                padding: '0 10px',
                borderRadius: 6,
                border: '1px solid var(--color-divider)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: 13,
              }}
            >
              <option value="budget">Recognition budget</option>
              <option value="earned">Earned coins</option>
            </select>
          </div>

          <div>
            <label
              htmlFor={`amt-${row.employee_id}`}
              className="block"
              style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}
            >
              Coins
            </label>
            <Input
              id={`amt-${row.employee_id}`}
              type="number"
              min={1}
              style={{ width: 96 }}
              value={amount}
              onChange={e => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
            />
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              htmlFor={`why-${row.employee_id}`}
              className="block"
              style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}
            >
              Reason (required)
            </label>
            <Input
              id={`why-${row.employee_id}`}
              placeholder="Why this adjustment is being made"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!reason.trim() || adjust.isPending}
              onClick={() => void apply(1)}
            >
              <Plus size={14} /> Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!reason.trim() || adjust.isPending}
              onClick={() => void apply(-1)}
            >
              <Minus size={14} /> Remove
            </Button>
          </div>

          {error && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)', width: '100%' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
