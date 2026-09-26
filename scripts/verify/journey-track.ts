/**
 * Verifies the Core Value journey's trail arithmetic.
 *
 * Run: npm run verify:journey
 *
 * The page draws what src/lib/journey.ts computes, so these are the claims
 * the screen makes: which badges are shown as held, which one is next, how
 * many recognitions are still needed, and where the marker sits.
 */
import {
  activeTiers, buildTrack, daysLeftInSeason, summariseSeason,
  type TierDefinition,
} from '../../src/lib/journey'

let failures = 0

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

// The production ladder (supabase/seed/001_badge_definitions.sql).
const LADDER: TierDefinition[] = [
  { level: 1, name: 'Cheers',           description: '', minimum_count: 1,  is_active: true },
  { level: 2, name: 'Applause',         description: '', minimum_count: 3,  is_active: true },
  { level: 3, name: 'Kudos',            description: '', minimum_count: 6,  is_active: true },
  { level: 4, name: 'Spotlight',        description: '', minimum_count: 11, is_active: true },
  { level: 5, name: 'Value Ambassador', description: '', minimum_count: 16, is_active: true },
]

/* The level the database would award (044_badge_recalculation_on_moderation). */
function dbLevel(count: number, tiers: TierDefinition[]): number | null {
  const hit = [...tiers].reverse().find(t => t.is_active && count >= t.minimum_count)
  return hit?.level ?? null
}

console.log('\nTrail positions')

{
  const t = buildTrack(0, null, LADDER)
  check('nothing yet: no stop earned', t.earned === 0 && t.current === null, JSON.stringify(t))
  check('nothing yet: Cheers is next, 1 to go', t.next?.name === 'Cheers' && t.remaining === 1, `${t.next?.name} ${t.remaining}`)
  check('nothing yet: marker at the start', t.at === 0, `at=${t.at}`)
}

{
  const t = buildTrack(1, 1, LADDER)
  check('1 recognition: holds Cheers', t.current?.name === 'Cheers' && t.earned === 1, JSON.stringify(t.current))
  check('1 recognition: 2 more to Applause', t.next?.name === 'Applause' && t.remaining === 2, `${t.next?.name} ${t.remaining}`)
  check('1 recognition: marker on the Cheers stop', near(t.at, 0.2), `at=${t.at}`)
  check('states in order', t.stops.map(s => s.state).join() === 'earned,next,locked,locked,locked', t.stops.map(s => s.state).join())
}

{
  // Halfway between Kudos (6) and Spotlight (11) is 8.5; 8 is 2/5 of the way.
  const t = buildTrack(8, 3, LADDER)
  check('8 recognitions: marker 2/5 through the Kudos→Spotlight segment', near(t.at, 0.6 + 0.4 * 0.2), `at=${t.at}`)
  check('8 recognitions: 3 more to Spotlight', t.remaining === 3, `${t.remaining}`)
}

{
  const t = buildTrack(19, 5, LADDER)
  check('past the top: every stop earned, nothing next', t.earned === 5 && t.next === null && t.remaining === null, JSON.stringify(t.next))
  check('past the top: marker at the end', t.at === 1, `at=${t.at}`)
}

{
  // A count the stored level has not caught up with must not reach the next stop.
  const t = buildTrack(3, 1, LADDER)
  check('stale level: Applause not shown as held', t.stops[1].state === 'next', t.stops[1].state)
  check('stale level: marker stays short of Applause', t.at < t.stops[1].pos, `at=${t.at}`)
}

console.log('\nAgreement with the database for every count 0–25')
{
  let bad = ''
  for (let c = 0; c <= 25 && !bad; c++) {
    const lvl = dbLevel(c, LADDER)
    const t = buildTrack(c, lvl, LADDER)
    const heldLevel = t.current?.level ?? null
    if (heldLevel !== lvl) bad = `count ${c}: held ${heldLevel}, db ${lvl}`
    else if (t.next && t.remaining !== t.next.threshold - c) bad = `count ${c}: remaining ${t.remaining}`
    else if (t.at < 0 || t.at > 1) bad = `count ${c}: at ${t.at}`
    else if (c > 0) {
      const prev = buildTrack(c - 1, dbLevel(c - 1, LADDER), LADDER)
      if (t.at < prev.at) bad = `count ${c}: marker moved backwards`
    }
  }
  check('held badge, remaining and a forward-only marker', bad === '', bad)
}

console.log('\nInactive tiers')
{
  const ladder = LADDER.map(t => (t.level === 3 ? { ...t, is_active: false } : t))
  const tiers = activeTiers(ladder)
  check('an inactive tier is not on the trail', tiers.length === 4 && !tiers.some(t => t.name === 'Kudos'), tiers.map(t => t.name).join())
  const t = buildTrack(7, dbLevel(7, tiers), tiers)
  check('the next stop skips it', t.next?.name === 'Spotlight' && t.remaining === 4, `${t.next?.name} ${t.remaining}`)
}

console.log('\nSeason summary')
{
  const tracks = [
    buildTrack(1, 1, LADDER),   // 2 to Applause
    buildTrack(5, 2, LADDER),   // 1 to Kudos
    buildTrack(0, null, LADDER),// 1 to Cheers
    buildTrack(16, 5, LADDER),  // done
  ]
  const s = summariseSeason(tracks)
  check('totals', s.totalRecognitions === 22 && s.stopsEarned === 8 && s.stopsTotal === 20, JSON.stringify(s))
  check('closest: every 1-to-go value, the one further along first', s.closest.join() === '1,2', s.closest.join())
  const unique = summariseSeason([buildTrack(1, 1, LADDER), buildTrack(5, 2, LADDER)])
  check('closest: a single value when one is clearly nearest', unique.closest.join() === '1', unique.closest.join())
  const done = summariseSeason([buildTrack(16, 5, LADDER)])
  check('closest is empty when every trail is complete', done.closest.length === 0, done.closest.join())
}

console.log('\nDays left')
check('last day of the season counts as 1', daysLeftInSeason('2026-12-31', new Date(2026, 11, 31, 23, 0)) === 1, '')
check('25 Sep → 31 Dec is 98 days including today', daysLeftInSeason('2026-12-31', new Date(2026, 8, 25, 9, 0)) === 98, `${daysLeftInSeason('2026-12-31', new Date(2026, 8, 25))}`)

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
