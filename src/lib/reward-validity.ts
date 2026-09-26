import type { RedemptionLifecycleStatus } from '@/types'

/**
 * Reading a redemption's expiry, for the screens that show one.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not the authority on whether a reward has lapsed. That is
 * `redemption_effective_status()` in migration 052, evaluated against the
 * database's clock, and it arrives on every row as `effective_status`. These
 * helpers only phrase what the server already decided.
 *
 * The distinction matters: a laptop with the wrong date would otherwise show
 * a dead voucher as usable. So nothing here ever returns a STATUS — it returns
 * countdowns and words. If the two disagree, the server is right.
 */

const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000

/** How much of the window is left, or null when there is no window. */
export interface Remaining {
  /** Whole days left. 0 once it is down to hours. */
  days: number
  /** Whole hours left, for the last day. */
  hours: number
  /** Already gone by the browser's reckoning. Advisory — see the module note. */
  past: boolean
}

export function remainingFrom(expiresAt: string | null, now: number = Date.now()): Remaining | null {
  if (!expiresAt) return null

  const ms = new Date(expiresAt).getTime() - now
  if (Number.isNaN(ms)) return null

  if (ms <= 0) return { days: 0, hours: 0, past: true }

  /*
    Floored, never rounded up. Thirteen and a half days left is "13 days",
    not "14" — a countdown that overstates the time somebody has is the one
    way this number can actually cost them something.
  */
  return {
    days: Math.floor(ms / MS_DAY),
    hours: Math.floor(ms / MS_HOUR),
    past: false,
  }
}

/**
 * The countdown as a phrase, or null when there is nothing to count.
 *
 * Null covers three different situations on purpose — pending, legacy and
 * already gone — because in all three a countdown would be a lie, and each
 * one is worded properly by the caller that knows which it is.
 */
export function remainingLabel(expiresAt: string | null, now: number = Date.now()): string | null {
  const left = remainingFrom(expiresAt, now)
  if (!left || left.past) return null

  if (left.days >= 1) return `${left.days} ${left.days === 1 ? 'day' : 'days'} remaining`
  if (left.hours >= 1) return `${left.hours} ${left.hours === 1 ? 'hour' : 'hours'} remaining`
  return 'Less than an hour remaining'
}

/**
 * The term, as the catalogue states it BEFORE anybody redeems.
 *
 * "14-day validity", never "expires in 14 days". Nothing on a store shelf has
 * an expiry date yet: the clock starts when the reward is approved, which has
 * not happened and might not. Wording it as a date would be inventing one.
 */
export function validityLabel(days: number | null | undefined): string | null {
  if (!days || days <= 0) return null
  return `${days}-day validity`
}

/** How a status is named and coloured, in one place for both portals. */
export interface StatusTone {
  label: string
  /** A CSS colour expression, resolved against whichever theme is mounted. */
  color: string
  /** One line saying what this state actually means for the person. */
  meaning: string
}

export function statusTone(status: RedemptionLifecycleStatus): StatusTone {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        color: 'var(--vsx-wait, #F2B23C)',
        meaning: 'Waiting for HR to approve it. Your coins are already spent; a rejection returns them in full.',
      }
    case 'approved':
      return {
        label: 'Approved',
        color: 'var(--vsx-red, #FF4A3D)',
        meaning: 'Yours to use.',
      }
    case 'rejected':
      return {
        label: 'Rejected',
        color: 'var(--vsx-danger, #FF7C93)',
        meaning: 'Not approved. Your coins were returned in full.',
      }
    case 'expired':
      return {
        label: 'Expired',
        color: 'var(--vsx-text-3, #898989)',
        meaning: 'The window to use this one closed.',
      }
  }
}
