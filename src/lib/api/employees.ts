/**
 * Employees — the people directory, roles and invitations.
 *
 * Every method is a business operation. Callers pass domain values and get
 * domain objects back; nothing in the signatures mentions a table, a column
 * list or an RPC name.
 *
 * Authorization is unchanged and is not performed here. `employees_hr_full`
 * governs reads and writes, `guard_employee_role_insert` (026) governs which
 * role may be created by whom, `set_employee_role()` (016) is the only way a
 * role changes, and `send_employee_invitation()` (027) authorises itself from
 * the employees table rather than the JWT. This layer makes the same calls the
 * components used to make.
 */
import type { Employee, UserRole } from '@/types'
import {
  supabase, unwrapMaybe, toApiError, ApiError,
  pageRange, toPage, ilikeAnyFilter, type Page, type PageRequest,
} from './client'

/**
 * What an erasure removed.
 *
 * The counts are reported because they are the part an administrator cannot
 * see coming: deleting one person also deletes the recognitions they gave,
 * out of other people's histories.
 */
export interface DeleteEmployeeResult {
  status: 'ok'
  email: string
  full_name: string
  recognitions_given: number
  recognitions_received: number
  /**
   * Set when the employee record went but their sign-in account did not, which
   * leaves the address occupied. Null on a clean deletion.
   */
  auth_warning: string | null
}

/**
 * What set_own_project() did.
 *
 * `relationship` says which of the two associations was written, because they
 * are genuinely different things: a Manager runs a project
 * (`projects.manager_id`), everyone else belongs to one (`project_members`).
 */
export interface SetOwnProjectResult {
  status: 'ok' | 'unchanged' | 'already_assigned'
  relationship?: 'manager' | 'member'
  /** The project's name — the one written, or the one already held. */
  project?: string
}

/** A project as the directory needs to name it. */
export interface EmployeeProjectRef {
  id: string
  name: string
}

/** A directory row with its department and projects resolved for display. */
export interface EmployeeListItem extends Employee {
  department: { name: string } | null
  /**
   * The projects this person is associated with, already resolved to names.
   *
   * `member` is what they work on (project_members); `manager` is what they
   * run (projects.manager_id). Both are lists because the schema permits more
   * than one of each — a Manager routinely runs several — even though the MVP
   * rule in 029 holds active MEMBERSHIPS to one at a time.
   */
  projects: {
    member: EmployeeProjectRef[]
    manager: EmployeeProjectRef[]
  }
}

/** Raw embed shapes from LIST_COLUMNS, before they are flattened. */
interface EmbeddedMembership {
  is_active: boolean
  project: EmployeeProjectRef | null
}

/**
 * Flatten the two project embeds onto a directory row.
 *
 * Inactive rows are dropped here rather than in the query — see LIST_COLUMNS
 * for why — and an archived project is not shown as somebody's project.
 */
function withProjects(
  row: Record<string, unknown>,
): EmployeeListItem {
  const memberships = (row.memberships ?? []) as EmbeddedMembership[]
  const managed = (row.managed_projects ?? []) as Array<EmployeeProjectRef & { is_active: boolean }>

  const member = memberships
    .filter(m => m.is_active && m.project)
    .map(m => m.project as EmployeeProjectRef)

  const manager = managed
    .filter(p => p.is_active)
    .map(p => ({ id: p.id, name: p.name }))

  return { ...(row as unknown as EmployeeListItem), projects: { member, manager } }
}

/*
  Columns the directory screens need. Narrower than select('*').

  `manager_id` and its join are gone from the directory. Employees are no
  longer tied to a line manager (migration 030) — managers relate to PROJECTS.
  The column still exists for historical records; the directory simply has no
  reason to read it.
*/
/*
  Project association comes back WITH the directory row rather than per row.

  Two embeds because the two relationships are different and both matter to
  the person reading the table:

    memberships      project_members -> the project they work on
    managed_projects projects.manager_id -> the project(s) they run

  Fetching either per employee would be a query per row. PostgREST resolves
  both from the foreign keys in one round trip, so the table costs the same as
  it did before the column existed.

  Filtered in TypeScript rather than in the embed: PostgREST cannot express
  "only active memberships" on a nested select without making the parent row
  disappear when there are none, and an employee with no project still belongs
  in the directory.
*/
const LIST_COLUMNS =
  'id, employee_id, full_name, email, role, is_active, auth_user_id, ' +
  'department_id, avatar_url, designation, joined_at, created_at, updated_at, ' +
  'department:department_id(name), ' +
  'memberships:project_members!project_members_employee_id_fkey(is_active, project:project_id(id, name)), ' +
  'managed_projects:projects!projects_manager_id_fkey(id, name, is_active)'

/** The columns the directory's free-text search looks at. */
const SEARCH_COLUMNS = ['full_name', 'email', 'employee_id'] as const

/*
  EMPLOYEE_COLUMNS and SEARCH_RESULT_LIMIT lived here, describing the query the
  recognition wizard's nominee search used to build in the browser. Both moved
  into recognition_candidates() (migration 041) along with the rest of that
  query, because which candidates are eligible is decided by the caller's role
  and that is not a browser decision. Leaving the column list and the limit
  behind would have implied the browser still shapes that search.
*/

export interface EmployeeQuery extends PageRequest {
  /** Free text over name, email and company id. Ignored under 2 characters. */
  search?: string
  activeOnly?: boolean
}

/**
 * The PostgREST `or` filter selecting a manager's team recognitions from a
 * table or view with `nominee_id` and `project_id`: received by a member, or
 * filed against one of the manager's projects. Null when the scope is empty.
 * Ids are uuids from our own queries, so they are safe inside the filter.
 */
export function teamRecognitionFilter(scope: { memberIds: string[]; projectIds: string[] }): string | null {
  const clauses = [
    scope.memberIds.length > 0 && `nominee_id.in.(${scope.memberIds.join(',')})`,
    scope.projectIds.length > 0 && `project_id.in.(${scope.projectIds.join(',')})`,
  ].filter(Boolean)
  return clauses.length > 0 ? clauses.join(',') : null
}

export const employeesApi = {
  /** A page of the directory. */
  async list(query: EmployeeQuery = {}): Promise<Page<EmployeeListItem>> {
    const { from, to, page, pageSize } = pageRange(query)

    let builder = supabase
      .from('employees')
      .select(LIST_COLUMNS, { count: 'exact' })
      .order('full_name')
      .range(from, to)

    if (query.activeOnly) builder = builder.eq('is_active', true)

    const term = query.search?.trim() ?? ''
    if (term.length >= 2) {
      builder = builder.or(ilikeAnyFilter(SEARCH_COLUMNS, term))
    }

    const { data, error, count } = await builder
    if (error) throw toApiError(error, 'Could not load employees.')

    const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(withProjects)
    return toPage(rows, count, page, pageSize)
  },

  /**
   * Find colleagues the CALLER MAY RECOGNISE, by name, company id or email.
   *
   * A different question from `list()`: the wizard wants a handful of people it
   * could actually act on, not a page of the directory with departments and
   * projects resolved. Under two characters it returns nothing rather than the
   * whole company.
   *
   * Routed through recognition_candidates() (041) rather than a table query,
   * because "may recognise" is not a filter the browser gets to choose. That
   * function takes a search term AND NOTHING ELSE — no role, no exclusion list,
   * no id. It reads the caller's own role from `employees` and applies the
   * eligibility rule itself: an Employee is offered only other Employees, every
   * other role is offered whoever they could be offered before, and nobody is
   * ever offered themselves.
   *
   * There is deliberately no parameter here that could widen the result. The
   * previous implementation built the filter in the browser — `is_active`, the
   * self-exclusion and, by omission, the absence of any role restriction — so
   * every one of those was a line in the network tab rather than a rule.
   *
   * Still not the enforcement point, and it does not pretend to be: the
   * guard_nomination_eligibility trigger (041) refuses an ineligible nominee at
   * INSERT whatever this returns.
   */
  async search(term: string): Promise<Employee[]> {
    const trimmed = term.trim()
    if (trimmed.length < 2) return []

    /*
      Cast for the same reason referenceApi does it: supabase-types.ts is
      generated from the schema and has not been regenerated since this
      function was added. Regenerating needs a local database
      (`npm run supabase:types` targets --local), which this change does not
      otherwise require.
    */
    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)(
      'recognition_candidates',
      { p_term: trimmed },
    )

    if (error) throw toApiError(error, 'Search failed. Please try again.')
    return (data ?? []) as Employee[]
  },

  /**
   * Ids of the active people on this manager's team.
   *
   * "Their team" now means everyone actively assigned to a project THEY
   * manage. It used to mean everyone whose employees.manager_id pointed at
   * them — that line-manager relationship was removed from the employee model
   * in migration 030, so deriving the team from project ownership is what
   * keeps the manager screens working under the new org model.
   *
   * Returns no duplicates: someone on two of a manager's projects is one
   * team member, not two.
   */
  async listTeamMemberIds(managerId: string): Promise<string[]> {
    return (await employeesApi.getTeamScope(managerId)).memberIds
  },

  /**
   * What a manager's team covers: the active projects they run, and the
   * people actively assigned to them.
   *
   * Both halves, because since migration 030 the RECOGNIZER picks the project
   * a recognition is filed against, and it need not be one the recipient is
   * a member of. Such a recognition is routed to, and approved by, this
   * manager — so a team view built from membership alone would leave out
   * recognitions they themselves approved.
   */
  async getTeamScope(managerId: string): Promise<{ projectIds: string[]; memberIds: string[] }> {
    const { data: projects, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('manager_id', managerId)
      .eq('is_active', true)

    if (projectError) throw toApiError(projectError, 'Could not load your team.')

    const projectIds = (projects ?? []).map(p => p.id)
    if (projectIds.length === 0) return { projectIds, memberIds: [] }

    const { data, error } = await supabase
      .from('project_members')
      .select('employee_id')
      .in('project_id', projectIds)
      .eq('is_active', true)

    if (error) throw toApiError(error, 'Could not load your team.')
    return { projectIds, memberIds: [...new Set((data ?? []).map(m => m.employee_id))] }
  },

  /*
    The approver-resolution lookups that used to sit here are gone:
    getChainLink(), getFullName(), listActiveHrAdminIds() and
    getFallbackApproverId(). They existed only to let the browser walk the
    nominee's management chain and pick an approver.

    Since migration 029 the approver is the manager of the project a
    recognition is filed against, and that is resolved by a BEFORE INSERT
    trigger. The HR fallback those helpers fed — the configured approver, then
    any active HR admin — was not dropped: it moved into that trigger, where it
    cannot be bypassed. Leaving the client-side versions behind would have
    advertised a route into approval routing that no longer exists.
  */

  /** Department name, for the historical snapshot written at submission. */
  async getDepartmentName(departmentId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('departments')
      .select('name')
      .eq('id', departmentId)
      .maybeSingle()

    if (error) throw toApiError(error, 'Could not load that department.')
    return data?.name ?? null
  },

  /*
    listPotentialManagers() lived here, feeding the employee form's "Manager"
    dropdown. That association is retired (030). The project form uses
    referenceApi.listEligibleProjectManagers() instead, which is stricter:
    a Project Manager must hold the Manager role, while this list also offered
    HR admins.
  */

  /**
   * Create a record for someone who does not have an account yet.
   *
   * The role is written as given, and the database decides whether the caller
   * may write it: 026's insert guard allows HR and Super Admin to create
   * employee/manager/hr_admin, and refuses super_admin to everyone but a
   * Super Admin. Passing a role here is a request, not an authorisation.
   */
  async create(input: {
    fullName: string
    email: string
    role: UserRole
    departmentId?: string | null
    designation?: string | null
  }): Promise<{ id: string }> {
    const result = await supabase
      .from('employees')
      .insert({
        full_name: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        department_id: input.departmentId || null,
        // Only sent when given, so creating an employee keeps working on a
        // database that has not had 054 applied yet.
        ...(input.designation?.trim()
          ? { designation: input.designation.replace(/\s+/g, ' ').trim() }
          : {}),
        is_active: true,
      })
      .select('id')
      .single()

    if (result.error) {
      throw toApiError(result.error, 'Could not create that employee.')
    }
    return result.data as { id: string }
  },

  /** Update profile fields. Deliberately cannot change `role` — see setRole. */
  async updateProfile(id: string, input: {
    fullName?: string
    departmentId?: string | null
    /** Job title (054). Blank clears it. */
    designation?: string | null
    /**
     * The company ID shown across the app (e.g. TC004). Assigned by the
     * assign_employee_id trigger on creation; HR and a Super Admin may
     * correct it here — employees_hr_full permits the write. Unique.
     */
    employeeCode?: string
  }): Promise<void> {
    // Typed against the generated row so an unknown column is a compile error
    // rather than a runtime PostgREST rejection. `role` is deliberately absent
    // from the shape — it is set_employee_role()'s job alone.
    const patch: Partial<Pick<Employee, 'full_name' | 'department_id' | 'designation' | 'employee_id'>> = {}
    if (input.fullName !== undefined) patch.full_name = input.fullName.trim()
    if (input.employeeCode !== undefined) patch.employee_id = input.employeeCode.trim().toUpperCase()
    if (input.departmentId !== undefined) patch.department_id = input.departmentId || null
    if (input.designation !== undefined) {
      patch.designation = input.designation?.replace(/\s+/g, ' ').trim() || null
    }

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('employees').update(patch).eq('id', id)
    if (error) {
      // employee_id is the only unique column this can write.
      if (error.code === '23505' && patch.employee_id) {
        throw new ApiError(`Another employee already has the ID ${patch.employee_id}.`, 'duplicate', error)
      }
      throw toApiError(error, 'Could not save those changes.')
    }
  },

  /**
   * Change someone's role.
   *
   * Routed through set_employee_role() because a direct write to the column is
   * rejected by the trigger from migration 016 — that is the point of it. The
   * function re-reads the caller's own role from the database and refuses
   * anyone not entitled, including an HR Admin reaching for Super Admin.
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
      case 'forbidden':
        throw new ApiError(
          result.reason === 'needs_super_admin'
            ? 'Only a Super Admin can grant or change HR Admin and Super Admin access.'
            : 'You do not have permission to change this role.',
          'forbidden',
        )
      case 'last_admin':
        throw new ApiError(
          'This is the only administrator who can sign in. Appoint another one first.',
          'last_admin',
        )
      case 'not_found':
        throw new ApiError('That employee no longer exists.', 'not_found')
      default:
        throw new ApiError('Could not change that role.', result?.status ?? 'unknown')
    }
  },

  /** Activate or deactivate. Deactivating the last admin is refused by 016. */
  async setActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('employees').update({ is_active: isActive }).eq('id', id)
    if (error) throw toApiError(error, 'Could not update that employee.')
  },

  /**
   * Erase an employee permanently, freeing their email address.
   *
   * NOT the same operation as setActive(false), and not a fallback for it.
   * Deactivation keeps the person's history intact and is the right answer for
   * someone who has left. This removes them and everything referring to them,
   * including the recognitions they GAVE — which live in other people's
   * histories. Migration 035 documents the full extent.
   *
   * Routed through the delete-employee Edge Function rather than a table
   * delete or a plain RPC, because the email address is held by auth.users and
   * only the service role can remove it. The function authorises the caller,
   * runs the purge, then deletes the identity.
   */
  async deleteEmployee(id: string): Promise<DeleteEmployeeResult> {
    const { data, error } = await supabase.functions.invoke('delete-employee', {
      body: { employee_id: id },
    })

    /*
      A refusal arrives as a non-2xx response, and its body carries the reason
      — "this is the only administrator", "you cannot delete your own account".
      invoke() puts that body out of reach on the error object, so it is read
      back off the Response rather than replaced with something generic: these
      are the messages the administrator actually needs.

      TWO DIFFERENT BODIES arrive here, which is worth being explicit about.
      The Edge Function answers with { error }. The platform GATEWAY, when the
      function is not deployed or the request never reaches it, answers with
      { code, message } — no `error` key at all. Reading only `error` made a
      missing deployment indistinguishable from a database refusal, which is
      exactly the ambiguity this whole branch exists to avoid.
    */
    if (error) {
      const response = (error as { context?: Response }).context
      const status = typeof response?.status === 'number' ? response.status : null

      // The function is not deployed, or the project cannot see it. No amount
      // of retrying fixes this, so say what it actually is.
      if (status === 404) {
        throw new ApiError(
          'Employee deletion is not available yet: the delete-employee function is not deployed to this project.',
          'function_not_deployed',
          error,
        )
      }

      if (response && typeof response.json === 'function') {
        const body = await response.json().catch(() => null) as
          { error?: string; status?: string; message?: string } | null

        // `error` is the function's own wording; `message` is the gateway's.
        const detail = body?.error ?? body?.message
        if (detail) throw new ApiError(detail, body?.status ?? 'delete_failed', error)
      }

      throw new ApiError(
        status
          ? `We could not delete that employee (server returned ${status}).`
          : 'We could not reach the server to delete that employee.',
        'delete_failed',
        error,
      )
    }

    return data as DeleteEmployeeResult
  },

  /**
   * The newly registered person names their OWN department.
   *
   * Called at the end of account creation, immediately after
   * claim_employee_account() — the department is chosen on the signup form,
   * and this is the first moment there is a record to write it to.
   *
   * Routed through set_own_department() rather than a self-update so the write
   * is one column wide and cannot overwrite a department HR has already
   * assigned on an invited record — see migration 031. There is no
   * employee-id argument on purpose: the row comes from the session.
   */
  async setOwnDepartment(departmentId: string): Promise<{ status: 'ok' | 'already_set' }> {
    const { data, error } = await supabase.rpc('set_own_department', {
      p_department_id: departmentId,
    })

    if (error) throw toApiError(error, 'Could not save your department.')

    const result = data as { status?: string } | null

    // 'already_set' is not a failure: HR filled it in while the prompt was
    // open, or the same answer was submitted twice. Either way the record has
    // a department now, which is all the caller wanted.
    if (result?.status === 'ok' || result?.status === 'already_set') {
      return { status: result.status }
    }

    throw new ApiError(ownDepartmentFailureMessage(result?.status), result?.status ?? 'unknown')
  },

  /**
   * The project chosen while creating the account.
   *
   * Routed through set_own_project() (038), which decides from the caller's
   * OWN role which relationship to write — `projects.manager_id` for a
   * Manager, `project_members` for everyone else. There is no employee id and
   * no role argument here on purpose: the browser names a project and nothing
   * else.
   *
   * Gap-filling by design. 'unchanged' and 'already_assigned' both mean the
   * person already has an assignment, which is the answer the caller wanted —
   * an administrator's decision is never displaced by one made at signup.
   */
  async setOwnProject(projectId: string): Promise<SetOwnProjectResult> {
    const { data, error } = await supabase.rpc('set_own_project', {
      p_project_id: projectId,
    })

    if (error) throw toApiError(error, 'Could not save your project.')

    const result = data as SetOwnProjectResult | null

    if (result?.status === 'ok'
      || result?.status === 'unchanged'
      || result?.status === 'already_assigned') {
      return result
    }

    throw new ApiError(ownProjectFailureMessage(result?.status, result?.project), result?.status ?? 'unknown')
  },

  /**
   * Email the invitation.
   *
   * Takes only an id. The destination path and the role named in the message
   * are derived inside send_employee_invitation() from the stored role, so
   * there is no way to ask for a different one — see migration 027.
   *
   * Returns 'queued': pg_net hands the request to Brevo asynchronously, so
   * acceptance is not delivery. Call `invitationDeliveryStatus` afterwards.
   */
  async sendInvitation(employeeId: string): Promise<{ status: 'queued' }> {
    const { data, error } = await supabase.rpc('send_employee_invitation', {
      p_employee_id: employeeId,
    })

    if (error) throw toApiError(error, 'Could not send that invitation.')

    const result = data as { status?: string; role?: string } | null
    if (result?.status === 'queued') return { status: 'queued' }

    throw new ApiError(
      invitationFailureMessage(result?.status),
      result?.status ?? 'unknown',
    )
  },

  /** Did the provider accept the last invitation for this person? */
  async invitationDeliveryStatus(
    employeeId: string,
  ): Promise<{ status: 'pending' | 'sent' | 'failed' | 'none'; reason?: string }> {
    const result = await supabase.rpc('invitation_delivery_status', {
      p_employee_id: employeeId,
    })

    const data = unwrapMaybe(result, 'Could not check delivery.')
    return (data as { status: 'pending' | 'sent' | 'failed' | 'none'; reason?: string } | null)
      ?? { status: 'none' }
  },
}

/** Why set_own_department() refused. Each case is something the person can act on. */
function ownDepartmentFailureMessage(status?: string): string {
  switch (status) {
    case 'needs_verification':
      return 'Your session is not verified. Please sign in again.'
    case 'not_authenticated':
      return 'You are signed out. Please sign in again.'
    case 'department_required':
      return 'Please choose a department.'
    case 'unknown_department':
      return 'That department is no longer available. Pick another one.'
    case 'no_employee_record':
      return 'Your employee record is not set up yet. Please contact HR.'
    case 'inactive':
      return 'Your employee record is not active. Please contact HR.'
    default:
      return 'Could not save your department. Please try again.'
  }
}

/** Why set_own_project() refused. Each case is something the person can act on. */
function ownProjectFailureMessage(status?: string, project?: string): string {
  switch (status) {
    case 'needs_verification':
      return 'Your session is not verified. Please sign in again.'
    case 'not_authenticated':
      return 'You are signed out. Please sign in again.'
    case 'project_required':
      return 'Please choose a project.'
    case 'unknown_project':
      return 'That project is no longer available. Pick another one.'
    case 'project_has_manager':
      // Named rather than generic: reassigning a project is HR's to do, and
      // the person needs to know who to ask rather than to try again.
      return project
        ? `${project} already has a Project Manager. Ask HR to assign you to it.`
        : 'That project already has a Project Manager. Ask HR to assign you to it.'
    case 'no_employee_record':
      return 'Your employee record is not set up yet. Please contact HR.'
    case 'inactive':
      return 'Your employee record is not active. Please contact HR.'
    default:
      return 'Could not save your project. Please try again.'
  }
}

/**
 * Turn an invitation status into something an HR user can act on.
 *
 * Never surfaces provider text: 027 returns a category precisely because
 * Brevo's error bodies can name the account owner's address.
 */
export function invitationFailureMessage(status?: string): string {
  switch (status) {
    case 'app_url_not_configured':
      return 'Automated email is not set up yet — the application address is missing. ' +
             'Copy the link and send it yourself, and ask IT to finish the setup.'
    case 'email_not_configured':
      return 'Automated email is not configured on this workspace. Copy the link and send it yourself.'
    case 'cooldown':
      return 'An invitation was just sent to this person. Wait a minute before resending.'
    case 'rate_limited':
      return 'This person has been sent a lot of invitations today. Try again tomorrow, ' +
             'or copy the link and send it yourself.'
    case 'already_registered':
      return 'This person has already set up their account — no invitation is needed.'
    case 'inactive':
      return 'This employee record is not active, so no invitation was sent.'
    case 'forbidden':
      return 'You do not have permission to send invitations.'
    case 'not_found':
      return 'That employee record no longer exists. Refresh the page.'
    case 'invalid_target_role':
      return 'That role cannot be invited.'
    case 'provider_auth':
    case 'invalid_sender':
      return 'Automated email is misconfigured on this workspace. Copy the link and send it ' +
             'yourself, and let IT know.'
    case 'recipient_not_allowed':
      return 'The email provider refused this recipient. Copy the link and send it yourself.'
    case 'provider_rate_limited':
      return 'The email provider is rate limiting us. Try again shortly, or copy the link.'
    case 'unreachable':
    case 'provider_error':
    default:
      return 'The invitation could not be emailed. Copy the link and send it yourself — ' +
             'the link itself works.'
  }
}
