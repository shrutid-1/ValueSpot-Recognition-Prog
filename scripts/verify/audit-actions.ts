/**
 * Verifies that the Audit Logs filter offers exactly the actions the
 * database writes.
 *
 * Run: npm run verify:audit
 *
 * Audit rows are written only by functions in supabase/migrations, and the
 * screen filters with an exact match on `action`. A name the screen offers
 * that no function writes is a filter that can only come back empty — which
 * is how "login" and "employee_created" sat in the dropdown showing nothing.
 *
 * So this reads every migration, collects the action names written to
 * audit_logs, and checks both directions against src/lib/audit-actions.ts:
 *
 *   - every action a migration writes has a label and a filter
 *   - every action the screen offers is one a migration writes
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_ACTION_GROUPS } from '../../src/lib/audit-actions'

let failures = 0

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

const dir = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))
const written = new Set<string>()

for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
  const sql = readFileSync(join(dir, file), 'utf8')

  // The VALUES of each INSERT INTO audit_logs, up to the statement's end.
  for (const m of sql.matchAll(/INSERT INTO\s+(?:public\.)?audit_logs[\s\S]*?\);/g)) {
    for (const lit of m[0].matchAll(/'([a-z_]+\.[a-z_]+)'/g)) written.add(lit[1])
    // 'reward.' || p_action || 'd', where p_action is 'approve' or 'reject' (051/052).
    if (/'reward\.'\s*\|\|\s*p_action\s*\|\|\s*'d'/.test(m[0])) {
      written.add('reward.approved')
      written.add('reward.rejected')
    }
  }
  // The approval decision names its action in a variable first (042).
  for (const m of sql.matchAll(/audit_act\s*:=\s*'([a-z_.]+)'/g)) written.add(m[1])
}

const offered = new Set(AUDIT_ACTION_GROUPS.flatMap(g => g.actions.map(a => a.action)))

console.log(`\n${written.size} actions written by migrations, ${offered.size} offered by the screen\n`)

const unlisted = [...written].filter(a => !offered.has(a)).sort()
check('every action the database writes can be filtered on', unlisted.length === 0,
  `add to src/lib/audit-actions.ts: ${unlisted.join(', ')}`)

const phantom = [...offered].filter(a => !written.has(a)).sort()
check('every action the screen offers is one the database writes', phantom.length === 0,
  `no migration writes: ${phantom.join(', ')}`)

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
