/**
 * Recognitions — the feed, submission, appreciation and the approval queue.
 *
 * The domain's implementations are deliberately varied and the component
 * should not care which is used:
 *
 *   feed and lists      a read-only view, v_recognition_feed
 *   submission          a table insert whose rate limit is enforced by a
 *                       trigger, not by the pre-flight check beside it
 *   approval decisions  the process-approval Edge Function, which runs under
 *                       the service role and re-checks the second factor
 *
 * Callers see `getFeed()`, `submit()`, `decide()`. Whether that is a view, an
 * insert or a Deno function is this file's business.
 *
 * Authorization is not performed here and none is claimed. Every read is still
 * governed by the nominations policies from 003 and 022 — `nominations_read_
 * approver` scopes a Manager to the recognitions routed to them, and
 * `nominations_hr_read_all` gives HR and Super Admin the organisation — and the
 * Edge Function still authorises itself.
 *
 * Since migration 042 the approval queue is one argument-less database function
 * rather than a filtered table query, and the decision is one locking database
 * call rather than a bare status update. Both of those moved because the answer
 * to "whose queue is this" and "who got there first" must not be assembled in a
 * browser.
 */
import type {
  RecognitionFeedItem, NominationWithDetails, NominationStatus, RecognitionSource, UserRole,
} from '@/types'
import { supabase, toApiError, ApiError } from './client'
import { employeesApi, teamRecognitionFilter } from './employees'

/*
  The management-chain walk that used to live here is gone, along with its
  MAX_ESCALATION_LEVELS bound and the employeesApi lookups it needed.

  Approval routing follows the PROJECT now, and it is decided by the database:
  route_nomination_to_project_manager() (029) reads the selected project's
  manager on INSERT. The HR fallback it used — configured approver, then any
  active HR admin — was kept, and moved into that trigger, so the behaviour
  survives where it can actually be trusted.
*/

/*
  Joined shape the detail lists render. Kept in one place, not per page.

  The three decision actors are embedded for the same reason the participants
  are: a recognition that says only "Not approved" leaves its author with no way
  to know who decided that or who to ask about it. The NAME comes from the join
  rather than a stored string, so the screens correct themselves when somebody
  is renamed; the *_by_role columns beside them (migration 042) carry the role
  the actor HELD at the time, which a join cannot give.
*/
const NOMINATION_DETAIL_COLUMNS = `
  *,
  nominator:nominator_id (id, full_name, avatar_url),
  nominee:nominee_id (id, full_name, avatar_url),
  core_value:core_value_id (id, name, slug, accent_color, icon),
  behaviour:behaviour_id (id, name),
  project:project_id (id, name),
  approved_by:approved_by_id (id, full_name),
  rejected_by:rejected_by_id (id, full_name),
  clarification_requested_by:clarification_requested_by_id (id, full_name)
`

export interface FeedPage {
  items: RecognitionFeedItem[]
  /** Ids on this page the given employee has already appreciated. */
  appreciatedIds: string[]
  hasMore: boolean
}

/** How the company feed is ordered. */
export type FeedSort = 'recent' | 'appreciated'

/**
 * A manager's team feed, with the roster size that produced it.
 *
 * `memberCount` is carried alongside the rows because an empty feed has two
 * quite different causes — nobody is on this manager's projects, or they are
 * but nothing of theirs has been approved yet — and the screen should say
 * which. Without it the page can only guess.
 */
export interface TeamFeed {
  /** Active projects this manager runs. Zero means there is no team at all. */
  projectCount: number
  /** Active members of those projects. */
  memberCount: number
  items: RecognitionFeedItem[]
  /** Ids in `items` the manager has already appreciated. */
  appreciatedIds: string[]
}

/** Which side of a recognition the caller wants listed. */
export type MyRecognitionsTab = 'received' | 'given'

/** A person as the approval queue names them. */
export interface ApprovalQueuePerson {
  id: string
  full_name: string
  avatar_url?: string | null
  role: UserRole
}

/**
 * Who decided a recognition, how and when. Null while it is still pending.
 *
 * Shape of nomination_decision() (migration 042).
 */
export interface NominationDecision {
  action: ApprovalAction
  at: string | null
  actor_id: string | null
  /** Resolved through the foreign key, so a rename corrects it everywhere. */
  actor_name: string | null
  /**
   * The role the actor HELD when they decided — not their role today.
   *
   * Null for decisions made before migration 042 added the column: those were
   * never recorded and are not invented here. The UI drops the role from the
   * line rather than guessing one.
   */
  actor_role: UserRole | null
  /** Rejections only. */
  reason: string | null
  /** Clarification requests only. */
  note: string | null
}

/**
 * One row of the approval queue. Shape of recognition_approval_queue() (042).
 *
 * Deliberately NOT `NominationWithDetails`: that is the nominations table row
 * with joins, and this is a purpose-built answer to "what may I review", with
 * the decision resolved and the viewer's own authority already applied.
 */
export interface ApprovalQueueItem {
  id: string
  status: NominationStatus
  submitted_at: string | null
  created_at: string
  what_happened: string
  what_impact: string
  snapshot_core_value_name: string
  snapshot_behaviour_name: string | null
  snapshot_project_name: string | null
  nominator: ApprovalQueuePerson
  nominee: ApprovalQueuePerson
  core_value: {
    id: string
    name: string
    slug: string
    accent_color: string | null
    icon: string | null
  }
  behaviour: { id: string; name: string } | null
  project: { id: string; name: string } | null
  /** Who it was ROUTED to — not necessarily who decided it. */
  assigned_approver: ApprovalQueuePerson | null
  decision: NominationDecision | null
  /**
   * Whether this viewer may still act on it.
   *
   * Computed by the database from the same function the decision path enforces,
   * so the buttons and the refusal cannot disagree. Advisory in the UI: hiding
   * a button is not a control, and record_nomination_decision() refuses anyway.
   */
  can_act: boolean
}

export interface SubmitRecognitionInput {
  nominatorId: string
  nomineeId: string
  coreValueId: string
  behaviourId?: string | null
  scenarioId?: string | null
  /**
   * REQUIRED since migration 029. The project decides who approves this, so a
   * recognition without one has nowhere to go. It must be the NOMINEE's active
   * project; the database refuses any other.
   */
  projectId: string
  whatHappened: string
  whatImpact: string
  /** Historical snapshots, written once and never updated. */
  snapshot: {
    coreValueName: string
    behaviourName?: string | null
    scenarioName?: string | null
    projectName?: string | null
    nominatorDept?: string | null
    nomineeDept?: string | null
    nomineeManagerId?: string | null
  }
  recognitionSource: RecognitionSource
  /*
    There is deliberately no approver field.

    The approver is resolved by route_nomination_to_project_manager() (029)
    from the selected project, and that trigger overwrites whatever arrives in
    the INSERT. Accepting one here would be offering the caller a lever that
    does nothing — and inviting someone to believe it works.
  */
  /** Makes a resubmitted form idempotent; a repeat lands as 'duplicate'. */
  idempotencyKey?: string
}

/**
 * 'duplicate' is a SUCCESS: the idempotency key matched, so this exact
 * submission already landed and the user should see the confirmation rather
 * than an error.
 */
export type SubmitResult = { status: 'created' | 'duplicate' }

export type ApprovalAction = 'approve' | 'reject' | 'request_clarification'

export const recognitionsApi = {
  /**
   * Who the database routed a submitted recognition to.
   *
   * Read back AFTER insert, never computed before it. Since migration 029 the
   * approver is decided by route_nomination_to_project_manager() from the
   * selected project's manager, and that trigger overwrites anything the
   * client sends. The wizard only needs the answer so it can name the approver
   * in its confirmation — so it asks, rather than guessing and hoping the two
   * agree.
   *
   * The previous implementation walked the NOMINEE'S MANAGER CHAIN in the
   * browser and submitted the result. That is gone: routing now follows the
   * project, and it is not a browser decision.
   */
  async getRoutedApprover(idempotencyKey: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('nominations')
      .select('approver:assigned_approver_id(full_name)')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    // Advisory only — a missing name costs a nicety, never the submission.
    if (error) return null

    const approver = (data as { approver?: { full_name: string } | null } | null)?.approver
    return approver?.full_name ?? null
  },

  /**
   * A page of the organisation-wide feed, with the caller's appreciations.
   *
   * Both halves are returned together because a card cannot render correctly
   * without knowing whether this person already appreciated it — leaving the
   * second query to the component is what made every page do it by hand.
   */
  async getFeed(opts: {
    page: number
    pageSize: number
    employeeId?: string | null
    /** Narrow the feed to one Core Value. Null or absent means all of them. */
    coreValueId?: string | null
    /** Ordering. 'recent' is newest first; 'appreciated' is most appreciated. */
    sort?: FeedSort
  }): Promise<FeedPage> {
    const from = opts.page * opts.pageSize
    const sort = opts.sort ?? 'recent'

    /*
      Filtering and ordering happen in the DATABASE, not in the component.

      Doing either over the pages already loaded would make both controls lie
      the moment the feed runs past its first page: "most appreciated" would
      mean "most appreciated of the twenty rows you happen to have scrolled",
      and a value filter would hide matches that simply had not been fetched
      yet. Neither is a filter — they are sorting of a sample.

      This changes no permissions. v_recognition_feed already restricts itself
      to approved recognitions and is still read under the caller's own RLS;
      these are an extra WHERE and a different ORDER BY over exactly the rows
      the viewer could already see.
    */
    let query = supabase.from('v_recognition_feed').select('*')

    if (opts.coreValueId) query = query.eq('core_value_id', opts.coreValueId)

    query = sort === 'appreciated'
      // approved_at breaks ties, so paging stays stable when counts are equal.
      ? query.order('appreciation_count', { ascending: false })
             .order('approved_at', { ascending: false })
      : query.order('approved_at', { ascending: false })

    const { data, error } = await query.range(from, from + opts.pageSize - 1)

    if (error) throw toApiError(error, 'We could not load the recognition feed.')

    const items = (data ?? []) as RecognitionFeedItem[]

    // One query for the whole page rather than one per card.
    let appreciatedIds: string[] = []
    if (opts.employeeId && items.length > 0) {
      const { data: mine } = await supabase
        .from('nomination_appreciations')
        .select('nomination_id')
        .eq('employee_id', opts.employeeId)
        .in('nomination_id', items.map(i => i.id))

      appreciatedIds = (mine ?? []).map(a => a.nomination_id)
    }

    return { items, appreciatedIds, hasMore: items.length === opts.pageSize }
  },

  /** Recognitions this person received or gave. */
  async getMine(opts: {
    employeeId: string
    tab: MyRecognitionsTab
    limit?: number
  }): Promise<NominationWithDetails[]> {
    const field = opts.tab === 'received' ? 'nominee_id' : 'nominator_id'

    // Received shows only what was approved; given shows the whole lifecycle,
    // because the person who wrote it needs to see it stuck in clarification.
    const statuses: NominationStatus[] = opts.tab === 'received'
      ? ['approved']
      : ['approved', 'pending', 'clarification_requested', 'rejected']

    const { data, error } = await supabase
      .from('nominations')
      .select(NOMINATION_DETAIL_COLUMNS)
      .eq(field, opts.employeeId)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 50)

    if (error) throw toApiError(error, 'We could not load your recognitions.')
    return (data ?? []) as unknown as NominationWithDetails[]
  },

  /**
   * The recognitions this person may review.
   *
   * SCOPE IS THE DATABASE'S, and it differs by role:
   *
   *   Manager      the recognitions ROUTED to them — assigned_approver_id,
   *                which 029/030 derived from the project the recognizer chose
   *   HR Admin     every recognition in the organisation
   *   Super Admin  every recognition in the organisation
   *
   * recognition_approval_queue() (042) takes NO ARGUMENTS. The previous version
   * of this method took an approver id and filtered on it, which meant the
   * thing the queue is scoped by travelled in the request — the policies
   * refused a tampered one, but nothing said so. There is now nothing to
   * tamper with, and `nominations_read_approver` / `nominations_hr_read_all`
   * remain the authority underneath (the function is SECURITY INVOKER).
   *
   * Recently decided recognitions come back too, carrying `decision` — who
   * acted, in which role, when. Without them a Manager's approval would simply
   * make the item vanish from HR's queue, which reads as data loss. `can_act`
   * says whether the viewer may still act; the database refuses regardless.
   */
  async getApprovalQueue(): Promise<ApprovalQueueItem[]> {
    const { data, error } = await supabase.rpc('recognition_approval_queue')

    if (error) throw toApiError(error, 'We could not load the approval queue.')
    return (data as ApprovalQueueItem[] | null) ?? []
  },

  /**
   * Approved recognitions for a manager's team: received by one of its
   * members, OR filed against one of its projects. See getTeamScope for why
   * the project half matters. A recognition matching both appears once.
   */
  async getTeamFeed(
    scope: { memberIds: string[]; projectIds: string[] },
    limit = 50,
  ): Promise<RecognitionFeedItem[]> {
    const filter = teamRecognitionFilter(scope)
    if (!filter) return []

    const { data, error } = await supabase
      .from('v_recognition_feed')
      .select('*')
      .or(filter)
      .order('approved_at', { ascending: false })
      .limit(limit)

    if (error) throw toApiError(error, 'We could not load team recognitions.')
    return (data ?? []) as RecognitionFeedItem[]
  },

  /**
   * Everything the Team Recognition screen needs, for one manager.
   *
   * The team is derived the way migration 030 defines it: the active members
   * of the ACTIVE PROJECTS this person manages — `projects.manager_id` and
   * `project_members`, never `employees.manager_id`. Re-reading it on every
   * load is what makes a project handover take effect; nothing about the
   * manager relationship is held in the browser.
   *
   * Three queries regardless of team size — projects, then their members, then
   * one feed read filtered by the whole roster OR those projects. The project
   * half is what brings in a recognition filed against this manager's project
   * for someone who is not a member of it (see getTeamScope). Deduplication
   * of someone on more than one project happens in getTeamScope.
   *
   * Composition only: both halves are the existing calls, so there is one
   * implementation of "who is my team" and one of "their approved
   * recognitions", shared with the dashboard and the badges screen.
   */
  async getTeamFeedForManager(managerId: string, limit = 50): Promise<TeamFeed> {
    const scope = await employeesApi.getTeamScope(managerId)
    const counts = { projectCount: scope.projectIds.length, memberCount: scope.memberIds.length }
    if (counts.projectCount === 0) return { ...counts, items: [], appreciatedIds: [] }

    const items = await recognitionsApi.getTeamFeed(scope, limit)

    // Which of these the manager has appreciated — one query, as the feed does.
    let appreciatedIds: string[] = []
    if (items.length > 0) {
      const { data: mine } = await supabase
        .from('nomination_appreciations')
        .select('nomination_id')
        .eq('employee_id', managerId)
        .in('nomination_id', items.map(i => i.id))
      appreciatedIds = (mine ?? []).map(a => a.nomination_id)
    }

    return { ...counts, items, appreciatedIds }
  },

  /**
   * Submit a recognition.
   *
   * The snapshot columns are written here and never updated, so a recognition
   * still reads correctly after someone changes department or a core value is
   * renamed.
   */
  async submit(input: SubmitRecognitionInput): Promise<SubmitResult> {
    const { error } = await supabase.from('nominations').insert({
      nominator_id: input.nominatorId,
      nominee_id: input.nomineeId,
      core_value_id: input.coreValueId,
      behaviour_id: input.behaviourId ?? null,
      scenario_id: input.scenarioId ?? null,
      project_id: input.projectId,
      what_happened: input.whatHappened,
      what_impact: input.whatImpact,
      snapshot_core_value_name: input.snapshot.coreValueName,
      snapshot_behaviour_name: input.snapshot.behaviourName ?? null,
      snapshot_scenario_name: input.snapshot.scenarioName ?? null,
      snapshot_project_name: input.snapshot.projectName ?? null,
      snapshot_nominator_dept: input.snapshot.nominatorDept ?? null,
      snapshot_nominee_dept: input.snapshot.nomineeDept ?? null,
      snapshot_nominee_manager_id: input.snapshot.nomineeManagerId ?? null,
      recognition_source: input.recognitionSource,
      /*
        assigned_approver_id and escalation_level are NOT sent. The BEFORE
        INSERT trigger from 029 sets both from the project's manager, and
        discards anything the client supplies. This is the security boundary:
        routing is not a browser decision.
      */
      idempotency_key: input.idempotencyKey ?? null,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    })

    if (!error) return { status: 'created' }

    const code = (error as { code?: string; message?: string }).code

    // The idempotency key already exists — the submission landed earlier.
    if (code === '23505') return { status: 'duplicate' }

    /*
      A BEFORE INSERT guard refused the submission. Three of them can, and each
      raises a check violation carrying a sentence written for a person:

        guard_nomination_eligibility     (041) the nominee is not someone this
                                               nominator may recognise, or is
                                               the nominator themselves
        enforce_nomination_rate_limits   (007) which limit was hit
        route_nomination_to_project_manager (029/030) the project cannot route

      All three are ENFORCEMENT POINTS, not the advisory pre-flight checks
      below, and the database's own wording is more useful than anything
      generic — so the message is passed through. `refused` rather than
      `rate_limited`: the code names what happened (the database declined this
      submission) rather than one of the three reasons it might have.
    */
    if (code === '23514') {
      throw new ApiError(
        (error as { message: string }).message,
        'refused',
        error,
      )
    }

    throw toApiError(error, 'We could not submit this recognition.')
  },

  /** Answer a clarification request and put it back in the queue. */
  async resubmitWithClarification(input: {
    nominationId: string
    whatHappened: string
    whatImpact: string
  }): Promise<void> {
    const { error } = await supabase
      .from('nominations')
      .update({
        what_happened: input.whatHappened.trim(),
        what_impact: input.whatImpact.trim(),
        status: 'pending',
        clarification_responded_at: new Date().toISOString(),
      })
      .eq('id', input.nominationId)

    if (error) throw toApiError(error, 'We could not resubmit this recognition.')
  },

  /**
   * Mark a recognition as appreciated by this person.
   *
   * Returns whether this call was the one that recorded it. A unique violation
   * means they had already appreciated it elsewhere — the end state the caller
   * wanted, so not an error, but the distinction matters: a card showing an
   * optimistic +1 has to undo it.
   */
  async appreciate(
    nominationId: string,
    employeeId: string,
  ): Promise<{ recorded: boolean }> {
    const { error } = await supabase.from('nomination_appreciations').insert({
      nomination_id: nominationId,
      employee_id: employeeId,
    })

    if (!error) return { recorded: true }
    if ((error as { code?: string }).code === '23505') return { recorded: false }

    throw toApiError(error, 'We could not record that.')
  },

  /**
   * Take back this person's appreciation of a recognition.
   *
   * The mirror of `appreciate`, and deliberately shaped the same way: it
   * reports whether this call was the one that removed the row, so a card
   * showing an optimistic -1 can tell "you had already un-appreciated this
   * elsewhere" apart from a failure and undo its own guess accordingly.
   *
   * Deleting nothing is not an error — the end state the caller wanted is the
   * end state they get — so a zero-row delete comes back as removed: false
   * rather than throwing. The employee id is passed for the same reason the
   * insert passes it: it narrows the statement to this person's row. What
   * actually forbids removing somebody else's appreciation is the delete
   * policy (045), not this filter.
   */
  async unappreciate(
    nominationId: string,
    employeeId: string,
  ): Promise<{ removed: boolean }> {
    const { data, error } = await supabase
      .from('nomination_appreciations')
      .delete()
      .eq('nomination_id', nominationId)
      .eq('employee_id', employeeId)
      .select('id')

    if (error) throw toApiError(error, 'We could not undo that.')

    return { removed: (data ?? []).length > 0 }
  },

  /**
   * Approve, reject or request clarification.
   *
   * Goes through the process-approval Edge Function, not a table write: it runs
   * under the service role, re-checks the second factor itself, and orchestrates
   * the notification and badge side effects that a bare status update would
   * skip. The state change inside it is one call to record_nomination_decision()
   * (042), which locks the row — so of three authorities acting at once, exactly
   * one changes anything.
   *
   * There is no approver id. The actor is the person holding the token, resolved
   * inside the function; sending one would be offering a lever that does nothing.
   *
   * Returns the decision so the caller can name the actor without a refetch.
   */
  async decide(input: {
    nominationId: string
    action: ApprovalAction
    reason?: string
    clarificationNote?: string
  }): Promise<{ decision: NominationDecision | null }> {
    const { data, error } = await supabase.functions.invoke('process-approval', {
      body: {
        nomination_id: input.nominationId,
        action: input.action,
        reason: input.action === 'reject' ? input.reason : undefined,
        clarification_note:
          input.action === 'request_clarification' ? input.clarificationNote : undefined,
      },
    })

    if (!error) {
      return { decision: (data as { decision?: NominationDecision | null })?.decision ?? null }
    }

    /*
      A refusal arrives as a non-2xx response whose body carries the reason, and
      invoke() puts that body out of reach on the error object — so it is read
      back off the Response, exactly as employeesApi.deleteEmployee does.

      This matters more here than almost anywhere else in the app: the most
      likely refusal is 409, "somebody else already decided this", and reporting
      that as "something went wrong" would leave three authorities re-clicking
      at each other with no idea what happened. The function's message names who
      acted.
    */
    const response = (error as { context?: Response }).context
    const status = typeof response?.status === 'number' ? response.status : null

    if (response && typeof response.json === 'function') {
      const body = await response.json().catch(() => null) as {
        error?: string
        status?: string
        message?: string
      } | null

      const detail = body?.error ?? body?.message
      if (detail) {
        // 'already_handled' is the one the queue renders differently: it is not
        // a failure of permission or of the network, it is a race that somebody
        // else won, and the item simply needs to be shown in its new state.
        throw new ApiError(detail, body?.status ?? (status === 409 ? 'already_handled' : 'approval_failed'), error)
      }
    }

    throw new ApiError('Something went wrong. Please try again.', 'approval_failed', error)
  },

  /**
   * Advisory pre-flight checks.
   *
   * Both are ADVISORY and neither is an enforcement point. The duplicate
   * warning is guidance shown while the form is open, and the rate limit is
   * really enforced by enforce_nomination_rate_limits (migration 007), which
   * cannot be skipped by calling PostgREST directly. They exist to explain the
   * refusal before the user has typed three paragraphs.
   */
  async checkDuplicate(input: {
    nominatorId: string
    nomineeId: string
    coreValueId: string
  }): Promise<{ isDuplicate: boolean; message: string | null }> {
    const { data, error } = await supabase.functions.invoke('check-duplicate', {
      body: {
        nominator_id: input.nominatorId,
        nominee_id: input.nomineeId,
        core_value_id: input.coreValueId,
      },
    })

    // Advisory only: a failure here must never block the form, so an
    // unavailable check reads as "no duplicate" rather than propagating.
    if (error) return { isDuplicate: false, message: null }

    const result = data as { is_duplicate?: boolean; message?: string } | null
    return {
      isDuplicate: Boolean(result?.is_duplicate),
      message: result?.message ?? null,
    }
  },

  async checkRateLimit(nominatorId: string): Promise<{ allowed: boolean; message: string | null }> {
    const { data, error } = await supabase.functions.invoke('check-rate-limits', {
      body: { nominator_id: nominatorId },
    })

    if (error) return { allowed: true, message: null }

    const result = data as { allowed?: boolean; message?: string } | null
    return { allowed: result?.allowed !== false, message: result?.message ?? null }
  },
}
