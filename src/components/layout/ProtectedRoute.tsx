import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { ProfileStatus } from '@/context/AuthContext'
import type { UserRole } from '@/types'
import { ROUTES } from '@/lib/constants'
import { dashboardForRole } from '@/lib/portals'
import { Skeleton } from '@/components/shared/SkeletonLoader'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: UserRole | UserRole[]
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  employee:    1,
  manager:     2,
  hr_admin:    3,
  super_admin: 4,
}

function hasRequiredRole(userRole: UserRole | null, required: UserRole | UserRole[]): boolean {
  if (!userRole) return false
  const roles = Array.isArray(required) ? required : [required]
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0
  return roles.some(r => ROLE_HIERARCHY[r] <= userLevel)
}

/**
 * Shown when someone is authenticated but has no employee profile to act as.
 * This is a dead end for the user, so it names the cause and offers the only
 * two useful actions rather than silently looping them back to sign-in.
 */
function AccountNotReady({
  status,
  onSignOut,
}: {
  status: ProfileStatus
  onSignOut: () => void
}) {
  const inactive = status === 'inactive'

  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: 24 }}
    >
      <div
        className="vs-card relative"
        style={{ maxWidth: 440, padding: 28, background: 'var(--color-surface)' }}
      >
        <i className="corner tl" /><i className="corner tr" />
        <i className="corner bl" /><i className="corner br" />

        <h1
          className="font-condensed"
          style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}
        >
          {inactive ? 'Your account is inactive' : 'Account not linked'}
        </h1>

        <p style={{ fontSize: 14, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginBottom: 8 }}>
          {inactive
            ? 'Your employee record has been deactivated, so you cannot use ValueSpot right now.'
            : 'You are signed in, but this email address is not linked to an employee record, so there is nothing to show you.'}
        </p>

        {!inactive && (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginBottom: 8 }}>
            Signing in normally creates this record automatically, so seeing it
            means the database setup is incomplete.
          </p>
        )}

        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginBottom: 20 }}>
          {inactive
            ? 'Please contact HR to reactivate your record.'
            : 'Sign out and back in to retry. If it persists, ask IT to run `npm run doctor`.'}
        </p>

        <button
          className="vs-btn vs-btn-primary relative"
          onClick={onSignOut}
          style={{ height: 38 }}
        >
          <i className="corner tl" /><i className="corner tr" />
          <i className="corner bl" /><i className="corner br" />
          Sign out
        </button>
      </div>
    </div>
  )
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { session, employee, profileStatus, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: '100vh', background: 'var(--color-bg)' }}
      >
        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton style={{ height: 3, width: '100%', background: 'var(--color-neutral-300)' }} />
          <Skeleton style={{ height: 3, width: '75%', background: 'var(--color-neutral-300)' }} />
          <Skeleton style={{ height: 3, width: '55%', background: 'var(--color-neutral-300)' }} />
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
  }

  // A session that has only seen a password: the second step was never
  // completed, or the tab was left open from a half-finished sign-in. Send it
  // back to sign in, where the code screen is. This is not the security
  // boundary — the database already declines to serve such a session — it just
  // avoids showing an "account not ready" page for something that is simply
  // unfinished.
  if (profileStatus === 'unverified') {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
  }

  // Signed in, but there is no usable employee profile. Redirecting to /login
  // here produced a loop with no message: the user signs in successfully and
  // lands straight back on the sign-in page. Explain it instead.
  if (!employee) {
    return <AccountNotReady status={profileStatus} onSignOut={signOut} />
  }

  if (requiredRole && !hasRequiredRole(employee.role, requiredRole)) {
    /*
      Send them to their OWN dashboard rather than a blank error.

      dashboardForRole() rather than a table written out here: this file held a
      fourth copy of the same role-to-dashboard mapping, and four copies is
      four chances for one of them to send a role somewhere it does not belong.
      The refusal above is the security decision; this only picks where to land
      afterwards.
    */
    return <Navigate to={dashboardForRole(employee.role)} replace />
  }

  return <>{children}</>
}
