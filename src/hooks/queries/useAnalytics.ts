import { useQuery } from '@tanstack/react-query'
import { analyticsApi, type LeaderBoardValue, type JourneyValue } from '@/lib/api'
import { keys } from '@/lib/query'
import { todayIST, currentAnnualPeriod } from '@/lib/date-utils'
import type { BadgeDefinition } from '@/types'

/**
 * The HR dashboard, as ONE query.
 *
 * Deliberately not eight. analyticsApi.getHrDashboard() already issues its
 * requests as a single parallel wave and returns a shaped result; splitting
 * that into eight query keys would undo the aggregation and hand React Query
 * eight independent loading states to reconcile.
 *
 * Keyed by the IST date so "today's leaders" rolls over at midnight instead of
 * serving yesterday from cache.
 */
export function useHrDashboard() {
  const today = todayIST()

  return useQuery({
    queryKey: keys.analytics.hrDashboard(today),
    queryFn: () => analyticsApi.getHrDashboard(today),
    // Dashboards are read often and tolerate slight staleness better than an
    // approval queue does.
    staleTime: 60_000,
  })
}

/**
 * Recognition leaders per core value, for one period.
 *
 * The core values come from the caller — in practice from useCoreValues(),
 * which the wizard and the HR admin screens already keep cached — so changing
 * the period does not refetch the catalogue. The query waits until that list
 * has arrived, because the leader board is computed over it.
 */
export function useCoreValueLeaders(
  start: string,
  end: string,
  coreValues: LeaderBoardValue[],
) {
  const valueIds = coreValues.map(cv => cv.id)

  return useQuery({
    queryKey: keys.analytics.coreValueLeaders(start, end, valueIds),
    queryFn: () => analyticsApi.getCoreValueLeaders({ start, end, coreValues }),
    enabled: coreValues.length > 0,
    staleTime: 60_000,
    /*
      Deliberately NO placeholderData here.

      Keeping the previous period on screen would mean the month/quarter
      selector — which sits directly above these cards — already reads the new
      period while the rows below are still the old one, with no loading state
      to say so. For a leader board that is a wrong answer, not a stale one.
      The directory search keeps its placeholder because a result list carries
      no such label.
    */
  })
}

/**
 * The employee's own dashboard.
 *
 * Both reference lists come from the shared cache rather than from extra
 * requests after the wave, so the page still resolves in one round. They are
 * needed to BUILD the result, not merely to adorn it: a core value with no
 * badge row yet still has to appear, which is why the query waits for the
 * catalogue the same way useCoreValueJourney does.
 */
export function useEmployeeDashboard(
  employeeId: string | undefined,
  coreValues: JourneyValue[],
  badgeDefinitions: BadgeDefinition[],
) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  // Keyed by month so the "this month" figure cannot be served from last
  // month's cache after midnight on the 1st.
  const monthKey = monthStart.slice(0, 7)
  const { start, end } = currentAnnualPeriod()

  return useQuery({
    queryKey: keys.analytics.employeeDashboard(employeeId ?? '', monthKey),
    queryFn: () => analyticsApi.getEmployeeDashboard({
      employeeId: employeeId!,
      monthStart,
      coreValues,
      badgeDefinitions,
      periodStart: start,
      periodEnd: end,
    }),
    enabled:
      Boolean(employeeId) && coreValues.length > 0 && badgeDefinitions.length > 0,
    staleTime: 60_000,
  })
}

/** Every core value with this employee's progress against it. */
export function useCoreValueJourney(
  employeeId: string | undefined,
  coreValues: JourneyValue[],
  badgeDefinitions: BadgeDefinition[],
) {
  const { start, end } = currentAnnualPeriod()

  return useQuery({
    queryKey: keys.analytics.coreValueJourney(employeeId ?? ''),
    queryFn: () => analyticsApi.getCoreValueJourney({
      employeeId: employeeId!,
      coreValues,
      badgeDefinitions,
      periodStart: start,
      periodEnd: end,
    }),
    // Both reference lists are needed to build the result, not just to adorn
    // it — a value with no badge row still has to appear.
    enabled: Boolean(employeeId) && coreValues.length > 0 && badgeDefinitions.length > 0,
    staleTime: 60_000,
  })
}

export function useManagerDashboard(managerId: string | undefined) {
  return useQuery({
    queryKey: keys.analytics.managerDashboard(managerId ?? ''),
    queryFn: () => analyticsApi.getManagerDashboard(managerId!),
    enabled: Boolean(managerId),
    staleTime: 60_000,
  })
}

/**
 * Badge standing across the signed-in person's scope.
 *
 * The id only keys the cache per viewer; the database decides the scope from
 * the session (team_badges, 061), so nothing is sent.
 */
export function useTeamBadges(viewerId: string | undefined) {
  return useQuery({
    queryKey: keys.analytics.teamBadges(viewerId ?? ''),
    queryFn: () => analyticsApi.getTeamBadges(),
    enabled: Boolean(viewerId),
    staleTime: 60_000,
  })
}

export function useBadgeDistribution() {
  const { start } = currentAnnualPeriod()

  return useQuery({
    queryKey: keys.analytics.badgeDistribution(start),
    queryFn: () => analyticsApi.getBadgeDistribution(start),
    staleTime: 60_000,
  })
}
