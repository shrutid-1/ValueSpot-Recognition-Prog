/**
 * What the Value Coin experience decides for itself.
 *
 * Durations, the milestones worth marking, and the record of which moments a
 * person has already been shown. No React and no rendering — this is the
 * policy the components and the context both read, kept in one place so a
 * threshold or a duration cannot come to mean two different things in two
 * different files.
 *
 * WHAT IS NOT HERE
 * ----------------
 * Any notion of what a balance IS. Balances come from the database and
 * nothing in this module invents, predicts or adjusts one. The only numbers
 * it produces are differences between two figures the backend reported.
 */

/* =========================================================================
   MOTION
   Mirrors the --vsx-coin-* custom properties in employee-theme.css. Declared
   twice because JavaScript timers and CSS transitions have to agree on how
   long a thing lasts, and reading a custom property back out of the DOM to
   find out is a lot of machinery for four numbers.
   ========================================================================= */

export const COIN_MOTION = {
  /** A chip appearing, a press answering. */
  micro: 160,
  /** A toast arriving or leaving. */
  move: 240,
  /** A figure settling into its new value; a glow decaying. */
  event: 440,
  /** How long a changed balance stays lit before returning to normal. */
  hold: 1100,
  /** How long a toast stays before it dismisses itself. */
  toast: 5200,
  /** The extra beat a first-time or milestone moment is given to be read. */
  toastMoment: 7400,
} as const

/* =========================================================================
   MILESTONES
   ========================================================================= */

/**
 * The totals worth marking, smallest first.
 *
 * Measured against coins RECEIVED over a career, never against the spendable
 * balance. A milestone that un-happens when somebody buys a coffee voucher
 * is not a milestone, and "10,000 earned" should stay true for the rest of
 * their time here.
 */
export const COIN_MILESTONES: readonly number[] = [1_000, 5_000, 10_000, 25_000, 50_000]

/**
 * The milestone crossed between two lifetime totals, if any.
 *
 * Strictly a CROSSING: `before` must be under it and `after` at or past it.
 * Somebody who already had 6,000 when the page loaded has not just reached
 * 1,000 or 5,000, and this returns undefined for them. When a single large
 * transfer clears more than one, the highest wins — being told about 5,000
 * and 10,000 in the same breath is two notifications for one event.
 */
export function milestoneCrossed(before: number, after: number): number | undefined {
  if (after <= before) return undefined

  return [...COIN_MILESTONES]
    .reverse()
    .find(threshold => before < threshold && after >= threshold)
}

/* =========================================================================
   MOMENTS ALREADY SHOWN
   ========================================================================= */

/**
 * The once-only moments, as they are remembered between visits.
 *
 * `firstCoins` is whether the "your first Value Coins" moment has happened.
 * `milestone` is the highest threshold already marked — one number rather
 * than a list, because the milestones are ordered and passing 10,000 means
 * 1,000 and 5,000 are behind you whether or not anybody was watching.
 */
export interface CoinMoments {
  firstCoins: boolean
  milestone: number
}

const EMPTY_MOMENTS: CoinMoments = { firstCoins: false, milestone: 0 }

/*
  Per employee, because a shared machine is a real thing in an office and
  somebody else's milestone is not yours to have already seen.
*/
const momentsKey = (employeeId: string) => `valuespot.coin-moments.${employeeId}`

/**
 * What this person has already been shown.
 *
 * Every access is guarded. Storage throws outright in some privacy modes
 * rather than returning null, and a celebration that cannot be recorded is a
 * reason to skip the celebration — never a reason to break the wallet.
 */
export function readMoments(employeeId: string): CoinMoments {
  try {
    const raw = window.localStorage.getItem(momentsKey(employeeId))
    if (!raw) return EMPTY_MOMENTS

    const parsed = JSON.parse(raw) as Partial<CoinMoments>
    return {
      firstCoins: parsed.firstCoins === true,
      milestone: typeof parsed.milestone === 'number' ? parsed.milestone : 0,
    }
  } catch {
    return EMPTY_MOMENTS
  }
}

/** Records what has been shown. Silent on failure, for the reason above. */
export function writeMoments(employeeId: string, moments: CoinMoments): void {
  try {
    window.localStorage.setItem(momentsKey(employeeId), JSON.stringify(moments))
  } catch {
    /* No storage: the moment simply is not remembered. */
  }
}

/**
 * Bring the record up to date with what is already true, without celebrating.
 *
 * Run once when a wallet is first read in a session. Somebody who has been
 * here a year and has 12,000 coins should not be walked through three
 * milestones on the first load after this feature ships — those already
 * happened, and marking them now would be fabricating the moment.
 */
export function seedMoments(employeeId: string, receivedTotal: number): CoinMoments {
  const known = readMoments(employeeId)

  const passed = [...COIN_MILESTONES].reverse().find(t => receivedTotal >= t) ?? 0

  const seeded: CoinMoments = {
    firstCoins: known.firstCoins || receivedTotal > 0,
    milestone: Math.max(known.milestone, passed),
  }

  if (seeded.firstCoins !== known.firstCoins || seeded.milestone !== known.milestone) {
    writeMoments(employeeId, seeded)
  }

  return seeded
}
