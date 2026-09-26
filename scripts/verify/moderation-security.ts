/**
 * Guards the security properties of recognition moderation and support requests.
 *
 * Run: npm run verify:moderation
 *
 * These are the properties that are easy to undo by accident and that a
 * type-check would not notice:
 *
 *   1. Moderation authority is decided by the DATABASE reading `employees`,
 *      not by a JWT claim and not by hiding a button.
 *   2. A moderator can correct CONTENT but cannot rewrite WHO did what.
 *   3. A support request cannot be resolved twice.
 *   4. Support requests have no write policy — every write is an RPC.
 *   5. Deleting a recognition is a soft delete that every existing query
 *      already excludes.
 *   6. The snapshot columns move with their ids, so the feed cannot display a
 *      value that contradicts the relationship.
 *   7. The approval-routing trigger is untouched.
 *
 * Like scripts/verify/approval-routing.ts, this checks the SHAPE OF THE CODE,
 * not a running database. It cannot tell you the migration has been applied —
 * `npm run db:migrate` does that — only that what would be applied still says
 * what it is supposed to say.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m' }

let failed = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ${C.green}PASS${C.reset}  ${label}`)
  } else {
    failed++
    console.log(`  ${C.red}FAIL${C.reset}  ${label}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}`)
  }
}

const migration = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/034_recognition_moderation_and_support.sql'), 'utf8',
)

const allMigrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter(f => f.endsWith('.sql'))
  .sort()
  .map(f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'))

/**
 * Body of one SQL function, from its CREATE to the closing $fn$; — taken from
 * the LAST migration that defines it, since that is what the database runs.
 * 058 redefines moderate_recognition() and 060 create_support_request(); a
 * check against 034's copy alone would pass however badly those regressed.
 */
function fnBody(name: string): string {
  let body = ''
  for (const sql of allMigrations) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
    if (start < 0) continue
    const end = sql.indexOf('$fn$;', start)
    body = end < 0 ? sql.slice(start) : sql.slice(start, end)
  }
  return body
}


console.log(`\n${C.bold}Recognition moderation — authority is the database's${C.reset}\n`)

// ── 1. The role check reads the table ───────────────────────
const guard = fnBody('can_moderate_recognitions')
check('a single shared guard decides who may moderate', guard.length > 0)
check('the guard reads the role from `employees`, not the JWT',
  guard.includes('current_employee_role()'))
check('the guard does NOT trust auth.jwt()->>\'user_role\'',
  !guard.includes("jwt()->>'user_role'"))
check('the guard requires a second-factor-verified session',
  guard.includes('session_second_factor_ok()'))

for (const fn of ['moderate_recognition', 'remove_recognition',
                  'resolve_support_request', 'reject_support_request',
                  'claim_support_request']) {
  check(`${fn}() refuses a non-moderator`, fnBody(fn).includes('can_moderate_recognitions()'))
}

// ── 2. Identity and approval are not writable ───────────────
console.log(`\n${C.bold}Historical identity is preserved${C.reset}\n`)

const edit = fnBody('moderate_recognition')
const immutable = [
  ['nominator_id', 'the original recognizer'],
  ['nominee_id', 'the original recipient'],
  ['assigned_approver_id', 'the routed approver'],
  ['approved_by_id', 'who approved it'],
  ['approved_at', 'when it was approved'],
  ['created_at', 'when it was created'],
] as const

for (const [column, what] of immutable) {
  // An assignment would read `column = ` inside the UPDATE ... SET list.
  check(`an edit cannot write ${column} (${what})`,
    !new RegExp(`\\n\\s+${column}\\s+=`).test(edit))
}
check('an edit cannot change status',
  !/\n\s+status\s+=/.test(edit))
check('the editable set is content only',
  ['core_value_id', 'behaviour_id', 'scenario_id', 'project_id',
   'what_happened', 'what_impact'].every(c => edit.includes(c)))

// ── 3. Snapshots move with their ids ────────────────────────
console.log(`\n${C.bold}Derived data cannot go stale${C.reset}\n`)

for (const snap of ['snapshot_core_value_name', 'snapshot_behaviour_name',
                    'snapshot_scenario_name', 'snapshot_project_name']) {
  check(`${snap} is refreshed by an edit`, new RegExp(`${snap}\\s+=`).test(edit))
}
check('the feed reads behaviour from the snapshot (why the above matters)',
  fs.readFileSync(path.join(ROOT, 'supabase/migrations/022_two_factor_everywhere.sql'), 'utf8')
    .includes('COALESCE(n.snapshot_behaviour_name, b.name)'))

// ── 4. Concurrency ──────────────────────────────────────────
console.log(`\n${C.bold}A request cannot be settled twice${C.reset}\n`)

for (const fn of ['resolve_support_request', 'reject_support_request']) {
  const body = fnBody(fn)
  check(`${fn}() claims with a conditional UPDATE`,
    /WHERE id = p_request_id\s+AND status IN \('open', 'in_progress'\)/.test(body))
  check(`${fn}() detects losing the race`, body.includes('already_settled'))
  check(`${fn}() reports who won`, body.includes('resolved_by_name'))
}
/*
  Ordering matters: the loser of the race must not have edited the recognition
  on its way to failing. Anchored on the actual CALL (`edit := public.…`) and
  on the conditional UPDATE, not on the bare function name — the parameter
  comment above the body names moderate_recognition() too, and matching that
  compared a comment against code and reported a real property as broken.
*/
const resolveBody = fnBody('resolve_support_request')
check('resolve claims BEFORE applying the correction',
  resolveBody.indexOf('AND status IN (\'open\', \'in_progress\')')
    < resolveBody.indexOf('edit := public.moderate_recognition('))
check('a failed correction rolls the claim back',
  fnBody('resolve_support_request').includes('RAISE EXCEPTION'))
check('viewing a request does not settle it — claim only moves open to in_progress',
  /SET status = 'in_progress'\s+WHERE id = p_request_id AND status = 'open'/.test(
    fnBody('claim_support_request')))

// ── 5. Write model ──────────────────────────────────────────
console.log(`\n${C.bold}Support requests are RPC-only${C.reset}\n`)

const policyBlock = migration.slice(migration.indexOf('ALTER TABLE recognition_support_requests ENABLE ROW LEVEL SECURITY'))
const policies = [...policyBlock.matchAll(/CREATE POLICY "([^"]+)" ON recognition_support_requests\s+FOR (\w+)/g)]
check('exactly two policies exist on the table', policies.length === 2,
  `found ${policies.length}`)
check('both are SELECT — no INSERT/UPDATE/DELETE policy',
  policies.every(m => m[2] === 'SELECT'),
  policies.map(m => `${m[1]}:${m[2]}`).join(', '))
check('the requester reads only their own',
  policyBlock.includes("requester_id = (auth.jwt()->>'employee_id')::uuid"))
check('HR and Super Admin read the same single queue',
  policyBlock.includes("IN ('hr_admin', 'super_admin')"))
check('an employee may only raise a request for their own recognition',
  fnBody('create_support_request')
    .includes('requester.id <> target.nominator_id AND requester.id <> target.nominee_id'))

// ── 6. Soft delete ──────────────────────────────────────────
console.log(`\n${C.bold}Removal is a soft delete every query already excludes${C.reset}\n`)

check("'removed' is an allowed nomination status", migration.includes("'removed'"))
check('removal is attributable', fnBody('remove_recognition').includes('removed_by_id'))
check('removal keeps the previous status',
  fnBody('remove_recognition').includes('previous_status'))
check('nothing hard-deletes a nomination',
  !/DELETE\s+FROM\s+nominations/i.test(migration))
check('the feed view still selects only approved rows',
  fs.readFileSync(path.join(ROOT, 'supabase/migrations/022_two_factor_everywhere.sql'), 'utf8')
    .includes("WHERE n.status = 'approved'"))

// ── 7. Audit ────────────────────────────────────────────────
console.log(`\n${C.bold}Every moderation action is audited${C.reset}\n`)

for (const [fn, action] of [
  ['moderate_recognition', 'recognition.moderated'],
  ['remove_recognition', 'recognition.removed'],
  ['create_support_request', 'support_request.created'],
  ['resolve_support_request', 'support_request.resolved'],
  ['reject_support_request', 'support_request.rejected'],
] as const) {
  const body = fnBody(fn)
  check(`${fn}() writes '${action}' to audit_logs`,
    body.includes('INSERT INTO audit_logs') && body.includes(action))
}
check('the audit records the actor role', edit.includes('_actor_role'))
check('no second audit table was created',
  !/CREATE TABLE[^;]*audit/i.test(migration))

// ── 8. Notifications ────────────────────────────────────────
console.log(`\n${C.bold}Notifications extend the existing system${C.reset}\n`)

check('no second notification table was created',
  !/CREATE TABLE[^;]*notification/i.test(migration))
check('creation notifies every HR admin AND Super Admin',
  /FROM employees e\s+WHERE e\.role IN \('hr_admin', 'super_admin'\)/.test(
    fnBody('create_support_request')))
check('the requester is not notified of their own request',
  fnBody('create_support_request').includes('e.id <> requester.id'))
check('resolution notifies the requester',
  fnBody('resolve_support_request').includes("'support_request_resolved'"))
check('rejection notifies the requester',
  fnBody('reject_support_request').includes("'support_request_rejected'"))

// ── 9. Nothing existing was disturbed ───────────────────────
console.log(`\n${C.bold}The existing workflow is untouched${C.reset}\n`)

check('034 does not drop or alter any nominations policy',
  !/(?:DROP|ALTER)\s+POLICY[^;]*ON nominations/i.test(migration))
// Naming the trigger in 034's own verification SELECT is not touching it —
// that line exists precisely to assert it is still there. What would matter is
// redefining the function or recreating the trigger.
check('034 does not redefine the routing function',
  !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.route_nomination_to_project_manager/i.test(migration))
check('034 does not recreate the routing trigger',
  !/CREATE\s+TRIGGER\s+route_nomination_to_project_manager/i.test(migration))
check('034 asserts the routing trigger is still installed',
  migration.includes("tgname = 'route_nomination_to_project_manager'"))
check('034 creates no trigger on nominations',
  !/CREATE TRIGGER[^;]*ON nominations/i.test(migration))

/*
  The approver-spoofing properties are asserted by verify:routing, which owns
  them and already covers the whole frontend. They are deliberately NOT
  re-checked here — a second, looser copy of a security assertion is a
  liability. The first draft of this file had exactly that, and it fired on a
  type declaration in supabase-types.ts, which is how you train people to
  ignore a red line.
*/

// What IS this file's to check: moderation stays behind the API layer, so no
// component can grow a privileged call of its own.
const componentFiles = fs
  .readdirSync(path.join(ROOT, 'src/components/recognition'), { withFileTypes: true })
  .filter(e => e.isFile() && /\.tsx?$/.test(e.name))

const componentSources = componentFiles.map(e =>
  fs.readFileSync(path.join(ROOT, 'src/components/recognition', e.name), 'utf8'))

check('no recognition component calls a moderation RPC directly',
  !componentSources.some(c =>
    /supabase\.rpc\(\s*'(moderate_recognition|remove_recognition)'/.test(c)))
check('no recognition component imports the supabase client',
  !componentSources.some(c => /from '@\/lib\/supabase'/.test(c)))

console.log()
if (failed > 0) {
  console.log(`${C.red}${C.bold}${failed} check(s) failed.${C.reset}\n`)
  process.exit(1)
}
console.log(`${C.green}${C.bold}All checks passed${C.reset} — moderation authority is enforced by the database.\n`)
