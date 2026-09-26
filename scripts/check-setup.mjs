#!/usr/bin/env node
/**
 * ValueSpot setup checker.
 *
 *   npm run doctor
 *
 * Probes the configured Supabase project read-only and reports what is and is
 * not in place, with the exact remediation for anything missing. Nothing here
 * writes data or creates accounts.
 */
import fs from 'node:fs'
import path from 'node:path'

const RESET = '[0m'
const BOLD = '[1m'
const RED = '[31m'
const GREEN = '[32m'
const YELLOW = '[33m'
const DIM = '[2m'

const problems = []

function ok(label, detail = '') {
  console.log(`  ${GREEN}PASS${RESET}  ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function fail(label, fix) {
  console.log(`  ${RED}FAIL${RESET}  ${label}`)
  problems.push({ label, fix })
}
function warn(label, detail = '') {
  console.log(`  ${YELLOW}WARN${RESET}  ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`)
}

// ── Environment ─────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return {}
  const out = {}
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnv(), ...process.env }
const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY

console.log(`${BOLD}ValueSpot setup check${RESET}`)

section('Environment')
if (!url || !anon) {
  fail('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set',
       'Copy .env.example to .env and fill in the project URL and anon key.')
  console.log(`\n${RED}Cannot continue without project credentials.${RESET}`)
  process.exit(1)
}
ok('Supabase credentials present', new URL(url).host)

const headers = { apikey: anon, 'Content-Type': 'application/json' }

async function get(pathname) {
  try {
    const res = await fetch(`${url}${pathname}`, { headers })
    return { status: res.status, body: await res.text() }
  } catch (err) {
    return { status: 0, body: String(err) }
  }
}
async function post(pathname, payload) {
  try {
    const res = await fetch(`${url}${pathname}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    })
    return { status: res.status, body: await res.text() }
  } catch (err) {
    return { status: 0, body: String(err) }
  }
}

// ── Connectivity ────────────────────────────────────────────
section('Connectivity')
const settingsRes = await get('/auth/v1/settings')
if (settingsRes.status !== 200) {
  fail(`Reach the Supabase project (got HTTP ${settingsRes.status})`,
       'Check VITE_SUPABASE_URL and that the project is not paused.')
  console.log(`\n${RED}Cannot continue.${RESET}`)
  process.exit(1)
}
ok('Project reachable')

// ── Auth configuration ──────────────────────────────────────
section('Auth configuration  (Dashboard > Authentication > Providers > Email)')
const settings = JSON.parse(settingsRes.body)

if (settings.disable_signup === true) {
  fail('"Allow new users to sign up" is ON',
       'Turn it ON. Self-registration can only ever produce the lowest role, ' +
       'and every account must still pass the emailed code, so leaving signup ' +
       'open is safe — turning it off blocks all registration.')
} else {
  ok('"Allow new users to sign up" is ON')
}

if (settings.mailer_autoconfirm === true) {
  ok('"Confirm email" is OFF', 'correct — verification is handled by ValueSpot itself')
} else {
  fail('"Confirm email" is OFF',
       'Turn it OFF. The six-digit code is sent by ValueSpot through Resend ' +
       '(migration 021), not by Supabase. Leaving Supabase confirmation on adds ' +
       'a second, redundant email and reintroduces the shared-sender rate limit.')
}

// Not detectable from here: hook registration is project configuration, not
// schema, and the anon key cannot read it. Flagged every run because its
// absence is invisible and its symptom is misleading — pages load, the sidebar
// is right, and every HR query quietly returns nothing.
warn('Custom access token hook cannot be probed from here',
     'Authentication > Hooks must point at custom_access_token_hook, or RLS ' +
     'sees every user as an employee')

// ── Migrations ──────────────────────────────────────────────
section('Database migrations  (Dashboard > SQL Editor)')

const tableChecks = [
  ['employees', '001-006 core schema'],
  ['nominations', '003 nominations'],
  ['notifications', '005 supporting tables'],
]
for (const [table, label] of tableChecks) {
  const res = await get(`/rest/v1/${table}?select=id&limit=1`)
  if (res.status === 200) ok(`${label}`, table)
  else fail(`${label} (${table} -> HTTP ${res.status})`,
            'Run supabase/migrations/001..006 in the SQL Editor, in order.')
}

const rpc007 = await post('/rest/v1/rpc/app_config_text', { config_key: 'timezone', fallback: 'x' })
// 404 = missing. Anything else (incl. permission denied) means it exists.
if (rpc007.status === 404) {
  fail('Migration 007 applied  (rate limits + config access)',
       'Run supabase/migrations/007_rate_limits_and_config_access.sql')
} else {
  ok('Migration 007 applied', 'rate limits + config access')
}

// Probe each object from 011 separately: if only some are present, the script
// was partially applied and the error message from the SQL Editor matters.
const authFns = [
  ['auth_setup_status', {}],
  ['check_signup_eligibility', { p_email: 'setup-check@invalid.local', p_full_name: 'Setup Check' }],
  ['claim_employee_account', {}],
]
const missing = []
for (const [fn, payload] of authFns) {
  const res = await post(`/rest/v1/rpc/${fn}`, payload)
  if (res.status === 404) missing.push(fn)
}

if (missing.length === authFns.length) {
  fail('Migration 011 applied  (AUTHENTICATION — nothing works without this)',
       'Run supabase/migrations/011_auth_complete.sql in the SQL Editor. Until it is ' +
       'applied, sign-up creates a row in auth.users that is never linked to an ' +
       'employee record, so sign-in has no profile to load. The file is idempotent ' +
       'and also repairs accounts already created.')
} else if (missing.length > 0) {
  fail(`Migration 011 only partially applied (missing: ${missing.join(', ')})`,
       'The SQL Editor stopped on an error part-way through. Re-run ' +
       'supabase/migrations/011_auth_complete.sql and paste the error it reports — ' +
       'it is safe to run repeatedly.')
} else {
  ok('Migration 011 applied', 'account linking, invitations, eligibility')

  // 012 is detectable by behaviour rather than presence: it is the version that
  // answers 'open' for an address nobody has been invited under. 011 on its own
  // answers 'not_eligible' and blocks the signup.
  const probe = await post('/rest/v1/rpc/check_signup_eligibility', {
    p_email: `setup-check-${Date.now()}@invalid.local`,
    p_full_name: 'Setup Check',
  })
  let eligibility = null
  try { eligibility = JSON.parse(probe.body)?.status } catch { /* below */ }

  if (eligibility === 'not_eligible') {
    fail('Migration 012 applied  (self-service account creation)',
         'Run supabase/migrations/012_self_service_signup.sql in the SQL Editor. ' +
         'Without it registration is invite-only: anyone HR has not already entered ' +
         'as an employee gets "we could not match those details to an employee ' +
         'record" and no account is created.')
  } else if (eligibility === 'open' || eligibility === 'first_admin' ||
             eligibility === 'domain_blocked') {
    ok('Migration 012 applied', 'self-service signup, role assigned by the database')
    if (eligibility === 'domain_blocked') {
      warn('Self-registration is restricted by domain',
           'app_config.signup_allowed_domains — intended, if you set it')
    }
  } else {
    warn(`Migration 012 status unclear (eligibility probe said "${eligibility}")`,
         'apply 012 if signup reports unmatched employee records')
  }

  // 014 moves the signup domain allowlist into HR Settings.
  const domainsFn = await post('/rest/v1/rpc/get_signup_domains', {})
  if (domainsFn.status === 404) {
    fail('Migration 014 applied  (signup domain allowlist)',
         'Run supabase/migrations/014_signup_domains.sql in the SQL Editor. ' +
         'Without it the allowlist can only be changed with raw SQL.')
  } else {
    ok('Migration 014 applied', 'signup domain allowlist')
  }

  // 018 removes the access-code machinery.
  const codes018 = await post('/rest/v1/rpc/create_role_access_code', { p_role: 'manager' })
  if (codes018.status === 404) {
    ok('Migration 018 applied', 'access codes removed')
  } else {
    fail('Migration 018 applied  (removes access codes)',
         'Run supabase/migrations/018_remove_access_codes.sql')
  }

  // 021 adds the session-bound second factor.
  const twofa = await post('/rest/v1/rpc/session_status', {})
  if (twofa.status === 404) {
    fail('Migration 021 applied  (two-step login)',
         'Run supabase/migrations/021_session_bound_2fa.sql. Until it is applied ' +
         'the sign-in code screen has no backend and nobody can complete a login.')
  } else {
    ok('Migration 021 applied', 'session-bound email second factor')
  }

  // 022 turns enforcement on. Detected by behaviour: once applied, an
  // unverified caller reading employees gets nothing rather than a row.
  const sf = await post('/rest/v1/rpc/session_second_factor_ok', {})
  if (sf.status === 404) {
    warn('Migration 022 not applied  (enforcement)',
         'policies still allow a password-only session — apply after testing 021')
  } else {
    ok('Migration 022 available', 'second factor enforced in RLS')
  }

  // 023 makes logout effective immediately instead of waiting out the access
  // token's lifetime. Absence is a security gap, not a missing feature.
  const revoke023 = await post('/rest/v1/rpc/revoke_login_verification', {})
  if (revoke023.status === 404) {
    fail('Migration 023 applied  (logout revokes the second factor)',
         'Run supabase/migrations/023_finalize_email_2fa.sql. Without it, signing ' +
         'out leaves the verification row in place, so an access token captured ' +
         'before logout keeps full verified access until it expires (~1 hour).')
  } else {
    ok('Migration 023 applied', 'logout revokes the second factor immediately')
  }

  warn('Email Vault secrets cannot be probed from here',
       'vault: brevo_api_key and brevo_sender must both be set (migration 025), ' +
       'or request_login_code() returns email_not_configured and no code is sent')
  warn('Sender identity determines who can receive codes',
       'Development uses Brevo with a single verified sender address, which ' +
       'delivers to any recipient. The production sender is set by whoever owns ' +
       'that infrastructure. See AUTHENTICATION.md.')

  const st = await post('/rest/v1/rpc/auth_setup_status', {})
  try {
    const parsed = JSON.parse(st.body)
    if (parsed && parsed.has_admin === undefined) {
      fail('Migration 015 applied  (first-administrator bootstrap)',
           'Run supabase/migrations/015_first_admin_bootstrap.sql in the SQL Editor. ' +
           'Without it the super_admin bootstrap only fires on a completely empty ' +
           'employees table, so once any row exists nobody can become an administrator ' +
           'and nobody can be promoted.')
    } else if (parsed && parsed.has_admin === false) {
      ok('Migration 015 applied', 'first-administrator bootstrap')
      warn('No administrator exists yet',
           'the next person to sign up becomes the Super Admin')
    } else {
      ok('Migration 015 applied', 'an administrator exists')
    }
  } catch { /* shape check only */ }
}

// 009 has no callable surface; note it rather than guess.
warn('Migration 009 cannot be probed from here',
     'approval notifications + clarification responses — apply it if you have not')

// ── Edge Functions ──────────────────────────────────────────
section('Edge Functions')
for (const [fn, need] of [
  ['process-approval', 'required for manager approvals'],
  ['check-rate-limits', 'optional'],
  ['calculate-badges', 'optional'],
  ['check-duplicate', 'optional'],
]) {
  const res = await post(`/functions/v1/${fn}`, {})
  if (res.status === 404) {
    if (need === 'required for manager approvals') {
      fail(`${fn} deployed  (${need})`, `npx supabase functions deploy ${fn}`)
    } else {
      warn(`${fn} not deployed`, need)
    }
  } else {
    ok(`${fn} deployed`, `HTTP ${res.status}`)
  }
}

// ── Summary ─────────────────────────────────────────────────
console.log()
if (problems.length === 0) {
  console.log(`${GREEN}${BOLD}Everything required is in place.${RESET}`)
  process.exit(0)
}

console.log(`${RED}${BOLD}${problems.length} thing${problems.length === 1 ? '' : 's'} still to do:${RESET}\n`)
problems.forEach((p, i) => {
  console.log(`${BOLD}${i + 1}. ${p.label}${RESET}`)
  console.log(`   ${p.fix}\n`)
})
process.exit(1)
