/**
 * Guards the properties of the employee reporting and AI insights feature.
 *
 * Run: npm run verify:reporting
 *
 * Four claims, each easy to undo by accident and invisible to a type-check:
 *
 *   1. MANAGER SCOPE IS PROJECT-BASED AND SERVER-SIDE. A Manager may report on
 *      the active members of the active projects they manage, resolved in the
 *      database from their session — never from employees.manager_id, never
 *      from an id in the request, and never by fetching everyone and filtering
 *      in React.
 *   2. AI NEVER PRODUCES A METRIC. Every figure is counted by SQL; the model is
 *      handed a closed set of facts, re-fetched server-side, and asked only to
 *      describe them.
 *   3. THE PROVIDER KEY NEVER REACHES THE BROWSER. It is read inside an Edge
 *      Function and appears nowhere in src/ or in a VITE_ variable.
 *   4. THE FACTUAL REPORT SURVIVES AI FAILURE. Every AI path fails soft.
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * Like the other verify scripts, this checks the SHAPE OF THE CODE, not a
 * running database and not a live model. It cannot tell you that a Manager was
 * actually refused, that the aggregates are arithmetically right, or that the
 * model obeyed its instructions — those need the migration applied, real data,
 * and a real API key, and are listed as manual testing in the report.
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
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')

/** Source with its comments removed — several assertions are "X is absent". */
function code(source: string, sql = false): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(sql ? /--.*$/gm : /\/\/.*$/gm, ' ')
}

/** The migration that currently DEFINES a function, never a pinned filename. */
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

function fnBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`))
  if (start < 0) return ''
  const end = sql.indexOf('$fn$;', start)
  return end < 0 ? sql.slice(start) : sql.slice(start, end)
}

const m043 = exists('supabase/migrations/043_employee_reporting.sql')
  ? read('supabase/migrations/043_employee_reporting.sql')
  : ''


// ── 1. Manager scope ────────────────────────────────────────

console.log(`\n${C.bold}Manager scope — project-based, and the database's${C.reset}\n`)

const scope = definingMigration('may_report_on')
const scopeBody = fnBody(scope.sql, 'may_report_on')

check('a single shared scope rule exists', scopeBody.length > 0,
  'public.may_report_on() was not found in any migration')

check(
  'a Manager is scoped through project_members -> projects.manager_id',
  /FROM project_members pm\s+JOIN projects p ON p\.id = pm\.project_id/.test(scopeBody)
  && /p\.manager_id = p_actor_id/.test(scopeBody),
  scopeBody,
)

check(
  'both is_active tests are applied — archived projects and departed members',
  /pm\.is_active/.test(scopeBody) && /p\.is_active/.test(scopeBody),
  'an archived project is not a team, and someone who left it is not on it',
)

check(
  'employees.manager_id is NOT consulted',
  /*
    Asserted against the FUNCTION BODIES, not the whole file. The migration's
    prose and its COMMENT ON strings both say "never employees.manager_id" —
    matching those would fail the check for documenting the very rule it is
    checking, and a looser regex would pass on `p.manager_id`, which is the
    project's manager and exactly what this feature is supposed to use.
  */
  ['may_report_on', 'report_subjects', 'employee_report', 'organization_report']
    .map(fn => code(fnBody(m043, fn), true))
    .every(body => !/\be\.manager_id\b|employees\.manager_id/.test(body)),
  'the line-manager relationship is retired (030) and must stay retired',
)

check(
  'multiple memberships do not duplicate an employee',
  /RETURN EXISTS \(/.test(scopeBody),
  'EXISTS rather than a join, so somebody on three of a manager\'s projects is in scope once',
)

check(
  'HR and Super Admin are organisation-wide',
  /actor_role IN \('hr_admin', 'super_admin'\)\s*THEN\s*RETURN true/.test(scopeBody.replace(/\s+/g, ' ')),
  scopeBody,
)

check(
  'an Employee has no reporting scope at all',
  /RETURN false;\s*END;/.test(scopeBody.replace(/\r/g, '')),
  'the function must fail closed for any role it does not recognise',
)

check(
  'the acting employee comes from the session, not from a request argument',
  /WHEN auth\.uid\(\) IS NULL THEN p_claimed_actor_id/.test(fnBody(m043, 'report_actor'))
  && /auth_user_id = auth\.uid\(\)/.test(fnBody(m043, 'report_actor'))
  && /session_second_factor_ok\(\)/.test(fnBody(m043, 'report_actor')),
  'a browser session must resolve from auth.uid(); only the Edge Function may claim an id',
)

const subjects = definingMigration('report_subjects')
check(
  'the employee picker takes a search term and nothing that names a team',
  /FUNCTION public\.report_subjects\(p_search text DEFAULT NULL\)/.test(subjects.sql),
  'a second parameter is a lever a Manager could pull at another Manager\'s team',
)

check(
  'the picker applies the same scope rule',
  /public\.may_report_on\(public\.report_actor\(\), e\.id\)/.test(fnBody(subjects.sql, 'report_subjects')),
  'the selector and the report must not disagree about who is in scope',
)

check(
  'both report functions authorise before reading anything',
  /IF NOT public\.may_report_on\(actor_id, p_employee_id\) THEN/
    .test(fnBody(m043, 'employee_report'))
  && /actor_role NOT IN \('hr_admin', 'super_admin'\)/
    .test(fnBody(m043, 'organization_report')),
  'a report must refuse before it aggregates, not filter afterwards',
)

check(
  'a refusal does not reveal whether the employee exists',
  (fnBody(m043, 'employee_report').match(/'forbidden'/g) ?? []).length >= 2,
  '"not allowed" and "no such person" must be the same answer',
)


// ── 2. Facts are SQL; AI only describes them ────────────────

console.log(`\n${C.bold}Facts and interpretation — kept apart${C.reset}\n`)

const edge = exists('supabase/functions/generate-report-insights/index.ts')
  ? read('supabase/functions/generate-report-insights/index.ts')
  : ''

check('the insights Edge Function exists', edge.length > 0,
  'supabase/functions/generate-report-insights/index.ts')

check(
  'the facts are re-fetched server-side, never taken from the request',
  /supabase\.rpc\(\s*'employee_report'/.test(edge)
  && /supabase\.rpc\(\s*'organization_report'/.test(edge)
  && !/body\.(report|facts|metrics)/.test(edge),
  'a caller who can supply the facts can describe themselves any way they like',
)

check(
  'the Edge Function passes the caller through to the database gate',
  /p_claimed_actor_id: actor\.id/.test(edge)
  && /\.eq\('auth_user_id', user\.id\)/.test(edge),
  'the actor must come from the validated token and be judged by may_report_on()',
)

check(
  'a database refusal becomes a refusal, not an insight',
  /facts\?\.status === 'forbidden'/.test(edge),
  edge.slice(0, 200),
)

check(
  'the second factor is re-checked, because the service role bypasses RLS',
  /session_second_factor_ok_for/.test(edge),
  'same posture as process-approval',
)

check(
  'the prompt forbids inventing facts, metrics and people',
  ['Use ONLY the numbers', 'Never invent a recognition', 'Never invent a score']
    .every(s => edge.includes(s)),
  'the grounding rules are the feature',
)

check(
  'the prompt separates recognition data from performance',
  /RECOGNITION DATA IS NOT PERFORMANCE DATA/.test(edge)
  && /Never write that someone is weak at/.test(edge),
  'a low count is a fact about the records, not about the person',
)

check(
  'the prompt forbids protected characteristics and clinical claims',
  /protected or sensitive characteristic/.test(edge)
  && /medical, psychological, clinical or diagnostic/.test(edge),
  edge.slice(0, 200),
)

check(
  'the prompt requires saying when evidence is insufficient',
  /say the evidence is insufficient/.test(edge)
  && /insufficient data for trend analysis/.test(edge),
  edge.slice(0, 200),
)

check(
  'the output shape is constrained by a response schema, not asked for in prose',
  /response_format:/.test(edge)
  && /mime_type: 'application\/json'/.test(edge)
  && /schema: INSIGHT_SCHEMA/.test(edge),
  'without a schema the model is free to answer in prose, or to add a "score"',
)

check(
  'every insight section is required, so none can be quietly dropped',
  // Every section named in the schema's `required` list, in any order -- the
  // list grew a leading 'headline' in insight format 2.
  (() => {
    const required = edge.replace(/\s+/g, ' ').match(/required: \[([^\]]*)\]/)?.[1] ?? ''
    return [
      'headline', 'summary', 'strengths', 'development_opportunities', 'recommendations',
      'core_value_insights', 'recognition_pattern', 'badge_summary', 'evidence_limitations',
    ].every(key => required.includes(`'${key}'`))
  })(),
  'an unsupported section must arrive empty, not missing',
)

check(
  'the report itself computes the trend sufficiency flag, not the model',
  /'sufficient', \(SELECT count\(\*\) FROM counted\) >= 3/.test(m043),
  'the model must not be the one deciding whether there is enough data',
)


// ── 3. The key never reaches the browser ────────────────────

console.log(`\n${C.bold}Credentials — server-side only${C.reset}\n`)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full)
  }
  return out
}

const srcFiles = walk(path.join(ROOT, 'src'))
const offenders = srcFiles.filter(f => /GEMINI_API_KEY|AIza[0-9A-Za-z_-]{10}/.test(fs.readFileSync(f, 'utf8')))

check(
  'no provider key or key name appears anywhere in src/',
  offenders.length === 0,
  offenders.map(f => path.relative(ROOT, f)).join(', '),
)

check(
  'the key is read from the Edge Function environment',
  /Deno\.env\.get\('GEMINI_API_KEY'\)/.test(edge),
  edge.slice(0, 200),
)

check(
  'the key is never given a VITE_ prefix in any env file',
  /*
    It LIVES in .env — that is deliberate, and how `supabase secrets set
    --env-file ./.env` pushes it. What must never happen is the VITE_ prefix:
    Vite compiles those into the browser bundle, so the key would be readable
    by anyone with devtools open. This asserts the prefix, not the presence.
  */
  ['.env.example', '.env']
    .filter(f => fs.existsSync(path.join(ROOT, f)))
    // Comments stripped first: those files WARN against the VITE_ prefix by
    // name, and matching the warning would fail the check for documenting it.
    .map(f => read(f).replace(/^\s*#.*$/gm, ''))
    .every(body => !/VITE_\w*GEMINI/i.test(body)),
  'a VITE_-prefixed model key ends up in dist/ and in every visitor\'s browser',
)

check(
  '.env.example documents the key and says how it reaches the function',
  /GEMINI_API_KEY/.test(read('.env.example'))
  && /secrets set --env-file/.test(read('.env.example')),
  'the next person has to know it is a function secret, not a Vite variable',
)

check(
  'no service-role key is referenced from src/',
  srcFiles.every(f => !/SERVICE_ROLE/.test(fs.readFileSync(f, 'utf8'))),
  'the service role belongs to Edge Functions and the seeder',
)

check(
  'the insight cache is unreachable from a browser session',
  /ALTER TABLE report_ai_insights ENABLE ROW LEVEL SECURITY/.test(m043)
  && !/CREATE POLICY[^;]*report_ai_insights/.test(m043),
  'RLS on with no policies is what makes the Edge Function the only door',
)


// ── 4. AI failure never takes the report down ───────────────

console.log(`\n${C.bold}Failure behaviour — the report stands without AI${C.reset}\n`)

const api = read('src/lib/api/reports.ts')
const page = read('src/pages/hr/ReportsPage.tsx')
const hooks = read('src/hooks/queries/useReports.ts')

check(
  'every AI failure path returns 503, never a 500 that reads as a broken report',
  (edge.match(/\}, 503\)/g) ?? []).length >= 3,
  'missing key, provider error and unparseable response each fail soft',
)

check(
  'a missing key is reported as "not configured", distinctly from an outage',
  /'not_configured'/.test(edge),
  'the two have different fixes and different people to tell',
)

check(
  'the page renders the AI failure beside the report, not instead of it',
  /AI insights are currently unavailable/.test(page)
  && /Every figure in this report was counted by the database and is unaffected/.test(page),
  page.slice(0, 200),
)

check(
  'insights are never retried automatically',
  /retry: false/.test(hooks),
  'retrying a refusal spends money to say the same thing more slowly',
)

check(
  'insights are generated only on request, after the facts have loaded',
  /enabled: ready && requested/.test(page)
  && /enabled: input\.enabled/.test(hooks),
  'opening Reports must not start a model call, let alone one per employee',
)


// ── 5. Performance and architecture ─────────────────────────

console.log(`\n${C.bold}Architecture — one call per report, no N+1${C.reset}\n`)

check(
  'the whole employee report is ONE database call',
  /callRpc\('employee_report'/.test(api)
  && (api.match(/callRpc\('employee_report'/g) ?? []).length === 1,
  'a query per core value, badge or project is the N+1 this shape avoids',
)

check(
  'the organisation report is ONE database call',
  /callRpc\('organization_report'/.test(api),
  api.slice(0, 200),
)

check(
  'the organisation report aggregates rather than summing employee reports',
  !/employee_report/.test(fnBody(m043, 'organization_report')),
  'a consolidated report is not a concatenation of individual ones',
)

check(
  'the page holds no direct Supabase call',
  !/from '@\/lib\/supabase'/.test(page) && !/supabase\./.test(code(page)),
  'UI -> React Query -> API module -> database is the project architecture',
)

check(
  'the page does not fetch everyone and filter in React',
  !/\.filter\([^)]*manager/i.test(page)
  && !/employeesApi\.list\(/.test(page),
  'the subject list must arrive already scoped',
)

check(
  'report caches are invalidated when a decision moves the numbers',
  /invalidate\.reports\(\)/.test(read('src/hooks/queries/useRecognitions.ts')),
  'an approved recognition changes every report that counts it',
)

check(
  'report caches are invalidated when project membership changes',
  /invalidate\.reports\(\)/.test(read('src/hooks/queries/useReference.ts')),
  'a membership change is what adds or removes an employee from a manager\'s picker',
)

check(
  'insights are keyed separately from the factual report',
  /insights: \(scope: string, subjectId: string, start: string, end: string\)/
    .test(read('src/lib/query/keys.ts')),
  'one key for both would make every report refresh an AI call',
)


// ── 6. Periods ──────────────────────────────────────────────

console.log(`\n${C.bold}Periods — one definition, with its own previous period${C.reset}\n`)

const dates = read('src/lib/date-utils.ts')

check(
  'one function resolves every report period',
  /export function reportPeriod\(/.test(dates),
  'monthly, quarterly and annual must not each compute their own bounds',
)

check(
  'the previous period is the same unit shifted, not a fixed window',
  /const prevDate = new Date\(y, m - 2, 1\)/.test(dates)
  && /const prevQuarter = quarter === 1 \? 4 : quarter - 1/.test(dates)
  && /previousStart: `\$\{year - 1\}-01-01`/.test(dates),
  'comparing against a window of a different length makes every figure look like it moved',
)

check(
  'quarters follow the application\'s existing financial-year convention',
  /getQuarterBounds\(quarter, fiscalYear\)/.test(dates)
  && /Q1 is\s*\n?\s*Apr–Jun/.test(dates.replace(/\r/g, '')),
  'the quarter picker has always been Apr-Jun; a report must not silently mean something else',
)

check(
  'no calendar date is hard-coded in the period logic',
  !/20\d\d-\d\d-\d\d/.test(code(dates).replace(/yyyy-MM-dd/g, '')),
  'periods come from the selection, never from a literal',
)

check(
  'the database buckets in the application display timezone',
  /'Asia\/Kolkata'/.test(m043) && /AT TIME ZONE tz/.test(m043),
  'bucketing in UTC puts the first hours of an IST month into the previous one',
)


// ── 7. Nothing else moved ───────────────────────────────────

console.log(`\n${C.bold}Untouched — approvals, eligibility, routing, the extract${C.reset}\n`)

check(
  'the bulk recognition extract still works, and is still capped',
  /callRpc\('recognition_extract'/.test(api) && /REPORT_ROW_LIMIT/.test(api)
  && /truncated/.test(page),
  'the export and its row cap predate this feature and must survive it',
)

check(
  '043 creates, alters or drops no policy',
  !/CREATE POLICY|ALTER POLICY|DROP POLICY/.test(code(m043, true)),
  'the reporting feature must not touch the existing security model',
)

check(
  '043 writes to no existing table',
  !/(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(nominations|employees|projects|project_members|employee_value_badges)\b/i
    .test(code(m043, true)),
  'reports read; they do not change the data they describe',
)

for (const [label, trigger] of [
  ['041\'s Employee-only nominee rule', 'check_nomination_eligibility'],
  ['042\'s decision integrity guard', 'guard_nomination_decision_integrity'],
] as Array<[string, string]>) {
  check(
    `${label} is still in place`,
    fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .some(f => new RegExp(`CREATE TRIGGER ${trigger}`)
        .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))),
    `${trigger} went missing`,
  )
}

check(
  'no migration before 043 was rewritten to carry this feature',
  fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f < '043')
    .every(f => !/may_report_on|employee_report|organization_report|report_ai_insights/
      .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))),
  'an applied migration was edited instead of a new one being added',
)

/*
  Until 061 the extract was withheld from Managers because it read
  `nominations` from the browser under RLS, where a Manager sees only the rows
  assigned to them — a partial, misleading export. It is now one database
  function that scopes the rows itself, so the check is on THAT property.
*/
const m061 = definingMigration('recognition_extract')
const extractBody = code(fnBody(m061.sql, 'recognition_extract'), true)

check(
  'the extract is scoped in the database, never read from `nominations` in the browser',
  /public\.report_scope_rows\(actor_id, org, f/.test(extractBody)
  && /actor_id\s+uuid := public\.report_actor\(\)/.test(extractBody)
  && !/from\('nominations'\)/.test(api),
  'a Manager\'s export must contain their whole team and nobody else',
)

check(
  'a Manager receives a recognition\'s story only where they could already read it',
  /'narrative_withheld'/.test(extractBody)
  && /THEN k\.what_happened END/.test(extractBody)
  && /k\.status = 'approved'/.test(extractBody)
  && /k\.assigned_approver_id = actor_id/.test(extractBody)
  && !/rejection_reason|clarification_note/.test(extractBody),
  'pending stories decided by another approver, rejection reasons and clarification notes stay private',
)


// ── 8. Team reports, filters and Team Badges (061) ──────────

console.log(`\n${C.bold}Team reports, filters, Team Badges — scoped by the database${C.reset}\n`)

const scopedBody = code(fnBody(definingMigration('scoped_report').sql, 'scoped_report'), true)
const rowsBody   = code(fnBody(definingMigration('report_scope_rows').sql, 'report_scope_rows'), true)
const badgesBody = code(fnBody(definingMigration('team_badges').sql, 'team_badges'), true)
const m061sql    = code(m061.sql, true)

check(
  'the team report chooses its scope from the caller\'s role, not from an argument',
  /org := actor_role IN \('hr_admin', 'super_admin'\)/.test(scopedBody)
  && /\(org OR public\.may_report_on\(actor_id, e\.id\)\)/.test(scopedBody)
  && !/p_manager|p_team|p_scope|p_role/.test(fnBody(definingMigration('scoped_report').sql, 'scoped_report').split('RETURNS')[0]),
  'a Manager must not be able to ask for another team by changing a parameter',
)

check(
  'every counted recognition passes the shared scope rule',
  /\(p_org OR public\.may_report_on\(p_actor, n\.nominee_id\)\)/.test(rowsBody),
  'the row source is the one place scope is applied to recognitions',
)

check(
  'the internal row source is not callable from a session',
  /REVOKE ALL ON FUNCTION public\.report_scope_rows\([^)]*\)\s*FROM PUBLIC, anon, authenticated/.test(m061sql),
  'it returns whole nomination rows and takes p_org as an argument',
)

check(
  'naming an employee outside your scope is refused, not answered with zeros',
  /f \? 'employee_id' AND NOT public\.may_report_on\(actor_id, \(f->>'employee_id'\)::uuid\)/.test(scopedBody),
  'a zero is a claim about a person the caller may not see',
)

check(
  'filters are normalised before any cast',
  /f\s+jsonb := public\.report_filters_clean\(p_filters\)/.test(scopedBody)
  && /report_filters_clean\(p_filters\)/.test(code(fnBody(m061.sql, 'employee_report'), true)),
  'an unvalidated uuid cast is an error message a caller can provoke at will',
)

check(
  'Team Badges takes no argument and resolves the caller from `employees`',
  /FUNCTION public\.team_badges\(\)/.test(m061.sql)
  && /actor_id\s+uuid := public\.report_actor\(\)/.test(badgesBody)
  && /public\.may_report_on\(actor_id, e\.id\)/.test(badgesBody)
  && !/auth\.jwt\(\)/.test(badgesBody),
  'the role claim in a token goes stale; the employees table does not',
)

check(
  'Team Badges reads only the current annual period',
  /evb\.period_start <= today/.test(badgesBody) && /evb\.period_end\s+>= today/.test(badgesBody),
  'last year\'s badges beside this year\'s is the defect this replaced',
)

check(
  'the Team Badges page calls the function, not the badge table',
  /'team_badges'/.test(read('src/lib/api/analytics.ts'))
  && !/from\('employee_value_badges'\)[\s\S]{0,400}listTeamMemberIds/.test(read('src/lib/api/analytics.ts')),
  'three browser round trips under RLS is what silently emptied the page',
)

check(
  'the employee report has exactly one definition, so named calls stay unambiguous',
  /DROP FUNCTION IF EXISTS public\.employee_report\(uuid, date, date, date, date, uuid\)/.test(m061.sql),
  'the AI Edge Function calls employee_report with named arguments',
)


console.log(
  failed === 0
    ? `\n${C.green}All checks passed.${C.reset}\n`
    : `\n${C.red}${failed} check(s) FAILED.${C.reset}\n`,
)

process.exit(failed === 0 ? 0 : 1)
