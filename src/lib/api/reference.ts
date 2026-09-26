/**
 * Reference data — the catalogue the rest of the product is built from.
 *
 * Core values, behaviours, scenarios, projects, rewards, departments and badge
 * definitions. Slow-moving, small, and read by almost every screen.
 *
 * Why this module exists at all: `core_values` was being fetched in FOUR
 * different places (the recognition wizard's step 2, and the Core Values,
 * Behaviours and Scenarios screens), and `behaviours` in three — each with a
 * slightly different column list, so nothing could share a cache even in
 * principle. Consolidating the shapes here is what makes one cached copy
 * possible.
 *
 * Authorization is unchanged and none is performed here. Reads are governed by
 * the `*_read_authenticated` policies and writes by `*_hr_write`, both gated on
 * session_second_factor_ok() since migration 022. An HR-only mutation called by
 * an employee is refused by the database, exactly as before.
 */
import type {
  CoreValue, Behaviour, Scenario, Project, Reward, Department, BadgeDefinition,
  UserRole, RewardCategory,
} from '@/types'
import { supabase, toApiError, ApiError } from './client'

/**
 * The range `rewards_validity_days_check` (052) allows.
 *
 * Stated here as well as in the CHECK, and that duplication is deliberate:
 * the constraint is the rule, this is the form control telling somebody what
 * the rule is before they hit it. The two are kept honest by verify:store.
 */
export const REWARD_VALIDITY_MIN = 1
export const REWARD_VALIDITY_MAX = 365
export const REWARD_VALIDITY_DEFAULT = 14

/**
 * A whole number of days inside that range.
 *
 * Clamps rather than throws. A 0 typed into a number field is far more
 * likely to be a half-finished edit than an intention, and the database
 * would refuse it with a constraint name nobody outside this repo can read.
 * Decimals are floored for the same reason a price is: a reward valid for
 * 7.5 days is not a thing the product can express.
 */
function clampValidityDays(days: number | undefined): number {
  if (days === undefined || !Number.isFinite(days)) return REWARD_VALIDITY_DEFAULT
  return Math.min(REWARD_VALIDITY_MAX, Math.max(REWARD_VALIDITY_MIN, Math.floor(days)))
}

/** Most screens want only what is in use; the admin screens want everything. */
export interface ActiveFilter {
  /** Defaults to true — the common case is "what can be chosen right now". */
  activeOnly?: boolean
}

/** A behaviour with the core value it belongs to, for the admin table. */
export interface BehaviourWithValue extends Behaviour {
  core_values: { name: string; slug: string } | null
}

/** A scenario with its behaviour and core value resolved, for the admin table. */
export interface ScenarioWithContext extends Scenario {
  behaviours: { name: string } | null
  core_values: { name: string } | null
}

/** A project with its manager's name resolved, for the admin table. */
export interface ProjectWithManager extends Project {
  manager: { full_name: string } | null
  /**
   * Active members, by name.
   *
   * Carried on the same row rather than fetched per project: the admin table
   * renders every project, so a query each would be one per row. These are the
   * people HR sees appear as soon as someone picks the project at signup.
   */
  members: Array<{ id: string; full_name: string }>
}

/** One person on a managed project, as My Projects needs to show them. */
export interface ManagedProjectMember {
  id: string
  full_name: string
  email: string
  role: UserRole
  /** Job title (054). Absent until that migration is applied. */
  designation?: string | null
  avatar_url: string | null
  /** The organisation's employee ID, e.g. "TC-0142" (061). */
  employee_code?: string | null
  /** Current department name (061). */
  department?: string | null
  /** Free-text location from their profile (061). */
  location?: string | null
  /** The date they joined THIS project (061). */
  project_joined_at?: string | null
}

/**
 * A project the calling manager runs, with its active members already
 * attached. Shape of managed_projects() (migrations 040, 054, 061).
 */
export interface ManagedProject {
  id: string
  name: string
  description: string | null
  project_code: string | null
  is_active: boolean
  members: ManagedProjectMember[]
  /** Counted in the database, so it matches `members` without the page adding up. */
  member_count: number
}

/**
 * A project the recognition wizard may offer, with the manager who would
 * approve. Shape of selectable_recognition_projects() (migration 030).
 */
export interface SelectableProject {
  project_id: string
  project_name: string
  manager_id: string
  manager_name: string
}

/**
 * An employee's current project, as the employee admin screen needs it.
 *
 * Shape of employee_active_project() (migration 029). This is org data — it
 * no longer has any bearing on where a recognition routes.
 */
export interface ActiveProject {
  project_id: string
  project_name: string
  manager_id: string | null
  manager_name: string | null
  /** False when the project is archived or has no usable Project Manager. */
  is_routable: boolean
}

export const referenceApi = {
  // ── Core values ───────────────────────────────────────────

  /**
   * Every core value, in display order.
   *
   * Deliberately returns the whole row rather than a narrowed projection: the
   * wizard needs the accent colour and icon, the admin screen needs the
   * definition, and the dropdowns need the name. One shape means one cache
   * entry serves all three — a narrower query per caller was what prevented
   * sharing in the first place, and the table holds five rows.
   */
  async listCoreValues({ activeOnly = true }: ActiveFilter = {}): Promise<CoreValue[]> {
    let query = supabase
      .from('core_values')
      .select('*')
      .order('display_order', { ascending: true })

    if (activeOnly) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load core values.')
    return (data ?? []) as CoreValue[]
  },

  async createCoreValue(input: {
    name: string
    slug: string
    /** NOT NULL in the schema, so empty string rather than null. */
    definition?: string
    accentColor?: string
    icon?: string
    displayOrder?: number
  }): Promise<void> {
    const { error } = await supabase.from('core_values').insert({
      name: input.name.trim(),
      slug: input.slug,
      definition: input.definition ?? '',
      accent_color: input.accentColor ?? '',
      icon: input.icon ?? '',
      display_order: input.displayOrder ?? 0,
      is_active: true,
    })
    if (error) throw toApiError(error, 'Could not create that core value.')
  },

  async updateCoreValue(id: string, input: {
    name?: string
    definition?: string
    accentColor?: string
    icon?: string
    displayOrder?: number
  }): Promise<void> {
    const patch: Partial<CoreValue> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.definition !== undefined) patch.definition = input.definition
    if (input.accentColor !== undefined) patch.accent_color = input.accentColor
    if (input.icon !== undefined) patch.icon = input.icon
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('core_values').update(patch).eq('id', id)
    if (error) throw toApiError(error, 'Could not save that core value.')
  },

  /**
   * Archive or restore. Never a delete — recognitions carry a snapshot of the
   * value's name, but the foreign key still points here.
   */
  async setCoreValueActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('core_values')
      .update({ is_active: isActive, archived_at: isActive ? null : new Date().toISOString() })
      .eq('id', id)
    if (error) throw toApiError(error, 'Could not update that core value.')
  },

  // ── Behaviours ────────────────────────────────────────────

  /** Behaviours, optionally narrowed to one core value (the wizard's step 3). */
  async listBehaviours(
    { coreValueId, activeOnly = true }: ActiveFilter & { coreValueId?: string } = {},
  ): Promise<Behaviour[]> {
    let query = supabase
      .from('behaviours')
      .select('*')
      .order('display_order', { ascending: true })

    if (coreValueId) query = query.eq('core_value_id', coreValueId)
    if (activeOnly) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load behaviours.')
    return (data ?? []) as Behaviour[]
  },

  /** The admin table's shape: every behaviour with its core value resolved. */
  async listBehavioursWithValues(): Promise<BehaviourWithValue[]> {
    const { data, error } = await supabase
      .from('behaviours')
      .select('*, core_values:core_value_id(name, slug)')
      .order('display_order', { ascending: true })

    if (error) throw toApiError(error, 'Could not load behaviours.')
    return (data ?? []) as unknown as BehaviourWithValue[]
  },

  async createBehaviour(input: {
    name: string
    coreValueId: string
    description?: string | null
    displayOrder?: number
  }): Promise<void> {
    const { error } = await supabase.from('behaviours').insert({
      name: input.name.trim(),
      core_value_id: input.coreValueId,
      description: input.description ?? null,
      display_order: input.displayOrder ?? 0,
      is_active: true,
    })
    if (error) throw toApiError(error, 'Could not create that behaviour.')
  },

  async updateBehaviour(id: string, input: {
    name?: string
    coreValueId?: string
    description?: string | null
    displayOrder?: number
  }): Promise<void> {
    const patch: Partial<Behaviour> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.coreValueId !== undefined) patch.core_value_id = input.coreValueId
    if (input.description !== undefined) patch.description = input.description
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('behaviours').update(patch).eq('id', id)
    if (error) throw toApiError(error, 'Could not save that behaviour.')
  },

  async setBehaviourActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('behaviours')
      .update({ is_active: isActive })
      .eq('id', id)
    if (error) throw toApiError(error, 'Could not update that behaviour.')
  },

  // ── Scenarios ─────────────────────────────────────────────

  /**
   * Scenarios, optionally narrowed.
   *
   * The wizard's step 4 narrows by behaviour when one was chosen and falls
   * back to the core value when it was skipped — that precedence is a domain
   * rule, so it lives here rather than being re-derived per caller.
   */
  async listScenarios(
    { behaviourId, coreValueId, activeOnly = true }: ActiveFilter & {
      behaviourId?: string
      coreValueId?: string
    } = {},
  ): Promise<Scenario[]> {
    let query = supabase
      .from('scenarios')
      .select('*')
      .order('display_order', { ascending: true })

    if (activeOnly) query = query.eq('is_active', true)
    if (behaviourId) query = query.eq('behaviour_id', behaviourId)
    else if (coreValueId) query = query.eq('core_value_id', coreValueId)

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load scenarios.')
    return (data ?? []) as Scenario[]
  },

  /** The admin table's shape, with behaviour and core value resolved. */
  async listScenariosWithContext(): Promise<ScenarioWithContext[]> {
    const { data, error } = await supabase
      .from('scenarios')
      .select('*, behaviours:behaviour_id(name), core_values:core_value_id(name)')
      .order('display_order', { ascending: true })

    if (error) throw toApiError(error, 'Could not load scenarios.')
    return (data ?? []) as unknown as ScenarioWithContext[]
  },

  async createScenario(input: {
    name: string
    /** Both NOT NULL: a scenario always sits under a behaviour and a value. */
    coreValueId: string
    behaviourId: string
    description?: string | null
    displayOrder?: number
  }): Promise<void> {
    const { error } = await supabase.from('scenarios').insert({
      name: input.name.trim(),
      core_value_id: input.coreValueId,
      behaviour_id: input.behaviourId,
      description: input.description ?? null,
      display_order: input.displayOrder ?? 0,
      is_active: true,
    })
    if (error) throw toApiError(error, 'Could not create that scenario.')
  },

  async updateScenario(id: string, input: {
    name?: string
    coreValueId?: string
    behaviourId?: string
    description?: string | null
    displayOrder?: number
  }): Promise<void> {
    const patch: Partial<Scenario> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.coreValueId !== undefined) patch.core_value_id = input.coreValueId
    if (input.behaviourId !== undefined) patch.behaviour_id = input.behaviourId
    if (input.description !== undefined) patch.description = input.description
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('scenarios').update(patch).eq('id', id)
    if (error) throw toApiError(error, 'Could not save that scenario.')
  },

  async setScenarioActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('scenarios')
      .update({ is_active: isActive })
      .eq('id', id)
    if (error) throw toApiError(error, 'Could not update that scenario.')
  },

  // ── Projects, rewards, departments, badges ────────────────

  async listProjects({ activeOnly = true }: ActiveFilter = {}): Promise<Project[]> {
    let query = supabase.from('projects').select('*').order('name')
    if (activeOnly) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load projects.')
    return (data ?? []) as Project[]
  },

  /** The admin table's shape: every project with its manager resolved. */
  async listProjectsWithManager(): Promise<ProjectWithManager[]> {
    const { data, error } = await supabase
      .from('projects')
      .select(
        '*, manager:manager_id(full_name), ' +
        // Active-only is applied below rather than in the embed: filtering a
        // nested select would drop projects that have no members at all, and
        // an empty project still belongs in the admin table.
        'memberships:project_members(is_active, employee:employee_id(id, full_name))',
      )
      .order('name')

    if (error) throw toApiError(error, 'Could not load projects.')

    interface Row { memberships?: Array<{ is_active: boolean; employee: { id: string; full_name: string } | null }> }

    return ((data ?? []) as unknown as Array<ProjectWithManager & Row>).map(p => ({
      ...p,
      members: (p.memberships ?? [])
        .filter(m => m.is_active && m.employee)
        .map(m => m.employee as { id: string; full_name: string })
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    }))
  },

  /**
   * Everyone eligible to run a project.
   *
   * Role 'manager' only: guard_project_manager() (029) refuses anything else.
   * Offering a name the database will reject would be a worse dropdown than a
   * short one. This is the ONLY manager selector left in the product — the
   * employee-level one was retired in 030.
   */
  async listEligibleProjectManagers(): Promise<Array<{ id: string; full_name: string }>> {
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name')
      .eq('role', 'manager')
      .eq('is_active', true)
      .order('full_name')

    if (error) throw toApiError(error, 'Could not load managers.')
    return (data ?? []) as Array<{ id: string; full_name: string }>
  },

  /**
   * Create a project.
   *
   * `managerId` is REQUIRED, not optional: since 029 a project's manager is
   * who approves every recognition filed against it, so a project without one
   * is a project nobody can be recognised on. The database enforces this too.
   */
  async createProject(input: {
    name: string
    managerId: string
    description?: string | null
    projectCode?: string | null
  }): Promise<void> {
    const { error } = await supabase.from('projects').insert({
      name: input.name.trim(),
      description: input.description ?? null,
      project_code: input.projectCode ?? null,
      manager_id: input.managerId,
      is_active: true,
    })
    if (error) throw toApiError(error, 'Could not create that project.')
  },

  /**
   * Edit a project.
   *
   * Changing `managerId` re-points only FUTURE recognitions. Anything already
   * awaiting approval keeps the approver it was routed to at submission —
   * `assigned_approver_id` is written once and never recomputed (029).
   */
  async updateProject(id: string, input: {
    name?: string
    description?: string | null
    projectCode?: string | null
    /** Cannot be cleared: an active project must always name a manager. */
    managerId?: string
  }): Promise<void> {
    const patch: Partial<Project> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.description !== undefined) patch.description = input.description
    if (input.projectCode !== undefined) patch.project_code = input.projectCode
    if (input.managerId !== undefined) patch.manager_id = input.managerId

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('projects').update(patch).eq('id', id)
    if (error) throw toApiError(error, 'Could not save that project.')
  },

  /**
   * Archive or restore. `projects` carries archived_at; departments do not.
   *
   * `.select('id')` is not decoration. An UPDATE that RLS filters out is not
   * an error in PostgREST — it succeeds against zero rows. Without asking for
   * the affected row back, a refusal (wrong role, or an unverified 2FA
   * session) would return cleanly, the screen would report success, and the
   * project would still be there after the refetch. That is precisely the
   * failure this guards.
   */
  async setProjectActive(id: string, isActive: boolean): Promise<void> {
    const { data, error } = await supabase
      .from('projects')
      .update({ is_active: isActive, archived_at: isActive ? null : new Date().toISOString() })
      .eq('id', id)
      .select('id')

    if (error) throw toApiError(error, 'Could not update that project.')

    if (!data || data.length === 0) {
      throw new ApiError(
        'That project was not updated. It may have been removed, or your session is not permitted to change projects.',
        'not_applied',
      )
    }
  },

  /**
   * Delete a project permanently.
   *
   * Archiving hides a project from new recognitions but keeps the row, which
   * is the right default: `nominations.project_id` and
   * `project_members.project_id` reference it with no ON DELETE clause, so
   * history stays intact. This exists for the other case — a project added by
   * mistake that nothing has used yet.
   *
   * WHAT IS SAFE TO DELETE IS THE DATABASE'S DECISION, NOT THIS FUNCTION'S.
   * No pre-flight count is taken here: a check-then-delete would race, and a
   * frontend that decides what may be deleted is the pattern this project
   * avoids everywhere else. The foreign keys refuse, and the refusal is
   * translated below.
   */
  async deleteProject(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .select('id')

    if (error) {
      /*
        23503 — a recognition or a team assignment still points here. The
        shared translator words this case as a dangling reference, which reads
        backwards for a delete: the reference is not missing, it is the reason
        the delete was refused. Worded locally rather than changing the
        translator, which every other caller depends on.
      */
      if ((error as { code?: string }).code === '23503') {
        throw new ApiError(
          'This project is still referenced by recognitions or team assignments, so it cannot be deleted. Archive it instead — that hides it from new recognitions and keeps the existing records readable.',
          'in_use',
          error,
        )
      }
      throw toApiError(error, 'Could not delete that project.')
    }

    // Same zero-row reasoning as setProjectActive: a DELETE that RLS filtered
    // out reports success, and silence here would look like it worked.
    if (!data || data.length === 0) {
      throw new ApiError(
        'That project was not deleted. It may have been removed already, or your session is not permitted to change projects.',
        'not_applied',
      )
    }
  },

  /**
   * Every reward, active or not.
   *
   * No activeOnly filter: the only screen that reads rewards is the HR
   * catalogue, which shows all of them, and there is no archive action to
   * produce an inactive one. Adding the parameter now would be speculative.
   */
  async listRewards(): Promise<Reward[]> {
    const { data, error } = await supabase.from('rewards').select('*').order('name')
    if (error) throw toApiError(error, 'Could not load rewards.')
    return (data ?? []) as Reward[]
  },

  async createReward(input: {
    name: string
    description?: string | null
    frequency?: string | null
    eligibilityCriteria?: string | null
    valueDescription?: string | null
    /** NOT NULL, defaults true in the schema. */
    requiresApproval?: boolean
    /**
     * What it costs in the Value Store (051). 0 keeps it out of the store —
     * redeem_reward() refuses an unpriced reward, so the store does not list
     * one rather than offering a control that can only fail.
     */
    coinPrice?: number
    /** Which shelf of the store it sits on (051). */
    category?: RewardCategory
    /**
     * Days an approved redemption stays usable, counted from fulfilment
     * (052). Clamped to the 1-365 the CHECK allows, so a stray 0 or a typed
     * 5000 is corrected here rather than bounced back from the database.
     *
     * Changing it moves nothing that already exists: every redemption keeps
     * the term it was raised under, in validity_days_snapshot.
     */
    validityDays?: number
  }): Promise<void> {
    const { error } = await supabase.from('rewards').insert({
      name: input.name.trim(),
      description: input.description ?? null,
      frequency: input.frequency ?? null,
      eligibility_criteria: input.eligibilityCriteria ?? null,
      value_description: input.valueDescription ?? null,
      requires_approval: input.requiresApproval ?? true,
      coin_price: Math.max(0, Math.floor(input.coinPrice ?? 0)),
      category: input.category ?? 'everyday',
      redemption_validity_days: clampValidityDays(input.validityDays),
      is_active: true,
    })
    if (error) throw toApiError(error, 'Could not create that reward.')
  },

  async updateReward(id: string, input: {
    name?: string
    description?: string | null
    frequency?: string | null
    eligibilityCriteria?: string | null
    valueDescription?: string | null
    requiresApproval?: boolean
    coinPrice?: number
    category?: RewardCategory
    /**
     * Days an approved redemption stays usable, counted from fulfilment
     * (052). Clamped to the 1-365 the CHECK allows, so a stray 0 or a typed
     * 5000 is corrected here rather than bounced back from the database.
     *
     * Changing it moves nothing that already exists: every redemption keeps
     * the term it was raised under, in validity_days_snapshot.
     */
    validityDays?: number
    /** Deactivating takes it out of the store; past redemptions keep their
        own snapshot of the name and price, so none of them change. */
    isActive?: boolean
  }): Promise<void> {
    const patch: Partial<Reward> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.description !== undefined) patch.description = input.description
    if (input.frequency !== undefined) patch.frequency = input.frequency
    if (input.eligibilityCriteria !== undefined) patch.eligibility_criteria = input.eligibilityCriteria
    if (input.valueDescription !== undefined) patch.value_description = input.valueDescription
    if (input.requiresApproval !== undefined) patch.requires_approval = input.requiresApproval
    if (input.coinPrice !== undefined) patch.coin_price = Math.max(0, Math.floor(input.coinPrice))
    if (input.category !== undefined) patch.category = input.category
    if (input.validityDays !== undefined) {
      patch.redemption_validity_days = clampValidityDays(input.validityDays)
    }
    if (input.isActive !== undefined) patch.is_active = input.isActive

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('rewards').update(patch).eq('id', id)
    if (error) throw toApiError(error, 'Could not save that reward.')
  },

  /** Active departments, for the assignment dropdowns. */
  async listDepartments({ activeOnly = true }: ActiveFilter = {}): Promise<Department[]> {
    let query = supabase.from('departments').select('*').order('name')
    if (activeOnly) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw toApiError(error, 'Could not load departments.')
    return (data ?? []) as Department[]
  },

  /**
   * Departments, for the create-account form.
   *
   * A separate operation from listDepartments() because the caller is
   * ANONYMOUS: there is no account yet, and the departments table is readable
   * only by a verified session. signup_departments() reads past that as its
   * definer and returns nothing but id and name of active departments — see
   * migration 032 for what that discloses and why it is accepted.
   *
   * Never use this inside the application; listDepartments() is the one that
   * respects the reader's own access.
   */
  async listSignupDepartments(): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabase.rpc('signup_departments')

    if (error) throw toApiError(error, 'Could not load departments.')

    return (data as Array<{ id: string; name: string }> | null) ?? []
  },

  /**
   * Projects offered on the create-account form.
   *
   * Read through signup_projects() rather than the table: the caller has no
   * account yet, so `projects` RLS (001/022) would return nothing. Same shape
   * as listSignupDepartments above.
   *
   * `forManager` narrows to projects with no Project Manager. Reassigning a
   * managed project is HR's to do, so offering one would produce a choice the
   * database refuses — see migration 038.
   */
  async listSignupProjects(forManager = false): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabase.rpc('signup_projects', {
      p_for_manager: forManager,
    })

    if (error) throw toApiError(error, 'Could not load projects.')

    return (data as Array<{ id: string; name: string }> | null) ?? []
  },

  /**
   * The projects the CALLING manager runs, each with its active members.
   *
   * No manager id is passed, on purpose. managed_projects() (040) reads the
   * caller from their session, so this API has nothing in it to point at
   * somebody else's team — which is the difference between scoping a query and
   * securing one.
   *
   * One round trip for every project and every member: the function gathers
   * members with a LATERAL join rather than leaving the page to fetch them per
   * card.
   */
  async listManagedProjects(): Promise<ManagedProject[]> {
    const { data, error } = await supabase.rpc('managed_projects')

    if (error) throw toApiError(error, 'Could not load your projects.')

    return (data as ManagedProject[] | null) ?? []
  },

  async createDepartment(input: {
    name: string
    description?: string | null
  }): Promise<void> {
    const { error } = await supabase.from('departments').insert({
      name: input.name.trim(),
      description: input.description ?? null,
      is_active: true,
    })
    // `departments.name` is UNIQUE — toApiError maps 23505 to a duplicate.
    if (error) throw toApiError(error, 'Could not create that department.')
  },

  async updateDepartment(id: string, input: {
    name?: string
    description?: string | null
  }): Promise<void> {
    const patch: Partial<Department> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.description !== undefined) patch.description = input.description

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('departments').update(patch).eq('id', id)
    if (error) throw toApiError(error, 'Could not save that department.')
  },

  /**
   * How many employees are in a department.
   *
   * Read for one purpose: the removal confirmation says the number out loud
   * before the click, because removing a department leaves its members with
   * none. `head: true` fetches the count without the rows.
   *
   * This is NOT a permission check. delete_department() does not consult it,
   * and a count taken here would be stale by the time the delete ran anyway —
   * it exists so the person deciding is told what they are about to change.
   */
  async countDepartmentMembers(departmentId: string): Promise<number> {
    const { count, error } = await supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', departmentId)

    if (error) throw toApiError(error, 'Could not count that department.')

    return count ?? 0
  },

  /**
   * Remove a department permanently, detaching anyone in it.
   *
   * Routed through delete_department() (migration 033) rather than a DELETE,
   * because `employees.department_id` has no ON DELETE clause: PostgreSQL
   * refuses to drop a department anyone points at. The function nulls those
   * references and deletes the row in ONE transaction, so a refusal cannot
   * leave employees detached from a department that still exists.
   *
   * Returns how many employees were detached, which is what the screen reports
   * afterwards.
   */
  async deleteDepartment(id: string): Promise<{ employeesDetached: number }> {
    const { data, error } = await supabase.rpc('delete_department', {
      p_department_id: id,
    })

    if (error) {
      // P0001 raised by the function itself: the row was already gone, or RLS
      // filtered it out. Both statements were rolled back.
      if ((error as { message?: string }).message?.includes('department_not_removed')) {
        throw new ApiError(
          'That department was not removed. It may have been removed already, or your session is not permitted to change departments.',
          'not_applied',
          error,
        )
      }
      throw toApiError(error, 'Could not remove that department.')
    }

    const result = data as { status?: string; employees_detached?: number } | null

    if (result?.status !== 'ok') {
      throw new ApiError('Could not remove that department.', result?.status ?? 'unknown')
    }

    return { employeesDetached: result.employees_detached ?? 0 }
  },

  /**
   * Restore an archived department. (Archiving itself is no longer offered —
   * the Departments screen removes instead, see deleteDepartment above.)
   *
   * Kept two-way rather than narrowed to a restore, because it is the same one
   * statement either way and rows archived before removal existed still need
   * the way back.
   *
   * No archived_at: `departments` has no such column, and including one made
   * PostgREST reject the whole update, so activate/deactivate silently did
   * nothing. That is why this is not a copy of setProjectActive.
   */
  async setDepartmentActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('departments')
      .update({ is_active: isActive })
      .eq('id', id)
    if (error) throw toApiError(error, 'Could not update that department.')
  },

  // ── Employee project assignment ────────────────────────────

  /**
   * The one project an employee is currently on, if any.
   *
   * MVP rule: at most one. `idx_project_members_one_active_per_employee` (029)
   * is what makes "their active project" a single answer rather than a guess.
   *
   * `is_routable` says whether a recognition filed against it would actually
   * find an approver — the project active, with a manager who is an active
   * Manager. The wizard needs that distinction to explain itself rather than
   * letting the database refuse the submission at the last moment.
   */
  /**
   * The projects a recognition may be filed against.
   *
   * Every active project that has a usable Project Manager — NOT the nominee's
   * project and not the recognizer's. The person giving the recognition
   * chooses, because they are the one who saw the work; the nominee's own
   * assignment is frequently not where that work happened.
   *
   * The manager comes back so the wizard can confirm who will approve before
   * submission. That is display only — route_nomination_to_project_manager()
   * re-derives it on INSERT and ignores anything the client sends.
   */
  async listSelectableProjects(): Promise<SelectableProject[]> {
    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
    ) => Promise<{ data: unknown; error: unknown }>)('selectable_recognition_projects')

    if (error) throw toApiError(error, 'Could not load projects.')
    return (data ?? []) as SelectableProject[]
  },

  async getEmployeeActiveProject(employeeId: string): Promise<ActiveProject | null> {
    /*
      Cast because supabase-types.ts is generated from the schema and has not
      been regenerated since 029 added this function. Regenerating needs a
      local database (`npm run supabase:types` targets --local), which this
      change does not otherwise require.
    */
    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)(
      'employee_active_project',
      { p_employee_id: employeeId },
    )

    if (error) throw toApiError(error, 'Could not load that project assignment.')

    const rows = (data ?? []) as unknown as ActiveProject[]
    return rows[0] ?? null
  },

  /**
   * Put an employee on a project, replacing whatever they were on.
   *
   * Two steps rather than one, because the unique index permits only one
   * active row per employee: stand the current assignment down first, then
   * add the new one. Passing a null projectId just removes them.
   */
  async setEmployeeProject(employeeId: string, projectId: string | null): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)

    const { error: clearError } = await supabase
      .from('project_members')
      .update({ is_active: false, left_at: today })
      .eq('employee_id', employeeId)
      .eq('is_active', true)

    if (clearError) throw toApiError(clearError, 'Could not update that project assignment.')

    if (projectId === null) return

    const { error } = await supabase.from('project_members').insert({
      project_id: projectId,
      employee_id: employeeId,
      is_active: true,
    })

    /*
      The same person can be re-added to a project they previously left on the
      same day — UNIQUE(project_id, employee_id, joined_at) treats that as the
      same row. Reactivating it is the correct reading of the intent.
    */
    if (error && (error as { code?: string }).code === '23505') {
      const { error: reviveError } = await supabase
        .from('project_members')
        .update({ is_active: true, left_at: null })
        .eq('employee_id', employeeId)
        .eq('project_id', projectId)
        .eq('joined_at', today)

      if (reviveError) {
        throw toApiError(reviveError, 'Could not update that project assignment.')
      }
      return
    }

    if (error) throw toApiError(error, 'Could not update that project assignment.')
  },

  /** Badge thresholds, in level order. */
  async listBadgeDefinitions(): Promise<BadgeDefinition[]> {
    const { data, error } = await supabase
      .from('badge_definitions')
      .select('*')
      .order('level')

    if (error) throw toApiError(error, 'Could not load badge definitions.')
    return (data ?? []) as BadgeDefinition[]
  },
}
