import { useState } from 'react'
import { CheckSquare, MessageSquare, XCircle, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useApprovalQueue, useDecideApproval } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { ApiError, type ApprovalQueueItem } from '@/lib/api'
import type { ApprovalAction } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import { DecisionLine } from '@/components/recognition/DecisionLine'
import { formatIST } from '@/lib/date-utils'
import { dismissOnBackdrop } from '@/lib/backdrop'

/**
 * The approval queue, for all three approval authorities.
 *
 * ONE page, not three. What differs between the roles is which recognitions are
 * in the queue, and that is decided by recognition_approval_queue() (migration
 * 042) from the caller's session:
 *
 *   Manager      the recognitions ROUTED to them — assigned_approver_id, which
 *                029/030 derived from the project the recognizer selected
 *   HR Admin     every recognition in the organisation
 *   Super Admin  every recognition in the organisation
 *
 * Nothing on this page decides that, and nothing on it could: the query takes
 * no arguments. A Manager who reaches for another Manager's queue has nothing
 * to reach with.
 *
 * RECENTLY HANDLED ONES ARE SHOWN TOO, and that is deliberate. With three
 * authorities watching the same item, a recognition that silently disappeared
 * the moment one of them acted would look like a recognition that was lost. It
 * stays, with the decision and who made it, so HR sees "Approved by Manager —
 * John Doe" rather than an empty list.
 */

// Derived from the shared contract so the UI can never drift from the action
// names the process-approval Edge Function actually dispatches on.
type ActionType = ApprovalAction['action']

function Corners() {
  return (
    <>
      <i className="corner tl" /><i className="corner tr" />
      <i className="corner bl" /><i className="corner br" />
    </>
  )
}

/** The status chip on a handled row. Matches My Recognitions' vocabulary. */
const STATUS_TAG: Record<string, { label: string; variant: string }> = {
  approved:                { label: 'Approved',               variant: 'accent'  },
  rejected:                { label: 'Rejected',               variant: 'neutral' },
  clarification_requested: { label: 'Clarification requested', variant: 'outline' },
}

export default function PendingApprovalsPage() {
  const { employee } = useAuth()
  const orgWide = employee?.role === 'hr_admin' || employee?.role === 'super_admin'

  const query = useApprovalQueue()
  const items = query.data ?? []
  const loading = query.isLoading

  const decide = useDecideApproval()
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [actionModal, setActionModal] = useState<{ type: ActionType; item: ApprovalQueueItem } | null>(null)
  const [actionText, setActionText]   = useState('')
  const actionLoading = decide.isPending
  const [actionError, setActionError] = useState<string | null>(null)
  /*
    Shown on the row, not in the modal, and kept after the modal closes: when
    another authority wins the race the modal has to go (its buttons are no
    longer valid) but the explanation must not go with it.
  */
  const [conflict, setConflict] = useState<{ id: string; message: string } | null>(null)

  const waiting = items.filter(i => i.status === 'pending')
  const handled = items.filter(i => i.status !== 'pending')

  const openAction = (type: ActionType, item: ApprovalQueueItem) => {
    setActionModal({ type, item })
    setActionText('')
    setActionError(null)
    setConflict(null)
  }

  const handleAction = async () => {
    if (!actionModal || !employee) return
    const { type, item } = actionModal

    if ((type === 'reject' || type === 'request_clarification') && !actionText.trim()) {
      setActionError(type === 'reject'
        ? 'Please provide a reason for rejection.'
        : 'Please describe what clarification you need.')
      return
    }
    setActionError(null)

    try {
      await decide.mutateAsync({
        nominationId: item.id,
        action: type,
        reason: actionText,
        clarificationNote: actionText,
      })
    } catch (err) {
      /*
        'already_handled' is not an error in this queue's sense — somebody else
        decided it first, which is the system working. It closes the modal and
        explains on the row; the queue has already been refetched by the
        mutation's onSettled, so the row is about to show the real decision.
      */
      if (err instanceof ApiError && err.code === 'already_handled') {
        setActionModal(null)
        setActionText('')
        setConflict({ id: item.id, message: err.message })
        setExpanded(item.id)
        return
      }
      setActionError(errorMessage(err, 'Something went wrong. Please try again.'))
      return
    }

    setActionModal(null)
    setActionText('')
    setExpanded(null)
  }

  const closeModal = () => { setActionModal(null); setActionText(''); setActionError(null) }

  if (loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <PageHeader title="Pending Approvals" />
        {[...Array(3)].map((_, i) => <CardSkeleton key={i} />)}
      </div>
    )
  }

  const renderRow = (item: ApprovalQueueItem, index: number) => {
    const cv         = item.core_value
    const isExpanded = expanded === item.id
    const isHandled  = item.status !== 'pending'
    const tag        = STATUS_TAG[item.status]
    const rowConflict = conflict && conflict.id === item.id ? conflict.message : null

    return (
      <article key={item.id} style={{ borderTop: index > 0 ? '1px solid var(--color-divider)' : 'none' }}>

        {/* Summary row — clickable to expand */}
        <button
          className="w-full flex items-center gap-3 text-left"
          style={{
            padding: '12px 16px',
            background: isExpanded ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 120ms',
            fontFamily: 'Barlow, sans-serif',
            opacity: isHandled ? 0.78 : 1,
          }}
          onClick={() => setExpanded(isExpanded ? null : item.id)}
          aria-expanded={isExpanded}
        >
          <EmployeeAvatar name={item.nominee.full_name} avatarUrl={item.nominee.avatar_url} size="sm" />
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.3 }}>
              <strong>{item.nominator.full_name}</strong>
              <span style={{ color: 'var(--color-neutral-600)', fontWeight: 400 }}> recognized </span>
              <strong>{item.nominee.full_name}</strong>
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 2 }}>
              {item.submitted_at ? formatIST(item.submitted_at) : ''}
              {/*
                Which project routed this, shown only in the organisation-wide
                queue. A Manager's queue is one project's worth of work by
                construction; HR's spans every project, and "whose recognition
                is this" is unanswerable without it.
              */}
              {orgWide && item.snapshot_project_name && (
                <span style={{ color: 'var(--color-neutral-500)' }}>
                  {' · '}{item.snapshot_project_name}
                </span>
              )}
            </p>
          </div>
          {isHandled && tag && (
            <span className={`vs-tag vs-tag-${tag.variant} shrink-0`} style={{ fontSize: 10 }}>
              {tag.label}
            </span>
          )}
          <CoreValueBadge name={cv.name} slug={cv.slug} size="sm" className="hidden sm:inline-flex shrink-0" />
          <span style={{ color: 'var(--color-neutral-500)', flexShrink: 0 }} aria-hidden="true">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        {/* Expanded detail */}
        {isExpanded && (
          <div
            className="animate-fade-in"
            style={{
              padding: '0 16px 16px',
              borderTop: '1px solid var(--color-divider)',
              background: 'color-mix(in srgb, var(--color-accent) 3%, transparent)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div className="sm:hidden" style={{ paddingTop: 12 }}>
              <CoreValueBadge name={cv.name} slug={cv.slug} />
            </div>

            <blockquote
              style={{
                borderLeft: '2px solid var(--color-accent-400)',
                paddingLeft: 12,
                margin: 0,
                fontSize: 13,
                color: 'var(--color-neutral-700)',
                fontStyle: 'italic',
                lineHeight: 1.55,
              }}
            >
              &ldquo;{item.what_happened}&rdquo;
            </blockquote>

            {item.what_impact && (
              <div>
                <p className="vs-kicker" style={{ marginBottom: 4 }}>Impact</p>
                <p style={{ fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>{item.what_impact}</p>
              </div>
            )}

            {item.snapshot_behaviour_name && (
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                Behaviour: <strong style={{ color: 'var(--color-text)' }}>{item.snapshot_behaviour_name}</strong>
              </p>
            )}

            {/*
              Who it was routed to. Only useful in the organisation-wide queue —
              a Manager is looking at their own — and it is what explains why HR
              is seeing something that is "somebody else's" to review.
            */}
            {orgWide && item.assigned_approver && (
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                Routed to <strong style={{ color: 'var(--color-text)' }}>{item.assigned_approver.full_name}</strong>
                {item.snapshot_project_name ? ` for ${item.snapshot_project_name}` : ''}
              </p>
            )}

            {/* THE ACTOR. Same sentence for every viewer of this recognition. */}
            {item.decision && (
              <DecisionLine
                action={item.decision.action}
                actorName={item.decision.actor_name}
                actorRole={item.decision.actor_role}
                at={item.decision.at}
                detail={item.decision.reason ?? item.decision.note}
                detailLabel={item.decision.reason ? 'Reason' : item.decision.note ? 'Requested' : undefined}
              />
            )}

            {rowConflict && (
              <p
                className="flex items-start gap-1.5"
                role="status"
                style={{ fontSize: 12.5, color: 'var(--color-accent-800)', lineHeight: 1.45 }}
              >
                <AlertCircle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                {rowConflict}
              </p>
            )}

            {/*
              The buttons appear only while this viewer may still act.

              `can_act` is computed by the database, by the same function that
              refuses the decision — so what the buttons offer and what the
              database accepts cannot drift apart. It is still only a display
              rule: hiding a button is not a control, and record_nomination_
              decision() refuses regardless of what is clicked.
            */}
            {item.can_act ? (
              <div className="flex flex-wrap gap-2" style={{ paddingTop: 4 }}>
                <button className="vs-btn vs-btn-primary relative" onClick={() => openAction('approve', item)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Corners />
                  <CheckSquare size={13} aria-hidden="true" /> Approve
                </button>
                <button className="vs-btn" onClick={() => openAction('request_clarification', item)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MessageSquare size={13} aria-hidden="true" /> Request Clarification
                </button>
                <button
                  className="vs-btn vs-btn-ghost"
                  style={{ color: 'var(--color-accent-800)' }}
                  onClick={() => openAction('reject', item)}
                >
                  <XCircle size={13} aria-hidden="true" /> Reject
                </button>
              </div>
            ) : item.status === 'pending' && (
              /*
                Still waiting, but not for this person: they are named in the
                recognition. The routing trigger already refuses to route a
                recognition to a party (029/030); this is the same rule applied
                to HR and Super Admin, who reach everything.
              */
              <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', lineHeight: 1.45 }}>
                You are named in this recognition, so another approver has to review it.
              </p>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="animate-fade-in" style={{ maxWidth: 680, margin: '0 auto' }}>
      <PageHeader
        kicker={orgWide ? 'Organisation-wide' : 'Manager Queue'}
        title="Pending Approvals"
        subtitle={
          waiting.length > 0
            ? `${waiting.length} recognition${waiting.length !== 1 ? 's' : ''} awaiting review`
            : undefined
        }
      />

      {query.isError && (
        <p role="alert" className="flex items-center gap-1.5" style={{ fontSize: 13, color: 'var(--color-accent-800)', marginBottom: 12 }}>
          <AlertCircle size={14} aria-hidden="true" />
          {errorMessage(query.error, 'We could not load the approval queue.')}
        </p>
      )}

      {waiting.length === 0 && handled.length === 0 ? (
        <EmptyState
          icon={<CheckSquare size={36} />}
          title="You're all caught up"
          description={orgWide
            ? 'No recognitions are waiting for review anywhere in the organisation right now.'
            : 'No recognitions are waiting for your review right now.'}
        />
      ) : (
        <>
          {waiting.length > 0 && (
            <div className="vs-card" style={{ overflow: 'visible' }}>
              {waiting.map(renderRow)}
            </div>
          )}

          {waiting.length === 0 && (
            <EmptyState
              icon={<CheckSquare size={36} />}
              title="Nothing waiting"
              description="Everything below has already been handled by one of the approval authorities."
            />
          )}

          {/*
            Recently handled — approved, rejected, or sent back for
            clarification. Present so a decision by another authority reads as a
            decision rather than as a disappearance.
          */}
          {handled.length > 0 && (
            <section style={{ marginTop: 22 }}>
              <h2 className="vs-kicker" style={{ marginBottom: 8 }}>
                Recently handled
              </h2>
              <div className="vs-card" style={{ overflow: 'visible' }}>
                {handled.map(renderRow)}
              </div>
            </section>
          )}
        </>
      )}

      {/* Action Modal */}
      {actionModal && (
        <div
          className="vs-dialog-backdrop"
          {...dismissOnBackdrop(() => closeModal())}
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-modal-title"
        >
          <div
            className="vs-dialog animate-fade-in"
            style={{ minWidth: 400 }}
            onClick={e => e.stopPropagation()}
          >
            <Corners />
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
              <h2 id="action-modal-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
                {actionModal.type === 'approve' && 'Approve recognition'}
                {actionModal.type === 'reject'  && 'Reject recognition'}
                {actionModal.type === 'request_clarification' && 'Request clarification'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.5 }}>
                {actionModal.type === 'approve' && 'This recognition will be published and the employee notified.'}
                {actionModal.type === 'reject'  && 'Provide a reason. The rejection reason will not be visible to the nominee.'}
                {actionModal.type === 'request_clarification' && 'Describe what additional information would help you evaluate this.'}
              </p>
              {/*
                Said before the click, not after it. Three authorities can be
                looking at this item, and the decision is recorded against the
                person who makes it.
              */}
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 6, lineHeight: 1.45 }}>
                Recorded as your decision. Whoever acts first is the one recorded — the
                others will see that you reviewed it.
              </p>
            </div>

            {/* Body — textarea for reject/clarify */}
            {actionModal.type !== 'approve' && (
              <div style={{ padding: '14px 18px' }}>
                <label
                  htmlFor="action-text"
                  style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}
                >
                  {actionModal.type === 'reject' ? 'Reason' : 'Clarification request'}
                  <span aria-hidden="true" style={{ color: 'var(--color-accent-700)', marginLeft: 3 }}>*</span>
                </label>
                <textarea
                  id="action-text"
                  className="vs-input w-full"
                  style={{ minHeight: 110, resize: 'vertical' }}
                  value={actionText}
                  onChange={e => setActionText(e.target.value)}
                  placeholder={
                    actionModal.type === 'reject'
                      ? 'Explain why this recognition cannot be approved…'
                      : 'What additional detail would help validate this recognition?'
                  }
                  autoFocus
                />
              </div>
            )}

            {actionError && (
              <p
                className="flex items-start gap-1"
                role="alert"
                style={{
                  margin: actionModal.type === 'approve' ? '14px 18px 0' : '0 18px',
                  fontSize: 12,
                  color: 'var(--color-accent-800)',
                  lineHeight: 1.45,
                }}
              >
                <AlertCircle size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                {actionError}
              </p>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)', marginTop: 12 }}>
              <button className="vs-btn" onClick={closeModal} disabled={actionLoading}>Cancel</button>
              <button
                className="vs-btn vs-btn-primary relative"
                style={
                  actionModal.type === 'reject'
                    ? { background: 'var(--color-accent-800)', borderColor: 'var(--color-accent-800)', color: 'var(--color-on-accent, var(--color-bg))' }
                    : undefined
                }
                onClick={handleAction}
                disabled={actionLoading}
                aria-busy={actionLoading}
              >
                <Corners />
                {actionLoading ? 'Working…'
                  : actionModal.type === 'approve' ? 'Approve'
                  : actionModal.type === 'reject'  ? 'Reject'
                  : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
