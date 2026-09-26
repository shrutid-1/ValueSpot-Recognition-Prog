/**
 * Recognition moderation, and the support requests that ask for it.
 *
 * TWO CALLERS, ONE SET OF RULES
 * ----------------------------
 * `supportApi`    what an employee does: raise a correction request, read
 *                 their own requests.
 * `moderationApi` what HR and a Super Admin do: correct a recognition, remove
 *                 one, work the shared request queue.
 *
 * Split by who uses them, not by privilege — because neither of them IS the
 * privilege. Every operation here is a thin call onto a SECURITY DEFINER
 * function from migration 034 that re-derives the caller's role from the
 * `employees` table and refuses on its own. Nothing in this file decides
 * whether an action is allowed, and nothing in it could: an employee calling
 * `moderationApi.editRecognition()` directly gets `forbidden` from the
 * database, exactly as if they had posted to the RPC by hand.
 *
 * That is deliberate. The buttons are hidden for tidiness; the refusal is in
 * PostgreSQL.
 */
import type { UserRole } from '@/types'
import { supabase, toApiError, ApiError } from './client'

// ── Shapes ──────────────────────────────────────────────────

export type SupportIssueType =
  | 'core_value' | 'behaviour' | 'scenario'
  | 'story' | 'impact' | 'project' | 'other'

export type SupportRequestStatus = 'open' | 'in_progress' | 'resolved' | 'rejected'

/** A request as the queue and the employee's own list both read it. */
export interface SupportRequest {
  id: string
  nomination_id: string
  requester_id: string
  issue_type: SupportIssueType
  description: string
  /** Free text. Optional when the request carries a proposal (migration 060). */
  requested_change: string | null
  /*
    What the requester wants the recognition to say (060), read as one
    proposal: no core value means no change to the value chain was asked for;
    with one, a null scenario means "none of the listed scenarios".
  */
  proposed_core_value_id: string | null
  proposed_behaviour_id: string | null
  proposed_scenario_id: string | null
  proposed_core_value: { id: string; name: string } | null
  proposed_behaviour: { id: string; name: string } | null
  proposed_scenario: { id: string; name: string } | null
  status: SupportRequestStatus
  resolved_by_id: string | null
  /** Snapshot of the resolver's role AT RESOLUTION — not their role today. */
  resolved_by_role: UserRole | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
  requester: { id: string; full_name: string; avatar_url: string | null } | null
  nomination: {
    id: string
    what_happened: string
    what_impact: string
    status: string
    core_value_id: string
    behaviour_id: string | null
    scenario_id: string | null
    project_id: string | null
    snapshot_core_value_name: string | null
    snapshot_behaviour_name: string | null
    snapshot_scenario_name: string | null
    snapshot_project_name: string | null
    nominator: { id: string; full_name: string } | null
    nominee: { id: string; full_name: string } | null
  } | null
}

/** The correction a moderator is applying. Every field optional — omitted means unchanged. */
export interface RecognitionCorrection {
  coreValueId?: string
  behaviourId?: string | null
  scenarioId?: string | null
  projectId?: string | null
  whatHappened?: string
  whatImpact?: string
}

const REQUEST_COLUMNS = `
  id, nomination_id, requester_id, issue_type, description, requested_change,
  status, resolved_by_id, resolved_by_role, resolved_at, resolution_note, created_at,
  proposed_core_value_id, proposed_behaviour_id, proposed_scenario_id,
  requester:employees!recognition_support_requests_requester_id_fkey (
    id, full_name, avatar_url
  ),
  proposed_core_value:core_values!recognition_support_requests_proposed_core_value_id_fkey (id, name),
  proposed_behaviour:behaviours!recognition_support_requests_proposed_behaviour_id_fkey (id, name),
  proposed_scenario:scenarios!recognition_support_requests_proposed_scenario_id_fkey (id, name),
  nomination:nominations!recognition_support_requests_nomination_id_fkey (
    id, what_happened, what_impact, status,
    core_value_id, behaviour_id, scenario_id, project_id,
    snapshot_core_value_name, snapshot_behaviour_name,
    snapshot_scenario_name, snapshot_project_name,
    nominator:employees!nominations_nominator_id_fkey (id, full_name),
    nominee:employees!nominations_nominee_id_fkey (id, full_name)
  )
`

/**
 * Turn a refusal from one of the 034 functions into something readable.
 *
 * These statuses are the database's own vocabulary; the mapping lives here so
 * no component has to know them. `already_settled` is handled by its callers
 * rather than here, because it carries who won and that is worth showing.
 */
function supportFailureMessage(status?: string): string {
  switch (status) {
    case 'forbidden':
      return 'Only HR and Super Admins can do that.'
    case 'needs_verification':
      return 'Your session is not verified. Please sign in again.'
    case 'not_authenticated':
      return 'You are signed out. Please sign in again.'
    case 'not_found':
      return 'That recognition no longer exists.'
    case 'not_your_recognition':
      return 'You can only request corrections to recognitions you gave or received.'
    case 'recognition_removed':
      return 'That recognition has been removed, so it cannot be corrected.'
    case 'already_open':
      return 'You already have an open request for this recognition.'
    case 'incomplete':
      return 'Please describe the problem and the change you want.'
    case 'behaviour_required':
      return 'Choose the Behaviour the recognition should have.'
    case 'invalid_issue_type':
      return 'Please choose what is wrong with the recognition.'
    case 'removed':
      return 'That recognition has been removed and can no longer be edited.'
    case 'already_removed':
      return 'That recognition was already removed.'
    case 'unknown_core_value':
      return 'That Core Value is no longer available.'
    case 'unknown_behaviour':
      return 'That Behaviour is no longer available.'
    case 'unknown_scenario':
      return 'That Scenario is no longer available.'
    case 'unknown_project':
      return 'That Project is no longer available.'
    case 'behaviour_mismatch':
      return 'That Behaviour does not belong to the chosen Core Value.'
    case 'scenario_mismatch':
      return 'That Scenario does not belong to the chosen Behaviour.'
    case 'reason_required':
      return 'Please give a reason.'
    default:
      return 'That did not work. Please try again.'
  }
}

/** Raised when a request was settled by someone else first. Carries who. */
export class AlreadySettledError extends ApiError {
  readonly settledBy: string
  readonly settledRole: UserRole | null
  readonly requestStatus: SupportRequestStatus

  constructor(result: {
    resolved_by_name?: string
    resolved_by_role?: UserRole
    request_status?: SupportRequestStatus
  }) {
    const who = result.resolved_by_name ?? 'another administrator'
    const role = result.resolved_by_role === 'super_admin' ? 'Super Admin'
      : result.resolved_by_role === 'hr_admin' ? 'HR'
      : null
    super(
      `Already ${result.request_status === 'rejected' ? 'rejected' : 'resolved'} by ` +
      `${role ? `${role} — ` : ''}${who}.`,
      'already_settled',
    )
    this.name = 'AlreadySettledError'
    this.settledBy = who
    this.settledRole = result.resolved_by_role ?? null
    this.requestStatus = result.request_status ?? 'resolved'
  }
}

/** Unwrap an RPC that answers with `{ status: 'ok', ... }`. */
function expectOk<T extends { status?: string }>(data: unknown, fallback: string): T {
  const result = (data ?? {}) as T & Record<string, unknown>

  if (result.status === 'already_settled') {
    throw new AlreadySettledError(result as never)
  }
  if (result.status !== 'ok') {
    throw new ApiError(
      result.status ? supportFailureMessage(result.status) : fallback,
      result.status ?? 'unknown',
    )
  }
  return result
}

// ── What an employee can do ─────────────────────────────────

export const supportApi = {
  /**
   * Raise a correction request against a recognition.
   *
   * The nomination id comes from a picker of the person's OWN recognitions —
   * nobody types a UUID — but that is convenience, not security:
   * create_support_request() re-checks that the caller is the nominator or the
   * nominee of that exact row and refuses otherwise.
   */
  async createRequest(input: {
    nominationId: string
    description: string
    /** Required when there is no proposal; otherwise "anything else". */
    requestedChange?: string
    /**
     * The whole Core Value > Behaviour > Scenario the recognition should have.
     * `scenarioId: null` means none of the listed scenarios. The database
     * checks the chain and derives the issue type from it.
     */
    proposal?: { coreValueId: string; behaviourId: string; scenarioId: string | null }
  }): Promise<{ requestId: string }> {
    const { data, error } = await supabase.rpc('create_support_request', {
      p_nomination_id: input.nominationId,
      p_description: input.description,
      p_requested_change: input.requestedChange || undefined,
      p_proposed_core_value_id: input.proposal?.coreValueId,
      p_proposed_behaviour_id: input.proposal?.behaviourId,
      p_proposed_scenario_id: input.proposal?.scenarioId ?? undefined,
    })

    if (error) throw toApiError(error, 'Could not send that request.')

    const ok = expectOk<{ status: string; request_id: string }>(
      data, 'Could not send that request.',
    )
    return { requestId: ok.request_id }
  },

  /**
   * This person's own requests.
   *
   * No employee-id filter is passed: `support_requests_read_own` restricts the
   * rows to the caller's own, so asking for "all" returns exactly theirs. A
   * filter here would be a second, weaker copy of that rule.
   */
  async listMine(): Promise<SupportRequest[]> {
    const { data, error } = await supabase
      .from('recognition_support_requests')
      .select(REQUEST_COLUMNS)
      .order('created_at', { ascending: false })

    if (error) throw toApiError(error, 'Could not load your requests.')
    return (data ?? []) as unknown as SupportRequest[]
  },
}

// ── What HR and a Super Admin can do ────────────────────────

export const moderationApi = {
  /**
   * The shared queue. HR and Super Admin read the SAME rows through the same
   * policy — there is no per-role copy, which is why a request resolved by one
   * immediately reads as resolved for the other.
   */
  async listRequests(status?: SupportRequestStatus | 'all'): Promise<SupportRequest[]> {
    let query = supabase
      .from('recognition_support_requests')
      .select(REQUEST_COLUMNS)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load support requests.')
    return (data ?? []) as unknown as SupportRequest[]
  },

  /** Correct a recognition. Content only — see migration 034 for what cannot move. */
  async editRecognition(
    nominationId: string,
    correction: RecognitionCorrection,
  ): Promise<{ changed: Record<string, unknown> }> {
    const { data, error } = await supabase.rpc('moderate_recognition', {
      p_nomination_id: nominationId,
      p_core_value_id: correction.coreValueId ?? undefined,
      // null means "clear it"; undefined means "leave it". The RPC takes an
      // explicit clear flag because a null argument cannot say which.
      p_behaviour_id: correction.behaviourId ?? undefined,
      p_scenario_id: correction.scenarioId ?? undefined,
      p_project_id: correction.projectId ?? undefined,
      p_what_happened: correction.whatHappened ?? undefined,
      p_what_impact: correction.whatImpact ?? undefined,
      p_clear_behaviour: correction.behaviourId === null,
      p_clear_scenario: correction.scenarioId === null,
      p_clear_project: correction.projectId === null,
    })

    if (error) throw toApiError(error, 'Could not save that correction.')

    const ok = expectOk<{ status: string; changed: Record<string, unknown> }>(
      data, 'Could not save that correction.',
    )
    return { changed: ok.changed ?? {} }
  },

  /**
   * Remove a recognition from the active product.
   *
   * A soft delete: the row stays, its status becomes 'removed', and every
   * feed, statistic and badge calculation stops counting it because all of
   * them select on status. History and audit remain readable to
   * administrators. See migration 034.
   */
  async removeRecognition(nominationId: string, reason?: string): Promise<void> {
    const { data, error } = await supabase.rpc('remove_recognition', {
      p_nomination_id: nominationId,
      p_reason: reason ?? undefined,
    })

    if (error) throw toApiError(error, 'Could not remove that recognition.')
    expectOk(data, 'Could not remove that recognition.')
  },

  /** Mark a request as being worked on. Never settles it. */
  async claimRequest(requestId: string): Promise<void> {
    const { data, error } = await supabase.rpc('claim_support_request', {
      p_request_id: requestId,
    })
    if (error) throw toApiError(error, 'Could not update that request.')
    expectOk(data, 'Could not update that request.')
  },

  /**
   * Resolve a request, applying the correction in the same database call.
   *
   * One round trip on purpose: the claim, the edit, the audit row and the
   * requester's notification are one transaction, so there is no sequence of
   * failures that leaves a request resolved with nothing corrected.
   *
   * Throws `AlreadySettledError` when the other administrator got there first.
   */
  async resolveRequest(input: {
    requestId: string
    note?: string
    correction?: RecognitionCorrection
  }): Promise<{ resolvedByRole: UserRole; resolvedByName: string }> {
    const c = input.correction ?? {}

    const { data, error } = await supabase.rpc('resolve_support_request', {
      p_request_id: input.requestId,
      p_resolution_note: input.note ?? undefined,
      p_core_value_id: c.coreValueId ?? undefined,
      p_behaviour_id: c.behaviourId ?? undefined,
      p_scenario_id: c.scenarioId ?? undefined,
      p_project_id: c.projectId ?? undefined,
      p_what_happened: c.whatHappened ?? undefined,
      p_what_impact: c.whatImpact ?? undefined,
      p_clear_behaviour: c.behaviourId === null,
      p_clear_scenario: c.scenarioId === null,
      p_clear_project: c.projectId === null,
    })

    if (error) {
      // The correction failed inside the transaction, so the claim was rolled
      // back too and the request is still open. Say which part failed.
      const message = (error as { message?: string }).message ?? ''
      if (message.includes('correction_failed')) {
        // The RPC raises "correction_failed:<status>"; name the reason when
        // the status is one we can explain.
        const reason = message.match(/correction_failed:(\w+)/)?.[1]
        const explained = reason ? supportFailureMessage(reason) : null
        throw new ApiError(
          explained && explained !== supportFailureMessage()
            ? `${explained} Nothing was changed and the request is still open.`
            : 'The correction could not be applied, so the request is still open.',
          'correction_failed',
          error,
        )
      }
      throw toApiError(error, 'Could not resolve that request.')
    }

    const ok = expectOk<{
      status: string
      resolved_by_role: UserRole
      resolved_by_name: string
    }>(data, 'Could not resolve that request.')

    return { resolvedByRole: ok.resolved_by_role, resolvedByName: ok.resolved_by_name }
  },

  /** Decline a request, with a reason the requester is told. */
  async rejectRequest(requestId: string, reason: string): Promise<void> {
    const { data, error } = await supabase.rpc('reject_support_request', {
      p_request_id: requestId,
      p_reason: reason,
    })

    if (error) throw toApiError(error, 'Could not update that request.')
    expectOk(data, 'Could not update that request.')
  },

  /**
   * Recompute badges after a correction or a removal.
   *
   * Reuses the existing `calculate-badges` Edge Function rather than
   * recalculating anywhere new. That function aggregates approved nominations
   * by their CURRENT core_value_id and rewrites the badge rows, so re-running
   * it after moderation is what makes badges agree with the corrected data —
   * a recognition moved to another Core Value counts towards the new one, and
   * a removed recognition stops counting at all, because it is no longer
   * 'approved'.
   *
   * It authenticates the caller as a 2FA-verified HR administrator using their
   * own session, so no service-role key is involved. Failure is reported to
   * the caller, which treats it as non-fatal: the correction itself is already
   * committed, and badges converge on the next recalculation.
   */
  async recalculateBadges(): Promise<{ ok: boolean }> {
    const { error } = await supabase.functions.invoke('calculate-badges', { body: {} })
    return { ok: !error }
  },
}
