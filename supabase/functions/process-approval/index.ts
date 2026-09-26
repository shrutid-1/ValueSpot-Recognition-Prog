import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * The session id from an already-validated access token.
 *
 * Read from the token itself rather than the request body, so a caller cannot
 * claim a session that is not theirs. Signature verification is done by
 * getUser() before this value is used.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Action = 'approve' | 'reject' | 'request_clarification'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Validate caller JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Require the second factor.
    //
    // This client runs under the service role, which bypasses RLS entirely, so
    // migration 022's policies do not protect this function — it has to check
    // for itself. auth.jwt() is empty under the service role, so the session is
    // named explicitly.
    //
    // The session id is taken from the JWT that getUser() just validated, never
    // from the request body: a caller cannot name someone else's session. The
    // database additionally requires the session and user to belong together.
    const sessionId = readSessionId(authHeader.replace('Bearer ', ''))
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Verification required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: secondFactorOk } = await supabase.rpc('session_second_factor_ok_for', {
      p_session_id: sessionId,
      p_user_id: user.id,
    })

    if (secondFactorOk !== true) {
      return new Response(JSON.stringify({ error: 'Verification required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get caller's employee record
    const { data: approverEmp } = await supabase
      .from('employees')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!approverEmp || !['manager', 'hr_admin', 'super_admin'].includes(approverEmp.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    /*
      There is deliberately no approver_id here.

      The caller used to send one and this function ignored it, using
      `approverEmp.id` — the record resolved from the validated token — instead.
      An ignored field that looks authoritative is worse than no field: it reads
      like a lever. The actor is the person holding the token, and there is now
      nothing in the body that says otherwise.
    */
    const { nomination_id, action, reason, clarification_note } =
      await req.json() as {
        nomination_id: string
        action: Action
        reason?: string
        clarification_note?: string
      }

    if (!nomination_id || !action) {
      return new Response(JSON.stringify({ error: 'nomination_id and action required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Reject anything outside the known set rather than falling through the
    // dispatch below and reporting success without having changed anything.
    const ALLOWED_ACTIONS: Action[] = ['approve', 'reject', 'request_clarification']
    if (!ALLOWED_ACTIONS.includes(action)) {
      return new Response(JSON.stringify({
        error: `Unknown action "${action}". Expected one of: ${ALLOWED_ACTIONS.join(', ')}`,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'reject' && !reason) {
      return new Response(JSON.stringify({ error: 'reason required for rejection' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'request_clarification' && !clarification_note) {
      return new Response(JSON.stringify({ error: 'clarification_note required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fetch nomination
    const { data: nomination } = await supabase
      .from('nominations')
      .select('*, nominator:nominator_id(id, full_name), nominee:nominee_id(id, full_name)')
      .eq('id', nomination_id)
      .single()

    if (!nomination) {
      return new Response(JSON.stringify({ error: 'Nomination not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    /*
      THE DECISION. One database call, and it is the only thing here that
      changes the nomination's state.

      Authorization is NOT decided in this file any more. It used to be the
      three lines above this comment —

          nomination.assigned_approver_id === approverEmp.id ||
          ['hr_admin', 'super_admin'].includes(approverEmp.role)

      — which was right about who may act, and had two problems. It was a
      SECOND copy of a rule the queue also needed, free to drift from it; and
      the UPDATE that followed had no precondition on the current status and no
      lock, so two authorities acting at the same moment both "succeeded" and
      the second silently overwrote the first.

      record_nomination_decision() (migration 042) takes the row lock, applies
      nomination_decision_authority() — the single definition of who may act,
      shared with recognition_approval_queue() — records the actor and their
      role, settles the other authorities' notifications and writes the audit
      row, all in one transaction. Exactly one caller can win.

      p_actor_id is the employee resolved from the VALIDATED TOKEN above, never
      a value from the request body.
    */
    const { data: outcome, error: decisionError } = await supabase.rpc(
      'record_nomination_decision',
      {
        p_nomination_id: nomination_id,
        p_actor_id: approverEmp.id,
        p_action: action,
        p_reason: reason ?? null,
        p_clarification_note: clarification_note ?? null,
      },
    )

    if (decisionError) throw decisionError

    const result = (outcome ?? {}) as {
      status?: string
      nomination_status?: string
      decision?: {
        action?: string
        actor_name?: string | null
        actor_role?: string | null
        at?: string | null
      } | null
    }

    if (result.status !== 'ok') {
      /*
        A refusal, not a crash. Each one is a state the caller can understand
        and act on, so each gets its own status code and its own sentence —
        409 in particular, because "somebody else got there first" is not the
        same thing as "you are not allowed" and the queue shows them
        differently.
      */
      const REFUSALS: Record<string, { status: number; error: string }> = {
        already_handled: {
          status: 409,
          error: describeHandled(result),
        },
        party: {
          status: 403,
          error: 'You are named in this recognition, so you cannot review it. ' +
                 'Another approver has to.',
        },
        forbidden: {
          status: 403,
          error: 'You are not an approver for this recognition.',
        },
        not_found: { status: 404, error: 'That recognition no longer exists.' },
        reason_required: { status: 400, error: 'A reason is required to reject a recognition.' },
        note_required: { status: 400, error: 'Describe what clarification you need.' },
        invalid_action: { status: 400, error: `Unknown action "${action}".` },
        unknown_actor: { status: 403, error: 'Your employee record is not available.' },
      }

      const refusal = REFUSALS[result.status ?? ''] ?? {
        status: 409,
        error: 'This recognition could not be updated. Refresh and try again.',
      }

      return new Response(
        JSON.stringify({ error: refusal.error, status: result.status, decision: result.decision }),
        { status: refusal.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    /*
      Past this point the decision is DURABLE and committed. Everything below is
      a post-commit side effect: it must not fail the request, and it must not
      be retried into a second decision.
    */
    if (action === 'approve') {
      // Create notifications
      await createNotification(supabase, {
        recipient_id: nomination.nominee_id,
        type: 'recognition_received',
        title: 'You received a recognition',
        body: `${(nomination.nominator as { full_name: string }).full_name} recognized you for ${nomination.snapshot_core_value_name}.`,
        related_id: nomination_id,
        related_type: 'nomination',
      })

      await createNotification(supabase, {
        recipient_id: nomination.nominator_id,
        type: 'nomination_approved',
        title: 'Your recognition was approved',
        body: `Your recognition of ${(nomination.nominee as { full_name: string }).full_name} has been approved and published.`,
        related_id: nomination_id,
        related_type: 'nomination',
      })

      // Post-commit side effects. The approval is already durable at this point,
      // so a failure here must not be reported to the approver as a failed approval.
      await runSideEffect('calculate-badges', () =>
        calculateBadges(supabase, nomination.nominee_id, nomination.core_value_id))

      // Check anti-gaming (reciprocal recognition flag)
      await runSideEffect('reciprocal-pattern', () =>
        checkReciprocalPattern(supabase, nomination.nominator_id, nomination.nominee_id))

      /*
        The audit row is NOT written here any more.

        record_nomination_decision() writes it inside the same transaction as
        the state change, with the actor's role and the reason. Writing it out
        here meant a decision could be durable while the record of who made it
        was lost to a failed insert — and runSideEffect() deliberately swallows
        exactly that failure.
      */

    } else if (action === 'reject') {
      // Notify nominator only (not nominee — privacy rule)
      await createNotification(supabase, {
        recipient_id: nomination.nominator_id,
        type: 'nomination_rejected',
        title: 'Your recognition was not approved',
        body: `Your recognition of ${(nomination.nominee as { full_name: string }).full_name} for ${nomination.snapshot_core_value_name} was not approved.`,
        related_id: nomination_id,
        related_type: 'nomination',
      })

    } else if (action === 'request_clarification') {
      await createNotification(supabase, {
        recipient_id: nomination.nominator_id,
        type: 'clarification_requested',
        title: 'Clarification requested on your recognition',
        body: `More detail has been requested on your recognition of ${(nomination.nominee as { full_name: string }).full_name}. Please update your submission.`,
        related_id: nomination_id,
        related_type: 'nomination',
      })
    }

    // The decision travels back so the caller can name the actor immediately,
    // without a refetch that would race the invalidation it is about to do.
    return new Response(
      JSON.stringify({ success: true, action, decision: result.decision ?? null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('process-approval error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// ── Helpers ─────────────────────────────────────────────────

/** Matches roleLabel() in src/lib/portals.ts and role_label() in migration 042. */
const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr_admin: 'HR',
  super_admin: 'Super Admin',
}

/**
 * The sentence shown when somebody else got there first.
 *
 * Names the actor, because "this has already been handled" invites the obvious
 * next question and the answer is already in hand — the decision travelled back
 * from record_nomination_decision() with the refusal.
 */
function describeHandled(result: {
  nomination_status?: string
  decision?: { action?: string; actor_name?: string | null; actor_role?: string | null } | null
}): string {
  const verb =
    result.decision?.action === 'approve' ? 'approved'
    : result.decision?.action === 'reject' ? 'rejected'
    : result.decision?.action === 'request_clarification' ? 'sent back for clarification by'
    : null

  const name = result.decision?.actor_name
  const role = result.decision?.actor_role ? ROLE_LABELS[result.decision.actor_role] : null

  if (!verb || !name) {
    return 'This recognition has already been reviewed by someone else.'
  }

  const who = role ? `${role} — ${name}` : name
  return result.decision?.action === 'request_clarification'
    ? `This recognition was already ${verb} ${who}.`
    : `This recognition was already ${verb} by ${who}.`
}

/**
 * Run a post-commit side effect without letting it fail the request.
 * The nomination state change has already been written by the time these run,
 * so throwing here would tell the approver their action failed when it did not.
 */
async function runSideEffect(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    console.error(`process-approval side effect "${name}" failed:`, err)
  }
}

async function createNotification(
  supabase: ReturnType<typeof createClient>,
  notification: {
    recipient_id: string
    type: string
    title: string
    body: string
    related_id?: string
    related_type?: string
  }
) {
  await supabase.from('notifications').insert(notification)
}

async function calculateBadges(
  supabase: ReturnType<typeof createClient>,
  employeeId: string,
  coreValueId: string
) {
  const now = new Date()
  const yearStart = `${now.getFullYear()}-01-01`
  const yearEnd   = `${now.getFullYear()}-12-31`
  // Exclusive upper bound. `lte(approved_at, 'YYYY-12-31')` compared against
  // midnight at the START of 31 December, dropping that day's approvals and
  // then overwriting the trigger's correct count (044) with a smaller one.
  const nextYearStart = `${now.getFullYear() + 1}-01-01`

  // Count approved recognitions for this employee × core value in the annual period
  const { count: total } = await supabase
    .from('nominations')
    .select('id', { count: 'exact', head: true })
    .eq('nominee_id', employeeId)
    .eq('core_value_id', coreValueId)
    .eq('status', 'approved')
    .gte('approved_at', yearStart)
    .lt('approved_at', nextYearStart)

  // Count unique nominators — fetch all nominator_ids and deduplicate in-memory
  // (Supabase JS v2 does not support COUNT(DISTINCT) natively)
  const { data: nominatorRows } = await supabase
    .from('nominations')
    .select('nominator_id')
    .eq('nominee_id', employeeId)
    .eq('core_value_id', coreValueId)
    .eq('status', 'approved')
    .gte('approved_at', yearStart)
    .lt('approved_at', nextYearStart)

  const uniqueNominators = new Set((nominatorRows ?? []).map(r => r.nominator_id)).size

  const count = total ?? 0
  const { data: defs } = await supabase
    .from('badge_definitions')
    .select('level, minimum_count, maximum_count')
    .eq('is_active', true)
    .order('level', { ascending: false })

  let newLevel: number | null = null
  for (const def of (defs ?? [])) {
    if (count >= def.minimum_count && (def.maximum_count === null || count <= def.maximum_count)) {
      newLevel = def.level
      break
    }
  }

  // Get current badge
  const { data: current } = await supabase
    .from('employee_value_badges')
    .select('badge_level, id')
    .eq('employee_id', employeeId)
    .eq('core_value_id', coreValueId)
    .eq('period_type', 'annual')
    .eq('period_start', yearStart)
    .single()

  const currentLevel = current?.badge_level ?? null

  // Never downgrade
  const finalLevel = (newLevel !== null && currentLevel !== null && newLevel < currentLevel)
    ? currentLevel
    : newLevel

  // Upsert badge record
  await supabase.from('employee_value_badges').upsert({
    employee_id: employeeId,
    core_value_id: coreValueId,
    period_type: 'annual',
    period_start: yearStart,
    period_end: yearEnd,
    recognition_count: count,
    unique_recognizer_count: uniqueNominators,
    badge_level: finalLevel,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'employee_id,core_value_id,period_type,period_start' })

  // Record badge history if level changed
  if (finalLevel !== null && finalLevel !== currentLevel) {
    await supabase.from('badge_history').insert({
      employee_id: employeeId,
      core_value_id: coreValueId,
      previous_level: currentLevel,
      new_level: finalLevel,
      recognition_count: count,
      achieved_at: new Date().toISOString(),
      period_type: 'annual',
      period_start: yearStart,
      period_end: yearEnd,
    })

    // Notify employee of badge unlock
    const { data: badgeDef } = await supabase
      .from('badge_definitions')
      .select('name')
      .eq('level', finalLevel)
      .single()

    const { data: cvData } = await supabase
      .from('core_values')
      .select('name')
      .eq('id', coreValueId)
      .single()

    const prevName = currentLevel
      ? (await supabase.from('badge_definitions').select('name').eq('level', currentLevel).single()).data?.name
      : null

    const body = prevName
      ? `You've progressed from ${prevName} → ${badgeDef?.name} for ${cvData?.name}.`
      : `You've unlocked ${badgeDef?.name} for ${cvData?.name}! You've been recognized ${count} time${count !== 1 ? 's' : ''} this year.`

    await supabase.from('notifications').insert({
      recipient_id: employeeId,
      type: 'badge_unlocked',
      title: `New badge unlocked: ${badgeDef?.name}`,
      body,
      related_id: employeeId,
      related_type: 'badge',
    })
  }
}

async function checkReciprocalPattern(
  supabase: ReturnType<typeof createClient>,
  nominatorId: string,
  nomineeId: string
) {
  // Check how many times nomineeId has recognized nominatorId (reciprocal)
  const { count } = await supabase
    .from('nominations')
    .select('id', { count: 'exact', head: true })
    .eq('nominator_id', nomineeId)
    .eq('nominee_id', nominatorId)
    .eq('status', 'approved')

  // Fetch threshold
  const { data: config } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'reciprocal_flag_threshold')
    .single()

  const threshold = Number(config?.value ?? 3)

  if ((count ?? 0) >= threshold) {
    // Upsert flag
    const { data: existing } = await supabase
      .from('reciprocal_recognition_flags')
      .select('id, count')
      .or(`employee_a_id.eq.${nominatorId},employee_a_id.eq.${nomineeId}`)
      .or(`employee_b_id.eq.${nominatorId},employee_b_id.eq.${nomineeId}`)
      .single()

    if (existing) {
      await supabase
        .from('reciprocal_recognition_flags')
        .update({ count: (existing.count ?? 0) + 1, last_flagged_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase.from('reciprocal_recognition_flags').insert({
        employee_a_id: nominatorId,
        employee_b_id: nomineeId,
        count: 1,
        last_flagged_at: new Date().toISOString(),
      })
    }
  }
}

/*
  writeAuditLog() lived here and is gone. record_nomination_decision()
  (migration 042) writes the audit row in the same transaction as the decision
  it records, which is the only place it can be written without a window where
  one exists and the other does not.
*/
