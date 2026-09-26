import React, { Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import { dashboardForRole } from '@/lib/portals'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { useAuth } from '@/context/AuthContext'

/**
 * Routing components used to assemble the router.
 *
 * These live apart from router.tsx so that each module has a single kind of
 * export — components here, the router instance there. Mixing the two in one
 * file defeats Fast Refresh.
 */

/** Role-aware landing redirect for the index route. */
export function RoleRedirect() {
  const { employee, loading } = useAuth()
  if (loading) return null
  if (!employee) return <Navigate to={ROUTES.LOGIN} replace />
  return <Navigate to={dashboardForRole(employee.role)} replace />
}

/**
 * Keeps already-authenticated users off the login and signup screens — landing
 * on a sign-in form when you are already signed in is disorienting.
 */
export function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { session, employee, loading } = useAuth()
  if (loading) return null
  if (session && employee) return <Navigate to={dashboardForRole(employee.role)} replace />
  return <>{children}</>
}

/** Placeholder shown while a lazily-loaded page chunk is fetched. */
export function PageLoader() {
  return (
    <div className="space-y-4 p-6 max-w-4xl">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-4 gap-4 mt-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    </div>
  )
}

/** Suspense boundary wrapper for lazily-loaded pages. */
export function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

/**
 * One route, two presentations of the same screen.
 *
 * The recognition feed is the same data, the same query and the same actions
 * for everybody; what differs is the design system it is drawn in — the
 * Employee portal's dark panels, or the administrative portal's light cards.
 * Rather than duplicating the route, the ROLE picks which page renders, the
 * way PortalShell picks which shell wraps it.
 *
 * This grants nothing and hides nothing. Both pages call the same hook, the
 * database decides what the feed contains and which actions it will accept,
 * and a person who forced the other presentation would see their own feed in
 * the wrong colours.
 *
 * Only the chosen element is rendered, so only that lazy chunk is fetched.
 */
export function ByPortal({ employee, admin }: { employee: React.ReactNode; admin: React.ReactNode }) {
  const { role } = useAuth()
  // While the session is still resolving, `role` is null — the Employee
  // presentation is the safe default, and ProtectedRoute holds the tree until
  // auth settles, so this is only ever a frame.
  return <>{role && role !== 'employee' ? admin : employee}</>
}
