/**
 * The Core Value journey as a map: where a person stands on each value's
 * ladder of badges, and what the next stop is.
 *
 * Pure, so the page stays a renderer and the arithmetic can be verified on
 * its own (scripts/verify/journey-track.ts).
 *
 * Stops are spaced EVENLY along the trail, not by threshold. The thresholds
 * climb 1, 3, 6, 11, 16, and a to-scale trail would crush the first three
 * into the left fifth — exactly the stops most people are working toward.
 * Evenly spaced stops read as a route; within a segment the marker moves in
 * proportion to the recognitions it takes to cross it.
 */

export interface TierDefinition {
  level: number
  name: string
  description: string
  minimum_count: number
  is_active: boolean
}

export type StopState = 'earned' | 'next' | 'locked'

export interface TrackStop {
  level: number
  name: string
  description: string
  /** Recognitions needed to unlock it. */
  threshold: number
  state: StopState
  /** Position along the trail, 0 (start) to 1 (the final stop). */
  pos: number
}

export interface TrackModel {
  stops: TrackStop[]
  /** Where the marker sits, 0 to 1. */
  at: number
  count: number
  /** How many stops are earned. */
  earned: number
  next: TrackStop | null
  /** Recognitions still needed for `next`; null once every stop is earned. */
  remaining: number | null
  /** The badge held now, or null before the first. */
  current: TrackStop | null
}

/** The active tiers, lowest first — the ladder the database awards against. */
export function activeTiers<T extends TierDefinition>(definitions: T[]): T[] {
  return definitions
    .filter(d => d.is_active)
    .sort((a, b) => a.minimum_count - b.minimum_count)
}

/**
 * Lay one value's progress onto the trail.
 *
 * Earned stops follow the stored `level`, not the count: the level is what
 * the database awarded, and the page should never show a badge the person
 * does not hold. The count only places the marker, and it is kept inside the
 * segment the level says they are in.
 */
export function buildTrack(
  count: number,
  level: number | null,
  tiers: TierDefinition[],
): TrackModel {
  const held = level ?? 0
  const n = tiers.length
  const stops: TrackStop[] = tiers.map((t, i) => ({
    level: t.level,
    name: t.name,
    description: t.description,
    threshold: t.minimum_count,
    state: t.level <= held ? 'earned' : 'locked',
    pos: (i + 1) / n,
  }))

  const earned = stops.filter(s => s.state === 'earned').length
  const next = stops[earned] ?? null
  if (next) next.state = 'next'
  const current = earned > 0 ? stops[earned - 1] : null

  let at = 1
  if (next) {
    const fromPos = current?.pos ?? 0
    const fromCount = current?.threshold ?? 0
    const span = next.threshold - fromCount
    const frac = span > 0 ? (count - fromCount) / span : 0
    // Short of the next stop: arriving on it would claim a badge not yet held.
    at = fromPos + clamp(frac, 0, 0.92) * (next.pos - fromPos)
  }

  return {
    stops,
    at: n === 0 ? 0 : at,
    count,
    earned,
    next,
    remaining: next ? Math.max(0, next.threshold - count) : null,
    current,
  }
}

export interface SeasonSummary {
  totalRecognitions: number
  stopsEarned: number
  stopsTotal: number
  /**
   * Every value sharing the fewest recognitions to go, furthest along its
   * current segment first, then in catalogue order. Empty when every trail
   * is complete.
   *
   * All of them, not one: four values a recognition from Cheers are equally
   * close, and naming one as "the" closest would be a coin toss.
   */
  closest: number[]
}

export function summariseSeason(tracks: TrackModel[]): SeasonSummary {
  const open = tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.remaining !== null)
  const fewest = Math.min(...open.map(({ t }) => t.remaining!))
  const along = (t: TrackModel) => t.at - (t.current?.pos ?? 0)

  const closest = open
    .filter(({ t }) => t.remaining === fewest)
    .sort((a, b) => along(b.t) - along(a.t) || a.i - b.i)
    .map(({ i }) => i)

  return {
    totalRecognitions: tracks.reduce((sum, t) => sum + t.count, 0),
    stopsEarned: tracks.reduce((sum, t) => sum + t.earned, 0),
    stopsTotal: tracks.reduce((sum, t) => sum + t.stops.length, 0),
    closest,
  }
}

/** Whole days left in the season, counting today. `end` is YYYY-MM-DD. */
export function daysLeftInSeason(end: string, today: Date): number {
  const [y, m, d] = end.split('-').map(Number)
  const endDay = Date.UTC(y, m - 1, d)
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((endDay - todayDay) / 86_400_000) + 1)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
