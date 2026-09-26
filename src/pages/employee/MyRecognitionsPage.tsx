import { useState } from 'react'
import type React from 'react'
import { ArrowRight, Award, Send } from 'lucide-react'
import { useMyRecognitions, useResubmitWithClarification } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import type { NominationWithDetails, UserRole } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { DecisionLine, type DecisionAction } from '@/components/recognition/DecisionLine'
import { formatIST } from '@/lib/date-utils'
import { Link, useNavigate } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import { valueToneVars } from '@/lib/value-tone'
import { cn } from '@/lib/utils'

type Tab = 'received' | 'given'

/** recognitionsApi.getMine's page size: a full page may not be everything. */
const LIST_LIMIT = 50

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

interface ValueShare { slug: string; name: string; count: number }

/** The tab's list, tallied: who, which values, and where each one stands. */
function summarise(items: NominationWithDetails[], tab: Tab) {
  const people = new Set(items.map(n => (tab === 'received' ? n.nominator_id : n.nominee_id))).size

  const byValue = new Map<string, ValueShare>()
  const byStatus: Record<string, number> = {}
  for (const n of items) {
    byStatus[n.status] = (byStatus[n.status] ?? 0) + 1
    const cv = n.core_value
    if (!cv) continue
    const share = byValue.get(cv.slug) ?? { slug: cv.slug, name: cv.name, count: 0 }
    share.count++
    byValue.set(cv.slug, share)
  }
  const values = [...byValue.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return { people, values, byStatus }
}

/**
 * The tab at a glance, above the list: how many, from or to how many people,
 * and how they spread across the Core Values. Tallied from the rows already
 * loaded — no second request — so a list that filled its page says "50+".
 */
function RecognitionSummary({
  tab, items, onJump,
}: {
  tab: Tab
  items: NominationWithDetails[]
  /** Scroll to a recognition by id. */
  onJump: (id: string) => void
}) {
  const { people, values, byStatus } = summarise(items, tab)
  const total = `${items.length}${items.length >= LIST_LIMIT ? '+' : ''}`
  const top = values[0]
  const topTied = values.length > 1 && values[1].count === top.count

  const stats: Array<{ value: React.ReactNode; label: string; style?: React.CSSProperties }> =
    tab === 'received'
      ? [
          { value: total, label: plural(items.length, 'recognition received', 'recognitions received') },
          { value: people, label: plural(people, 'colleague recognized you', 'colleagues recognized you') },
          ...(top
            ? [{
                value: top.name,
                label: topTied ? 'joint most recognized value' : 'your most recognized value',
                style: valueToneVars(top.slug),
              }]
            : []),
        ]
      : [
          { value: total, label: plural(items.length, 'recognition given', 'recognitions given') },
          { value: people, label: plural(people, 'colleague recognized', 'colleagues recognized') },
          { value: byStatus.approved ?? 0, label: 'published' },
        ]

  const pending = byStatus.pending ?? 0
  const declined = byStatus.rejected ?? 0
  const needsReply = items.filter(n => n.status === 'clarification_requested')

  return (
    <section className="mr-summary" aria-label={tab === 'received' ? 'Received at a glance' : 'Given at a glance'}>
      <div className="mr-stats">
        {stats.map(s => (
          <div key={s.label} className={cn('mr-stat', s.style && 'mr-toned is-toned')} style={s.style}>
            <p className="mr-stat-value font-condensed">{s.value}</p>
            <p className="mr-stat-label">{s.label}</p>
          </div>
        ))}
      </div>

      {values.length > 0 && (
        <div className="mr-mix-wrap">
          <div
            className="mr-mix"
            role="img"
            aria-label={`By Core Value: ${values.map(v => `${v.name} ${v.count}`).join(', ')}`}
          >
            {values.map((v, i) => (
              <span
                key={v.slug}
                className="mr-mix-seg mr-toned"
                style={{ ...valueToneVars(v.slug), flexGrow: v.count, animationDelay: `${120 + i * 70}ms` }}
              />
            ))}
          </div>
          <ul className="mr-legend" aria-hidden="true">
            {values.map(v => (
              <li key={v.slug} className="mr-toned" style={valueToneVars(v.slug)}>
                <span className="mr-legend-dot" />
                {v.name}
                <b>{v.count}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(tab === 'received' || pending > 0 || declined > 0 || needsReply.length > 0) && (
        <div className="mr-summary-foot">
          {tab === 'received' ? (
            <Link to={ROUTES.CORE_VALUE_JOURNEY} className="mr-link">
              See where this puts you on your Core Value journey
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : (
            <>
              {needsReply.length > 0 && (
                <button type="button" className="mr-attention" onClick={() => onJump(needsReply[0].id)}>
                  <span className="mr-attention-dot" aria-hidden="true" />
                  {needsReply.length} {plural(needsReply.length, 'recognition needs', 'recognitions need')} your reply
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              )}
              {(pending > 0 || declined > 0) && (
                <p className="mr-status-line">
                  {[
                    pending > 0 && `${pending} awaiting approval`,
                    declined > 0 && `${declined} not approved`,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The decision on a recognition, read off the row.
 *
 * The same shape nomination_decision() (migration 042) returns to the approval
 * queue, assembled here from the joined columns instead — these lists already
 * fetch the whole row, so asking the database a second time for something it
 * has already sent would be a query per card.
 *
 * Which columns hold the answer depends on the status, because 003 gave each
 * action its own pair. Returns null while there is nothing to report.
 */
function decisionFor(n: NominationWithDetails): {
  action: DecisionAction
  actorName: string | null
  actorRole: UserRole | null
  at: string | null
} | null {
  switch (n.status) {
    case 'approved':
      return {
        action: 'approve',
        actorName: n.approved_by?.full_name ?? null,
        actorRole: n.approved_by_role,
        at: n.approved_at,
      }
    case 'rejected':
      return {
        action: 'reject',
        actorName: n.rejected_by?.full_name ?? null,
        actorRole: n.rejected_by_role,
        at: n.rejected_at,
      }
    case 'clarification_requested':
      return {
        action: 'request_clarification',
        actorName: n.clarification_requested_by?.full_name ?? null,
        actorRole: n.clarification_requested_by_role,
        at: n.clarification_requested_at,
      }
    default:
      return null
  }
}

const STATUS_STYLE: Record<string, { label: string; variant: 'accent' | 'neutral' | 'outline' }> = {
  approved:                { label: 'Published',            variant: 'accent'   },
  pending:                 { label: 'Pending approval',     variant: 'neutral'  },
  clarification_requested: { label: 'Clarification needed', variant: 'outline'  },
  rejected:                { label: 'Not approved',         variant: 'neutral'  },
  draft:                   { label: 'Draft',                variant: 'neutral'  },
}

/**
 * Lets a nominator revise a recognition a manager asked about and send it back
 * for review. The status change to 'pending' is what re-enters the approval
 * queue; migration 009 permits exactly this transition and restricts the
 * update to these two narrative fields.
 */
function ClarificationResponse({
  nomination,
  employeeId,
  onCancel,
  onDone,
}: {
  nomination: NominationWithDetails
  /** Whose lists to refresh once this lands. */
  employeeId: string | undefined
  onCancel: () => void
  onDone: () => void
}) {
  const resubmit = useResubmitWithClarification(employeeId)
  const [whatHappened, setWhatHappened] = useState(nomination.what_happened)
  const [whatImpact, setWhatImpact]     = useState(nomination.what_impact)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const submit = async () => {
    if (!whatHappened.trim() || !whatImpact.trim()) {
      setError('Please complete both fields before resubmitting.')
      return
    }
    setSaving(true)
    setError(null)

    try {
      // Invalidates this person's lists and the approver queue it re-enters.
      await resubmit.mutateAsync({
        nominationId: nomination.id,
        whatHappened,
        whatImpact,
      })
    } catch {
      setError('We could not resubmit this recognition. Please try again.')
      setSaving(false)
      return
    }

    setSaving(false)
    onDone()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label
          htmlFor={`what-happened-${nomination.id}`}
          style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
        >
          What happened
        </label>
        <textarea
          id={`what-happened-${nomination.id}`}
          className="vs-input w-full"
          style={{ minHeight: 72, resize: 'vertical', fontSize: 12 }}
          value={whatHappened}
          maxLength={1000}
          onChange={e => setWhatHappened(e.target.value)}
        />
      </div>
      <div>
        <label
          htmlFor={`what-impact-${nomination.id}`}
          style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
        >
          Impact
        </label>
        <textarea
          id={`what-impact-${nomination.id}`}
          className="vs-input w-full"
          style={{ minHeight: 60, resize: 'vertical', fontSize: 12 }}
          value={whatImpact}
          maxLength={1000}
          onChange={e => setWhatImpact(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)' }}>{error}</p>
      )}

      <div className="flex gap-2">
        <button
          className="vs-btn vs-btn-primary"
          style={{ fontSize: 12 }}
          onClick={submit}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? 'Resubmitting…' : 'Resubmit for review'}
        </button>
        <button className="vs-btn" style={{ fontSize: 12 }} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function MyRecognitionsPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab]       = useState<Tab>('received')
  const [editing, setEditing] = useState<string | null>(null)

  /*
    Cached per (employee, tab). Switching tabs used to refetch every time,
    including switching straight back to one you had just left; now the second
    visit is served from memory.

    The manual reloadToken is gone — the clarification mutation invalidates
    this key itself, which is both narrower and harder to forget.
  */
  const query = useMyRecognitions(employee?.id, tab)
  const items = query.data ?? []
  // isLoading, not isPending: this query is disabled until the signed-in
  // employee is known, and a disabled query is isPending forever.
  const loading = query.isLoading

  // The summary only jumps to a recognition awaiting a reply, so open the reply with it.
  const jumpTo = (id: string) => {
    setEditing(id)
    document.getElementById(`rec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="mr-scope animate-fade-in" style={{ maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        kicker="My Activity"
        title="My Recognitions"
        subtitle="The recognitions you've received, and the ones you've given — with where each one stands."
      />

      <div className="mr-tabs" role="tablist" aria-label="Recognitions">
        {(['received', 'given'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={cn('mr-tab', tab === t && 'is-active')}
            onClick={() => setTab(t)}
          >
            {t === 'received' ? <Award size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
            {t === 'received' ? 'Received' : 'Given'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={tab === 'received' ? <Award size={36} /> : <Send size={36} />}
          title={tab === 'received' ? 'No recognitions received yet' : 'No recognitions given yet'}
          description={
            tab === 'received'
              ? 'Your first recognition will appear here once approved.'
              : 'When you recognize a colleague, it will appear here.'
          }
          action={tab === 'given'
            ? { label: 'Give Recognition', onClick: () => navigate(ROUTES.GIVE_RECOGNITION) }
            : undefined
          }
        />
      ) : (
        <>
        <RecognitionSummary tab={tab} items={items} onJump={jumpTo} />
        <div className="mr-list">
          {items.map((n, i) => {
            const cv = n.core_value as { name: string; slug: string } | null
            const other = tab === 'received' ? n.nominator : n.nominee
            const otherPerson = other as { full_name: string; avatar_url: string | null } | null
            const statusInfo = STATUS_STYLE[n.status] ?? { label: n.status, variant: 'neutral' as const }

            return (
              <article
                key={n.id}
                id={`rec-${n.id}`}
                className={cn('mr-card', cv && 'mr-toned')}
                style={{
                  ...(cv ? valueToneVars(cv.slug) : {}),
                  // Only the first screenful staggers in; a long list should not keep arriving.
                  animationDelay: `${Math.min(i, 6) * 55}ms`,
                }}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <EmployeeAvatar
                      name={otherPerson?.full_name ?? ''}
                      avatarUrl={otherPerson?.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.3 }}>
                        {tab === 'received' ? 'From ' : 'For '}
                        <strong>{otherPerson?.full_name}</strong>
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 1 }}>
                        {formatIST(n.created_at)}
                      </p>
                    </div>
                  </div>
                  {/* Status tag. Received lists only published recognitions, so there it would say the same thing on every card. */}
                  {tab === 'given' && (
                    <span
                      className={`vs-tag vs-tag-${statusInfo.variant}`}
                      style={{ flexShrink: 0 }}
                    >
                      {statusInfo.label}
                    </span>
                  )}
                </div>

                {/* Core value */}
                {cv && (
                  <div>
                    <CoreValueBadge name={cv.name} slug={cv.slug} />
                  </div>
                )}

                {/* Story */}
                <p style={{ fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.55 }}>
                  {n.what_happened}
                </p>

                {/*
                  WHO decided it, not just what was decided.

                  Any of three authorities may have acted — the Project Manager
                  this was routed to, HR, or a Super Admin — so "Not approved"
                  on its own leaves the author with no idea who to ask. The same
                  sentence the approval queue shows, from the same component.

                  The rejection REASON is deliberately not passed: 003 records it
                  as internal, and this list is read by the nominee on the
                  received tab. The clarification note has its own panel below,
                  where it comes with the button to answer it.
                */}
                {decisionFor(n) && (
                  <DecisionLine
                    action={decisionFor(n)!.action}
                    actorName={decisionFor(n)!.actorName}
                    actorRole={decisionFor(n)!.actorRole}
                    at={decisionFor(n)!.at}
                  />
                )}

                {/* Clarification request + response — only to the nominator */}
                {n.status === 'clarification_requested' && tab === 'given' && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 14,
                      border: '1px solid var(--color-accent-400)',
                      background: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-bg))',
                      fontSize: 12,
                      color: 'var(--color-accent-800)',
                    }}
                  >
                    <p style={{ fontWeight: 600, marginBottom: 3 }}>Clarification requested</p>
                    {n.clarification_note && <p style={{ marginBottom: 8 }}>{n.clarification_note}</p>}

                    {editing === n.id ? (
                      <ClarificationResponse
                        nomination={n}
                        onCancel={() => setEditing(null)}
                        employeeId={employee?.id}
                        onDone={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        className="vs-btn"
                        style={{ fontSize: 12 }}
                        onClick={() => setEditing(n.id)}
                      >
                        Revise and resubmit
                      </button>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}
