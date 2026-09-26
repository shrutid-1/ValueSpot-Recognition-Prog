import { useQuery, useMutation } from '@tanstack/react-query'
import { referenceApi } from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Reference data hooks.
 *
 * The whole point is the SHARED key. Before this, the recognition wizard's
 * step 2 and the Core Values, Behaviours and Scenarios admin screens each
 * fetched `core_values` with a different column list — four requests for five
 * rows, none able to reuse another's result. They now read one cached copy.
 *
 * Cached for ten minutes. This is a catalogue: values and behaviours change
 * when somebody deliberately edits them, and the mutations below invalidate
 * exactly the list they touched.
 */
const REFERENCE_STALE_TIME = 10 * 60_000

// ── Core values ─────────────────────────────────────────────

export function useCoreValues(activeOnly = true) {
  return useQuery({
    queryKey: keys.reference.coreValues(activeOnly),
    queryFn: () => referenceApi.listCoreValues({ activeOnly }),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useCreateCoreValue() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createCoreValue,
    onSuccess: () => { void invalidate.coreValues() },
  })
}

export function useUpdateCoreValue() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: {
      id: string
      name?: string
      definition?: string
      accentColor?: string
      icon?: string
      displayOrder?: number
    }) => referenceApi.updateCoreValue(vars.id, vars),
    onSuccess: () => { void invalidate.coreValues() },
  })
}

export function useSetCoreValueActive() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      referenceApi.setCoreValueActive(vars.id, vars.isActive),
    onSuccess: () => {
      void invalidate.coreValues()
      /*
        Archiving a core value changes which behaviours and scenarios can be
        chosen beneath it, so those lists move too — but nothing else does.
        Projects, rewards and departments are untouched.
      */
      void invalidate.behaviours()
      void invalidate.scenarios()
    },
  })
}

// ── Behaviours ──────────────────────────────────────────────

/** Behaviours, optionally for one core value (the wizard's step 3). */
export function useBehaviours(coreValueId?: string, activeOnly = true) {
  return useQuery({
    queryKey: keys.reference.behaviours(coreValueId, activeOnly),
    queryFn: () => referenceApi.listBehaviours({ coreValueId, activeOnly }),
    // Step 3 has no meaning until a core value is chosen in step 2.
    enabled: coreValueId !== undefined ? Boolean(coreValueId) : true,
    staleTime: REFERENCE_STALE_TIME,
  })
}

/** The admin table's shape, with each behaviour's core value resolved. */
export function useBehavioursWithValues() {
  return useQuery({
    queryKey: keys.reference.behavioursWithValues(),
    queryFn: () => referenceApi.listBehavioursWithValues(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useCreateBehaviour() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createBehaviour,
    onSuccess: () => { void invalidate.behaviours() },
  })
}

export function useUpdateBehaviour() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: {
      id: string
      name?: string
      coreValueId?: string
      description?: string | null
      displayOrder?: number
    }) => referenceApi.updateBehaviour(vars.id, vars),
    onSuccess: () => { void invalidate.behaviours() },
  })
}

export function useSetBehaviourActive() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      referenceApi.setBehaviourActive(vars.id, vars.isActive),
    onSuccess: () => {
      void invalidate.behaviours()
      // Scenarios hang off behaviours.
      void invalidate.scenarios()
    },
  })
}

// ── Scenarios ───────────────────────────────────────────────

export function useScenarios(
  filter: { behaviourId?: string; coreValueId?: string; activeOnly?: boolean; enabled?: boolean } = {},
) {
  const activeOnly = filter.activeOnly ?? true
  const key = { behaviourId: filter.behaviourId, coreValueId: filter.coreValueId, activeOnly }

  return useQuery({
    queryKey: keys.reference.scenarios(key),
    queryFn: () => referenceApi.listScenarios(key),
    enabled: filter.enabled ?? true,
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useScenariosWithContext() {
  return useQuery({
    queryKey: keys.reference.scenariosWithContext(),
    queryFn: () => referenceApi.listScenariosWithContext(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useCreateScenario() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createScenario,
    onSuccess: () => { void invalidate.scenarios() },
  })
}

export function useUpdateScenario() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: {
      id: string
      name?: string
      coreValueId?: string
      behaviourId?: string
      description?: string | null
      displayOrder?: number
    }) => referenceApi.updateScenario(vars.id, vars),
    onSuccess: () => { void invalidate.scenarios() },
  })
}

export function useSetScenarioActive() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      referenceApi.setScenarioActive(vars.id, vars.isActive),
    onSuccess: () => { void invalidate.scenarios() },
  })
}

// ── Projects, rewards, departments, badges ──────────────────

export function useProjects(activeOnly = true) {
  return useQuery({
    queryKey: keys.reference.projects(activeOnly),
    queryFn: () => referenceApi.listProjects({ activeOnly }),
    staleTime: REFERENCE_STALE_TIME,
  })
}

/** The admin table's shape, with each project's manager resolved. */
export function useProjectsWithManager() {
  return useQuery({
    queryKey: keys.reference.projectsWithManager(),
    queryFn: () => referenceApi.listProjectsWithManager(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

/**
 * The signed-in manager's own projects, each with its members.
 *
 * Takes no manager id because managed_projects() takes none: the answer is
 * derived from the session, so there is nothing to pass and nothing to key on.
 *
 * No `staleTime` override. The reference default suits catalogues that rarely
 * move; team membership changes the moment HR reassigns somebody, and a
 * manager looking at this page is usually looking BECAUSE something changed.
 */
export function useManagedProjects() {
  return useQuery({
    queryKey: keys.reference.managedProjects(),
    queryFn: () => referenceApi.listManagedProjects(),
  })
}

/** Managers who may run a project. Role 'manager' only — see 029. */
export function useEligibleProjectManagers() {
  return useQuery({
    queryKey: keys.reference.eligibleProjectManagers(),
    queryFn: () => referenceApi.listEligibleProjectManagers(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

/**
 * Projects a recognition may be filed against.
 *
 * Every active project with a usable Project Manager — the recognizer chooses.
 * Deliberately not scoped to the nominee or the viewer: a recognition is about
 * work on a project, and that is frequently not the project either party is
 * nominally assigned to.
 */
export function useSelectableProjects() {
  return useQuery({
    queryKey: keys.reference.selectableProjects(),
    queryFn: () => referenceApi.listSelectableProjects(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

/**
 * The one project an employee is currently on.
 *
 * The recognition wizard asks this about the NOMINEE — the project decides who
 * approves, so it is a property of the person being recognised, not of the
 * person writing.
 */
export function useEmployeeProject(employeeId: string | undefined) {
  return useQuery({
    queryKey: keys.reference.employeeProject(employeeId ?? ''),
    queryFn: () => referenceApi.getEmployeeActiveProject(employeeId!),
    enabled: Boolean(employeeId),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useSetEmployeeProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { employeeId: string; projectId: string | null }) =>
      referenceApi.setEmployeeProject(vars.employeeId, vars.projectId),
    onSuccess: () => {
      void invalidate.employeeProjects()
      // The directory shows the assignment, so the listings move too.
      void invalidate.employeeDirectory()
      /*
        And so does the project catalogue, which did NOT used to be true: the
        Projects table now lists each project's members, so moving somebody
        between projects changes two rows there. Without this, HR would move an
        employee and watch them stay under their old project until a reload.
      */
      void invalidate.projects()
      /*
        And the reports domain, which is the security-relevant one: a Manager's
        report scope IS their projects' membership, so moving somebody in or
        out changes who they may open a report for. The database decides that
        on every request — this only stops a stale picker being shown until the
        next natural refetch.
      */
      void invalidate.reports()
    },
  })
}

export function useCreateProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createProject,
    onSuccess: () => { void invalidate.projects() },
  })
}

export function useUpdateProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: {
      id: string
      name?: string
      description?: string | null
      projectCode?: string | null
      /** Not nullable: an active project must always name a manager. */
      managerId?: string
    }) => referenceApi.updateProject(vars.id, vars),
    onSuccess: () => {
      void invalidate.projects()
      /*
        Changing the Project Manager moves the "manages" marker in the employee
        directory — off the previous manager and onto the new one — so that
        listing is stale until it refetches. Reassignment is exactly the case
        HR needs to see reflected immediately.
      */
      void invalidate.employeeDirectory()
    },
  })
}

export function useSetProjectActive() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      referenceApi.setProjectActive(vars.id, vars.isActive),
    onSuccess: () => { void invalidate.projects() },
  })
}

/**
 * Delete a project permanently.
 *
 * Only ever succeeds for a project nothing references — the foreign keys
 * decide, not this hook. Invalidates the whole projects prefix: the admin
 * table, the active-only lists behind every project dropdown and the
 * wizard's selectable list all lose a row at once.
 */
export function useDeleteProject() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string }) => referenceApi.deleteProject(vars.id),
    onSuccess: () => { void invalidate.projects() },
  })
}

export function useRewards() {
  return useQuery({
    queryKey: keys.reference.rewards(),
    queryFn: () => referenceApi.listRewards(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useCreateReward() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createReward,
    onSuccess: () => { void invalidate.rewards() },
  })
}

export function useUpdateReward() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: {
      id: string
      name?: string
      description?: string | null
      frequency?: string | null
      eligibilityCriteria?: string | null
      valueDescription?: string | null
      requiresApproval?: boolean
    }) => referenceApi.updateReward(vars.id, vars),
    onSuccess: () => { void invalidate.rewards() },
  })
}

/**
 * The Value Store's shelves, in order (062).
 *
 * One cached copy serves the HR form's dropdown, the category manager, the
 * store's shelf tabs and the label on every reward and redemption card.
 */
export function useStoreCategories() {
  return useQuery({
    queryKey: keys.reference.storeCategories(),
    queryFn: () => referenceApi.listStoreCategories(),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useCreateStoreCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createStoreCategory,
    onSuccess: () => { void invalidate.storeCategories() },
  })
}

/** Rename or re-icon a shelf. Rewards point at the slug, so none of them move. */
export function useUpdateStoreCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { slug: string; label?: string; icon?: string }) =>
      referenceApi.updateStoreCategory(vars.slug, vars),
    onSuccess: () => { void invalidate.storeCategories() },
  })
}

export function useReorderStoreCategories() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.reorderStoreCategories,
    // Settled, not success: a reorder that failed half way has still moved
    // one shelf, and the list should show where things really are.
    onSettled: () => { void invalidate.storeCategories() },
  })
}

export function useDeleteStoreCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { slug: string; moveTo: string | null }) =>
      referenceApi.deleteStoreCategory(vars.slug, vars.moveTo),
    onSuccess: () => {
      void invalidate.storeCategories()
      /*
        The rewards that sat on it are on another shelf now, so both the HR
        catalogue and the store's copy of it are stale — as is anybody's
        redemption list, which reads the shelf through the reward.
      */
      void invalidate.rewards()
      void invalidate.store()
    },
  })
}

/**
 * Departments.
 *
 * Reference data, so it lives here rather than with employees — the assignment
 * dropdown on the Employees screen and any future org screen share this one
 * cached copy.
 */
export function useDepartments(activeOnly = true) {
  return useQuery({
    queryKey: keys.reference.departments(activeOnly),
    queryFn: () => referenceApi.listDepartments({ activeOnly }),
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useCreateDepartment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: referenceApi.createDepartment,
    onSuccess: () => { void invalidate.departments() },
  })
}

export function useUpdateDepartment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string; name?: string; description?: string | null }) =>
      referenceApi.updateDepartment(vars.id, vars),
    onSuccess: () => { void invalidate.departments() },
  })
}

/**
 * Headcount for the removal confirmation.
 *
 * `enabled` keeps it from firing until a department is actually up for
 * removal — this is a question the screen asks once, at the moment of the
 * click, not something it keeps warm for every row in the table.
 */
export function useDepartmentMemberCount(departmentId: string | null) {
  return useQuery({
    queryKey: keys.reference.departmentMembers(departmentId ?? ''),
    queryFn: () => referenceApi.countDepartmentMembers(departmentId as string),
    enabled: !!departmentId,
    // Deliberately not cached: the number is shown to justify a destructive
    // click, so a stale one is worse than a brief spinner.
    staleTime: 0,
  })
}

export function useDeleteDepartment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string }) => referenceApi.deleteDepartment(vars.id),
    onSuccess: () => {
      void invalidate.departments()
      /*
        Anyone who was in it now has no department, so every employee listing
        that prints one is stale — including the Employees table, which is the
        screen where that shows up as a dash.
      */
      void invalidate.employeeDirectory()
    },
  })
}

export function useSetDepartmentActive() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      referenceApi.setDepartmentActive(vars.id, vars.isActive),
    onSuccess: () => {
      void invalidate.departments()
      /*
        A department is shown on every employee row, so the directory's
        rendering of it moves too. The employee records themselves do not
        change — only which departments can be assigned.
      */
      void invalidate.employeeDirectory()
    },
  })
}

export function useBadgeDefinitions() {
  return useQuery({
    queryKey: keys.reference.badgeDefinitions(),
    queryFn: () => referenceApi.listBadgeDefinitions(),
    // Thresholds change about never.
    staleTime: 30 * 60_000,
  })
}
