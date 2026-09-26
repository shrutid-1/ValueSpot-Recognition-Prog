import { useQuery, useMutation } from '@tanstack/react-query'
import { employeesApi, type EmployeeQuery } from '@/lib/api'
import type { UserRole } from '@/types'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Employee directory.
 *
 *     component → hook → employeesApi → Supabase → PostgreSQL + RLS
 *
 * The hook knows nothing about tables or RPCs; the API layer knows nothing
 * about React. Neither is a data-access boundary on its own — RLS and the
 * database guards remain the authority, and nothing here decides permissions.
 */

export function useEmployeeDirectory(query: EmployeeQuery) {
  return useQuery({
    queryKey: keys.employees.list(query),
    queryFn: () => employeesApi.list(query),
    /*
      Keep the previous page on screen while the next loads, so typing in the
      search box does not blank the table between keystrokes. The page already
      debounces input; this removes the remaining flicker.
    */
    placeholderData: previous => previous,
  })
}

/*
  usePotentialManagers() lived here. It populated the "Manager" dropdown on the
  employee form — the employee -> line-manager association, which migration 030
  retired. Managers relate to PROJECTS now, and the project form has its own
  stricter list (useEligibleProjectManagers: role 'manager' only).
*/

export function useCreateEmployee() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: employeesApi.create,
    // A new person appears in the directory.
    onSuccess: () => { void invalidate.employeesAll() },
  })
}

export function useUpdateEmployeeProfile() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: {
      id: string
      fullName?: string
      departmentId?: string | null
      designation?: string | null
      employeeCode?: string
    }) => employeesApi.updateProfile(vars.id, vars),
    // A rename, or a corrected company ID, shows up across the directory listings.
    onSuccess: () => { void invalidate.employeesAll() },
  })
}

export function useSetEmployeeRole() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: { employeeId: string; role: UserRole }) =>
      employeesApi.setRole(vars.employeeId, vars.role),
    onSuccess: () => {
      void invalidate.employeesAll()
      // A role change is also an administrative event: the Administration
      // listings and the security trail both move.
      void invalidate.adminRoles()
    },
  })
}

export function useSetEmployeeActive() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      employeesApi.setActive(vars.id, vars.isActive),
    // Deactivation removes someone from the manager list as well as the table.
    onSuccess: () => { void invalidate.employeesAll() },
  })
}

/**
 * Erase an employee permanently.
 *
 * The broadest invalidation in the file, and deliberately so. An erasure does
 * not merely remove a directory row: it deletes the recognitions that person
 * gave, which changes other people's feeds, their own lists, badge counts and
 * every analytic derived from them, and it can leave a project without a
 * manager. Naming the individual caches would mean enumerating consequences
 * the caller cannot see; refetching is cheaper than showing a deleted person.
 */
export function useDeleteEmployee() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (id: string) => employeesApi.deleteEmployee(id),
    onSuccess: () => {
      void invalidate.employeesAll()
      void invalidate.recognitionsAll()
      void invalidate.analytics()
      void invalidate.adminRoles()
      void invalidate.support()
      // A project they managed is now unassigned, and their own project
      // membership is gone.
      void invalidate.projects()
      void invalidate.employeeProjects()
      // They are gone from every report picker, and from the figures.
      void invalidate.reports()
    },
  })
}

export function useSendInvitation() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (employeeId: string) => employeesApi.sendInvitation(employeeId),
    onSuccess: (_result, employeeId) => {
      /*
        Only the delivery status for this one person. Sending an invitation
        changes nothing about the directory — invalidating it here would make
        the table refetch for no reason, which is exactly the kind of
        over-broad invalidation to avoid.
      */
      void invalidate.invitationStatus(employeeId)
    },
  })
}
