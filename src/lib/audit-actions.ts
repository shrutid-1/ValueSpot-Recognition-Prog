/**
 * The audit trail's vocabulary: every `action` the database writes, grouped
 * and labelled for the Audit Logs screen.
 *
 * Audit rows are written only by SECURITY DEFINER functions in the
 * migrations, never by the app, so this list is transcribed from them. The
 * screen used to filter on names like 'login' and 'employee_created' that no
 * function has ever written — those filters could only come back empty.
 * When a migration adds a new audit action, add it here too; until then it
 * still appears under "All actions", just with its raw name.
 *
 * Written today by:
 *   login.*                 021 / 023 / 025  (email sign-in codes, sign-out)
 *   employee.*, super_admin.*  016 / 027 / 035 / 037
 *   nomination_*            042              (approval decisions)
 *   recognition.*           034              (moderation)
 *   value_coins.*           050
 *   reward.*                051 / 052
 *   support_request.*       034
 *   audit_log.cleared       055
 *   signup_domains.*, access_code.*  017    (access codes were retired in
 *                                            018; old rows remain)
 */

export interface AuditActionGroup {
  id: string
  label: string
  actions: Array<{ action: string; label: string }>
}

export const AUDIT_ACTION_GROUPS: AuditActionGroup[] = [
  {
    id: 'sign-in',
    label: 'Sign-in',
    actions: [
      { action: 'login.code_verified',        label: 'Signed in' },
      { action: 'login.code_sent',            label: 'Sign-in code sent' },
      { action: 'login.code_failed',          label: 'Wrong sign-in code' },
      { action: 'login.verification_revoked', label: 'Signed out' },
    ],
  },
  {
    id: 'recognitions',
    label: 'Recognitions',
    actions: [
      { action: 'nomination_approved',                label: 'Recognition approved' },
      { action: 'nomination_rejected',                label: 'Recognition rejected' },
      { action: 'nomination_clarification_requested', label: 'Clarification requested' },
      { action: 'recognition.moderated',              label: 'Recognition edited by moderator' },
      { action: 'recognition.removed',                label: 'Recognition removed' },
    ],
  },
  {
    id: 'employees',
    label: 'Employees & roles',
    actions: [
      { action: 'employee.invited',      label: 'Employee invited' },
      { action: 'employee.role_changed', label: 'Role changed' },
      { action: 'super_admin.granted',   label: 'Super Admin granted' },
      { action: 'super_admin.revoked',   label: 'Super Admin revoked' },
      { action: 'employee.erased',       label: 'Employee permanently deleted' },
    ],
  },
  {
    id: 'rewards',
    label: 'Value Coins & rewards',
    actions: [
      { action: 'value_coins.adjusted', label: 'Value Coins adjusted' },
      { action: 'reward.redeemed',      label: 'Reward redeemed' },
      { action: 'reward.approved',      label: 'Reward redemption approved' },
      { action: 'reward.rejected',      label: 'Reward redemption rejected' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    actions: [
      { action: 'support_request.created',  label: 'Support request raised' },
      { action: 'support_request.resolved', label: 'Support request resolved' },
      { action: 'support_request.rejected', label: 'Support request rejected' },
    ],
  },
  {
    id: 'audit',
    label: 'Audit log',
    actions: [
      { action: 'audit_log.cleared', label: 'Audit log cleared' },
    ],
  },
  {
    id: 'settings',
    label: 'Access settings',
    actions: [
      { action: 'signup_domains.changed', label: 'Sign-up domains changed' },
      { action: 'access_code.issued',     label: 'Access code issued' },
      { action: 'access_code.revoked',    label: 'Access code revoked' },
    ],
  },
]

const LABELS = new Map(
  AUDIT_ACTION_GROUPS.flatMap(g => g.actions.map(a => [a.action, a.label] as const)),
)

/** A readable name for an action; an unknown one falls back to its raw name. */
export function auditActionLabel(action: string): string {
  return LABELS.get(action) ?? action.replace(/[._]/g, ' ')
}

/** Filter value for a whole group, as opposed to one exact action. */
export const groupFilter = (id: string) => `group:${id}`

/**
 * The actions a filter value selects: every action in a group, one exact
 * action, or undefined for no filter at all.
 */
export function actionsForFilter(filter: string): string[] | undefined {
  if (!filter) return undefined
  if (filter.startsWith('group:')) {
    const group = AUDIT_ACTION_GROUPS.find(g => groupFilter(g.id) === filter)
    return group ? group.actions.map(a => a.action) : []
  }
  return [filter]
}

/** How a filter reads in a sentence, e.g. the empty state. */
export function filterLabel(filter: string): string {
  if (filter.startsWith('group:')) {
    const group = AUDIT_ACTION_GROUPS.find(g => groupFilter(g.id) === filter)
    return group ? `all ${group.label.toLowerCase()} activity` : filter
  }
  return auditActionLabel(filter).toLowerCase()
}
