import { CheckCircle2, MessageSquare, XCircle } from 'lucide-react'
import { roleLabel } from '@/lib/portals'
import { formatIST } from '@/lib/date-utils'
import type { UserRole } from '@/types'

/**
 * Who decided a recognition, said once, the same way everywhere.
 *
 * The rule this exists to hold: a recognition is never described only as
 * "Approved". Three different authorities can approve, reject or send back the
 * same recognition — the Project Manager it was routed to, HR, or a Super Admin
 * — so a bare status is ambiguous to every one of them and to the author. The
 * line always names the actor:
 *
 *     Approved by Manager — John Doe · 18 Sep 2026
 *     Rejected by HR — Priya Sharma · 18 Sep 2026
 *     Clarification requested by Super Admin — Pushkar Kaslikar · 18 Sep 2026
 *
 * ONE component rather than a formatter per screen, because the approval queue,
 * the author's own list and anywhere this goes next must not each invent their
 * own wording — the whole point is that the Manager, HR and the Super Admin all
 * read the same sentence about the same event.
 *
 * The ROLE is the one recorded at the time of the decision (approved_by_role
 * and its siblings, migration 042), not the actor's role today. When it is
 * absent — decisions made before that migration, which were never recorded with
 * one — the role is dropped rather than guessed, and the line reads
 * "Approved by John Doe".
 */

export type DecisionAction = 'approve' | 'reject' | 'request_clarification'

interface DecisionLineProps {
  action: DecisionAction
  actorName: string | null
  actorRole: UserRole | null
  at: string | null
  /** Rejection reason or clarification request, shown beneath when present. */
  detail?: string | null
  /** Label for `detail`, e.g. "Reason". Omitted when there is no detail. */
  detailLabel?: string
}

const VERB: Record<DecisionAction, string> = {
  approve: 'Approved by',
  reject: 'Rejected by',
  request_clarification: 'Clarification requested by',
}

const ICON: Record<DecisionAction, typeof CheckCircle2> = {
  approve: CheckCircle2,
  reject: XCircle,
  request_clarification: MessageSquare,
}

const TONE: Record<DecisionAction, string> = {
  approve: 'var(--color-success, #1e7049)',
  reject: 'var(--color-accent-800)',
  request_clarification: 'var(--color-neutral-700)',
}

export function DecisionLine({
  action, actorName, actorRole, at, detail, detailLabel,
}: DecisionLineProps) {
  const Icon = ICON[action]

  // "Manager — John Doe", or just the name when the role was never recorded.
  const who = actorName
    ? (actorRole ? `${roleLabel(actorRole)} — ${actorName}` : actorName)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p
        className="flex items-center gap-1.5"
        style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', lineHeight: 1.45 }}
      >
        <Icon size={13} aria-hidden="true" style={{ color: TONE[action], flexShrink: 0 }} />
        <span>
          {/*
            When the actor is unknown the sentence stops at the verb rather than
            reading "Approved by null" — an unnamed actor is a gap in the record
            and should look like one.
          */}
          <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            {who ? `${VERB[action]} ${who}` : VERB[action].replace(' by', '')}
          </strong>
          {at && (
            <span style={{ color: 'var(--color-neutral-600)' }}>
              {' · '}{formatIST(at)}
            </span>
          )}
        </span>
      </p>

      {detail && (
        <div
          style={{
            borderLeft: '2px solid var(--color-divider)',
            paddingLeft: 10,
            fontSize: 12.5,
            color: 'var(--color-neutral-700)',
            lineHeight: 1.5,
          }}
        >
          {detailLabel && (
            <span className="vs-kicker" style={{ display: 'block', marginBottom: 2 }}>
              {detailLabel}
            </span>
          )}
          {detail}
        </div>
      )}
    </div>
  )
}
