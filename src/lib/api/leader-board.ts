/**
 * Who leads each core value — the counting and tie-breaking rules.
 *
 * Deliberately free of imports, like filters.ts: these are the business rules
 * that decide who appears on the HR leader board, so they can be exercised
 * directly against generated data without a Supabase client in the way.
 *
 * The rules themselves are unchanged from the per-core-value loop this
 * replaced. They were moved, not rewritten:
 *
 *   - a nominee's score is how many approved recognitions they received
 *   - ties break on how many DIFFERENT people did the recognising
 *   - everyone matching the leader on BOTH measures is a joint winner
 *   - people tied on both keep the order they were first seen in
 */

export interface LeaderTally {
  count: number
  recognizers: Set<string>
}

export interface LeaderNomination {
  nominee_id: string
  nominator_id: string
  core_value_id: string | null
}

/**
 * Tally every nominee, grouped by core value.
 *
 * Map preserves insertion order, which is what keeps joint winners in the
 * order the old implementation produced them.
 */
export function tallyByCoreValue(
  rows: readonly LeaderNomination[],
): Map<string, Map<string, LeaderTally>> {
  const byValue = new Map<string, Map<string, LeaderTally>>()

  for (const row of rows) {
    if (!row.core_value_id) continue

    let people = byValue.get(row.core_value_id)
    if (!people) { people = new Map(); byValue.set(row.core_value_id, people) }

    let tally = people.get(row.nominee_id)
    if (!tally) { tally = { count: 0, recognizers: new Set() }; people.set(row.nominee_id, tally) }

    tally.count++
    tally.recognizers.add(row.nominator_id)
  }

  return byValue
}

/** Everyone tied at the top of one core value. Empty when nobody qualifies. */
export function topOf(
  people: Map<string, LeaderTally> | undefined,
): Array<[string, LeaderTally]> {
  if (!people || people.size === 0) return []

  const sorted = [...people.entries()].sort(([, a], [, b]) =>
    b.count !== a.count ? b.count - a.count : b.recognizers.size - a.recognizers.size,
  )

  const [, leader] = sorted[0]
  return sorted.filter(
    ([, t]) => t.count === leader.count && t.recognizers.size === leader.recognizers.size,
  )
}
