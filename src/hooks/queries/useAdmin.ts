import { useQuery, useMutation } from '@tanstack/react-query'
import { adminApi, type PrivilegedRole } from '@/lib/api'
import type { UserRole } from '@/types'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Administration — privileged role holders, signup policy, security trail.
 *
 * Every underlying function re-reads the caller's role from the database
 * before answering, so a refusal here is the database's verdict and is cached
 * like any other result. The retry policy in queryClient.ts deliberately does
 * not retry 'forbidden' — asking three times produces three identical refusals
 * and delays the message the user needs.
 */

export function useRoleHolders(role: PrivilegedRole) {
  return useQuery({
    queryKey: keys.admin.roleHolders(role),
    queryFn: () => adminApi.listRoleHolders(role),
  })
}

/**
 * People eligible to be granted a privileged role.
 *
 * Fetched lazily: the picker is behind a button, and loading two candidate
 * lists on every visit to Administration would be two requests nobody asked
 * for. `enabled` keeps it that way while still sharing the cache — opening the
 * same picker twice is one request.
 */
export function usePromotionCandidates(role: PrivilegedRole, enabled: boolean) {
  return useQuery({
    queryKey: keys.admin.candidates(role),
    queryFn: () => adminApi.listPromotionCandidates(role),
    enabled,
    staleTime: 60_000,
  })
}

/**
 * Grant or revoke a privileged role.
 *
 * Invalidates BOTH cards' listings and both candidate pickers, not just the
 * one that acted. Promoting somebody to Super Admin removes them from the HR
 * Admin candidate list, so refreshing only the acting card would leave the
 * other offering a stale option — a real bug in the previous implementation,
 * which reloaded only itself.
 */
export function useSetPrivilegedRole() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: { employeeId: string; role: UserRole }) =>
      adminApi.setRole(vars.employeeId, vars.role),
    onSuccess: () => {
      // Role holders + candidates + the security trail, which just gained a row.
      void invalidate.adminRoles()
      // The directory shows the role too.
      void invalidate.employeeDirectory()
    },
  })
}

export function useSignupDomains() {
  return useQuery({
    queryKey: keys.admin.signupDomains(),
    queryFn: () => adminApi.getSignupDomains(),
    // Policy, not activity: it changes when somebody changes it.
    staleTime: 5 * 60_000,
  })
}

export function useSetSignupDomains() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (domains: string[]) => adminApi.setSignupDomains(domains),
    onSuccess: () => {
      void invalidate.signupDomains()
      // set_signup_domains() writes an audit row.
      void invalidate.adminRoles()
    },
  })
}

export function useSecurityActivity(limit = 100) {
  return useQuery({
    queryKey: keys.admin.securityActivity(limit),
    queryFn: () => adminApi.listSecurityActivity(limit),
  })
}
