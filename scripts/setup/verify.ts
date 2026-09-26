/**
 * Post-setup verification.
 *
 * Probes the project over the ordinary anon REST endpoint — the same surface
 * the browser uses — and reports what a developer needs to know before
 * starting work. Read-only by construction: it issues no writes and holds no
 * privileged credential.
 *
 * It deliberately does NOT try to reproduce supabase/setup/VERIFY_026.sql or
 * VERIFY_027.sql. Those impersonate signed-in sessions with SET LOCAL ROLE and
 * must run in the SQL Editor as an owner; approximating them here would give a
 * false sense of coverage. This answers the narrower question: is the project
 * reachable, migrated, and configured well enough to develop against?
 */
import type { Env } from './env.js'

export interface Check {
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
  fix?: string
}

async function rest(
  env: Env,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${env.supabaseUrl}${pathname}`, {
    ...init,
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/** Is the project reachable and serving PostgREST? */
async function checkReachable(env: Env): Promise<Check> {
  try {
    // ANY HTTP response proves the project is up and routing. The root path
    // answers 401 without a table in the URL, which is reachable, not broken.
    const res = await rest(env, '/rest/v1/')
    return {
      label: 'Supabase project reachable',
      status: 'pass',
      detail: `REST HTTP ${res.status}`,
    }
  } catch (err) {
    return {
      label: 'Supabase project reachable',
      status: 'fail',
      detail: (err as Error).message,
      fix: 'Check network access and VITE_SUPABASE_URL.',
    }
  }
}

/**
 * Are the schema's core tables present?
 *
 * RLS means anon sees zero rows, which is correct and expected. A 200 with an
 * empty array proves the table exists and is protected; a 404 means the
 * migrations have not run.
 */
async function checkSchema(env: Env): Promise<Check> {
  const tables = ['employees', 'nominations', 'core_values', 'app_config']
  const missing: string[] = []

  for (const table of tables) {
    try {
      const res = await rest(env, `/rest/v1/${table}?select=id&limit=1`)
      if (res.status === 404) missing.push(table)
    } catch {
      missing.push(table)
    }
  }

  return missing.length === 0
    ? { label: 'Core tables present', status: 'pass', detail: tables.join(', ') }
    : {
        label: 'Core tables present',
        status: 'fail',
        detail: `missing: ${missing.join(', ')}`,
        fix: 'Run `npm run setup` to apply pending migrations.',
      }
}

/**
 * Is RLS actually on?
 *
 * An anon SELECT against employees must return zero rows. Rows coming back
 * would mean the directory is readable by anyone holding the public key --
 * which is a genuine emergency, not a warning.
 */
async function checkRlsEngaged(env: Env): Promise<Check> {
  try {
    const res = await rest(env, '/rest/v1/employees?select=id&limit=1')
    if (!res.ok) {
      // 401/403 is also a pass: the request was refused outright.
      return { label: 'RLS refuses anonymous reads', status: 'pass', detail: `HTTP ${res.status}` }
    }

    const rows = (await res.json()) as unknown[]
    return rows.length === 0
      ? { label: 'RLS refuses anonymous reads', status: 'pass' }
      : {
          label: 'RLS refuses anonymous reads',
          status: 'fail',
          detail: `anon read returned ${rows.length} row(s)`,
          fix: 'STOP. Employee data is publicly readable. Check that RLS is ' +
               'enabled on employees and that its policies were not dropped.',
        }
  } catch (err) {
    return { label: 'RLS refuses anonymous reads', status: 'warn', detail: (err as Error).message }
  }
}

/** Are the security-critical RPCs installed and refusing anonymous callers? */
async function checkRpcsGated(env: Env): Promise<Check> {
  /*
    Both are REVOKEd from anon, so 401/403 is the correct answer and a 200
    would mean an anonymous caller got through.

    The arguments matter. PostgREST resolves an RPC by NAME AND SIGNATURE, so
    posting {} at a function with a required parameter returns 404 "not found
    in schema cache" — indistinguishable from the function being absent. Each
    probe therefore sends arguments that match a real signature. The nil UUID
    addresses nothing; the call is refused on permissions long before any
    lookup happens.
  */
  const guarded: Array<{ fn: string; args: Record<string, unknown> }> = [
    { fn: 'claim_employee_account', args: {} },
    { fn: 'send_employee_invitation',
      args: { p_employee_id: '00000000-0000-0000-0000-000000000000' } },
    { fn: 'set_own_department',
      args: { p_department_id: '00000000-0000-0000-0000-000000000000' } },
  ]

  const leaks: string[] = []
  const absent: string[] = []

  for (const { fn, args } of guarded) {
    try {
      const res = await rest(env, `/rest/v1/rpc/${fn}`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
      if (res.ok) leaks.push(fn)
      else if (res.status === 404) absent.push(fn)
    } catch {
      absent.push(fn)
    }
  }

  if (leaks.length > 0) {
    return {
      label: 'Privileged RPCs refuse anonymous callers',
      status: 'fail',
      detail: `executable by anon: ${leaks.join(', ')}`,
      fix: 'STOP. Re-check the REVOKE ... FROM anon statements in migrations 026/027/031.',
    }
  }

  if (absent.length > 0) {
    return {
      label: 'Privileged RPCs installed',
      status: 'warn',
      detail: `not found: ${absent.join(', ')}`,
      fix: 'Run `npm run setup` to apply pending migrations.',
    }
  }

  return { label: 'Privileged RPCs refuse anonymous callers', status: 'pass' }
}

/**
 * Has someone bootstrapped an administrator yet?
 *
 * auth_setup_status() is granted to anon on purpose — the signup page needs it
 * before anyone is signed in — so this is a legitimate read.
 */
async function checkBootstrap(env: Env): Promise<Check> {
  try {
    const res = await rest(env, '/rest/v1/rpc/auth_setup_status', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      return {
        label: 'Setup status readable',
        status: 'warn',
        detail: `HTTP ${res.status}`,
        fix: 'Expected if migrations have not been applied yet.',
      }
    }

    const status = (await res.json()) as { has_admin?: boolean; accepting_first_admin?: boolean }

    return status.has_admin
      ? { label: 'An administrator exists', status: 'pass' }
      : {
          label: 'An administrator exists',
          status: 'warn',
          detail: 'none yet — the next account to sign up becomes Super Admin',
          fix: 'Open the app and create the founding account.',
        }
  } catch (err) {
    return { label: 'Setup status readable', status: 'warn', detail: (err as Error).message }
  }
}

export async function runVerification(env: Env): Promise<Check[]> {
  const reachable = await checkReachable(env)
  if (reachable.status === 'fail') return [reachable]

  // Independent probes, so run them together rather than in sequence.
  const others = await Promise.all([
    checkSchema(env),
    checkRlsEngaged(env),
    checkRpcsGated(env),
    checkBootstrap(env),
  ])

  return [reachable, ...others]
}
