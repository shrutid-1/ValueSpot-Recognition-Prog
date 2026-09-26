/**
 * Environment loading and validation.
 *
 * Reads .env without depending on dotenv — the project has no runtime env
 * loader and adding one for a build-time script is not worth a dependency.
 * Vite reads .env itself for the browser bundle; this only serves the setup
 * scripts.
 *
 * Nothing here prints a secret. Values are reported as present/absent and, for
 * the URL, by host only.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface Env {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Project ref parsed out of the URL, e.g. abcdefgh from abcdefgh.supabase.co */
  projectRef: string | null
  /** True when the URL points at a local Supabase stack. */
  isLocal: boolean
}

export interface EnvProblem {
  key: string
  detail: string
  fix: string
}

/** Parse a .env file. Deliberately minimal: KEY=value, # comments, quotes. */
export function readEnvFile(root: string): Record<string, string> {
  const out: Record<string, string> = {}

  // .env.local wins over .env, matching Vite's own precedence.
  for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue

    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue

      const eq = line.indexOf('=')
      if (eq === -1) continue

      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  }

  // A real environment variable beats the file, so CI can override.
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
    if (process.env[key]) out[key] = process.env[key] as string
  }

  return out
}

/**
 * Validate what the setup scripts need.
 *
 * Note what is NOT required: the service-role key. Nothing in this workflow
 * uses it. Migrations go through the Supabase CLI, which authenticates with
 * its own linked-project credentials, and everything else here is read-only
 * against the anon endpoint.
 */
export function validateEnv(root: string): { env: Env | null; problems: EnvProblem[] } {
  const vars = readEnvFile(root)
  const problems: EnvProblem[] = []

  const url = vars.VITE_SUPABASE_URL ?? ''
  const anon = vars.VITE_SUPABASE_ANON_KEY ?? ''

  if (!url) {
    problems.push({
      key: 'VITE_SUPABASE_URL',
      detail: 'not set',
      fix: 'Copy .env.example to .env and paste your project URL from ' +
           'Supabase → Project Settings → API.',
    })
  } else if (!/^https?:\/\//.test(url)) {
    problems.push({
      key: 'VITE_SUPABASE_URL',
      detail: 'does not look like a URL',
      fix: 'It should look like https://<project-ref>.supabase.co',
    })
  }

  if (!anon) {
    problems.push({
      key: 'VITE_SUPABASE_ANON_KEY',
      detail: 'not set',
      fix: 'Supabase → Project Settings → API → anon/public key. ' +
           'This is the PUBLIC key and belongs in .env; never the service_role key.',
    })
  }

  // A service-role key in .env would be shipped to the browser by Vite if it
  // ever picked up a VITE_ prefix. Worth catching loudly.
  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith('VITE_')) continue
    if (/service[_-]?role/i.test(key) || (value.length > 100 && /service_role/.test(value))) {
      problems.push({
        key,
        detail: 'looks like a service-role key exposed to the browser',
        fix: 'Remove it. Anything prefixed VITE_ is compiled into the client ' +
             'bundle and is public. The service-role key must never be there.',
      })
    }
  }

  if (problems.length > 0) return { env: null, problems }

  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  const refMatch = host.match(/^([a-z0-9]+)\.supabase\.(co|in)$/i)

  return {
    env: {
      supabaseUrl: url,
      supabaseAnonKey: anon,
      projectRef: refMatch ? refMatch[1] : null,
      isLocal: /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host),
    },
    problems: [],
  }
}

/** Host only — never the key, never the full URL with any query string. */
export function describeTarget(env: Env): string {
  try {
    return `${new URL(env.supabaseUrl).hostname}${env.isLocal ? ' (local)' : ''}`
  } catch {
    return '(unparseable URL)'
  }
}
