/**
 * Verifies the pre-handover security hardening (migration 057) and the app
 * code that depends on it.
 *
 * Run: npm run verify:security
 *
 * Static checks, like the other verifiers: they read the migrations and the
 * source rather than a database. Each one names a hole that was reproduced
 * against the full migration chain and closed by 057 -- if a later migration
 * redefines one of these functions or drops one of these triggers without the
 * rule, this fails and says which.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')

const migrationsDir = join(root, 'supabase', 'migrations')
const migrations = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

/** The LAST migration that defines `fn`, and that definition's body. */
function lastDefinition(fn: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null
  const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`, 'i')
  for (const file of migrations) {
    const sql = read(join('supabase', 'migrations', file))
    const at = sql.search(head)
    if (at < 0) continue
    const tag = sql.slice(at).match(/AS\s+(\$[a-z]*\$)/i)?.[1] ?? '$$'
    const start = sql.indexOf(tag, at) + tag.length
    found = { file, body: sql.slice(start, sql.indexOf(tag, start)) }
  }
  return found
}

const m057 = migrations.find(f => f.startsWith('057_'))
const sql057 = m057 ? read(join('supabase', 'migrations', m057)) : ''

console.log('\nDeactivated accounts\n')

for (const fn of ['session_second_factor_ok', 'session_second_factor_ok_for']) {
  const def = lastDefinition(fn)
  check(`${fn}() refuses a deactivated employee`,
    !!def && /NOT EXISTS[\s\S]*employees[\s\S]*NOT is_active/.test(def.body),
    `last defined in ${def?.file ?? 'nowhere'} without the is_active test`)
}
check('session_status() reports account_inactive',
  /'account_inactive'/.test(lastDefinition('session_status')?.body ?? ''),
  'the sign-in screen cannot tell a deactivated account from an unlinked one')
check('AuthContext acts on account_inactive',
  (read('src/context/AuthContext.tsx').match(/status\.account_inactive/g) ?? []).length >= 2,
  'both applySession and completeSignIn must check it')

console.log('\nDirect table writes\n')

for (const [trigger, table] of [
  ['guard_employee_direct_write', 'employees'],
  ['guard_nomination_submission', 'nominations'],
  ['guard_nomination_direct_update', 'nominations'],
  ['guard_reward_assignment_write', 'reward_assignments'],
] as const) {
  check(`${trigger} is attached to ${table}`,
    new RegExp(`CREATE TRIGGER ${trigger}[\\s\\S]*?ON public\\.${table}`).test(sql057),
    'missing from 057')

  const body = lastDefinition(trigger)?.body ?? ''
  check(`${trigger}() is SECURITY INVOKER and keys on current_user`,
    !/SECURITY DEFINER/.test(sql057.slice(sql057.indexOf(`FUNCTION public.${trigger}`),
                                          sql057.indexOf(`FUNCTION public.${trigger}`) + 200))
      && (trigger === 'guard_nomination_submission' || /current_user/.test(body)),
    'as SECURITY DEFINER, current_user is the owner and every write looks trusted')
}

const employeeGuard = lastDefinition('guard_employee_direct_write')?.body ?? ''
check('nobody deletes an employee row directly',
  /TG_OP = 'DELETE'[\s\S]*RAISE/.test(employeeGuard), 'Delete employee must be the only path')
check('email and auth_user_id are never changed directly',
  /NEW\.auth_user_id\s+IS DISTINCT FROM OLD\.auth_user_id/.test(employeeGuard)
    && /NEW\.email\s+IS DISTINCT FROM OLD\.email/.test(employeeGuard),
  'HR could re-point a Super Admin record and claim it')
check('HR cannot change a Super Admin record',
  /caller_role = 'hr_admin' AND OLD\.role = 'super_admin'/.test(employeeGuard), 'HR -> Super Admin')

const submission = lastDefinition('guard_nomination_submission')?.body ?? ''
check('a recognition cannot be inserted already decided',
  /NEW\.status IS DISTINCT FROM 'pending'/.test(submission), 'self-approval by INSERT')
check('behaviour and scenario must belong to their parent',
  /core_value_id = NEW\.core_value_id/.test(submission) && /behaviour_id = NEW\.behaviour_id/.test(submission),
  'taxonomy mismatch accepted')
check('snapshot names come from the catalogue',
  /NEW\.snapshot_core_value_name := cv_name/.test(submission), 'forged names stored')

const rewardGuard = lastDefinition('guard_reward_assignment_write')?.body ?? ''
check('nobody decides their own reward request',
  /NEW\.decided_by_id = NEW\.employee_id/.test(rewardGuard), 'HR self-approval')

console.log('\nBoundaries and grants\n')

check('HR cannot write the signup domain policy',
  /CREATE POLICY "app_config_hr_write"[\s\S]*key <> 'signup_allowed_domains'/.test(sql057),
  'app_config_hr_write lets HR widen self-registration')
for (const fn of ['custom_access_token_hook', 'open_value_coin_wallet', 'refresh_value_coin_budget',
                  'app_config_text', 'value_coin_setting']) {
  check(`${fn}() is not executable by anon or authenticated`,
    new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated`).test(sql057),
    'Supabase grants EXECUTE to anon/authenticated explicitly; REVOKE FROM PUBLIC is not enough')
}
check('check_signup_eligibility() does not reveal a registered account\'s role',
  /'already_registered', 'expected_role', NULL/.test(lastDefinition('check_signup_eligibility')?.body ?? ''),
  'anyone could look up whether an address belongs to a Super Admin')
{
  const body = lastDefinition('send_value_coins')?.body ?? ''
  check('the daily coin cap is counted after the wallet locks',
    body.indexOf('FOR UPDATE') > 0 && body.indexOf('FOR UPDATE') < body.indexOf('sent_today + p_amount'),
    'two concurrent sends can both pass the cap')
}

console.log('\nEdge Functions\n')

for (const fn of ['check-duplicate', 'check-rate-limits']) {
  const src = read(`supabase/functions/${fn}/index.ts`)
  check(`${fn} counts the caller, not a nominator_id from the body`,
    /const nominator_id = callerEmp\.id/.test(src), 'the service role reads past RLS')
}
check('process-approval counts approvals through 31 December',
  /\.lt\('approved_at', nextYearStart\)/.test(read('supabase/functions/process-approval/index.ts')),
  "lte('YYYY-12-31') stops at midnight at the start of the day")

console.log('\nApp code\n')

const client = read('src/lib/api/client.ts')
check('toApiError still hides constraint text',
  /violates check constraint/.test(client), 'raw Postgres wording would reach the screen')
/*
  Either paged with fetchAllRows, or — since 061 — one call to a function that
  returns a SINGLE jsonb value. The response cap limits rows, and a scalar
  result is one row however many recognitions it carries.
*/
check('the recognition export reads past the 1000-row response cap',
  /fetchAllRows\(/.test(read('src/lib/api/reports.ts'))
  || (/callRpc\('recognition_extract'/.test(read('src/lib/api/reports.ts'))
      && /FUNCTION public\.recognition_extract\([^)]*\)\s*RETURNS jsonb/.test(
        read('supabase/migrations/061_team_reports_filters_and_badges.sql'))),
  'exports were silently cut to 1000 rows')
check('HR dashboard and leader board read past the 1000-row response cap',
  (read('src/lib/api/analytics.ts').match(/fetchAllRows\(/g) ?? []).length >= 4,
  'figures silently computed from the first 1000 rows')

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
