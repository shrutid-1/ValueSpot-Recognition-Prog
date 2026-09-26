/**
 * Verifies that the Phase 6 leader-board refactor computes exactly what the
 * previous per-core-value loop computed.
 *
 * Run: npm run verify:leaders
 *
 * The old implementation issued one nominations query per core value and
 * reduced each result separately. The new one issues a single query and groups
 * in one pass. That is only a safe change if the OUTPUT is identical, so this
 * runs both over the same generated data and compares:
 *
 *   - which core values have leaders at all
 *   - who the leaders are, in order
 *   - recognition counts and unique-recognizer counts
 *   - the joint-winner flag
 *
 * The old algorithm below is a faithful transcription of the code that was in
 * AnalyticsPage before this phase, kept here as the reference to compare to.
 */
import { tallyByCoreValue, topOf } from '../../src/lib/api/leader-board'

interface Nomination {
  nominee_id: string
  nominator_id: string
  core_value_id: string | null
}

interface LeaderOut {
  employee_id: string
  recognition_count: number
  unique_recognizer_count: number
  is_joint: boolean
}

let failures = 0

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

/* ── The old implementation, transcribed ──────────────────── */

function oldWay(rows: Nomination[], valueIds: string[]): Map<string, LeaderOut[]> {
  const out = new Map<string, LeaderOut[]>()

  for (const cvId of valueIds) {
    // The old code fetched only this core value's rows; filtering the same
    // rows here is the equivalent.
    const noms = rows.filter(r => r.core_value_id === cvId)

    const empMap: Record<string, { count: number; uniqueNominators: Set<string> }> = {}
    for (const n of noms) {
      if (!empMap[n.nominee_id]) empMap[n.nominee_id] = { count: 0, uniqueNominators: new Set() }
      empMap[n.nominee_id].count++
      empMap[n.nominee_id].uniqueNominators.add(n.nominator_id)
    }

    if (Object.keys(empMap).length === 0) { out.set(cvId, []); continue }

    const sorted = Object.entries(empMap).sort(([, a], [, b]) =>
      b.count !== a.count ? b.count - a.count : b.uniqueNominators.size - a.uniqueNominators.size)
    const topCount = sorted[0][1].count
    const topUnique = sorted[0][1].uniqueNominators.size
    const topEntries = sorted.filter(
      ([, v]) => v.count === topCount && v.uniqueNominators.size === topUnique)
    const isJoint = topEntries.length > 1

    out.set(cvId, topEntries.map(([id, v]) => ({
      employee_id: id,
      recognition_count: v.count,
      unique_recognizer_count: v.uniqueNominators.size,
      is_joint: isJoint,
    })))
  }

  return out
}

/* ── The new implementation's pure core ───────────────────── */

function newWay(rows: Nomination[], valueIds: string[]): Map<string, LeaderOut[]> {
  const byValue = tallyByCoreValue(rows)
  const out = new Map<string, LeaderOut[]>()

  for (const cvId of valueIds) {
    const winners = topOf(byValue.get(cvId))
    const isJoint = winners.length > 1

    out.set(cvId, winners.map(([id, tally]) => ({
      employee_id: id,
      recognition_count: tally.count,
      unique_recognizer_count: tally.recognizers.size,
      is_joint: isJoint,
    })))
  }

  return out
}

/* ── Comparison ───────────────────────────────────────────── */

function render(result: Map<string, LeaderOut[]>, valueIds: string[]): string {
  return valueIds
    .map(id => `${id}=[${(result.get(id) ?? [])
      .map(l => `${l.employee_id}:${l.recognition_count}/${l.unique_recognizer_count}${l.is_joint ? 'J' : ''}`)
      .join(' ')}]`)
    .join(' ')
}

function compare(label: string, rows: Nomination[], valueIds: string[]): void {
  const before = render(oldWay(rows, valueIds), valueIds)
  const after = render(newWay(rows, valueIds), valueIds)
  check(label, before === after, `old: ${before}\n        new: ${after}`)
}

/* ── Named scenarios, from the approved validation list ───── */

console.log('\nLeader board — old implementation vs new\n')

const CV = ['cv-a', 'cv-b', 'cv-c']

compare('no recognitions at all', [], CV)

compare('a single clear leader', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e1', nominator_id: 'n2', core_value_id: 'cv-a' },
  { nominee_id: 'e2', nominator_id: 'n1', core_value_id: 'cv-a' },
], CV)

compare('joint winners tied on both measures', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e1', nominator_id: 'n2', core_value_id: 'cv-a' },
  { nominee_id: 'e2', nominator_id: 'n3', core_value_id: 'cv-a' },
  { nominee_id: 'e2', nominator_id: 'n4', core_value_id: 'cv-a' },
], CV)

compare('same count, broken by unique recognizers', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e2', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e2', nominator_id: 'n2', core_value_id: 'cv-a' },
], CV)

compare('several core values at once', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e2', nominator_id: 'n2', core_value_id: 'cv-b' },
  { nominee_id: 'e3', nominator_id: 'n3', core_value_id: 'cv-c' },
], CV)

compare('one value populated, the others empty', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-b' },
], CV)

compare('rows for a value not on the board', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-zz' },
  { nominee_id: 'e2', nominator_id: 'n2', core_value_id: 'cv-a' },
], CV)

compare('null core value is ignored', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: null },
  { nominee_id: 'e2', nominator_id: 'n2', core_value_id: 'cv-a' },
], CV)

compare('self-nomination style repeats from one recognizer', [
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
  { nominee_id: 'e1', nominator_id: 'n1', core_value_id: 'cv-a' },
], CV)

/* ── Randomised sweep ─────────────────────────────────────── */

console.log('\nRandomised datasets\n')

/** Deterministic PRNG, so a failure is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

let randomMismatches = 0
const TRIALS = 500

for (let trial = 0; trial < TRIALS; trial++) {
  const rand = makeRandom(trial + 1)
  const pick = (n: number) => Math.floor(rand() * n)

  const rows: Nomination[] = []
  const rowCount = pick(40)

  for (let i = 0; i < rowCount; i++) {
    rows.push({
      // Small pools, so ties happen often — ties are the interesting case.
      nominee_id: `e${pick(4)}`,
      nominator_id: `n${pick(3)}`,
      core_value_id: rand() < 0.1 ? null : `cv-${['a', 'b', 'c'][pick(3)]}`,
    })
  }

  if (render(oldWay(rows, CV), CV) !== render(newWay(rows, CV), CV)) {
    randomMismatches++
    if (randomMismatches === 1) {
      console.log(`        first mismatch at trial ${trial}: ${JSON.stringify(rows)}`)
    }
  }
}

check(
  `${TRIALS} randomised datasets produce identical output`,
  randomMismatches === 0,
  `${randomMismatches} mismatch(es)`,
)

console.log(
  failures === 0
    ? '\nAll checks passed — the refactor is output-equivalent.\n'
    : `\n${failures} check(s) FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
