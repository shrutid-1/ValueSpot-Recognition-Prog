import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Permanently erase an employee.
 *
 * Two things have to happen and only one of them is SQL:
 *
 *   public schema   purge_employee() (migration 035) removes the person and
 *                   everything referring to them.
 *   auth.users      the identity itself, which is what actually holds the
 *                   email address. Until it goes, the address cannot be
 *                   reused -- and this project does not necessarily own
 *                   auth.users from SQL (see the note in migration 011), so
 *                   it is removed through the Admin API instead of a DELETE.
 *
 * The order matters. The public-schema purge runs first because it is the part
 * that can legitimately refuse -- last administrator, insufficient role, not
 * found. Removing the auth account first would leave someone locked out of an
 * employee record that then refused to go.
 *
 * Authorization is done here, exactly as process-approval does it: the JWT is
 * validated, the second factor is required, and the caller's role is read from
 * the employees table rather than trusted from the request.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * The session id from an already-validated access token.
 *
 * Read from the token rather than the body so a caller cannot claim a session
 * that is not theirs. getUser() verifies the signature before this is used.
 */
function readSessionId(token: string): string | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown }
    return typeof claims.session_id === 'string' ? claims.session_id : null
  } catch {
    return null
  }
}

/** What purge_employee() returns, as far as this function needs to care. */
interface PurgeResult {
  status: string
  reason?: string
  email?: string
  full_name?: string
  auth_user_id?: string | null
  recognitions_given?: number
  recognitions_received?: number
}

/** Refusals from the database, mapped to a status and a sentence. */
const REFUSALS: Record<string, { status: number; error: string }> = {
  not_authenticated:  { status: 401, error: 'Your session has expired. Please sign in again.' },
  forbidden:          { status: 403, error: 'You do not have permission to delete this employee.' },
  not_found:          { status: 404, error: 'That employee no longer exists.' },
  cannot_delete_self: { status: 400, error: 'You cannot delete your own account.' },
  last_admin:         { status: 400, error: 'This is the only administrator. Appoint another one before deleting this account.' },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const token = authHeader.replace('Bearer ', '')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    /*
      Require the second factor.

      This client runs under the service role and bypasses RLS entirely, so
      migration 022's policies do not protect this function — it checks for
      itself, naming the session explicitly because auth.jwt() is empty here.
    */
    const sessionId = readSessionId(token)
    if (!sessionId) return json({ error: 'Verification required' }, 403)

    const { data: secondFactorOk } = await supabase.rpc('session_second_factor_ok_for', {
      p_session_id: sessionId,
      p_user_id: user.id,
    })
    if (secondFactorOk !== true) return json({ error: 'Verification required' }, 403)

    // The caller's own record. Role comes from the table, never the request.
    const { data: actor } = await supabase
      .from('employees')
      .select('id, role, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!actor || !actor.is_active) return json({ error: 'Unauthorized' }, 401)
    if (actor.role !== 'hr_admin' && actor.role !== 'super_admin') {
      return json({ error: 'You do not have permission to delete employees.' }, 403)
    }

    const body = await req.json().catch(() => null) as { employee_id?: unknown } | null
    const employeeId = typeof body?.employee_id === 'string' ? body.employee_id : null
    if (!employeeId) return json({ error: 'No employee was named.' }, 400)

    // ── 1. The public schema ──────────────────────────────
    //
    // purge_employee re-checks the role boundary and the last-administrator
    // rule for itself. The checks above are there to fail early and to keep
    // this function honest on its own terms, not to be the only gate.
    const { data, error } = await supabase.rpc('purge_employee', {
      p_employee_id: employeeId,
      p_actor_id: actor.id,
    })

    if (error) {
      console.error('purge_employee failed', error)

      /*
        Setup problems, told apart from genuine failures because the fix is to
        change the project rather than to retry.

        The two codes are NOT interchangeable, which an earlier version of this
        got wrong:

          42883  Postgres undefined_function. The function really is absent —
                 the migration has not been applied.

          PGRST202  PostgREST cannot find it in its schema cache. That happens
                 when it does not exist, but ALSO when it exists and the caller
                 has no EXECUTE on it, because PostgREST does not expose
                 functions the caller cannot call. Reporting this as "the
                 migration has not been applied" sent an operator to re-run a
                 migration that was already in the ledger.
      */
      const code = (error as { code?: string }).code

      if (code === '42883') {
        return json({
          error: 'Employee deletion is not set up on this project: migration 035 has not been applied.',
        }, 501)
      }

      if (code === 'PGRST202') {
        return json({
          error: 'Employee deletion is not reachable: purge_employee is missing, or the service role has no permission to call it. Apply migrations 035 and 036, then try again.',
        }, 501)
      }

      // Explicit permission denial, when PostgREST lets it through as itself.
      if (code === '42501') {
        return json({
          error: 'Employee deletion is not permitted for the service role on this project. Apply migration 036, which grants it.',
        }, 501)
      }

      /*
        Report what the database actually said.

        Only hr_admin and super_admin reach this line — the checks above have
        already run — and this is their own project. A constraint name or a
        trigger's message is exactly what makes the difference between fixing
        the problem and guessing at it, and "nothing was changed" told an
        administrator nothing they could act on.

        purge_employee runs as a single statement, so a failure has rolled the
        whole thing back: reporting the cause reveals no partial state.
      */
      const pgError = error as {
        message?: string; code?: string; details?: string; hint?: string
      }

      const detail = [
        pgError.message,
        pgError.details,
        pgError.hint,
        pgError.code ? `(SQLSTATE ${pgError.code})` : null,
      ].filter(Boolean).join(' — ')

      return json({
        error: detail
          ? `We could not delete that employee. Nothing was changed. ${detail}`
          : 'We could not delete that employee. Nothing was changed.',
        code: pgError.code ?? null,
      }, 500)
    }

    const result = data as PurgeResult

    if (result.status !== 'ok') {
      const refusal = REFUSALS[result.status]
        ?? { status: 400, error: 'That employee could not be deleted.' }
      return json({ error: refusal.error, status: result.status }, refusal.status)
    }

    // ── 2. The identity ───────────────────────────────────
    //
    // The employee row is already gone, so a failure here cannot be rolled
    // back. It is reported rather than swallowed: the address stays occupied
    // until the account is removed, and an administrator who is not told that
    // will try to re-invite the person and be refused for no visible reason.
    let authWarning: string | null = null

    if (result.auth_user_id) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(result.auth_user_id)

      if (authDeleteError) {
        console.error('auth user deletion failed', authDeleteError)
        authWarning =
          'The employee record was deleted, but their sign-in account could not be removed. ' +
          'Their email address cannot be reused until it is deleted from Authentication.'
      }
    }

    return json({
      status: 'ok',
      email: result.email,
      full_name: result.full_name,
      recognitions_given: result.recognitions_given ?? 0,
      recognitions_received: result.recognitions_received ?? 0,
      auth_warning: authWarning,
    }, 200)
  } catch (err) {
    console.error('delete-employee failed', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
