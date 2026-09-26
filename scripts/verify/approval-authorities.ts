/**
 * Guards the properties of the three-authority approval workflow.
 *
 * Run: npm run verify:authorities
 *
 * The feature rests on four claims that are easy to undo by accident and that
 * no type-check would notice:
 *
 *   1. WHO SEES WHAT is decided in the database, from the session. A Manager is
 *      scoped to the recognitions ROUTED to them; HR and Super Admin see the
 *      organisation. The query takes no arguments, so there is nothing in the
 *      request to point at someone else's queue.
 *   2. EXACTLY ONE authority can decide. The row is locked before its status is
 *      read, and a second decision is refused rather than allowed to overwrite.
 *   3. WHO DECIDED is recorded for all three actions, with the role they held
 *      at the time, and it cannot be forged from a browser session.
 *   4. ROUTING IS UNTOUCHED. The approver still comes from the project the
 *      recognizer selected, never from employees.manager_id and never from the
 *      nominee's assignment.
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * Like approval-routing.ts, moderation-security.ts and
 * recognition-eligibility.ts, this checks the SHAPE OF THE CODE, not a running
 * database. It cannot tell you that two simultaneous decisions really produced
 * one winner — that needs two verified sessions racing each other against the
 * real database, and is manual UAT. It asserts that the mechanism which would
 * produce that outcome is present and wired up.
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
 * Source with its comments removed.
 *
 * Needed because several assertions here are of the form "X no longer appears",
 * and this codebase documents what it removed — `writeAuditLog() lived here and
 * is gone` would otherwise fail the check that writeAuditLog is gone. Matching
 * on prose is how a passing assertion becomes a lying one, in either direction.
 */
function code(source: string, sql = false): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(sql ? /--.*$/gm : /\/\/.*$/gm, ' ')
}

/**
 * The migration that currently DEFINES a function — the highest-numbered file
 * containing a definition, never a hard-coded filename. Same lesson
 * approval-routing.ts learned when 030 replaced 029's routing function.
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


// ── 1. Visibility is the database's, and differs by role ────

console.log(`\n${C.bold}Visibility — scoped in the database, from the session${C.reset}\n`)

const queue = definingMigration('recognition_approval_queue')
const queueBody = fnBody(queue.sql, 'recognition_approval_queue')

check('an approval queue function exists', queueBody.length > 0,
  'public.recognition_approval_queue() was not found in any migration')

check(
  'it takes no arguments — nothing in the request to steer it',
  /FUNCTION public\.recognition_approval_queue\(\)/.test(queue.sql),
  'a parameter is a lever a Manager could pull at another Manager\'s queue',
)

check(
  'a Manager is scoped to the recognitions ROUTED to them',
  /WHEN 'manager'\s+THEN n\.assigned_approver_id = public\.employee_id\(\)/.test(queueBody),
  queueBody,
)

check(
  'HR sees the organisation',
  /WHEN 'hr_admin'\s+THEN true/.test(queueBody),
  queueBody,
)

check(
  'Super Admin sees the organisation',
  /WHEN 'super_admin'\s+THEN true/.test(queueBody),
  queueBody,
)

check(
  'every other role sees nothing — it fails closed',
  /ELSE false/.test(queueBody),
  'an unrecognised role must match no rows, not all of them',
)

check(
  'the caller\'s role is read from the database, not from an argument',
  /public\.current_employee_role\(\)/.test(queueBody)
  && !/p_role|p_actor|p_approver/.test(queueBody),
  queueBody,
)

check(
  'it is SECURITY INVOKER, so the nominations policies still decide',
  /SECURITY INVOKER/.test(queueBody) && !/SECURITY DEFINER/.test(queueBody),
  'a definer queue would return rows the caller\'s own policies refuse',
)

check(
  'anon cannot call it',
  /REVOKE EXECUTE ON FUNCTION public\.recognition_approval_queue\(\) FROM PUBLIC, anon/.test(queue.sql)
  && /GRANT\s+EXECUTE ON FUNCTION public\.recognition_approval_queue\(\) TO authenticated/.test(queue.sql),
  queue.name,
)

check(
  'handled recognitions stay in the queue, with who decided them',
  /'decision',\s+public\.nomination_decision\(n\.id\)/.test(queueBody)
  && /n\.status = 'pending'\s*\n?\s*OR COALESCE\(n\.approved_at/.test(queueBody.replace(/\r/g, '')),
  'a decision by another authority would look like the recognition vanishing',
)


// ── 2. Exactly one authority wins ───────────────────────────

console.log(`\n${C.bold}Concurrency — one decision, decided by the database${C.reset}\n`)

const decision = definingMigration('record_nomination_decision')
const decisionBody = fnBody(decision.sql, 'record_nomination_decision')

check('an atomic decision function exists', decisionBody.length > 0, decision.name)

check(
  'it locks the row BEFORE it reads the status',
  (() => {
    const lock = decisionBody.indexOf('FOR UPDATE')
    const authority = decisionBody.indexOf('nomination_decision_authority')
    return lock > 0 && authority > lock
  })(),
  'reading the status before taking the lock is the race this must not have',
)

check(
  'a second decision is refused, not applied',
  /'already_handled'/.test(decisionBody),
  decisionBody,
)

check(
  'the refusal names the decision that won',
  /'decision',\s+public\.nomination_decision\(nom\.id\)/.test(decisionBody),
  '"already handled" without saying by whom invites the obvious next question',
)

check(
  'every UPDATE is conditional on the row still being pending',
  (decisionBody.match(/AND status = 'pending'/g) ?? []).length === 3,
  `expected 3 guarded updates (approve, reject, clarify), found ${(decisionBody.match(/AND status = 'pending'/g) ?? []).length}`,
)

check(
  'the row count is checked rather than assumed',
  /GET DIAGNOSTICS affected = ROW_COUNT/.test(decisionBody)
  && /IF affected = 0 THEN/.test(decisionBody),
  'reporting success when no row changed is the failure this prevents',
)

check(
  'a browser cannot call the decision function at all',
  /REVOKE EXECUTE ON FUNCTION public\.record_nomination_decision\([^)]*\)\s*\n?\s*FROM PUBLIC, anon, authenticated/
    .test(decision.sql.replace(/\r/g, ''))
  && /GRANT\s+EXECUTE ON FUNCTION public\.record_nomination_decision\([^)]*\)\s*\n?\s*TO service_role/
    .test(decision.sql.replace(/\r/g, '')),
  'granting this to authenticated would let a browser approve without the notifications and badges',
)


// ── 3. Who may act — one rule, three callers ────────────────

console.log(`\n${C.bold}Authority — one definition of who may decide${C.reset}\n`)

const authority = definingMigration('nomination_decision_authority')
const authorityBody = fnBody(authority.sql, 'nomination_decision_authority')

check('a single shared authority function exists', authorityBody.length > 0, authority.name)

check(
  'a Manager may act only on what was routed to them',
  /actor\.role = 'manager' AND nom\.assigned_approver_id IS DISTINCT FROM actor\.id/.test(authorityBody),
  authorityBody,
)

check(
  'HR and Super Admin are not scoped to a project',
  !/hr_admin.*assigned_approver_id|assigned_approver_id.*hr_admin/.test(authorityBody),
  'an organisation-wide authority must not be narrowed to one project',
)

check(
  'an Employee is refused',
  /actor\.role NOT IN \('manager', 'hr_admin', 'super_admin'\)/.test(authorityBody),
  authorityBody,
)

check(
  'nobody decides a recognition they are a party to',
  /actor\.id = nom\.nominator_id OR actor\.id = nom\.nominee_id/.test(authorityBody),
  'the routing trigger already refuses to route to a party — this keeps that rule',
)

check(
  'only a pending recognition is actionable',
  /nom\.status <> 'pending'/.test(authorityBody) && /'already_handled'/.test(authorityBody),
  authorityBody,
)

check(
  'the decision path and the queue share this one definition',
  /public\.nomination_decision_authority\(/.test(decisionBody)
  && /public\.nomination_decision_authority\(/.test(queueBody),
  'the buttons and the refusal would be free to drift apart',
)


// ── 4. The actor is recorded, and cannot be forged ──────────

console.log(`\n${C.bold}The actor — recorded, snapshotted, unforgeable${C.reset}\n`)

const m042 = read('supabase/migrations/042_recognition_approval_authorities.sql')

check(
  'clarification now records WHO asked',
  /ADD COLUMN IF NOT EXISTS clarification_requested_by_id\s+UUID REFERENCES employees\(id\)/.test(m042),
  'clarification was the one action with no recorded actor',
)

for (const col of ['approved_by_role', 'rejected_by_role', 'clarification_requested_by_role']) {
  check(
    `${col} snapshots the role held at the time`,
    new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\s+TEXT`).test(m042),
    'without it the UI would describe a past decision with the actor\'s role today',
  )
}

check(
  'the decision writes the actor and their role for all three actions',
  (decisionBody.match(/_by_id\s+= actor\.id/g) ?? []).length === 3
  && (decisionBody.match(/_by_role\s+= actor\.role/g) ?? []).length === 3,
  decisionBody,
)

check(
  'the actor is an argument, never a client-supplied field',
  !/auth\.jwt\(\)/.test(decisionBody),
  'the decision function must be handed the identity the Edge Function validated',
)

const guard = definingMigration('guard_nomination_decision_integrity')
const guardBody = fnBody(guard.sql, 'guard_nomination_decision_integrity')

check('a forgery guard exists on UPDATE', guardBody.length > 0, guard.name)

check(
  'it is attached as a BEFORE UPDATE trigger',
  /CREATE TRIGGER guard_nomination_decision_integrity\s+BEFORE UPDATE ON nominations/.test(m042),
  'the function exists but nothing fires it',
)

check(
  'a browser session cannot move a recognition into a decided state',
  /NEW\.status IN \('approved', 'rejected', 'clarification_requested'\)/.test(guardBody),
  'nominations_hr_update would otherwise let HR write an approval nobody made',
)

check(
  'a browser session cannot edit who decided',
  ['approved_by_id', 'rejected_by_id', 'clarification_requested_by_id',
   'approved_by_role', 'rejected_by_role', 'clarification_requested_by_role']
    .every(c => guardBody.includes(`NEW.${c}`)),
  guardBody,
)

check(
  'moderation and clarification answers still pass — only decisions are guarded',
  !/'removed'/.test(guardBody) && !/NEW\.status = 'pending'/.test(guardBody)
  && /IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/.test(guardBody),
  'remove_recognition (034) and the nominator\'s clarification answer must not be refused',
)

check(
  'the audit row is written in the same transaction as the decision',
  /INSERT INTO audit_logs/.test(decisionBody)
  && /'actor_role', actor\.role/.test(decisionBody),
  'written afterwards, a decision could be durable while the record of it was lost',
)

check(
  'the Edge Function no longer writes its own audit row',
  !/writeAuditLog\(/.test(code(read('supabase/functions/process-approval/index.ts'))),
  'two audit writers would double-record every decision',
)


// ── 5. Notifications reach all three, without spam ──────────

console.log(`\n${C.bold}Notifications — all three asked, none spammed${C.reset}\n`)

const notify = definingMigration('notify_nomination_submitted')
const notifyBody = fnBody(notify.sql, 'notify_nomination_submitted')

check(
  'the routed approver is still notified, exactly as before',
  /VALUES \(NEW\.assigned_approver_id, 'approval_required'/.test(notifyBody),
  notifyBody,
)

check(
  'HR and Super Admin are notified too',
  /WHERE e\.role IN \('hr_admin', 'super_admin'\)/.test(notifyBody)
  && /AND e\.is_active/.test(notifyBody),
  notifyBody,
)

check(
  'nobody is notified twice, and parties are not asked to review their own',
  /e\.id IS DISTINCT FROM NEW\.assigned_approver_id/.test(notifyBody)
  && /e\.id <> NEW\.nominator_id/.test(notifyBody)
  && /e\.id <> NEW\.nominee_id/.test(notifyBody),
  notifyBody,
)

check(
  'no new notification type was invented — the CHECK constraint is untouched',
  !/notifications_type_check|ALTER TABLE notifications/.test(m042),
  'adding a type means altering a constraint; approval_required already says this',
)

check(
  'a decision settles the outstanding requests instead of sending more',
  /UPDATE notifications/.test(decisionBody)
  && /type\s+= 'approval_required'/.test(decisionBody)
  && /is_read = true/.test(decisionBody),
  'one "already handled" message per authority per decision is the spam to avoid',
)


// ── 6. Nothing else moved ───────────────────────────────────

console.log(`\n${C.bold}Untouched — routing, publication, badges, eligibility${C.reset}\n`)

const routing = definingMigration('route_nomination_to_project_manager')

check(
  '042 does not redefine the routing trigger',
  !/FUNCTION public\.route_nomination_to_project_manager/.test(m042)
  && !/TRIGGER route_nomination_to_project_manager/.test(m042),
  'approval routing was changed by the approval-authorities migration',
)

check(
  'routing is still the SELECTED PROJECT\'s manager',
  /NEW\.assigned_approver_id := mgr\.id/.test(routing.sql)
  && /proj\.manager_id/.test(routing.sql),
  routing.name,
)

check(
  'employees.manager_id is not reintroduced anywhere in 042',
  /*
    Comments stripped first, and 042's own verification block excused: the one
    surviving mention of `e.manager_id` there is an assertion that the routing
    function does NOT reference it, which is the opposite of reintroducing it.
  */
  !/employees\.manager_id/.test(code(m042, true))
  && !/e\.manager_id/.test(code(m042, true).replace(/NOT LIKE '%e\.manager_id%'/g, '')),
  'the line-manager relationship is retired (030) and must stay retired',
)

check(
  '042 never WRITES to project or membership data',
  /*
    Reading a project's name to display it is fine, and the queue does exactly
    that with a LEFT JOIN. What must not appear is a WRITE: routing, project
    managers and memberships are not this feature's to change.
  */
  !/(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(projects|project_members)\b/i
    .test(code(m042, true))
  && !/ALTER TABLE\s+(public\.)?(projects|project_members)\b/i.test(code(m042, true)),
  'the approval-authorities migration writes to project data',
)

check(
  'no policy is created, altered or dropped',
  !/CREATE POLICY|ALTER POLICY|DROP POLICY/.test(m042),
  'the visibility model was already in the policies; 042 must not change them',
)

check(
  '041\'s Employee-only nominee rule is still in place',
  /CREATE TRIGGER check_nomination_eligibility/
    .test(read('supabase/migrations/041_employee_nominee_eligibility.sql')),
  'the nominee eligibility trigger went missing',
)

check(
  'only an approval publishes — nothing else sets published_at',
  /published_at\s+= now\(\)/.test(decisionBody)
  && !/published_at/.test(fnBody(m042, 'recognition_approval_queue')),
  'a pending recognition must never reach the feed',
)

check(
  'no migration before 042 was rewritten to carry this feature',
  fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f < '042')
    .every(f => !/record_nomination_decision|recognition_approval_queue|nomination_decision_authority/
      .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))),
  'an applied migration was edited instead of a new one being added',
)


// ── 7. The frontend asks, and does not decide ───────────────

console.log(`\n${C.bold}The frontend — asks the database, decides nothing${C.reset}\n`)

const api = read('src/lib/api/recognitions.ts')
const page = read('src/pages/manager/PendingApprovalsPage.tsx')
const hooks = read('src/hooks/queries/useRecognitions.ts')
const edge = read('supabase/functions/process-approval/index.ts')

check(
  'the queue is fetched through the RPC, not a filtered table query',
  /supabase\.rpc\('recognition_approval_queue'\)/.test(api)
  && !/\.eq\('assigned_approver_id'/.test(api),
  'filtering by approver id in the browser is what left HR with an empty page',
)

check(
  'the queue API takes no approver id',
  /async getApprovalQueue\(\): Promise<ApprovalQueueItem\[\]>/.test(api),
  'an id in the signature is an id in the request',
)

check(
  'the decision API sends no approver id either',
  // Scoped to decide()'s own body: `assigned_approver_id` legitimately appears
  // elsewhere in this file, where the wizard reads back WHO the database routed
  // a submission to.
  (() => {
    const body = code(api)
    const start = body.indexOf('async decide(')
    const decideBody = start < 0 ? '' : body.slice(start, body.indexOf('\n  },', start))
    return decideBody.length > 0
      && !/approver_id/.test(decideBody)
      && !/approverId/.test(decideBody)
  })(),
  'an ignored field that looks authoritative reads like a lever',
)

check(
  'the Edge Function resolves the actor from the validated token',
  /p_actor_id: approverEmp\.id/.test(edge)
  && /\.eq\('auth_user_id', user\.id\)/.test(edge),
  edge.slice(0, 200),
)

check(
  'the Edge Function no longer decides authorization for itself',
  !/isAuthorized/.test(edge) && /record_nomination_decision/.test(edge),
  'a second copy of the rule is free to drift from the one the queue uses',
)

check(
  'the Edge Function no longer writes the status itself',
  !/status: 'approved'/.test(edge)
  && !/status: 'rejected'/.test(edge)
  && !/status: 'clarification_requested'/.test(edge),
  'a bare status update has no lock and no precondition',
)

check(
  'a lost race is surfaced to the user, not swallowed',
  /already_handled/.test(api) && /already_handled/.test(page),
  'three authorities re-clicking at each other with no explanation',
)

check(
  'the queue is refetched whether the decision landed or was refused',
  /onSettled: \(\) => \{ void invalidate\.approvalQueues\(\) \}/.test(hooks),
  'a refused decision leaves a stale "pending" row with three live buttons',
)

check(
  'the buttons follow the database\'s own can_act, not a local role check',
  /item\.can_act/.test(page)
  && !/role === 'manager'.*can|canAct =/.test(page),
  page.slice(0, 200),
)

check(
  'the actor is shown, never a bare status',
  /DecisionLine/.test(page)
  && /actorRole=\{item\.decision\.actor_role\}/.test(page),
  'a status with no actor is the ambiguity this feature exists to remove',
)

check(
  'the author sees who decided their recognition too',
  /DecisionLine/.test(read('src/pages/employee/MyRecognitionsPage.tsx')),
  'My Recognitions still reports only "Not approved"',
)

check(
  'one component renders the actor line everywhere',
  fs.existsSync(path.join(ROOT, 'src/components/recognition/DecisionLine.tsx'))
  && /roleLabel/.test(read('src/components/recognition/DecisionLine.tsx')),
  'per-screen wording is how the Manager and HR end up reading different sentences',
)


console.log(
  failed === 0
    ? `\n${C.green}All checks passed.${C.reset}\n`
    : `\n${C.red}${failed} check(s) FAILED.${C.reset}\n`,
)

process.exit(failed === 0 ? 0 : 1)
