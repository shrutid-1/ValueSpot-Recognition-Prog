import { useQuery, useMutation } from '@tanstack/react-query'
import { settingsApi } from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'

/**
 * Operational settings.
 *
 * The badge thresholds these sit beside are reference data and come from
 * useBadgeDefinitions() — the same cached copy the dashboards read, rather
 * than a fetch of their own. Editing one invalidates it.
 */

export function useAppConfig(configKeys: readonly string[]) {
  return useQuery({
    queryKey: keys.settings.config(configKeys),
    queryFn: () => settingsApi.getConfig(configKeys),
    // Tunables, not live data — they change when somebody edits them here.
    staleTime: 5 * 60_000,
  })
}

export function useSetNumericConfig() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: { key: string; value: number }) =>
      settingsApi.setNumericConfig(vars.key, vars.value),
    onSuccess: () => { void invalidate.settings() },
  })
}

export function useSetBadgeThresholds() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (vars: {
      badgeId: string
      minimumCount: number
      maximumCount: number | null
    }) => settingsApi.setBadgeThresholds(vars.badgeId, vars),
    onSuccess: () => {
      /*
        Thresholds decide which badge a count earns, so every screen showing a
        badge level or a "next badge" target is now out of date: the personal
        dashboard, the Core Value journey, team badges and badge analytics all
        read them.
      */
      void invalidate.badgeDefinitions()
      void invalidate.analytics()
    },
  })
}
