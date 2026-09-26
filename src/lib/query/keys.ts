import type { EmployeeQuery, MyRecognitionsTab, PrivilegedRole } from '@/lib/api'

/**
 * Every query key in the application, in one place.
 *
 * Centralised so invalidation can be precise. A mutation needs to say "the
 * employee directory changed" without knowing which search terms or page sizes
 * happen to be cached, and it can only do that if the keys share a documented
 * prefix. Scattering `['employees', something]` through components makes that
 * impossible to do safely — you end up invalidating everything because you
 * cannot prove what exists.
 *
 * The shape is prefix-first, narrowing left to right:
 *
 *   ['employees']                          everything in the domain
 *   ['employees', 'list']                  every directory listing
 *   ['employees', 'list', { search: 'a' }] one specific listing
 *
 * React Query matches by prefix, so invalidating `employees.lists()` clears
 * every search variant while leaving `employees.invitationStatus()` — which that
 * mutation did not affect — untouched.
 */
export const keys = {
  employees: {
    all: ['employees'] as const,
    lists: () => [...keys.employees.all, 'list'] as const,
    list: (query: EmployeeQuery) => [...keys.employees.lists(), query] as const,
    // Departments used to live here too. They are reference data, so Phase 5
    // moved them to keys.reference.departments — where the wizard and the org
    // screens share one cached copy. Nothing referenced this builder after
    // that move, so it is gone rather than left as a second spelling.
    invitationStatus: (id: string) =>
      [...keys.employees.all, 'invitation-status', id] as const,
  },

  /*
    Reference data — the catalogue.

    These keys are the point of the whole module: `core_values` was fetched in
    four places and `behaviours` in three, each with a different column list, so
    nothing could share a cache. One key per logical list means the recognition
    wizard and the HR admin screens now read the SAME cached copy.
  */
  reference: {
    all: ['reference'] as const,

    coreValues: (activeOnly: boolean) =>
      [...keys.reference.all, 'core-values', { activeOnly }] as const,
    coreValuesPrefix: () => [...keys.reference.all, 'core-values'] as const,

    behaviours: (coreValueId: string | undefined, activeOnly: boolean) =>
      [...keys.reference.all, 'behaviours', { coreValueId, activeOnly }] as const,
    behavioursWithValues: () =>
      [...keys.reference.all, 'behaviours', 'with-values'] as const,
    behavioursPrefix: () => [...keys.reference.all, 'behaviours'] as const,

    scenarios: (
      filter: { behaviourId?: string; coreValueId?: string; activeOnly: boolean },
    ) => [...keys.reference.all, 'scenarios', filter] as const,
    scenariosWithContext: () =>
      [...keys.reference.all, 'scenarios', 'with-context'] as const,
    scenariosPrefix: () => [...keys.reference.all, 'scenarios'] as const,

    projects: (activeOnly: boolean) =>
      [...keys.reference.all, 'projects', { activeOnly }] as const,
    projectsWithManager: () =>
      [...keys.reference.all, 'projects', 'with-manager'] as const,
    projectsPrefix: () => [...keys.reference.all, 'projects'] as const,

    /**
     * The calling manager's own projects, with members (040).
     *
     * Under the `projects` prefix on purpose: every invalidation that already
     * fires when a project or an assignment changes — including HR moving
     * somebody between projects, or reassigning a Project Manager — reaches
     * this without a second invalidator to keep in step.
     *
     * Not keyed by manager id: the RPC takes no arguments and answers for
     * whoever is signed in, so an id in the key would describe something the
     * request does not contain.
     */
    managedProjects: () =>
      [...keys.reference.all, 'projects', 'managed'] as const,

    /** Active projects with a usable manager — the recognition selector (030). */
    selectableProjects: () =>
      [...keys.reference.all, 'projects', 'selectable'] as const,
    /** Managers eligible to run a project — role 'manager' only (029). */
    eligibleProjectManagers: () =>
      [...keys.reference.all, 'projects', 'eligible-managers'] as const,
    /** One employee's current project assignment (MVP: at most one). */
    employeeProject: (employeeId: string) =>
      [...keys.reference.all, 'employee-project', employeeId] as const,
    employeeProjectPrefix: () => [...keys.reference.all, 'employee-project'] as const,

    rewards: () => [...keys.reference.all, 'rewards'] as const,
    rewardsPrefix: () => [...keys.reference.all, 'rewards'] as const,
    departments: (activeOnly: boolean) =>
      [...keys.reference.all, 'departments', { activeOnly }] as const,
    departmentsPrefix: () => [...keys.reference.all, 'departments'] as const,
    /*
      Headcount for one department, asked only when it is up for removal.
      Sits UNDER the departments prefix on purpose, so invalidating departments
      after a removal drops this with it.
    */
    departmentMembers: (departmentId: string) =>
      [...keys.reference.all, 'departments', 'members', departmentId] as const,
    badgeDefinitions: () => [...keys.reference.all, 'badge-definitions'] as const,
  },

  /*
    Recognition correction requests.

    One domain for both audiences — the employee's own list and the shared
    admin queue are the same rows read through different policies, so they
    share a prefix and one invalidation clears both. Two prefixes would let an
    administrator's queue go stale after an employee filed a request.
  */
  support: {
    all: ['support'] as const,
    mine: () => [...keys.support.all, 'mine'] as const,
    queue: (status: string) => [...keys.support.all, 'queue', status] as const,
    queuePrefix: () => [...keys.support.all, 'queue'] as const,
  },

  recognitions: {
    all: ['recognitions'] as const,
    /** One person's given/received lists. */
    mine: (employeeId: string, tab: MyRecognitionsTab) =>
      [...keys.recognitions.all, 'mine', employeeId, tab] as const,
    minePrefix: (employeeId: string) =>
      [...keys.recognitions.all, 'mine', employeeId] as const,
    /**
     * The company feed. Keyed by viewer because each page carries that
     * person's own appreciations alongside the rows.
     */
    /*
      The sort and the value filter are PART OF THE KEY, because they are part
      of the request: the database returns different rows for each
      combination. Leaving them out would serve the newest-first pages from
      cache under a "most appreciated" heading.
    */
    feed: (employeeId: string, sort = 'recent', coreValueId: string | null = null) =>
      [...keys.recognitions.all, 'feed', employeeId, sort, coreValueId ?? 'all'] as const,
    feedPrefix: () => [...keys.recognitions.all, 'feed'] as const,
    /*
      The approval queue.

      ONE key, not one per approver. It used to be keyed by approver id because
      the query took one; since migration 042 the queue is scoped inside the
      database from the session, so there is no id to key on — and a second
      person's queue is a second browser, never a second entry in this cache.
    */
    approvalQueue: () => [...keys.recognitions.all, 'approval-queue'] as const,
    /** One manager's team list — the members of the projects they run. */
    team: (managerId: string) =>
      [...keys.recognitions.all, 'team', managerId] as const,
    teamPrefix: () => [...keys.recognitions.all, 'team'] as const,
  },

  wallet: {
    all: ['wallet'] as const,
    /** One person's balance. Keyed by employee: it is never shared. */
    balance: (employeeId: string) => [...keys.wallet.all, 'balance', employeeId] as const,
    balancePrefix: () => [...keys.wallet.all, 'balance'] as const,
    /** The whole wallet screen's figures, in one query. */
    summary: (employeeId: string) => [...keys.wallet.all, 'summary', employeeId] as const,
    summaryPrefix: () => [...keys.wallet.all, 'summary'] as const,
    /*
      Activity, per filter.

      The filter is part of the key because it is part of the REQUEST — the
      database returns different rows for each. Leaving it out would serve
      the whole ledger under a "Coins received" heading.
    */
    activity: (employeeId: string, filter: string, limit: number) =>
      [...keys.wallet.all, 'activity', employeeId, filter, limit] as const,
    activityPrefix: () => [...keys.wallet.all, 'activity'] as const,
  },

  store: {
    all: ['store'] as const,
    /** The catalogue. One list for everybody, so no viewer in the key. */
    rewards: () => [...keys.store.all, 'rewards'] as const,
    /** One person's own redemptions. */
    myRedemptions: (employeeId: string) =>
      [...keys.store.all, 'mine', employeeId] as const,
    myRedemptionsPrefix: () => [...keys.store.all, 'mine'] as const,
    /*
      The HR queue, per status. The status is part of the REQUEST — the
      database filters on it — so leaving it out would serve the pending
      rows under an "Approved" heading.
    */
    requests: (status: string) => [...keys.store.all, 'requests', status] as const,
    requestsPrefix: () => [...keys.store.all, 'requests'] as const,
  },

  coinAdmin: {
    all: ['coin-admin'] as const,
    /** The organisation-wide Value Coin policy. */
    policy: () => [...keys.coinAdmin.all, 'policy'] as const,
    /*
      Employee wallets, per search term — the term is part of the REQUEST,
      since the database filters, so leaving it out would serve one search's
      results under another's heading.
    */
    wallets: (search: string) => [...keys.coinAdmin.all, 'wallets', search] as const,
    walletsPrefix: () => [...keys.coinAdmin.all, 'wallets'] as const,
  },

  comments: {
    all: ['comments'] as const,
    /**
     * One recognition's conversation.
     *
     * Keyed by the VIEWER as well as the post, because the thread carries
     * `likedIds` — which of these comments you liked. Two people looking at
     * the same conversation are looking at two different answers to that, and
     * one key would serve the first person's likes to the second.
     */
    thread: (nominationId: string, viewerId: string) =>
      [...keys.comments.all, 'thread', nominationId, viewerId] as const,
    threadPrefix: () => [...keys.comments.all, 'thread'] as const,
  },

  admin: {
    all: ['admin'] as const,
    roleHolders: (role: PrivilegedRole) =>
      [...keys.admin.all, 'role-holders', role] as const,
    roleHoldersPrefix: () => [...keys.admin.all, 'role-holders'] as const,
    candidates: (role: PrivilegedRole) =>
      [...keys.admin.all, 'candidates', role] as const,
    candidatesPrefix: () => [...keys.admin.all, 'candidates'] as const,
    signupDomains: () => [...keys.admin.all, 'signup-domains'] as const,
    securityActivity: (limit: number) =>
      [...keys.admin.all, 'security-activity', limit] as const,
    securityActivityPrefix: () => [...keys.admin.all, 'security-activity'] as const,
  },

  settings: {
    all: ['settings'] as const,
    config: (configKeys: readonly string[]) =>
      [...keys.settings.all, 'config', configKeys] as const,
    configPrefix: () => [...keys.settings.all, 'config'] as const,
  },

  audit: {
    all: ['audit'] as const,
    /** One filtered view of the trail; pages live under it. */
    log: (action: string) => [...keys.audit.all, 'log', action] as const,
    logPrefix: () => [...keys.audit.all, 'log'] as const,
  },

  analytics: {
    all: ['analytics'] as const,
    /**
     * Keyed by the IST date so "today's leaders" rolls over at midnight rather
     * than serving yesterday from cache. One key for the whole dashboard,
     * because analyticsApi aggregates it into one request wave — splitting it
     * into eight query keys would undo that.
     */
    hrDashboard: (today: string) =>
      [...keys.analytics.all, 'hr-dashboard', today] as const,

    /**
     * The per-core-value leader board for one period.
     *
     * The core value ids are part of the key because they are part of the
     * answer: archive or add a value and the board has different sections,
     * even though the dates did not move.
     */
    coreValueLeaders: (start: string, end: string, valueIds: readonly string[]) =>
      [...keys.analytics.all, 'core-value-leaders', { start, end, valueIds }] as const,

    /** One employee's own dashboard. Keyed by month, so it rolls over. */
    employeeDashboard: (employeeId: string, month: string) =>
      [...keys.analytics.all, 'employee-dashboard', employeeId, month] as const,

    /** One employee's progress against every core value. */
    coreValueJourney: (employeeId: string) =>
      [...keys.analytics.all, 'core-value-journey', employeeId] as const,

    managerDashboard: (managerId: string) =>
      [...keys.analytics.all, 'manager-dashboard', managerId] as const,

    teamBadges: (managerId: string) =>
      [...keys.analytics.all, 'team-badges', managerId] as const,

    badgeDistribution: (periodStart: string) =>
      [...keys.analytics.all, 'badge-distribution', periodStart] as const,
  },

  /*
    Reports.

    Keyed by everything that changes the answer and nothing that does not. The
    period BOUNDS are in the key rather than the period type, because "monthly"
    is not an answer — September is. The caller's own scope is deliberately NOT
    in the key: the database decides it from the session, and two different
    people are two different browsers, never two entries in one cache.
  */
  reports: {
    all: ['reports'] as const,

    /** The employee picker, per search term. */
    subjects: (search: string) => [...keys.reports.all, 'subjects', search] as const,
    subjectsPrefix: () => [...keys.reports.all, 'subjects'] as const,

    /** The eight filters' dropdown contents, scoped by the session. */
    filterOptions: () => [...keys.reports.all, 'filter-options'] as const,

    /**
     * Filters are part of the key: they change the answer. Callers pass them
     * through compactFilters(), so "no project filter" is one key however the
     * page happened to spell it.
     */
    employee: (employeeId: string, start: string, end: string, filters: object = {}) =>
      [...keys.reports.all, 'employee', employeeId, { start, end, filters }] as const,
    employeePrefix: () => [...keys.reports.all, 'employee'] as const,

    organization: (start: string, end: string) =>
      [...keys.reports.all, 'organization', { start, end }] as const,
    organizationPrefix: () => [...keys.reports.all, 'organization'] as const,

    /** The consolidated report — the organisation, or a Manager's team. */
    scoped: (start: string, end: string, filters: object) =>
      [...keys.reports.all, 'scoped', { start, end, filters }] as const,

    /**
     * AI insights, under their own prefix.
     *
     * Separate from the factual report on purpose: approving a recognition
     * should refetch the report, and the insight follows only because the facts
     * it was generated from now hash differently. Keeping them in one key would
     * make every report refresh an AI call.
     */
    insights: (scope: string, subjectId: string, start: string, end: string) =>
      [...keys.reports.all, 'insights', scope, subjectId, { start, end }] as const,
    insightsPrefix: () => [...keys.reports.all, 'insights'] as const,
  },
} as const
