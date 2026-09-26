import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError } from '@/lib/api'
import { keys } from './keys'

export { queryClient } from './queryClient'
export { keys }

/**
 * The small shared pieces. Deliberately three helpers, not a framework —
 * anything more would just be a second way to write `useQuery`.
 */

/**
 * A user-facing message for a failed query or mutation.
 *
 * The API layer already produces messages fit to display, including the
 * database's own wording for 42501 refusals. This exists so components stop
 * re-deriving that, and so an unexpected error type still yields a sentence
 * rather than `[object Object]`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  return fallback
}

/** Whether this failure means the session is no longer usable. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated'
}

/**
 * Narrow invalidation helpers, bound to the key shapes in keys.ts.
 *
 * The point is that a mutation states what CHANGED, not what to refetch.
 * `invalidate.employeeDirectory()` clears every cached listing regardless of
 * search term, while leaving the managers and departments reference lists
 * alone — they did not change, and refetching them would be the broad
 * invalidation this is meant to avoid.
 */
export function useInvalidate() {
  const qc = useQueryClient()

  return {
    /** Directory listings only. Reference lists are untouched. */
    employeeDirectory: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.employees.lists() }),
      [qc],
    ),

    /** Everything in the employees domain, including reference lists. */
    employeesAll: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.employees.all }),
      [qc],
    ),

    /** One person's invitation delivery status. */
    invitationStatus: useCallback(
      (employeeId: string) =>
        qc.invalidateQueries({ queryKey: keys.employees.invitationStatus(employeeId) }),
      [qc],
    ),

    /*
      Reference lists, one at a time.

      Editing a behaviour must not refetch core values, projects and rewards —
      they did not change. The behaviours prefix covers both the plain list and
      the admin "with values" variant, which is as broad as it needs to be.
    */
    coreValues: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.coreValuesPrefix() }),
      [qc],
    ),
    behaviours: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.behavioursPrefix() }),
      [qc],
    ),
    scenarios: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.scenariosPrefix() }),
      [qc],
    ),
    projects: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.projectsPrefix() }),
      [qc],
    ),
    rewards: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.rewardsPrefix() }),
      [qc],
    ),

    /**
     * Project assignments.
     *
     * Every employee's, not just one: moving somebody onto a project changes
     * what the recognition wizard offers for them, and the wizard caches that
     * per nominee rather than per viewer.
     */
    employeeProjects: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.employeeProjectPrefix() }),
      [qc],
    ),
    departments: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.departmentsPrefix() }),
      [qc],
    ),

    /** Every support request view — the employee's own list and the admin queue. */
    support: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.support.all }),
      [qc],
    ),

    /**
     * The approval queue.
     *
     * Singular since migration 042: the queue is scoped inside the database
     * from the caller's session, so this browser holds one — the viewer's own.
     * The OTHER authorities' queues are in other browsers and are refreshed by
     * their own next fetch; nothing here can reach them, and a decision made
     * elsewhere shows up as 'already handled' if they act on a stale copy.
     */
    approvalQueues: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.recognitions.approvalQueue() }),
      [qc],
    ),

    /**
     * Every manager's team list.
     *
     * Deliberately not narrowed to one manager: the caller of an approval
     * knows the approver, not which managers have the nominee on one of their
     * projects — and after migration 030 those are different people whenever
     * the recognition was filed against a project the nominee does not sit on.
     * Resolving that would mean a project lookup purely to decide what to
     * refetch. The prefix is one cheap invalidation instead.
     */
    teamRecognitions: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.recognitions.teamPrefix() }),
      [qc],
    ),

    /**
     * EVERY recognition view: the feed, both participants' own lists, team
     * lists and approval queues.
     *
     * Intentionally the broad hammer, and only used by moderation. Correcting
     * or removing a recognition changes what the nominator sees, what the
     * nominee sees, what the company feed shows and what a manager's team list
     * contains — and the caller knows the recognition id, not which viewers
     * have which of those cached. Narrowing it would mean guessing, and a
     * wrong guess leaves a corrected recognition displaying its old Core Value
     * to somebody.
     */
    recognitionsAll: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.recognitions.all }),
      [qc],
    ),

    /** One person's given/received lists, both tabs. */
    myRecognitions: useCallback(
      (employeeId: string) =>
        qc.invalidateQueries({ queryKey: keys.recognitions.minePrefix(employeeId) }),
      [qc],
    ),

    /**
     * A redemption, or a decision on one.
     *
     * Both move an earned balance, so the wallet goes with the store: the
     * employee's balance, their ledger, their own redemption list and the HR
     * queue are all now wrong. Narrowing this would mean guessing which of
     * them the caller is looking at, and a wrong guess leaves a spent balance
     * showing its old figure.
     */
    store: useCallback(
      () => Promise.all([
        qc.invalidateQueries({ queryKey: keys.store.all }),
        qc.invalidateQueries({ queryKey: keys.wallet.all }),
      ]),
      [qc],
    ),

    /**
     * An HR change to Value Coins — the policy, or one person's balance.
     *
     * Deliberately the broad hammer. Changing the monthly allowance changes
     * what every wallet screen says the allowance IS, and adjusting one
     * balance changes a number that person may have open in another tab.
     * The caller knows what it changed, not who has what cached, and a wrong
     * guess leaves a stale figure on a screen about money.
     */
    coinAdmin: useCallback(
      () => Promise.all([
        qc.invalidateQueries({ queryKey: keys.coinAdmin.all }),
        qc.invalidateQueries({ queryKey: keys.wallet.all }),
      ]),
      [qc],
    ),

    /**
     * A Value Coin send, and everything that quotes a balance.
     *
     * Three things move on one send and they are not the same thing: the
     * sender's balance, the ledger both parties read, and the coin total on
     * the recognition it was sent on — which lives on the feed view, so the
     * feed prefix is the recognitions one rather than a wallet one.
     *
     * The balance prefix covers BOTH wallets. The recipient is a different
     * browser, but the sender may be looking at their own balance in two
     * places at once, and narrowing this to one employee id would be
     * guessing which.
     */
    wallet: useCallback(
      () => Promise.all([
        qc.invalidateQueries({ queryKey: keys.wallet.all }),
        qc.invalidateQueries({ queryKey: keys.recognitions.feedPrefix() }),
      ]),
      [qc],
    ),

    /**
     * A conversation, and the counts that quote it.
     *
     * Both prefixes, because a comment changes two cached things: the thread
     * it belongs to, and `comment_count` on every feed page that carries its
     * post. Invalidating only the thread leaves the post above it saying "3
     * comments" over four of them — which is the kind of wrongness a reader
     * notices immediately.
     *
     * The feed prefix is the recognitions one, not a comments one: the count
     * lives on v_recognition_feed.
     */
    comments: useCallback(
      () => Promise.all([
        qc.invalidateQueries({ queryKey: keys.comments.all }),
        qc.invalidateQueries({ queryKey: keys.recognitions.feedPrefix() }),
      ]),
      [qc],
    ),

    /**
     * Administrative role listings and their candidate pickers.
     *
     * Both, together, and on purpose: promoting somebody to Super Admin
     * removes them from the HR Admin candidate list, so refreshing only the
     * card that acted would leave the other showing a stale option.
     */
    adminRoles: useCallback(
      () => Promise.all([
        qc.invalidateQueries({ queryKey: keys.admin.roleHoldersPrefix() }),
        qc.invalidateQueries({ queryKey: keys.admin.candidatesPrefix() }),
        qc.invalidateQueries({ queryKey: keys.admin.securityActivityPrefix() }),
      ]),
      [qc],
    ),

    signupDomains: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.admin.signupDomains() }),
      [qc],
    ),

    /** Dashboard aggregates, across every date key. */
    analytics: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.analytics.all }),
      [qc],
    ),

    /**
     * Every report view: the employee picker, both report kinds, and the AI
     * insights derived from them.
     *
     * Called when something a report COUNTS has moved — a recognition decided,
     * a badge earned, project membership changed. Deliberately includes the
     * subject list, because a membership change is exactly what adds or removes
     * an employee from a manager's picker.
     *
     * The AI insights are invalidated alongside, and that is cheap rather than
     * expensive: the Edge Function keys its cache on a hash of the facts, so a
     * refetch whose underlying numbers did not move is a cache hit and costs no
     * generation.
     */
    reports: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reports.all }),
      [qc],
    ),

    /** Operational settings, across every key selection. */
    settings: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.settings.configPrefix() }),
      [qc],
    ),

    /** Badge thresholds — reference data every badge screen reads. */
    badgeDefinitions: useCallback(
      () => qc.invalidateQueries({ queryKey: keys.reference.badgeDefinitions() }),
      [qc],
    ),
  }
}
