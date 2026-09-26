/**
 * Administration — who holds privileged roles, who may sign up, and the
 * security audit trail.
 *
 * Everything here is backed by SECURITY DEFINER functions from migrations 016
 * and 017, each of which re-reads the caller's own role from the database
 * before answering. That is why these are RPCs rather than table reads: the
 * authorization is inseparable from the query, and a policy alone could not
 * express "only a Super Admin, and only if verified".
 *
 * This layer therefore adds no checks of its own and must not — it would only
 * be a second opinion the database ignores. It normalises shapes and messages.
 */
import type { UserRole } from '@/types'
import { supabase, toApiError, ApiError } from './client'

/** The two roles the Administration screen manages. */
export type PrivilegedRole = Extract<UserRole, 'hr_admin' | 'super_admin'>

export interface RoleHolder {
  id: string
  full_name: string
  email: string
  /** Present on candidate listings; absent from the privileged-role listings. */
  role?: string
  is_active: boolean
  /**
   * Whether this person can actually sign in — active AND registered.
   * The last-administrator warning depends on it, so it is not optional.
   */
  can_sign_in: boolean
}

/** Somebody who could be granted a privileged role. */
export interface PromotionCandidate {
  id: string
  full_name: string
  email: string
  role: string
}

export interface SecurityEvent {
  id: string
  action: string
  actor_email: string | null
  created_at: string
  entity_id?: string | null
  new_value?: unknown
  previous_value?: unknown
}

export const adminApi = {
  /**
   * Who currently holds a privileged role.
   *
   * Two different functions because they answer with different detail — the
   * administrator listing includes whether each can actually sign in, which is
   * what the last-admin warning depends on.
   */
  async listRoleHolders(role: PrivilegedRole): Promise<RoleHolder[]> {
    // Branched rather than computing the RPC name, so both stay statically
    // checkable against the generated schema types.
    const { data, error } = role === 'super_admin'
      ? await supabase.rpc('list_administrators')
      : await supabase.rpc('list_hr_administrators')

    if (error) throw toApiError(error, 'Could not load that list.')

    // The function answers with its own authorization verdict rather than
    // erroring, so a non-'ok' status is a refusal and not an empty list.
    const payload = data as { status?: string; admins?: RoleHolder[] } | null
    if (payload?.status !== 'ok') {
      throw new ApiError('Only a Super Admin can view this.', payload?.status ?? 'forbidden')
    }

    return payload.admins ?? []
  },

  /**
   * Grant or revoke a privileged role.
   *
   * Shares set_employee_role() with the Employees screen deliberately: one
   * function is the only way a role changes anywhere, enforced by 016's
   * trigger, so there is exactly one place where the rules live.
   */
  async setRole(employeeId: string, role: UserRole): Promise<void> {
    const { data, error } = await supabase.rpc('set_employee_role', {
      p_employee_id: employeeId,
      p_role: role,
    })

    if (error) throw toApiError(error, 'Could not change that role.')

    const result = data as { status?: string; reason?: string } | null

    switch (result?.status) {
      case 'ok':
        return
      case 'last_admin':
        throw new ApiError(
          'This is the only administrator who can sign in. Add another one first — ' +
          'the system will not leave itself without one.',
          'last_admin',
        )
      case 'forbidden':
        throw new ApiError(
          result.reason === 'needs_super_admin'
            ? 'Only a Super Admin can grant or revoke administrator access.'
            : 'You do not have permission to change this role.',
          'forbidden',
        )
      case 'not_found':
        throw new ApiError('That person no longer exists.', 'not_found')
      default:
        throw new ApiError('Could not change that role.', result?.status ?? 'unknown')
    }
  },

  /**
   * People who could be granted a privileged role.
   *
   * Only those who have actually registered: granting a role to a record
   * nobody has signed up against produces an administrator who cannot log in.
   */
  async listPromotionCandidates(targetRole: PrivilegedRole): Promise<PromotionCandidate[]> {
    let query = supabase
      .from('employees')
      .select('id, full_name, email, role')
      .eq('is_active', true)
      .not('auth_user_id', 'is', null)
      .neq('role', targetRole)
      .order('full_name')
      .limit(200)

    // Granting HR Admin to a Super Admin would be a demotion in disguise.
    if (targetRole === 'hr_admin') query = query.neq('role', 'super_admin')

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load candidates.')
    return (data ?? []) as PromotionCandidate[]
  },

  /** Domains permitted to self-register. Empty means unrestricted. */
  async getSignupDomains(): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_signup_domains')
    if (error) {
      throw new ApiError(
        'Could not load the domain list. Migration 014 may not be applied.',
        'unavailable',
        error,
      )
    }

    const payload = data as { status?: string; domains?: string[] } | null
    if (payload?.status !== 'ok') {
      throw new ApiError(
        'You do not have permission to manage signup domains.',
        payload?.status ?? 'forbidden',
      )
    }

    return payload.domains ?? []
  },

  /** Replace the allowlist. Super Admin only, enforced by migration 017. */
  async setSignupDomains(domains: string[]): Promise<void> {
    const { data, error } = await supabase.rpc('set_signup_domains', {
      p_domains: domains,
    })

    if (error) throw toApiError(error, 'Could not save the signup domains.')

    const payload = data as { status?: string; domain?: string } | null
    if (payload?.status === 'ok') return

    // invalid_domain names the offending entry, which is the whole value of
    // the message — echo it rather than replacing it with something generic.
    throw new ApiError(
      payload?.status === 'invalid_domain'
        ? `"${payload.domain}" is not a valid domain name.`
        : payload?.status === 'forbidden'
          ? 'You do not have permission to change this.'
          : 'Could not save. Please try again.',
      payload?.status ?? 'unknown',
    )
  },

  /** The administrative audit trail. */
  async listSecurityActivity(limit = 100): Promise<SecurityEvent[]> {
    const { data, error } = await supabase.rpc('list_security_activity', {
      p_limit: limit,
    })

    if (error) throw toApiError(error, 'Could not load security activity.')

    const payload = data as { status?: string; events?: SecurityEvent[] } | null
    if (payload?.status !== 'ok') {
      throw new ApiError(
        'Only a Super Admin can view security activity.',
        payload?.status ?? 'forbidden',
      )
    }

    return payload.events ?? []
  },
}
