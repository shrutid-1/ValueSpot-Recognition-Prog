import { useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { ResolveRequestDialog } from '@/components/hr/ResolveRequestDialog'
import { ProposalSummary } from '@/components/support/ProposalSummary'
import { useSupportQueue } from '@/hooks/queries'
import type { SupportRequest, SupportRequestStatus, SupportIssueType } from '@/lib/api'
import { formatIST } from '@/lib/date-utils'

/**
 * The correction queue, shared by HR and Super Admin.
 *
 * ONE QUEUE, NOT TWO
 * ------------------
 * Both roles read the same rows, through two SELECT policies over one table.
 * There is no per-role copy and nothing is mirrored between them, which is
 * what makes the stated behaviour fall out for free: whoever resolves a
 * request first, the other immediately sees it as resolved and by whom,
 * because they were always looking at the same row.
 *
 * Opening a request does NOT change it. Only the explicit action in the dialog
 * settles anything.
 */

const ISSUE_LABELS: Record<SupportIssueType, string> = {
  core_value: 'Wrong Core Value',
  behaviour:  'Wrong Behaviour',
  scenario:   'Wrong Scenario',
  story:      'Mistake in what happened',
  impact:     'Mistake in the impact',
  project:    'Wrong project',
  other:      'Something else',
}

const STATUS_TAG: Record<SupportRequestStatus, string> = {
  open:        'vs-tag-outline',
  in_progress: 'vs-tag-outline',
  resolved:    'vs-tag-accent',
  rejected:    'vs-tag-neutral',
}

const STATUS_LABEL: Record<SupportRequestStatus, string> = {
  open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', rejected: 'Rejected',
}

const FILTERS: Array<{ key: SupportRequestStatus | 'all'; label: string }> = [
  { key: 'all',         label: 'All' },
  { key: 'open',        label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved',    label: 'Resolved' },
  { key: 'rejected',    label: 'Rejected' },
]

function resolverLabel(role: string | null): string {
  return role === 'super_admin' ? 'Super Admin' : role === 'hr_admin' ? 'HR' : 'an administrator'
}

export default function SupportRequestsPage() {
  const [filter, setFilter] = useState<SupportRequestStatus | 'all'>('all')
  const [active, setActive] = useState<SupportRequest | null>(null)

  const queue = useSupportQueue(filter)
  const rows = queue.data ?? []

  /*
    Counts come from the rows already loaded when showing "all", so the summary
    costs no extra query. On a filtered view only that status is known, so the
    others are left blank rather than guessed at.
  */
  const counts = filter === 'all'
    ? {
        open: rows.filter(r => r.status === 'open').length,
        in_progress: rows.filter(r => r.status === 'in_progress').length,
        resolved: rows.filter(r => r.status === 'resolved').length,
        rejected: rows.filter(r => r.status === 'rejected').length,
      }
    : null

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Support Requests"
        subtitle="Recognition corrections asked for by employees. HR and Super Admins share this queue."
      />

      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['open', 'in_progress', 'resolved', 'rejected'] as SupportRequestStatus[]).map(key => (
            <div key={key} className="vs-card relative" style={{ padding: '12px 14px' }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <p className="vs-kicker" style={{ marginBottom: 4 }}>{STATUS_LABEL[key]}</p>
              <p className="font-condensed vs-metric-value" style={{ fontSize: 26, fontWeight: 600 }}>
                {counts[key]}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="vs-seg" style={{ display: 'inline-flex', flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'inherit', border: 'none',
              borderRight: '1px solid var(--color-divider)',
              background: filter === f.key ? 'var(--color-accent)' : 'transparent',
              color: filter === f.key ? 'var(--color-on-accent, #fff)' : 'var(--color-neutral-600)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {queue.isPending ? <TableSkeleton /> : rows.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy size={36} />}
          title="Nothing here"
          description={filter === 'all'
            ? 'No employee has asked for a correction yet.'
            : `No ${STATUS_LABEL[filter as SupportRequestStatus].toLowerCase()} requests.`}
        />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="vs-table w-full" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  <th>Requester</th>
                  <th>Recognition</th>
                  <th>Issue</th>
                  <th className="hidden lg:table-cell">Requested</th>
                  <th>Status</th>
                  <th style={{ width: 90 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map(req => {
                  const nom = req.nomination
                  const settled = req.status === 'resolved' || req.status === 'rejected'

                  return (
                    <tr key={req.id}>
                      <td>
                        <EmployeeAvatar
                          name={req.requester?.full_name ?? 'Unknown'}
                          avatarUrl={req.requester?.avatar_url}
                          size="sm"
                          showName
                          subtitle={formatIST(req.created_at)}
                        />
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>
                        {nom?.nominator?.full_name ?? '—'} → {nom?.nominee?.full_name ?? '—'}
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-600)' }}>
                          {nom?.snapshot_core_value_name ?? '—'}
                        </span>
                      </td>
                      <td style={{ fontSize: 13 }}>{ISSUE_LABELS[req.issue_type]}</td>
                      <td className="hidden lg:table-cell" style={{ fontSize: 12, color: 'var(--color-neutral-700)', maxWidth: 260 }}>
                        <span className="line-clamp-2">
                          {req.proposed_core_value_id
                            ? <ProposalSummary request={req} />
                            : req.requested_change}
                        </span>
                      </td>
                      <td>
                        <span className={`vs-tag ${STATUS_TAG[req.status]}`}>{STATUS_LABEL[req.status]}</span>
                        {settled && (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 3 }}>
                            by {resolverLabel(req.resolved_by_role)}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end">
                          {settled ? (
                            <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>—</span>
                          ) : (
                            <button className="vs-btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setActive(req)}>
                              Review
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active && <ResolveRequestDialog request={active} onClose={() => setActive(null)} />}
    </div>
  )
}
