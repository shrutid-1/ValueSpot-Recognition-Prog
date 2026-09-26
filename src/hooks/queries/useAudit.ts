import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { auditApi, DEFAULT_AUDIT_PAGE_SIZE } from '@/lib/api'
import { keys } from '@/lib/query'
import { actionsForFilter } from '@/lib/audit-actions'

/**
 * The audit trail, page by page.
 *
 * useInfiniteQuery rather than useQuery because the screen is a load-more
 * list: the pages accumulate, and React Query keeps them together under one
 * key instead of the page having to concatenate them into local state itself.
 *
 * Page semantics are unchanged — same size, and "there may be more" still
 * means the last page came back full.
 */
export function useAuditLog(filter: string) {
  return useInfiniteQuery({
    queryKey: keys.audit.log(filter),
    queryFn: ({ pageParam }) => auditApi.listPage({
      page: pageParam,
      pageSize: DEFAULT_AUDIT_PAGE_SIZE,
      // '' for everything, a group for several actions, or one exact action.
      actions: actionsForFilter(filter),
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
    /*
      The trail is append-only and read for investigation rather than
      monitoring, so a short staleness window is fine and avoids refetching
      every accumulated page on each remount.
    */
    staleTime: 30_000,
  })
}

/**
 * Clear the whole trail (Super Admin only; the database enforces it).
 *
 * Every filtered view is refetched, and so is the Settings security-activity
 * card, which reads the same table.
 */
export function useClearAuditLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => auditApi.clearAll(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.audit.all })
      void qc.invalidateQueries({ queryKey: keys.admin.securityActivityPrefix() })
    },
  })
}
