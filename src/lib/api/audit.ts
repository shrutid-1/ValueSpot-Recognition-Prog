/**
 * The audit trail.
 *
 * Append-only, newest first, and read by HR and Super Admin only. Nothing here
 * writes: audit rows are written by the database triggers and the SECURITY
 * DEFINER functions that perform the privileged operations, which is what
 * makes the trail trustworthy. A client that could write it could forge it.
 *
 * Authorization is unchanged and none is performed here — the audit_logs
 * policies decide who sees what, gated on session_second_factor_ok().
 */
import type { AuditLog } from '@/types'
import { supabase, toApiError } from './client'

export interface AuditLogPage {
  rows: AuditLog[]
  /** True when the page came back full, so another may exist. */
  hasMore: boolean
}

export const DEFAULT_AUDIT_PAGE_SIZE = 50

export const auditApi = {
  /**
   * One page of the trail, newest first.
   *
   * Offset paging, as before. `audit_logs(created_at DESC)` already indexes
   * this ordering. Keyset paging would be steadier for a log that grows while
   * you read it, but that is a change of behaviour rather than of plumbing and
   * is deliberately left for a later phase.
   */
  async listPage(opts: {
    page: number
    pageSize?: number
    /**
     * Only these actions, e.g. ['employee.role_changed'] or every sign-in
     * action at once. See src/lib/audit-actions.ts for the names written.
     */
    actions?: string[]
  }): Promise<AuditLogPage> {
    const pageSize = opts.pageSize ?? DEFAULT_AUDIT_PAGE_SIZE
    const from = opts.page * pageSize

    let builder = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (opts.actions) builder = builder.in('action', opts.actions)

    const { data, error } = await builder
    if (error) throw toApiError(error, 'Could not load the audit log.')

    const rows = (data ?? []) as AuditLog[]
    return { rows, hasMore: rows.length === pageSize }
  },

  /**
   * Delete every entry. Super Admin only — clear_audit_log() (055) checks the
   * role itself and leaves one 'audit_log.cleared' row naming who did it.
   * Returns how many entries were removed.
   */
  async clearAll(): Promise<number> {
    const { data, error } = await supabase.rpc('clear_audit_log')
    if (error) throw toApiError(error, 'Could not clear the audit log.')
    return (data as { removed?: number } | null)?.removed ?? 0
  },
}
