import { useState } from 'react'
import { Shield, Trash2 } from 'lucide-react'
import { useAuditLog, useClearAuditLog } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { errorMessage } from '@/lib/query'
import { toast } from '@/hooks/use-toast'
import { ClearAuditLogDialog } from '@/components/hr/ClearAuditLogDialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { formatISTDateTime } from '@/lib/date-utils'
import {
  AUDIT_ACTION_GROUPS, auditActionLabel, filterLabel, groupFilter,
} from '@/lib/audit-actions'

/*
  Colours come from the admin theme's variables, never Tailwind's fixed hex
  tokens (bg-surface, text-text-muted …): those are literal light-mode values,
  so under the dark theme they left a pale table and a select whose light
  label sat on a pale fill.
*/
const TEXT   = { color: 'var(--ad-text)' }
const TEXT_2 = { color: 'var(--ad-text-2)' }
const TEXT_3 = { color: 'var(--ad-text-3)' }

export default function AuditLogsPage() {
  const [filterAction, setFilterAction] = useState('')

  /*
    The filter is part of the query key, so changing it selects a different
    cached list rather than resetting page state by hand — which is what the
    exhaustive-deps suppression here used to be working around.
  */
  const auditLog = useAuditLog(filterAction)

  const logs = auditLog.data?.pages.flatMap(p => p.rows) ?? []
  const loading = auditLog.isPending
  const loadingMore = auditLog.isFetchingNextPage
  const hasMore = auditLog.hasNextPage

  const loadMore = () => { void auditLog.fetchNextPage() }

  /*
    Clearing is a Super Admin's alone. HR reads the log but is never offered
    the button — and clear_audit_log() refuses them even if it were called.
  */
  const { role } = useAuth()
  const clearLog = useClearAuditLog()
  const [clearOpen, setClearOpen] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  const confirmClear = async () => {
    setClearError(null)
    try {
      const removed = await clearLog.mutateAsync()
      setClearOpen(false)
      setFilterAction('')
      toast({
        title: 'Audit log cleared',
        description: `${removed} ${removed === 1 ? 'entry' : 'entries'} removed. The clearing itself is now the first entry.`,
        variant: 'success',
      })
    } catch (err) {
      setClearError(errorMessage(err, 'Could not clear the audit log. Please try again.'))
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Logs"
        subtitle="Complete history of significant system and admin actions."
        actions={role === 'super_admin' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setClearError(null); setClearOpen(true) }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Clear audit log
          </Button>
        ) : undefined}
      />

      {clearOpen && (
        <ClearAuditLogDialog
          onClose={() => { setClearOpen(false); setClearError(null) }}
          onConfirm={confirmClear}
          clearing={clearLog.isPending}
          error={clearError}
        />
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <label htmlFor="audit-filter" className="text-sm font-medium shrink-0" style={TEXT_2}>
          Filter by action:
        </label>
        <select
          id="audit-filter"
          className="vs-input"
          style={{ width: 'auto', maxWidth: '100%' }}
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
        >
          <option value="">All actions</option>
          {/* Each group can be taken whole, or narrowed to one action. */}
          {AUDIT_ACTION_GROUPS.map(g => (
            <optgroup key={g.id} label={g.label}>
              <option value={groupFilter(g.id)}>All {g.label.toLowerCase()} activity</option>
              {g.actions.map(a => (
                <option key={a.action} value={a.action}>{a.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<Shield size={40} />}
          title="No audit logs"
          description={filterAction ? `Nothing recorded for ${filterLabel(filterAction)} yet.` : 'Actions will be logged here as they occur.'}
        />
      ) : (
        <>
          <div className="vs-card" style={{ overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table className="vs-table w-full text-sm min-w-[600px]">
                <thead>
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3 hidden md:table-cell">Entity</th>
                    <th className="px-4 py-3 hidden lg:table-cell">Entity ID</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-xs tabular-nums" style={TEXT_3}>
                        {formatISTDateTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm" style={TEXT_2}>
                        {log.actor_email ?? <span style={TEXT_3}>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {/* The readable name, with the raw action kept for anyone matching it elsewhere. */}
                        <span className="text-sm" style={TEXT}>{auditActionLabel(log.action)}</span>
                        <code className="block text-[11px] font-mono mt-0.5" style={TEXT_3}>{log.action}</code>
                      </td>
                      <td className="px-4 py-3 text-sm capitalize hidden md:table-cell" style={TEXT_2}>
                        {log.entity_type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {log.entity_id
                          ? <code className="text-xs font-mono" style={TEXT_3}>{log.entity_id.slice(0, 8)}&hellip;</code>
                          : <span style={TEXT_3}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={loadMore} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
