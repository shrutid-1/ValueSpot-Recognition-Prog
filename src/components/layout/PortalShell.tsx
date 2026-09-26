import { useAuth } from '@/context/AuthContext'
import { AppShell } from './AppShell'
import { EmployeeShell } from './EmployeeShell'

/**
 * Picks the shell for the signed-in role.
 *
 * An Employee gets the redesigned experience — top navigation, dark canvas,
 * the new type system. A Manager, HR Admin or Super Admin keeps the existing
 * Blueprint portal, whose sidebar carries twenty-odd administrative
 * destinations that a top bar would not hold.
 *
 * This is PRESENTATION ONLY and grants nothing. It reads the role the way the
 * sidebar already does, to decide what a screen looks like; ProtectedRoute
 * still guards every route, and the database re-checks every action. Someone
 * who edited their role in memory would change the colour of their navigation
 * and nothing else.
 *
 * While the session is still resolving, `role` is null and this renders the
 * administrative shell. That is only ever a flash — ProtectedRoute holds the
 * tree until auth settles — but it is why the shell is chosen here, inside the
 * guard, rather than in the router where it would be decided before there is
 * a role to read.
 */
export function PortalShell() {
  const { role } = useAuth()
  return role === 'employee' ? <EmployeeShell /> : <AppShell />
}
