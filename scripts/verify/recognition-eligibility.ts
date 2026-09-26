/**
 * Guards the one property that migration 041 exists for:
 *
 *   AN EMPLOYEE MAY ONLY RECOGNISE ANOTHER EMPLOYEE, AND THE BROWSER
 *   DOES NOT GET A VOTE.
 *
 * Run: npm run verify:eligibility
 *
 * Before 041 the nominee's role was never consulted by the database. The only
 * nominee rule anywhere was `nominator_id != nominee_id`, so hiding Managers,
 * HR and Super Admins from the wizard's search box was the whole restriction —
 * and a search box is not a restriction. This is the set of assertions that
 * would notice if that state of affairs came back.
 *
 * It is easy to undo by accident and none of it would fail a type-check:
 *
 *   * a `role` or `excludeId` argument added back to employeesApi.search()
 *   * the search reverted to a table query the browser shapes
 *   * the trigger dropped from the migration while the function survives
 *   * the eligibility test removed from the nominations_insert policy
 *   * SECURITY DEFINER added to the search, which would turn a narrowing
 *     convenience into a new door
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * Like scripts/verify/approval-routing.ts and moderation-security.ts, this
 * checks the SHAPE OF THE CODE, not a running database. It cannot tell you the
 * migration has been applied — `npm run db:migrate` does that — nor that the
 * trigger fired correctly against real rows. Exercising the refusal against
 * the live database needs two signed-in sessions that have passed the emailed
 * second factor, which is manual UAT.
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
    console.log(`  ${C.red}FAIL${C.reset}  ${label}${detail ? `\n        ${C.dim}${detail}${C.reset}` : ''}`)
  }
}

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')

/**
 * The migration that currently DEFINES a function — the highest-numbered file
 * containing a definition, not a hard-coded filename.
 *
 * Same lesson as approval-routing.ts learned when 030 replaced 029's routing
 * function: pinning the filename asserts against history rather than against
 * what the database actually runs.
 */
function definingMigration(fn: string): { name: string; sql: string } {
  const needle = new RegExp(`FUNCTION public\\.${fn}\\s*\\(`)
  const defining = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .filter(f => needle.test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
    .sort()
    .pop()

  return defining
    ? { name: defining, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, defining), 'utf8') }
    : { name: '<none>', sql: '' }
}

/** Body of one SQL function, from its CREATE to the closing $fn$; */
function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`))
  if (start < 0) return ''
  const end = sql.indexOf('$fn$;', start)
  return end < 0 ? sql.slice(start) : sql.slice(start, end)
}


// ── 1. The rule is defined once, in the database ────────────

console.log(`\n${C.bold}The rule — one definition, in the database${C.reset}\n`)

const rule = definingMigration('role_may_recognize')
const ruleBody = fnBody(rule.sql, 'role_may_recognize')

check('a single shared predicate states who may recognise whom', ruleBody.length > 0,
  'public.role_may_recognize(text, text) was not found in any migration')

check(
  'it restricts employee nominators and only employee nominators',
  /p_nominator_role IS DISTINCT FROM 'employee'/.test(ruleBody)
  && /p_nominee_role = 'employee'/.test(ruleBody),
  ruleBody.trim(),
)

check(
  'no other role is named, so Manager/HR/Super Admin keep their existing reach',
  !/'manager'|'hr_admin'|'super_admin'/.test(ruleBody),
  'the predicate mentions a role other than employee — Manager/HR/Super Admin behaviour may have changed',
)

const verdict = definingMigration('recognition_eligibility')
const verdictBody = fnBody(verdict.sql, 'recognition_eligibility')

check('the pair verdict reuses that predicate rather than restating the rule',
  /public\.role_may_recognize\(/.test(verdictBody),
  verdict.name)

check(
  'roles are read from the employees table, not from a JWT claim or an argument',
  /SELECT role INTO nominator_role\s+FROM employees/.test(verdictBody)
  && /SELECT role INTO nominee_role\s+FROM employees/.test(verdictBody)
  && !/auth\.jwt\(\)/.test(verdictBody),
  'the verdict consults something other than the employees table for a role',
)

check(
  'self-recognition is still a refusal',
  /p_nominator_id = p_nominee_id/.test(verdictBody) && /'self'/.test(verdictBody),
  verdictBody.slice(0, 400),
)

check(
  'it is SECURITY DEFINER with a pinned search_path and no public grant',
  /SECURITY DEFINER/.test(verdictBody)
  && /SET search_path = public/.test(verdictBody)
  && /REVOKE EXECUTE ON FUNCTION public\.recognition_eligibility\(uuid, uuid\) FROM PUBLIC, anon/.test(verdict.sql)
  && /GRANT\s+EXECUTE ON FUNCTION public\.recognition_eligibility\(uuid, uuid\) TO authenticated/.test(verdict.sql),
  'definer functions must pin search_path and must not be executable by anon/public',
)


// ── 2. The enforcement point is the INSERT ──────────────────

console.log(`\n${C.bold}Enforcement — at the INSERT, where it cannot be skipped${C.reset}\n`)

const guard = definingMigration('guard_nomination_eligibility')
const guardBody = fnBody(guard.sql, 'guard_nomination_eligibility')

check('a BEFORE INSERT trigger guards nominations', guardBody.length > 0, guard.name)

check(
  'the trigger is actually attached to nominations',
  /CREATE TRIGGER check_nomination_eligibility\s+BEFORE INSERT ON nominations/.test(guard.sql),
  'the function exists but nothing fires it',
)

check(
  'it sorts before the rate limiter and the routing trigger',
  // Postgres fires BEFORE triggers in name order: check_ < enforce_ < route_.
  'check_nomination_eligibility' < 'enforce_nomination_rate_limits'
  && 'check_nomination_eligibility' < 'route_nomination_to_project_manager',
  'a refused nomination would cost a rate-limit count or resolve an approver first',
)

check(
  'the nomination is bound to the caller, resolved from auth.uid()',
  /FROM employees\s+WHERE auth_user_id = auth\.uid\(\)/.test(guardBody)
  && /NEW\.nominator_id IS DISTINCT FROM caller_id/.test(guardBody),
  'the guard does not prove the nominator is the person making the request',
)

check(
  'the verdict comes from the shared function, not a second copy of the rule',
  /public\.recognition_eligibility\(NEW\.nominator_id, NEW\.nominee_id\)/.test(guardBody)
  && !/role_may_recognize/.test(guardBody),
  guard.name,
)

check(
  'the refusal the user sees is the wording the brief asked for',
  /Employees can only recognize other employees\./.test(guardBody),
  'the message changed — check it is still a sentence written for a person',
)

check(
  'no refusal message names a table, column, policy or role value',
  ['Employees can only recognize other employees.',
   'You cannot recognize yourself.',
   'That person is no longer available to recognize.',
   'You can only give recognition from your own account.',
   'This recognition cannot be submitted.',
   'Your employee record is not set up yet, so you cannot give recognition.']
    .every(m => guardBody.includes(m))
  && !/RAISE EXCEPTION\s+'[^']*(nominations|nominee_id|hr_admin|super_admin|policy)/.test(guardBody),
  'a raised message leaks an internal detail, or an expected message is missing',
)

check(
  'seeders and migrations keep the established escape hatch',
  /IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/.test(guardBody),
  'identity-less callers (service-role seeder, SQL editor, migrations) would now be refused',
)


// ── 3. The row-level policy is the second gate ──────────────

console.log(`\n${C.bold}The row-level policy — second gate, nothing weakened${C.reset}\n`)

const policy = (() => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
  const last = files.filter(f =>
    /POLICY "nominations_insert"/.test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))).pop()
  if (!last) return { name: '<none>', clause: '' }
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, last), 'utf8')
  const start = sql.indexOf('POLICY "nominations_insert"')
  const end = sql.indexOf(');', start)
  return { name: last, clause: sql.slice(start, end < 0 ? undefined : end) }
})()

check('the newest definition of nominations_insert was found', policy.clause.length > 0, policy.name)

check(
  'it now also demands an eligible pair',
  /public\.recognition_eligibility\(nominator_id, nominee_id\) = 'ok'/.test(policy.clause),
  policy.clause,
)

for (const [label, pattern] of [
  ['the second-factor gate', /public\.session_second_factor_ok\(\)/],
  ['the authenticated test', /auth\.role\(\) = 'authenticated'/],
  ['the nominator binding', /nominator_id = \(auth\.jwt\(\)->>'employee_id'\)::uuid/],
  ['self-recognition prevention', /nominator_id != nominee_id/],
] as Array<[string, RegExp]>) {
  check(`${label} is carried over unchanged`, pattern.test(policy.clause), policy.clause)
}


// ── 4. The search asks the database, not the other way round ─

console.log(`\n${C.bold}The nominee search — scoped by the caller's own role${C.reset}\n`)

const candidates = definingMigration('recognition_candidates')
const candidatesBody = fnBody(candidates.sql, 'recognition_candidates')

check('a database function backs the wizard search', candidatesBody.length > 0, candidates.name)

check(
  'it takes a search term and nothing else',
  /FUNCTION public\.recognition_candidates\(p_term text\)/.test(candidates.sql),
  'a second parameter is a lever the browser can pull — there must not be one',
)

check(
  'the caller role comes from current_employee_role(), not an argument',
  /public\.role_may_recognize\(public\.current_employee_role\(\), e\.role\)/.test(candidatesBody),
  candidatesBody,
)

check(
  'the caller is excluded from their own candidate list',
  /e\.id <> public\.employee_id\(\)/.test(candidatesBody),
  candidatesBody,
)

check(
  'it is SECURITY INVOKER, so it narrows access and cannot widen it',
  /SECURITY INVOKER/.test(candidatesBody) && !/SECURITY DEFINER/.test(candidatesBody),
  'a definer search would return rows the caller\'s own policies refuse',
)

check(
  'anon cannot call it',
  /REVOKE EXECUTE ON FUNCTION public\.recognition_candidates\(text\) FROM PUBLIC, anon/.test(candidates.sql)
  && /GRANT\s+EXECUTE ON FUNCTION public\.recognition_candidates\(text\) TO authenticated/.test(candidates.sql),
  candidates.name,
)


// ── 5. The frontend cannot ask for more ─────────────────────

console.log(`\n${C.bold}The frontend — no role filter it could change${C.reset}\n`)

const employeesApi = read('src/lib/api/employees.ts')
const searchMethod = (() => {
  const start = employeesApi.indexOf('async search(')
  if (start < 0) return ''
  const end = employeesApi.indexOf('\n  },', start)
  return end < 0 ? employeesApi.slice(start) : employeesApi.slice(start, end)
})()

check('employeesApi.search() still exists', searchMethod.length > 0)

check(
  'it takes only a term — no role, no id, no exclusion list',
  /async search\(term: string\): Promise<Employee\[\]>/.test(searchMethod),
  searchMethod.split('\n')[0],
)

check(
  'it calls the database function rather than shaping a table query',
  /'recognition_candidates'/.test(searchMethod)
  && !/\.from\('employees'\)/.test(searchMethod),
  'the search builds its own query again — the role filter is back in the browser',
)

check(
  'no role is sent as a search argument anywhere in the API layer',
  !/recognition_candidates'[^)]*p_role/.test(employeesApi),
  'a client-supplied role reached the candidate query',
)

const step1 = read('src/components/recognition/steps/Step1Employee.tsx')

check(
  'the wizard passes only the term to the API layer',
  /employeesApi\.search\(q\)/.test(step1),
  'Step1Employee is passing something else to the search',
)

check(
  'the step still never lets someone pick themselves',
  /const isSelf = emp\.id === currentUserId/.test(step1) && /disabled=\{isSelf\}/.test(step1),
  'the client-side self-recognition guard was removed',
)

check(
  'an Employee is told what they can recognise',
  /Select an employee to recognize/.test(step1)
  && /nominatorRole === 'employee'/.test(step1),
  'the Employee wording is gone — the step implies anyone can be nominated',
)


// ── 6. Nothing else moved ───────────────────────────────────

console.log(`\n${C.bold}Untouched — routing, approvals and the rest${C.reset}\n`)

const recognitionsApi = read('src/lib/api/recognitions.ts')
const givePage = read('src/pages/employee/GiveRecognitionPage.tsx')
const eligibility = read('supabase/migrations/041_employee_nominee_eligibility.sql')

check(
  'the submission still sends no approver',
  !/assigned_approver_id:/.test(recognitionsApi) && !/assigned_approver_id:/.test(givePage),
  'an approver is being sent from the browser again — see 029/030',
)

check(
  '041 does not redefine the routing trigger',
  !/FUNCTION public\.route_nomination_to_project_manager/.test(eligibility)
  && !/TRIGGER route_nomination_to_project_manager/.test(eligibility),
  'approval routing was changed by the eligibility migration',
)

check(
  '041 touches no project, membership or approval table',
  !/\b(project_members|projects)\b/.test(eligibility.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
  'the eligibility migration writes to project or membership data',
)

check(
  '041 alters exactly one policy, the insert policy on nominations',
  (eligibility.match(/ALTER POLICY/g) ?? []).length === 1
  && /ALTER POLICY "nominations_insert" ON nominations/.test(eligibility),
  'more than one policy changed — check nothing was weakened',
)

check(
  'no migration file before 041 was rewritten to carry this rule',
  fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f < '041')
    .every(f => !/role_may_recognize|recognition_eligibility|recognition_candidates/
      .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))),
  'an applied migration was edited instead of a new one being added',
)

check(
  'a refused submission is surfaced, never swallowed',
  /err\.code === 'refused'/.test(givePage)
  && /'refused',/.test(recognitionsApi)
  && /has not been submitted/.test(givePage),
  'the page can no longer tell the user why the database refused',
)


console.log(
  failed === 0
    ? `\n${C.green}All checks passed.${C.reset}\n`
    : `\n${C.red}${failed} check(s) FAILED.${C.reset}\n`,
)

process.exit(failed === 0 ? 0 : 1)
