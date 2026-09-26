import type { BadgeSummary } from '@/types'

/**
 * The Core Value closest to earning its next badge.
 *
 * Smallest remaining gap wins; on a tie, the value already further along. With
 * nothing started at all every gap is equal, so this naturally settles on the
 * lowest threshold in the catalogue — which is the honest answer to "what is
 * nearest" for somebody who has not been recognised yet.
 *
 * Returns undefined when there is nothing left to reach: either no Core Values
 * are configured, or every one of them is already at the highest badge. Those
 * are different states and the caller distinguishes them.
 *
 * Lives here rather than beside the dial that renders it so that the component
 * file exports only components — a module that mixes the two breaks Fast
 * Refresh for everything in it.
 */
export function nextMilestoneOf(badges: BadgeSummary[]): BadgeSummary | undefined {
  const candidates = badges.filter(
    b => b.next_threshold !== null && b.next_threshold > 0 && b.badge_level !== 5,
  )

  return [...candidates].sort((a, b) => {
    const gapA = (a.next_threshold ?? 0) - a.recognition_count
    const gapB = (b.next_threshold ?? 0) - b.recognition_count
    return gapA - gapB || b.recognition_count - a.recognition_count
  })[0]
}
