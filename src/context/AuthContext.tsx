import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Employee, UserRole } from '@/types'
import { canEnterPortal, roleLabel, defaultPortalFor, type Portal } from '@/lib/portals'

type PortalId = Portal['id']

/** Landing route for a role, so sign-in can hand the caller a destination. */
function dashboardPathFor(role: UserRole): string {
  switch (defaultPortalFor(role)) {
    case 'hr_admin': return '/hr/dashboard'
    case 'manager':  return '/manager/dashboard'
    default:         return '/dashboard'
  }
}

/**
 * Why a signed-in session might still have no usable profile.
 * - `ok`         — employee record loaded.
 * - `none`       — not signed in.
 * - `unverified` — password accepted, emailed code not yet entered. The
 *                  database refuses to load a profile for such a session, so
 *                  this is a real state rather than a display choice.
 * - `not_linked` — verified, but no employee row points at this auth user.
 * - `inactive`   — the employee record exists but HR has deactivated it.
 */
export type ProfileStatus = 'ok' | 'none' | 'unverified' | 'not_linked' | 'inactive'

/** Shape returned by the session_status() RPC (migration 021). */
interface SessionStatus {
  authenticated: boolean
  password_session?: boolean
  verified: boolean
  has_pending_code?: boolean
  retry_after?: number
  /**
   * The linked employee record is deactivated (057). Such a session is no
   * longer verified for anything else, including reading its own record, so
   * this is the only place the sign-in screen can learn why.
   */
  account_inactive?: boolean
}

interface AuthContextValue {
  session: Session | null
  employee: Employee | null
  role: UserRole | null
  profileStatus: ProfileStatus
  /**
   * Whether this session cleared the emailed-code step, as reported by the
   * database. Presentation only — authorization is enforced server-side by
   * session_second_factor_ok(), which this value merely mirrors.
   */
  verified: boolean
  loading: boolean
  /**
   * Step one: check the password. Never completes a sign-in on its own — a
   * success returns `needsVerification` and the caller shows the code screen.
   */
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; needsVerification?: boolean }>
  /** Step two: the code has been accepted, so check the profile and portal. */
  completeSignIn: (
    portal?: PortalId,
  ) => Promise<{ error: string | null; redirectTo?: string }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  refreshEmployee: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)

  // Mirrors `employee` so the auth-state subscription can read the current
  // value without listing it as a dependency — re-subscribing on every profile
  // change would tear down and rebuild the listener for no reason.
  const employeeRef = useRef<Employee | null>(null)
  useEffect(() => { employeeRef.current = employee }, [employee])
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('none')
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(true)

  /**
   * Ask the database whether this session has passed the second step.
   *
   * Deliberately a server call rather than decoding the JWT: the token records
   * how the session authenticated, but whether the emailed code was entered
   * lives in login_verifications, which the browser cannot read or write.
   */
  const readSessionStatus = useCallback(async (): Promise<SessionStatus> => {
    const { data, error } = await supabase.rpc('session_status')
    if (error) {
      console.warn('[ValueSpot] session_status unavailable — migration 021 may ' +
                   'not be applied. Run `npm run doctor`.', error.message)
      return { authenticated: false, verified: false }
    }
    return (data as unknown as SessionStatus) ?? { authenticated: false, verified: false }
  }, [])

  /**
   * Load the employee record for a verified session.
   *
   * Deliberately does not filter on is_active: an inactive employee and an
   * unlinked account both come back as `null`, and distinguishing them lets
   * the UI say what is actually wrong instead of bouncing to the login page.
   */
  const fetchEmployee = useCallback(
    async (authUserId: string): Promise<{ employee: Employee | null; status: ProfileStatus }> => {
      const read = async () => {
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', authUserId)
          .maybeSingle()
        if (error) {
          console.error('Failed to load employee profile:', error.message)
          return null
        }
        return data
      }

      let data = await read()

      // No linked record yet. Ask the database to claim one: it matches on the
      // verified identity in the JWT, so this completes a fresh signup and
      // repairs an older account alike. Safe to call whenever — an already
      // linked session returns 'ok' and changes nothing.
      if (!data) {
        const { data: claim, error: claimError } = await supabase.rpc('claim_employee_account')

        if (claimError) {
          console.warn('[ValueSpot] claim_employee_account failed.', claimError.message)
        } else if ((claim as { status?: string } | null)?.status === 'ok') {
          data = await read()
        }
      }

      if (!data) return { employee: null, status: 'not_linked' }
      if (!data.is_active) return { employee: null, status: 'inactive' }
      return { employee: data, status: 'ok' }
    },
    [],
  )

  const applySession = useCallback(async (s: Session | null): Promise<void> => {
    if (!s?.user.id) {
      setEmployee(null)
      setProfileStatus('none')
      setVerified(false)
      return
    }

    const status = await readSessionStatus()
    setVerified(status.verified)

    if (!status.verified) {
      // Nothing to load: the database will not serve this session yet.
      setEmployee(null)
      setProfileStatus('unverified')
      return
    }

    if (status.account_inactive) {
      setEmployee(null)
      setProfileStatus('inactive')
      return
    }

    const { employee: emp, status: profile } = await fetchEmployee(s.user.id)
    setEmployee(emp)
    setProfileStatus(profile)
  }, [readSessionStatus, fetchEmployee])

  const refreshEmployee = useCallback(async () => {
    if (!session) return
    await applySession(session)
  }, [session, applySession])

  useEffect(() => {
    let active = true

    const handle = async (s: Session | null, signedOut = false) => {
      if (!active) return
      setSession(s)
      await applySession(signedOut ? null : s)
      if (active) setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => handle(s))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      /*
        TOKEN_REFRESHED fires roughly hourly, and used to re-run the whole of
        applySession() — a session_status() RPC plus an employees read — for a
        session whose identity has not changed. The refreshed token carries the
        same session_id and the same user, so the verification row and the
        employee record are necessarily the same rows we already hold.

        The token object still has to be stored, because the access token
        inside it is what every later request uses. Only the refetch is
        skipped, and only while we already have a profile loaded. If we do not
        (first load, or an earlier failure) the full path still runs.
      */
      if (event === 'TOKEN_REFRESHED' && s?.user.id && employeeRef.current) {
        setSession(s)
        return
      }

      // Supabase warns against awaiting its own client inside this callback —
      // it can deadlock against the auth lock. Defer to a microtask instead.
      void Promise.resolve().then(() => handle(s, event === 'SIGNED_OUT'))
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [applySession])

  /**
   * Step one of two: prove the password.
   *
   * Supabase mints a session as soon as the password is correct — that cannot
   * be prevented from a browser. What matters is that the session is inert:
   * until verify_login_code() marks it verified, every policy and privileged
   * function in the database refuses it. So a caller who skips the code screen
   * holds a token that can do nothing.
   */
  const signIn = async (
    email: string,
    password: string,
  ): Promise<{ error: string | null; needsVerification?: boolean }> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      const raw = error.message.toLowerCase()
      if (raw.includes('invalid login credentials')) {
        return { error: 'Incorrect email or password. Please try again.' }
      }
      if (raw.includes('email not confirmed') || raw.includes('not confirmed')) {
        return { error: null, needsVerification: true }
      }
      if (raw.includes('too many requests') || raw.includes('rate limit')) {
        return { error: 'Too many attempts. Please wait a moment and try again.' }
      }
      return { error: 'Something went wrong. Please try again.' }
    }

    if (!data.user) return { error: 'Something went wrong. Please try again.' }

    return { error: null, needsVerification: true }
  }

  /**
   * Step two of two: the emailed code has been accepted. Now confirm the
   * account is usable —
   *   - the session is verified according to the database,
   *   - an employee record is linked to this auth user,
   *   - that record is active,
   *   - its role permits the portal the person selected.
   *
   * All read from the database, never from the browser. Any failure signs the
   * session back out so a half-valid session never lingers.
   */
  const completeSignIn = async (
    portal?: PortalId,
  ): Promise<{ error: string | null; redirectTo?: string }> => {
    const { data: { session: current } } = await supabase.auth.getSession()

    if (!current?.user) {
      return { error: 'Your sign-in expired. Please start again.' }
    }

    const status = await readSessionStatus()
    if (!status.verified) {
      return { error: 'Please enter the code we emailed you.' }
    }
    setVerified(true)

    if (status.account_inactive) {
      await supabase.auth.signOut()
      return { error: 'Your employee record is not active. Please contact HR.' }
    }

    const { employee: emp, status: profile } = await fetchEmployee(current.user.id)

    if (profile === 'not_linked') {
      await supabase.auth.signOut()
      return {
        error:
          'Your password is correct, but this account has no employee record ' +
          'yet. Please contact HR.',
      }
    }
    if (profile === 'inactive' || !emp) {
      await supabase.auth.signOut()
      return { error: 'Your employee record is not active. Please contact HR.' }
    }

    if (portal && !canEnterPortal(emp.role, portal)) {
      await supabase.auth.signOut()
      return {
        error:
          `Your account does not have ${roleLabel(portal as UserRole)} access. ` +
          `You are registered as ${roleLabel(emp.role)} — select that to sign in.`,
      }
    }

    setEmployee(emp)
    setProfileStatus('ok')
    return { error: null, redirectTo: dashboardPathFor(emp.role) }
  }

  /**
   * Sign out, and make it take effect immediately at the database.
   *
   * signOut() revokes the refresh token, but the access token already held by
   * the browser stays cryptographically valid until it expires — PostgREST
   * checks a signature and an expiry, not a revocation list. Without the call
   * below, that token would still satisfy session_second_factor_ok() and every
   * policy in 022 for the rest of its lifetime.
   *
   * Revoking first, while the session can still authenticate the RPC, is what
   * makes logout mean something before the token expires. Order matters.
   *
   * A failure here must not trap the user in a signed-in state, so the local
   * sign-out proceeds regardless; the worst case is the pre-023 behaviour.
   */
  const signOut = async () => {
    try {
      await supabase.rpc('revoke_login_verification', { p_all_sessions: true })
    } catch {
      // Deliberately swallowed — see above.
    }

    await supabase.auth.signOut()
    setEmployee(null)
    setProfileStatus('none')
    setVerified(false)
  }

  const resetPassword = async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) return { error: 'Unable to send reset email. Please try again.' }
    return { error: null }
  }

  /**
   * Set a new password for the currently authenticated user.
   *
   * Reachable from a recovery session too, which is the point: the emailed
   * reset link authorises a password change and nothing else. Such a session
   * is not second-factor verified, so it still cannot read any application
   * data — after resetting, the person signs in normally and gets a code.
   */
  const updatePassword = async (password: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      if (error.message.includes('New password should be different')) {
        return { error: 'Your new password must be different from your current one.' }
      }
      if (error.message.includes('session') || error.message.includes('JWT')) {
        return { error: 'This reset link has expired. Please request a new one.' }
      }
      return { error: 'Unable to update your password. Please try again.' }
    }
    return { error: null }
  }

  return (
    <AuthContext.Provider value={{
      session,
      employee,
      role: employee?.role ?? null,
      profileStatus,
      verified,
      loading,
      signIn,
      completeSignIn,
      signOut,
      resetPassword,
      updatePassword,
      refreshEmployee,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
