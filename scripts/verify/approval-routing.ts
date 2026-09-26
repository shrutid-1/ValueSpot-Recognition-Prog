/**
 * Guards the one security property of project-based approval routing:
 *
 *   THE BROWSER CANNOT CHOOSE WHO APPROVES A RECOGNITION.
 *
 * Run: npm run verify:routing
 *
 * Before migration 029 the frontend walked the nominee's management chain and
 * submitted the result as `assigned_approver_id`. The row-level policy on
 * `nominations` never constrained that column, so a modified client could name
 * any approver — including the nominator. Routing now happens in a BEFORE
 * INSERT trigger that overwrites whatever arrives.
 *
 * That property is easy to undo by accident: one well-meaning `assigned_
 * approver_id:` added back to an insert payload would restore the hole without
 * failing a type-check. These are the assertions that would notice.
 *
 * This checks the SHAPE OF THE CODE, not the running database. It cannot tell
 * you the trigger fired correctly against real rows — that needs the database,
 * and is listed as manual UAT in the report.
 */
import fs from 'node:fs'
import path from 'node:path'

let failures = 0

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const SRC = path.join(process.cwd(), 'src')
const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

/**
 * The migration that currently DEFINES the routing function.
 *
 * Deliberately the highest-numbered one that contains a definition, not a
 * hard-coded filename. An earlier version of this script pinned 029 and kept
 * passing after 030 replaced the function — it was asserting against history
 * rather than against what the database actually runs.
 */
function effectiveRoutingMigration(): { name: string; sql: string } {
  const defining = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .filter(f => /FUNCTION public\.route_nomination_to_project_manager/
      .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
    .sort()

  const name = defining[defining.length - 1]
  if (!name) throw new Error('No migration defines route_nomination_to_project_manager')
  return { name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }
}

console.log('\nApproval routing — the approver is not a browser decision\n')

/* ── 1. No frontend file writes the approver column ──────── */

const sources = walk(SRC)
const writers: string[] = []

for (const file of sources) {
  /*
    supabase-types.ts is generated from the schema. It DECLARES the column
    (`assigned_approver_id: string | null`), which is not a write and must not
    be confused for one — the column still exists and is still read.
  */
  if (file.endsWith('supabase-types.ts')) continue

  const text = fs.readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    // An object property assignment, e.g. `assigned_approver_id: x`.
    // Reads (.eq('assigned_approver_id', …), select lists) are fine and expected.
    if (/^\s*assigned_approver_id\s*:/.test(line)) {
      writers.push(`${path.relative(process.cwd(), file)}:${i + 1}`)
    }
  })
}

check(
  'no frontend source assigns assigned_approver_id',
  writers.length === 0,
  `assigned in: ${writers.join(', ')}`,
)

/* ── 2. The submit contract offers no approver lever ─────── */

// Line endings normalised: the checkout may be CRLF (core.autocrlf), and the
// patterns below are written against '\n'.
const recognitions = fs.readFileSync(
  path.join(SRC, 'lib', 'api', 'recognitions.ts'), 'utf8',
).replace(/\r\n/g, '\n')
const inputBlock = recognitions.slice(
  recognitions.indexOf('export interface SubmitRecognitionInput'),
  recognitions.indexOf('export type SubmitResult'),
)

check(
  'SubmitRecognitionInput has no approver field',
  !/\bassignedApproverId\b/.test(inputBlock) && !/\bescalationLevel\b/.test(inputBlock),
  'an approver or escalation field is back on the submit contract',
)

check(
  'SubmitRecognitionInput requires a project',
  /\n\s*projectId:\s*string\n/.test(inputBlock),
  'projectId is optional or missing — routing has nothing to resolve from',
)

check(
  'the client-side management-chain walk is gone',
  !/resolveApprover/.test(recognitions),
  'resolveApprover is back in the API layer',
)

check(
  'no source calls resolveApprover',
  !sources.some(f => /resolveApprover/.test(fs.readFileSync(f, 'utf8'))),
  'something still resolves an approver in the browser',
)

/* ── 3. The effective migration actually takes the decision ─ */

const { name: migrationName, sql } = effectiveRoutingMigration()
console.log(`  (routing defined by ${migrationName})
`)

check(
  'a BEFORE INSERT trigger routes nominations',
  /BEFORE INSERT ON nominations/.test(
    fs.readFileSync(path.join(MIGRATIONS_DIR, '029_project_based_approval_routing.sql'), 'utf8'),
  ) && /route_nomination_to_project_manager/.test(sql),
  'the routing trigger is not installed on nominations',
)

check(
  'the trigger OVERWRITES the approver rather than reading it',
  /NEW\.assigned_approver_id\s*:=/.test(sql),
  'the effective definition does not assign NEW.assigned_approver_id',
)

check(
  'a missing project is refused',
  /NEW\.project_id IS NULL/.test(sql),
  'a nomination without a project is not rejected',
)

check(
  'an archived project is refused',
  /NOT proj\.is_active/.test(sql),
  'inactive projects are not rejected',
)

check(
  'a project with no manager is refused',
  /proj\.manager_id IS NULL/.test(sql),
  'a project without a manager is not rejected',
)

check(
  'a project manager must hold the Manager role',
  /mgr\.role\s*<>\s*'manager'/.test(sql),
  'project manager eligibility is not constrained by role',
)

/*
  The corrected rule: the RECOGNIZER chooses the project, so the nominee's own
  membership must NOT be a precondition. 029 required it; 030 removed it. This
  asserts the removal stuck.
*/
check(
  "the project is NOT required to be the nominee's own",
  !/pm\.employee_id\s*=\s*NEW\.nominee_id/.test(sql),
  'the effective definition still ties the project to the nominee',
)

check(
  'a selectable-projects function exists for the wizard',
  fs.readdirSync(MIGRATIONS_DIR).some(f =>
    /FUNCTION public\.selectable_recognition_projects/
      .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))),
  'nothing defines which projects the wizard may offer',
)

check(
  'one active project per employee is still enforced by an index',
  fs.readdirSync(MIGRATIONS_DIR).some(f =>
    /CREATE UNIQUE INDEX[\s\S]*project_members[\s\S]*WHERE is_active/
      .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))),
  'the one-project rule is not enforced in the schema',
)

/* ── 4. The employee->manager relationship is out of the path ─ */

check(
  "no source classifies a recognition by the nominee's line manager",
  !sources.some(f => /nomineeManagerId\s*[,)]/.test(fs.readFileSync(f, 'utf8'))),
  'something still keys behaviour on the nominee manager relationship',
)

check(
  'the employee admin form no longer assigns a manager',
  !/register\('manager_id'\)/.test(
    fs.readFileSync(path.join(SRC, 'pages', 'hr', 'EmployeesPage.tsx'), 'utf8')),
  'the employee Manager selector is back',
)

check(
  'the employees API takes no managerId',
  !/managerId/.test(fs.readFileSync(path.join(SRC, 'lib', 'api', 'employees.ts'), 'utf8')
    .split('async listTeamMemberIds')[0]),
  'employee create/update still accepts a manager',
)

console.log(
  failures === 0
    ? '\nAll checks passed — routing is decided by the database.\n'
    : `\n${failures} check(s) FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
