import type { UserRole } from '@/types'
import { ROUTES } from '@/lib/constants'

/**
 * The three entry points people recognise themselves by, offered at SIGN-IN.
 *
 * A portal is a *destination*, not a permission. Choosing one never grants
 * anything: `employees.role` decides what a person may do, and the selection is
 * checked against it. Picking a portal you are not entitled to is refused; the
 * selector can only ever narrow where you land, never widen what you can reach.
 *
 * Deliberately not offered at SIGN-UP. Your role is already settled by then —
 * it is whatever HR stored on your employee record, or `employee` if nobody
 * invited you — so a chooser there decided nothing and only misled.
 *
 * `super_admin` is absent entirely: it is granted in Administration by another
 * Super Admin, never picked on a form.
 */
export interface Portal {
  id: Exclude<UserRole, 'super_admin'>
  label: string
  description: string
}

export const PORTALS: readonly Portal[] = [
  {
    id: 'employee',
    label: 'Employee',
    description: 'Give and receive recognition',
  },
  {
    id: 'manager',
    label: 'Manager',
    description: 'Review and approve your team',
  },
  {
    id: 'hr_admin',
    label: 'HR',
    description: 'Analytics, reports and administration',
  },
] as const

/** Seniority ordering. A role can enter its own portal and any below it. */
const ROLE_RANK: Record<UserRole, number> = {
  employee: 1,
  manager: 2,
  hr_admin: 3,
  super_admin: 4,
}

/** Whether an account's real role may enter the chosen portal. */
export function canEnterPortal(role: UserRole, portal: Portal['id']): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[portal]
}

/** Human-readable name for a stored role, for use in error messages. */
export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'employee': return 'Employee'
    case 'manager': return 'Manager'
    case 'hr_admin': return 'HR'
    case 'super_admin': return 'Super Admin'
  }
}

/**
 * The PRIMARY dashboard for a role — the one "Dashboard" means when that role
 * is the one signed in.
 *
 * One definition, used by three callers that must never disagree: the landing
 * redirect after sign-in, the redirect that keeps a signed-in person off the
 * login form, and the first item in the sidebar. They were not sharing one
 * before, which is the whole bug this fixes — the redirects were already
 * role-aware while the sidebar's "Dashboard" was hardwired to the Employee
 * route, so every role above Employee was offered a "Dashboard" that was not
 * the dashboard they had just landed on.
 *
 * Purely a destination. It reads the role to decide where to POINT, exactly as
 * the sidebar reads it to decide what to LIST; neither grants anything, and
 * every route still re-checks the role in its own guard and in the database.
 */
export function dashboardForRole(role: UserRole | string | null): string {
  if (role === 'super_admin' || role === 'hr_admin') return ROUTES.HR_DASHBOARD
  if (role === 'manager') return ROUTES.MANAGER_DASHBOARD
  return ROUTES.DASHBOARD
}

/** The portal a role lands in by default. */
export function defaultPortalFor(role: UserRole): Portal['id'] {
  if (role === 'hr_admin' || role === 'super_admin') return 'hr_admin'
  if (role === 'manager') return 'manager'
  return 'employee'
}
