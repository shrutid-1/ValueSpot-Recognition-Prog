/**
 * The brake.
 *
 * Everything destructive in this workflow passes through here first. The rule
 * is simple and deliberately blunt: a setup script may read anything, but it
 * may only WRITE when the operator has said so for this specific run.
 *
 * There is no "production" flag to forget to set. The default is refusal.
 */
import { execFileSync } from 'node:child_process'
import type { Env } from './env.js'

export interface RunMode {
  /** --check: read-only. Nothing may write, whatever else is passed. */
  checkOnly: boolean
  /** --yes: skip the interactive confirmation before applying migrations. */
  assumeYes: boolean
  /** --seed: run the seed step. Off by default; seeding is never implied. */
  seed: boolean
  /**
   * --soft: report problems but always exit 0.
   *
   * Used by the pre-dev hook. A readiness check that can BLOCK `npm run dev`
   * is worse than no check at all -- being offline, or having the project
   * paused, would stop you editing CSS. It warns; it never gets in the way.
   */
  soft: boolean
  /**
   * --migrate: apply pending migrations and NOTHING else.
   *
   * The mode behind `npm run db:migrate`. It narrows the run rather than
   * widening it -- environment, tooling, migrations and (on success) the
   * verification checks, with the seed step skipped outright.
   *
   * It grants no new permission. The confirmation below still has to pass, so
   * this cannot write unattended any more than `npm run setup` can.
   */
  migrateOnly: boolean
}

export function parseArgs(argv: string[]): RunMode {
  return {
    checkOnly: argv.includes('--check'),
    assumeYes: argv.includes('--yes') || argv.includes('-y'),
    seed: argv.includes('--seed'),
    soft: argv.includes('--soft'),
    migrateOnly: argv.includes('--migrate'),
  }
}

/** Is the Supabase CLI callable? Returns its version, or null. */
export function supabaseCliVersion(): string | null {
  try {
    const out = execFileSync('npx', ['supabase', '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
      timeout: 120_000,
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Would this run touch a shared/hosted project rather than a local stack?
 *
 * Not a perfect signal — a hosted project can be a scratch project — which is
 * exactly why this only raises the bar to an explicit confirmation rather than
 * pretending to know. It never decides on its own that a write is fine.
 */
export function isHostedTarget(env: Env): boolean {
  return !env.isLocal
}

/**
 * Ask before writing. Reads a single line from stdin.
 *
 * In a non-interactive context (CI, a piped shell) there is no one to answer,
 * so the answer is no unless --yes was passed. Failing closed is the point.
 */
export async function confirm(question: string, mode: RunMode): Promise<boolean> {
  if (mode.assumeYes) return true

  if (!process.stdin.isTTY) {
    console.log(
      `\n  Refusing: ${question}\n` +
      '  This shell is not interactive, so there is nobody to confirm.\n' +
      '  Re-run with --yes if you are certain.',
    )
    return false
  }

  process.stdout.write(`\n  ${question} [y/N] `)

  return new Promise(resolve => {
    const onData = (chunk: Buffer) => {
      process.stdin.removeListener('data', onData)
      process.stdin.pause()
      resolve(/^y(es)?$/i.test(chunk.toString().trim()))
    }
    process.stdin.resume()
    process.stdin.once('data', onData)
  })
}

/**
 * Statements this workflow must never execute, whatever else changes.
 *
 * Setup automation exists to remove repetitive typing, not to make destruction
 * convenient. Resetting, dropping and truncating stay manual, deliberate acts
 * performed by a person who has read what they are about to do.
 */
export const FORBIDDEN_OPERATIONS = [
  'supabase db reset',
  'DROP DATABASE',
  'DROP SCHEMA',
  'TRUNCATE',
  'DELETE FROM auth.users',
] as const

export function assertNotForbidden(command: string): void {
  const hit = FORBIDDEN_OPERATIONS.find(op =>
    command.toLowerCase().includes(op.toLowerCase()),
  )
  if (hit) {
    throw new Error(
      `Refusing to run "${command}".\n` +
      `Setup automation never performs "${hit}". If you genuinely need it, ` +
      'do it deliberately by hand.',
    )
  }
}
