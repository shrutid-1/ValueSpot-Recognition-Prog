/**
 * Migration orchestration.
 *
 * This is a WRAPPER around the Supabase CLI, not a migration engine. It shells
 * out to `supabase migration list` and `supabase db push` and reads their JSON.
 *
 * That distinction matters more than it looks. A second engine would need its
 * own ledger, and two ledgers disagreeing about what has been applied is how
 * schemas get corrupted. There is exactly one source of truth for what has run
 * -- supabase_migrations.schema_migrations -- and exactly one source of truth
 * for what should run -- the files in supabase/migrations/.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { assertNotForbidden } from './guard.js'

export interface MigrationRow {
  local: string
  remote: string
  time?: string
}

export interface MigrationState {
  all: MigrationRow[]
  applied: MigrationRow[]
  pending: MigrationRow[]
  /** Applied remotely but with no local file — someone pushed from elsewhere. */
  orphaned: MigrationRow[]
}

function runCli(args: string[], timeoutMs = 180_000): string {
  const command = `supabase ${args.join(' ')}`
  assertNotForbidden(command)

  return execFileSync('npx', ['supabase', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: timeoutMs,
  })
}

/** The CLI prints progress lines before the JSON; take the last JSON object. */
function lastJson<T>(output: string): T | null {
  const lines = output.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try { return JSON.parse(trimmed) as T } catch { /* keep looking */ }
  }
  return null
}

/**
 * Parse the CLI's human table, for versions that print one.
 *
 *      Local | Remote | Time (UTC)
 *     -------|--------|-----------
 *      `026` | `026`  | `026`
 *
 * Which format you get varies by CLI version and whether stdout is a TTY, so
 * both are handled rather than pinning a flag that may not exist.
 */
function parseTable(output: string): MigrationRow[] | null {
  const rows: MigrationRow[] = []

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('|')) continue
    if (/local\s*\|/i.test(line)) continue           // header
    if (/^[\s|-]+$/.test(line)) continue             // separator

    const cells = line.split('|').map(c => c.trim().replace(/`/g, ''))
    if (cells.length < 2) continue

    const [local, remote, time] = cells
    // At least one side must carry a version, else it is not a data row.
    if (!local && !remote) continue
    if (local && !/^\d/.test(local) && remote && !/^\d/.test(remote)) continue

    rows.push({ local, remote, time })
  }

  return rows.length > 0 ? rows : null
}

/** Migration files on disk, in apply order. */
export function localMigrationFiles(root: string): string[] {
  const dir = path.join(root, 'supabase', 'migrations')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
}

/**
 * Read migration state from the remote project. READ-ONLY.
 *
 * Returns null when the CLI cannot reach the project at all, so callers can
 * distinguish "nothing pending" from "could not ask".
 */
export function readMigrationState(): MigrationState | null {
  let raw: string
  try {
    raw = runCli(['migration', 'list'])
  } catch {
    return null
  }

  // Two shapes in the wild. Try JSON, then the table.
  const parsed = lastJson<{ migrations?: MigrationRow[] }>(raw)
  const all = parsed?.migrations ?? parseTable(raw)
  if (!all) return null
  return {
    all,
    applied: all.filter(m => m.local && m.remote),
    pending: all.filter(m => m.local && !m.remote),
    orphaned: all.filter(m => !m.local && m.remote),
  }
}

/** What `db push` WOULD do. Read-only; never writes. */
export function dryRunPush(): { pending: string[]; upToDate: boolean } | null {
  let raw: string
  try {
    raw = runCli(['db', 'push', '--dry-run'])
  } catch {
    return null
  }

  const parsed = lastJson<{ migrations?: string[]; upToDate?: boolean }>(raw)
  if (!parsed) return null

  return {
    pending: parsed.migrations ?? [],
    upToDate: parsed.upToDate ?? (parsed.migrations ?? []).length === 0,
  }
}

/**
 * Apply pending migrations. THE ONLY WRITING FUNCTION IN THIS MODULE.
 *
 * Callers must have confirmed first — see guard.confirm(). This does not ask;
 * it does what it is told, which is why nothing should call it without one.
 */
export function applyPendingMigrations(): { ok: boolean; output: string } {
  try {
    return { ok: true, output: runCli(['db', 'push'], 600_000) }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, output: e.stderr || e.stdout || e.message || String(err) }
  }
}
