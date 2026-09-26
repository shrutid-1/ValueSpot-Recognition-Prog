/**
 * Analytics — the aggregate numbers behind the dashboards.
 *
 * This is where request aggregation belongs. Screens ask one question
 * ("give me the HR dashboard") and the layer decides how many queries that
 * takes and runs them together, rather than each component discovering
 * parallelism for itself.
 *
 * Every read is governed by the same RLS that governed it before. The monthly
 * trend goes through recognition_monthly_trend() (migration 028), which is
 * SECURITY INVOKER precisely so that remains true.
 */
import type {
  RecognitionFeedItem, CoreValue, BadgeDefinition, BadgeSummary,
} from '@/types'
import { supabase, toApiError, fetchAllRows, ApiError } from './client'
import { formatIST } from '@/lib/date-utils'
import { tallyByCoreValue, topOf, type LeaderTally } from './leader-board'
import { employeesApi, teamRecognitionFilter } from './employees'

export interface CoreValueDistribution {
  name: string
  slug: string
  color: string
  count: number
}

export interface TrendPoint {
  month: string
  count: number
}

/** One day of the week band on the dashboard. `date` is an IST calendar day. */
export interface DailyPoint {
  /** yyyy-MM-dd, in the display timezone. */
  date: string
  count: number
}

export interface DailyLeader {
  core_value_name: string
  employee_name: string
  count: number
}

export interface HrDashboard {
  totalRecognitions: number
  employeesRecognized: number
  activeEmployees: number
  pendingApprovals: number
  mostRecognizedValue: string | null
  crossTeamCount: number
  crossTeamPct: number
  coverage: number
  coreValueDistribution: CoreValueDistribution[]
  /** The last seven IST days, oldest first. Always seven entries. */
  daily: DailyPoint[]
  trend: TrendPoint[]
  dailyLeaders: DailyLeader[]
  recentFeed: RecognitionFeedItem[]
}

interface CoreValueRef { name: string; slug: string; accent_color: string }

/** One recognition leader for a core value over a period. */
export interface Leader {
  employee_id: string
  employee_name: string
  avatar_url: string | null
  recognition_count: number
  unique_recognizer_count: number
  badge_level: number | null
  /** True when more than one person tied for the top position. */
  is_joint: boolean
}

export interface CoreValueLeaders {
  core_value_id: string
  core_value_name: string
  slug: string
  leaders: Leader[]
  /** Approved recognitions in this value over the period, to anyone. */
  total_recognitions: number
  /** Distinct people who received them. */
  people_recognized: number
}

/** The core values the leader board is computed over, in display order. */
export type LeaderBoardValue = Pick<CoreValue, 'id' | 'name' | 'slug'>

/** A core value as the badge screens need it — name, slug and styling. */
export type JourneyValue = Pick<
  CoreValue, 'id' | 'name' | 'slug' | 'accent_color' | 'icon'
>

export interface EmployeeDashboard {
  received: number
  given: number
  thisMonth: number
  mostRecognizedValue: string | null
  badges: BadgeSummary[]
  recentFeed: RecognitionFeedItem[]
  /**
   * Recognitions RECEIVED in each month of the annual period, index 0 being
   * the month the period opens in. Always twelve entries, zeros included —
   * a month with nothing in it is part of the shape of somebody's year.
   */
  monthlyReceived: number[]
  /** The same twelve months, for recognitions this person GAVE. */
  monthlyGiven: number[]
}

export interface ManagerDashboard {
  pending: number
  teamMembers: number
  teamRecognitions: number
}

/** One person's standing in one core value, this annual period. */
export interface TeamBadgeStanding {
  core_value_id: string
  /** Null until the first threshold is reached. */
  badge_level: number | null
  badge_name: string | null
  recognition_count: number
  unique_recognizer_count: number
  /** Recognitions needed for the next level; null at the top level. */
  next_level_at: number | null
}

export interface TeamBadgeMember {
  id: string
  full_name: string
  employee_id: string
  email: string
  designation: string | null
  avatar_url: string | null
  department: string | null
  projects: Array<{ id: string; name: string }>
  /** Only the values they have been recognised for; empty for nobody yet. */
  badges: TeamBadgeStanding[]
}

/** Shape of team_badges() (061). */
export interface TeamBadges {
  /** 'team' for a Manager; 'organization' for HR and Super Admin. */
  scope: 'team' | 'organization'
  period: { start: string; end: string }
  core_values: Array<{ id: string; name: string; slug: string; accent_color: string | null }>
  levels: Array<{ level: number; name: string; minimum_count: number; maximum_count: number | null }>
  members: TeamBadgeMember[]
}

export interface BadgeDistribution {
  core_value_name: string
  slug: string
  b1: number; b2: number; b3: number; b4: number; b5: number
}

export interface BadgeDistributionSummary {
  /** Distinct people holding at least one badge, in any value. */
  employees_with_badge: number
  /** Badges held — one per employee per value, so a person can hold several. */
  badges_held: number
  b1: number; b2: number; b3: number; b4: number; b5: number
}

/** The raw badge row both badge screens read. */
interface BadgeRow {
  core_value_id: string
  badge_level: number | null
  recognition_count: number
  unique_recognizer_count: number
  period_start: string
  period_end: string
}

export const analyticsApi = {
  /**
   * Everything the HR dashboard shows, in one wave.
   *
   * Eight requests issued together rather than in three sequential rounds —
   * the page waits for the slowest, not the sum. The trend in particular was
   * twelve sequential queries before migration 028 gave it a single aggregate.
   */
  async getHrDashboard(today: string): Promise<HrDashboard> {
    const [
      totalRes, recipientsRes, activeRes, pendingRes,
      valuesRes, feedRes, trendRes, todayRes,
    ] = await Promise.all([
      supabase.from('nominations').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      // Paged (fetchAllRows): every approved recognition, which passes the
      // server's 1000-row response cap long before the dashboard is retired.
      fetchAllRows((from, to) => supabase.from('nominations').select('nominee_id')
        .eq('status', 'approved').order('id').range(from, to)),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('nominations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      /*
        One scan of the approved nominations answers three questions: the
        distribution across Core Values, how much recognition crossed a
        department boundary, and the shape of the last seven days.
        `approved_at` is selected for the third — a separate query for a
        seven-day count would be a second pass over rows already in hand.
      */
      fetchAllRows((from, to) => supabase.from('nominations')
        .select('core_value_id, approved_at, core_values:core_value_id(name, slug, accent_color), snapshot_nominator_dept, snapshot_nominee_dept')
        .eq('status', 'approved')
        .order('id')
        .range(from, to)),
      supabase.from('v_recognition_feed').select('*').order('approved_at', { ascending: false }).limit(6),
      supabase.rpc('recognition_monthly_trend', { p_months: 12 }),
      supabase.from('nominations')
        .select('nominee_id, core_value_id, nominee:nominee_id(full_name), core_values:core_value_id(name)')
        .eq('status', 'approved')
        .gte('approved_at', `${today}T00:00:00+00:00`)
        .lte('approved_at', `${today}T23:59:59+00:00`),
    ])

    const firstError = [totalRes, activeRes, pendingRes, valuesRes, feedRes].find(r => r.error)?.error
    if (firstError) throw toApiError(firstError, 'Could not load the dashboard.')

    const total = totalRes.count ?? 0
    const activeEmployees = activeRes.count ?? 0
    const employeesRecognized = new Set((recipientsRes.data ?? []).map(n => n.nominee_id)).size

    const valueRows = valuesRes.data ?? []

    const crossTeamCount = valueRows.filter(n =>
      n.snapshot_nominator_dept &&
      n.snapshot_nominee_dept &&
      n.snapshot_nominator_dept !== n.snapshot_nominee_dept,
    ).length

    const byValue: Record<string, CoreValueDistribution> = {}
    for (const row of valueRows) {
      const cv = row.core_values as CoreValueRef | null
      if (!cv) continue
      byValue[cv.name] ??= { name: cv.name, slug: cv.slug, color: cv.accent_color, count: 0 }
      byValue[cv.name].count++
    }
    const coreValueDistribution = Object.values(byValue)

    /*
      The week, bucketed in the DISPLAY timezone.

      Bucketing on the raw UTC timestamp would push anything approved in the
      first few hours of an IST morning into the previous day — the same
      correction recognition_monthly_trend() makes for months. The seven keys
      are built by UTC calendar arithmetic on today's IST date, so no local
      clock or daylight rule can shift them.
    */
    const [ty, tm, td] = today.split('-').map(Number)
    const byDay = new Map<string, number>()
    for (const row of valueRows) {
      if (!row.approved_at) continue
      const key = formatIST(row.approved_at, 'yyyy-MM-dd')
      byDay.set(key, (byDay.get(key) ?? 0) + 1)
    }

    const daily: DailyPoint[] = []
    for (let i = 6; i >= 0; i--) {
      const key = new Date(Date.UTC(ty, tm - 1, td - i)).toISOString().slice(0, 10)
      daily.push({ date: key, count: byDay.get(key) ?? 0 })
    }

    return {
      totalRecognitions: total,
      employeesRecognized,
      activeEmployees,
      pendingApprovals: pendingRes.count ?? 0,
      mostRecognizedValue: [...coreValueDistribution].sort((a, b) => b.count - a.count)[0]?.name ?? null,
      crossTeamCount,
      crossTeamPct: total > 0 ? Math.round((crossTeamCount / total) * 100) : 0,
      coverage: activeEmployees > 0 ? Math.round((employeesRecognized / activeEmployees) * 100) : 0,
      coreValueDistribution,
      daily,
      trend: (trendRes.data as TrendPoint[] | null) ?? [],
      dailyLeaders: topPerValue(todayRes.data ?? []),
      recentFeed: (feedRes.data ?? []) as RecognitionFeedItem[],
    }
  },

  /**
   * Who leads each core value over a period.
   *
   * This replaces a loop. The screen used to issue, for each core value in
   * turn, one nominations query, one employees query and one badges query —
   * `1 + 3N` requests, awaited one after another, so five core values meant
   * sixteen sequential round trips every time the period changed.
   *
   * It is now one nominations query for the whole period, then employees and
   * badges for the winners together: three requests in two rounds, regardless
   * of how many core values exist. The grouping and the tie-breaking are
   * unchanged — they moved from the loop into a single pass, and the core
   * values themselves come from the caller's cache rather than a fresh fetch.
   */
  async getCoreValueLeaders(input: {
    /** Inclusive date bounds, `yyyy-MM-dd`. */
    start: string
    end: string
    coreValues: LeaderBoardValue[]
  }): Promise<CoreValueLeaders[]> {
    const { start, end, coreValues } = input
    if (coreValues.length === 0) return []

    // Paged: a year of approvals passes the server's 1000-row response cap.
    const { data: nominations, error } = await fetchAllRows((from, to) => supabase
      .from('nominations')
      .select('nominee_id, nominator_id, core_value_id')
      .eq('status', 'approved')
      .gte('approved_at', `${start}T00:00:00Z`)
      .lte('approved_at', `${end}T23:59:59Z`)
      .order('id')
      .range(from, to))

    if (error) throw toApiError(error, 'Could not load recognition leaders.')

    // Grouping and tie-breaking live in leader-board.ts, unchanged from the
    // loop this replaced and verified against it directly.
    const byValue = tallyByCoreValue(nominations ?? [])

    // Work out each value's winners before fetching anything about them.
    const winnersByValue = new Map<string, Array<[string, LeaderTally]>>()
    for (const cv of coreValues) {
      winnersByValue.set(cv.id, topOf(byValue.get(cv.id)))
    }

    const winnerIds = [
      ...new Set([...winnersByValue.values()].flat().map(([id]) => id)),
    ]

    // The whole field, not just the winners: "1 recognition" means little
    // without knowing whether the value had 1 or 40 in the period.
    const totals = (cvId: string) => {
      const people = byValue.get(cvId)
      let count = 0
      for (const t of people?.values() ?? []) count += t.count
      return { total_recognitions: count, people_recognized: people?.size ?? 0 }
    }

    if (winnerIds.length === 0) {
      return coreValues.map(cv => ({
        core_value_id: cv.id,
        core_value_name: cv.name,
        slug: cv.slug,
        leaders: [],
        ...totals(cv.id),
      }))
    }

    // One round for both, rather than two per core value.
    const [employeesRes, badgesRes] = await Promise.all([
      supabase.from('employees').select('id, full_name, avatar_url').in('id', winnerIds),
      // The badge year the period ends in. Without this bound every year's
      // row came back and whichever arrived last won the map below.
      supabase
        .from('employee_value_badges')
        .select('employee_id, badge_level, core_value_id')
        .in('employee_id', winnerIds)
        .eq('period_type', 'annual')
        .lte('period_start', end)
        .gte('period_end', end),
    ])

    const enrichmentError = employeesRes.error ?? badgesRes.error
    if (enrichmentError) {
      throw toApiError(enrichmentError, 'Could not load recognition leaders.')
    }

    const employees = new Map(
      (employeesRes.data ?? []).map(e => [e.id, e]),
    )
    // Badges are per person AND per value, so the key has to carry both.
    const badges = new Map(
      (badgesRes.data ?? []).map(b => [`${b.employee_id}:${b.core_value_id}`, b.badge_level]),
    )

    return coreValues.map(cv => {
      const winners = winnersByValue.get(cv.id) ?? []
      const isJoint = winners.length > 1

      return {
        core_value_id: cv.id,
        core_value_name: cv.name,
        slug: cv.slug,
        leaders: winners.map(([id, tally]) => {
          const employee = employees.get(id)
          return {
            employee_id: id,
            // The id as a fallback name is deliberate and pre-existing: it
            // shows that someone won even if their row is not readable.
            employee_name: employee?.full_name ?? id,
            avatar_url: employee?.avatar_url ?? null,
            recognition_count: tally.count,
            unique_recognizer_count: tally.recognizers.size,
            badge_level: badges.get(`${id}:${cv.id}`) ?? null,
            is_joint: isJoint,
          }
        }),
        ...totals(cv.id),
      }
    })
  },

  /**
   * The employee's own dashboard, in one wave.
   *
   * Five requests issued together. The badge thresholds used to be a sixth,
   * fetched only after the wave resolved — they now come from the caller's
   * cache, so the page waits for one round instead of two. The core values
   * arrive the same way, and for the same reason.
   *
   * Returns a row for EVERY core value, not only the ones with a badge row.
   *
   * It previously returned only what `employee_value_badges` held, which is
   * written on first approval — so somebody with no recognition yet got an
   * empty array, and the dashboard section that should have shown them the
   * whole journey ahead disappeared instead. A value nobody has been
   * recognised for is a real, informative zero; it is not absence of data.
   * getCoreValueJourney() has always worked this way, and the two screens
   * now agree.
   */
  async getEmployeeDashboard(input: {
    employeeId: string
    /** ISO timestamp for the first day of the current month. */
    monthStart: string
    /** The catalogue, in display order — from the caller's reference cache. */
    coreValues: JourneyValue[]
    badgeDefinitions: BadgeDefinition[]
    /** The annual period, used when a value has no badge row yet. */
    periodStart: string
    periodEnd: string
  }): Promise<EmployeeDashboard> {
    const {
      employeeId, monthStart, coreValues, badgeDefinitions, periodStart, periodEnd,
    } = input

    const [
      receivedRes, givenRes, monthRes, badgeRes, feedRes, yearRes, yearGivenRes,
    ] = await Promise.all([
      supabase.from('nominations').select('id', { count: 'exact', head: true })
        .eq('nominee_id', employeeId).eq('status', 'approved'),
      supabase.from('nominations').select('id', { count: 'exact', head: true })
        .eq('nominator_id', employeeId).eq('status', 'approved'),
      supabase.from('nominations').select('id', { count: 'exact', head: true })
        .eq('nominee_id', employeeId).eq('status', 'approved').gte('approved_at', monthStart),
      /*
        No join on core_values any more: the catalogue comes from the caller's
        reference cache, and the rows are matched to it by id below. One less
        thing for PostgREST to embed, and the same list the journey screen
        renders.
      */
      supabase.from('employee_value_badges')
        .select('core_value_id, recognition_count, unique_recognizer_count, badge_level, period_start, period_end')
        .eq('employee_id', employeeId).eq('period_type', 'annual'),
      /*
        Both sides of the employee's own feed. The interpolated value is their
        id from the session, not anything they typed — unlike the search
        filters, which are quoted through ilikeAnyFilter for that reason.
      */
      supabase.from('v_recognition_feed').select('*')
        .or(`nominator_id.eq.${employeeId},nominee_id.eq.${employeeId}`)
        .order('approved_at', { ascending: false }).limit(8),

      /*
        Approval dates for the period — the two series behind the year panel
        and the sparkline: what this person received, and what they gave.

        Only the timestamp column, and both join the wave that was already
        being issued rather than adding round trips. Bucketed below instead
        of by twenty-four COUNT queries, which is the N+1 this shape avoids.
      */
      supabase.from('nominations').select('approved_at')
        .eq('nominee_id', employeeId).eq('status', 'approved')
        .gte('approved_at', periodStart)
        .lte('approved_at', `${periodEnd}T23:59:59.999Z`),

      supabase.from('nominations').select('approved_at')
        .eq('nominator_id', employeeId).eq('status', 'approved')
        .gte('approved_at', periodStart)
        .lte('approved_at', `${periodEnd}T23:59:59.999Z`),
    ])

    const firstError =
      [receivedRes, givenRes, monthRes, badgeRes, feedRes, yearRes, yearGivenRes]
        .find(r => r.error)?.error
    if (firstError) throw toApiError(firstError, 'Could not load your dashboard.')

    const byValue = new Map(
      (badgeRes.data ?? []).map(b => [b.core_value_id, b as BadgeRow]),
    )

    // Every core value appears, whether or not it has been earned yet.
    const badges = coreValues.map(cv =>
      toBadgeSummary(byValue.get(cv.id), cv, badgeDefinitions, {
        start: periodStart,
        end: periodEnd,
      }),
    )

    /*
      Which value this person is recognised for most.

      Zero-count values are excluded rather than sorted. Now that every value
      is present, taking the top of the sorted list would name an arbitrary
      one for somebody who has never been recognised at all — a fact the data
      does not support. No recognition means no most-recognised value.
    */
    const topValue = badges
      .filter(b => b.recognition_count > 0)
      .sort((a, b) => b.recognition_count - a.recognition_count)[0]

    /*
      Bucket the approvals into the twelve months of the period. The period
      does not necessarily open in January — badge_period_start_month is
      configurable — so the offset is measured from the period's own start
      rather than from the calendar year.
    */
    const periodStartDate = new Date(periodStart)

    const bucketByMonth = (rows: { approved_at: string | null }[] | null): number[] => {
      const months = Array<number>(12).fill(0)
      for (const row of rows ?? []) {
        if (!row.approved_at) continue
        const at = new Date(row.approved_at)
        const offset =
          (at.getFullYear() - periodStartDate.getFullYear()) * 12 +
          (at.getMonth() - periodStartDate.getMonth())
        if (offset >= 0 && offset < 12) months[offset] += 1
      }
      return months
    }

    const monthlyReceived = bucketByMonth(yearRes.data)
    const monthlyGiven = bucketByMonth(yearGivenRes.data)

    return {
      received: receivedRes.count ?? 0,
      given: givenRes.count ?? 0,
      thisMonth: monthRes.count ?? 0,
      mostRecognizedValue: topValue?.core_value_name ?? null,
      badges,
      recentFeed: (feedRes.data ?? []) as RecognitionFeedItem[],
      monthlyReceived,
      monthlyGiven,
    }
  },

  /**
   * Every core value with this employee's progress against it.
   *
   * One request. The core values and badge thresholds are both reference data
   * the caller already has cached — this screen used to fetch all three.
   */
  async getCoreValueJourney(input: {
    employeeId: string
    coreValues: JourneyValue[]
    badgeDefinitions: BadgeDefinition[]
    /** The annual period, used when a value has no badge row yet. */
    periodStart: string
    periodEnd: string
  }): Promise<BadgeSummary[]> {
    const { employeeId, coreValues, badgeDefinitions, periodStart, periodEnd } = input

    const { data, error } = await supabase
      .from('employee_value_badges')
      .select('core_value_id, badge_level, recognition_count, unique_recognizer_count, period_start, period_end')
      .eq('employee_id', employeeId)
      .eq('period_type', 'annual')

    if (error) throw toApiError(error, 'Could not load your Core Value journey.')

    const byValue = new Map((data ?? []).map(b => [b.core_value_id, b as BadgeRow]))

    // Every core value appears, whether or not it has been earned yet.
    return coreValues.map(cv =>
      toBadgeSummary(byValue.get(cv.id), cv, badgeDefinitions, {
        start: periodStart,
        end: periodEnd,
      }),
    )
  },

  /**
   * The manager's headline numbers.
   *
   * The team roster was previously fetched twice — once for a count and once
   * for the ids — across three sequential rounds. It is now fetched once,
   * alongside the pending count, and its length IS the team size.
   */
  async getManagerDashboard(managerId: string): Promise<ManagerDashboard> {
    /*
      The team is now the people on the projects this manager runs, not the
      people whose employees.manager_id pointed at them — that line-manager
      relationship left the employee model in migration 030.

      The pending count is unaffected: it has always counted what is assigned
      to this approver, and the project routing feeds exactly that column.
    */
    const [pendingRes, scope] = await Promise.all([
      supabase.from('nominations').select('id', { count: 'exact', head: true })
        .eq('assigned_approver_id', managerId).eq('status', 'pending'),
      employeesApi.getTeamScope(managerId),
    ])

    if (pendingRes.error) {
      throw toApiError(pendingRes.error, 'Could not load your dashboard.')
    }

    /*
      Counted the way the Team Recognition list is built: received by a
      member, OR filed against one of this manager's projects. Counting
      members alone left out recognitions filed against their project for
      someone not on it — ones this manager approved themselves.

      Read from v_recognition_feed, as the list is, not from `nominations`: a
      manager's policy on nominations only shows what was ASSIGNED to them,
      so a member's recognition routed to another project's manager was
      invisible here and the count came up short. The view is approved-only
      and readable by every signed-in session (022), so it counts everything
      the list can show.
    */
    let teamRecognitions = 0
    const filter = teamRecognitionFilter(scope)
    if (filter) {
      const { count, error } = await supabase
        .from('v_recognition_feed').select('id', { count: 'exact', head: true })
        .or(filter)

      if (error) throw toApiError(error, 'Could not load your dashboard.')
      teamRecognitions = count ?? 0
    }

    return {
      pending: pendingRes.count ?? 0,
      teamMembers: scope.memberIds.length,
      teamRecognitions,
    }
  },

  /**
   * Current badge standing for everyone in the caller's scope.
   *
   * ONE call to team_badges() (061). This used to be three browser queries —
   * projects, members, then employee_value_badges under evb_read_team — and
   * the last one tested the role claim frozen into the access token. A token
   * issued before someone became a Manager carried 'employee', the policy
   * filtered every row away, and the page said "No badges yet" with no error.
   * The function reads the caller's role from `employees` instead, and returns
   * only the current annual period, every member included.
   *
   * No manager id is passed: the scope comes from the session.
   */
  async getTeamBadges(): Promise<TeamBadges> {
    const { data, error } = await (supabase.rpc as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: unknown }>)('team_badges')

    if (error) throw toApiError(error, 'Could not load team badges.')

    const result = data as ({ status?: string } & TeamBadges) | null
    if (result?.status !== 'ok') {
      throw new ApiError('Team badges are available to Managers, HR and Super Admins.', result?.status ?? 'forbidden')
    }
    return result
  },

  /** How badge levels are spread across core values, for the current year. */
  async getBadgeDistribution(periodStart: string): Promise<{
    distribution: BadgeDistribution[]
    summary: BadgeDistributionSummary
  }> {
    // Paged: one row per employee per core value can pass the 1000-row cap.
    const { data, error } = await fetchAllRows((from, to) => supabase
      .from('employee_value_badges')
      .select('employee_id, badge_level, core_values:core_value_id(name, slug)')
      .eq('period_type', 'annual')
      .gte('period_start', periodStart)
      .not('badge_level', 'is', null)
      .order('id')
      .range(from, to))

    if (error) throw toApiError(error, 'Could not load badge analytics.')

    const rows = (data ?? []) as unknown as Array<{
      employee_id: string
      badge_level: number | null
      core_values: { name: string; slug: string } | null
    }>

    const byValue: Record<string, BadgeDistribution> = {}
    const holders = new Set<string>()
    const summary: BadgeDistributionSummary = {
      employees_with_badge: 0, badges_held: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0,
    }

    for (const row of rows) {
      const cv = row.core_values
      if (!cv || !row.badge_level) continue

      byValue[cv.name] ??= {
        core_value_name: cv.name, slug: cv.slug, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0,
      }

      const key = `b${row.badge_level}` as 'b1' | 'b2' | 'b3' | 'b4' | 'b5'
      byValue[cv.name][key] += 1
      summary[key] += 1
      summary.badges_held += 1
      holders.add(row.employee_id)
    }

    // A row is one person in one value, so counting rows would count someone
    // with badges in two values twice.
    summary.employees_with_badge = holders.size

    return { distribution: Object.values(byValue), summary }
  },
}

/**
 * Turn a badge row into the summary the badge screens render.
 *
 * Shared because the personal dashboard and the Core Value journey built the
 * same shape from the same two inputs, with the journey additionally showing
 * values that have no badge row yet — hence the optional row.
 */
function toBadgeSummary(
  row: BadgeRow | undefined,
  coreValue: JourneyValue | { name: string; slug: string; accent_color: string; icon: string } | null,
  definitions: BadgeDefinition[],
  fallbackPeriod: { start: string; end: string },
): BadgeSummary {
  const level = row?.badge_level ?? null
  // The next badge is the one above the current level, or the first if none.
  const next = definitions.find(d => d.level === (level ? level + 1 : 1))

  return {
    core_value_id: row?.core_value_id ?? (coreValue && 'id' in coreValue ? coreValue.id : ''),
    core_value_name: coreValue?.name ?? '',
    core_value_slug: coreValue?.slug ?? '',
    core_value_color: coreValue?.accent_color ?? '',
    core_value_icon: coreValue?.icon ?? '',
    badge_level: level,
    badge_name: definitions.find(d => d.level === level)?.name ?? null,
    recognition_count: row?.recognition_count ?? 0,
    unique_recognizer_count: row?.unique_recognizer_count ?? 0,
    next_threshold: next?.minimum_count ?? null,
    next_badge_name: next?.name ?? null,
    period_start: row?.period_start ?? fallbackPeriod.start,
    period_end: row?.period_end ?? fallbackPeriod.end,
  }
}


/** For each core value recognised today, whoever received the most. */
function topPerValue(
  rows: Array<{ nominee_id: string; nominee: unknown; core_values: unknown }>,
): DailyLeader[] {
  const byValue: Record<string, Record<string, { count: number; name: string }>> = {}

  for (const row of rows) {
    const cv = row.core_values as { name: string } | null
    const nominee = row.nominee as { full_name: string } | null
    if (!cv || !nominee) continue

    byValue[cv.name] ??= {}
    byValue[cv.name][row.nominee_id] ??= { count: 0, name: nominee.full_name }
    byValue[cv.name][row.nominee_id].count++
  }

  return Object.entries(byValue).map(([core_value_name, people]) => {
    const top = Object.values(people).sort((a, b) => b.count - a.count)[0]
    return { core_value_name, employee_name: top.name, count: top.count }
  })
}
