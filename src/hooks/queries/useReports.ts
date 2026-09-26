import { useQuery } from '@tanstack/react-query'
import { reportsApi, compactFilters, type ReportFilters } from '@/lib/api'
import { keys } from '@/lib/query'
import type { ReportPeriod, ReportPeriodType } from '@/lib/date-utils'

/**
 * Reports.
 *
 *     component → hook → reportsApi → Supabase RPC → PostgreSQL
 *
 * Every hook here is LAZY on purpose, and that is the performance design rather
 * than an accident of writing them this way. Opening the Reports page must not
 * generate a report for every employee, and it must not generate any AI text at
 * all: the page loads a picker, the report loads when somebody is chosen, and
 * the interpretation loads when the report is on screen. Each step is a
 * separate query with its own `enabled` gate.
 *
 * Nothing here decides who may see what. The database resolves the caller from
 * the session and refuses through may_report_on() before reading a row.
 */

/** A refusal is not worth retrying: the answer will not change on the second attempt. */
const retryUnlessForbidden = (count: number, error: unknown) =>
  (error as { code?: string })?.code === 'forbidden' ? false : count < 2

/**
 * The employees the signed-in person may report on.
 *
 * Kept a little stale-tolerant: the list changes when HR moves somebody between
 * projects, which is rare, and `invalidate.reports()` covers it when it happens.
 */
export function useReportSubjects(search: string) {
  return useQuery({
    queryKey: keys.reports.subjects(search),
    queryFn: () => reportsApi.listSubjects(search),
    staleTime: 60_000,
    placeholderData: previous => previous,
  })
}

/** What the eight report filters may offer, scoped by the database. */
export function useReportFilterOptions() {
  return useQuery({
    queryKey: keys.reports.filterOptions(),
    queryFn: () => reportsApi.getFilterOptions(),
    staleTime: 5 * 60_000,
    retry: retryUnlessForbidden,
  })
}

/**
 * One employee's factual report.
 *
 * Disabled until an employee is chosen, so read `isLoading` rather than
 * `isPending` at the call site: a disabled query is pending forever.
 *
 * Keyed by employee, period bounds AND filters, so switching between
 * September and August — or toggling a filter off again — serves from cache
 * on the way back instead of regenerating.
 */
export function useEmployeeReport(
  employeeId: string | undefined,
  period: ReportPeriod,
  filters: ReportFilters = {},
) {
  const f = compactFilters(filters)
  return useQuery({
    queryKey: keys.reports.employee(employeeId ?? 'none', period.start, period.end, f),
    queryFn: () => reportsApi.getEmployeeReport({ employeeId: employeeId!, period, filters: f }),
    enabled: Boolean(employeeId),
    /*
      Five minutes. A report is a period summary, not a live counter — and the
      things that would change it (a recognition approved, a badge earned) fire
      invalidate.reports() themselves rather than waiting for this to expire.
    */
    staleTime: 5 * 60_000,
    /*
      No placeholderData here, unlike the consolidated report: switching from
      one person to another must never show the first person's figures under
      the second person's name, even for a moment.
    */
    retry: retryUnlessForbidden,
  })
}

/** The unfiltered organisation report — the facts the AI insights describe. */
export function useOrganizationReport(period: ReportPeriod, enabled = true) {
  return useQuery({
    queryKey: keys.reports.organization(period.start, period.end),
    queryFn: () => reportsApi.getOrganizationReport({ period }),
    enabled,
    staleTime: 5 * 60_000,
    retry: retryUnlessForbidden,
  })
}

/**
 * The consolidated report for the caller's scope: the organisation for HR and
 * Super Admin, their own team for a Manager. Filtered, with one row per
 * employee. The previous result stays on screen while a new filter loads, so
 * changing a dropdown does not flash the page empty.
 */
export function useScopedReport(period: ReportPeriod, filters: ReportFilters, enabled = true) {
  const f = compactFilters(filters)
  return useQuery({
    queryKey: keys.reports.scoped(period.start, period.end, f),
    queryFn: () => reportsApi.getScopedReport({ period, filters: f }),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: previous => previous,
    retry: retryUnlessForbidden,
  })
}

/**
 * The AI interpretation of a report.
 *
 * `enabled` is the cost control, and the caller owns it. Nothing generates an
 * interpretation until the factual report it describes has loaded, so a page
 * that is still fetching numbers never spends a model call on them — and a
 * report nobody scrolls to never generates one at all.
 *
 * Two layers of caching sit under this, doing different jobs:
 *
 *   React Query   this session, this browser. Stops a re-render or a tab
 *                 switch from re-asking.
 *   the database  every session, keyed on a HASH OF THE FACTS. Two people
 *                 opening the same unchanged report share one generation, and
 *                 so does the same person tomorrow.
 *
 * Deliberately never retried. A failure here is "AI is unavailable", which the
 * page states beside a report that is already complete without it; retrying
 * would spend money to say the same thing more slowly.
 */
export function useReportInsights(input: {
  scope: 'employee' | 'organization'
  employeeId?: string
  periodType: ReportPeriodType
  period: ReportPeriod
  enabled: boolean
}) {
  return useQuery({
    queryKey: keys.reports.insights(
      input.scope,
      input.employeeId ?? 'organization',
      input.period.start,
      input.period.end,
    ),
    queryFn: () => reportsApi.getInsights({
      scope: input.scope,
      employeeId: input.employeeId,
      periodType: input.periodType,
      period: input.period,
    }),
    enabled: input.enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  })
}
