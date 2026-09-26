#!/usr/bin/env tsx
/**
 * ValueSpot project setup.
 *
 *   npm run setup          validate, show pending migrations, apply on confirm
 *   npm run setup:check    read-only. Never writes. Safe anywhere, any time.
 *   npm run setup -- --seed --yes   non-interactive, with demo data
 *
 * Replaces the manual loop of opening the SQL Editor, pasting SQL, checking
 * migration status by hand and repeating it on the next machine.
 *
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a migration engine. Every schema change still lives in
 * supabase/migrations/ and is applied by the Supabase CLI, against the CLI's
 * own ledger. This orchestrates that; it does not reimplement it, and it holds
 * no second opinion about what has been applied.
 *
 * It also never resets, drops, truncates or deletes -- see guard.ts, which
 * refuses those by name whatever it is asked.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateEnv, describeTarget, type Env } from './env.js'
import { parseArgs, supabaseCliVersion, isHostedTarget, confirm, type RunMode } from './guard.js'
import { readMigrationState, dryRunPush, applyPendingMigrations, localMigrationFiles } from './migrations.js'
import { runVerification } from './verify.js'
import { runSeed, seedFiles } from './seed.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}

let failed = false

const pass = (l: string, d = '') => console.log(`  ${C.green}PASS${C.reset}  ${l}${d ? `  ${C.dim}${d}${C.reset}` : ''}`)
const warn = (l: string, d = '') => console.log(`  ${C.yellow}WARN${C.reset}  ${l}${d ? `  ${C.dim}${d}${C.reset}` : ''}`)
const info = (l: string) => console.log(`  ${C.dim}····${C.reset}  ${l}`)
function fail(l: string, fix?: string) {
  console.log(`  ${C.red}FAIL${C.reset}  ${l}`)
  if (fix) console.log(`        ${C.dim}→ ${fix}${C.reset}`)
  failed = true
}
const section = (t: string) => console.log(`\n${C.bold}${t}${C.reset}`)

/** What the migration step ended up doing. Read by both callers. */
interface MigrationOutcome {
  /** Pending count as read BEFORE anything was applied. */
  pending: number
  /** A push ran and the CLI reported success. */
  applied: boolean
  /** State could not be read at all — offline, unlinked, or no CLI. */
  unknown: boolean
  /** A push ran and failed. Distinct from `!applied`, which includes declining. */
  failed: boolean
}

/**
 * The migration step, shared by `npm run setup` and `npm run db:migrate`.
 *
 * ONE implementation on purpose. The two commands differ in what surrounds
 * them — setup also seeds and reports readiness, db:migrate does neither — but
 * the part that touches the database must not exist in two versions whose
 * safety checks can drift apart. This is that part.
 *
 * It decides nothing about whether writing is allowed. guard.confirm() does,
 * and `--check` returns before it is ever reached, so nothing here can write
 * without a confirmation given for this specific run.
 */
async function migrationStep(
  env: Env,
  mode: RunMode,
  cli: string | null,
): Promise<MigrationOutcome> {
  const files = localMigrationFiles(ROOT)
  pass(`${files.length} migration file(s) on disk`,
       files.length ? `${files[0]} … ${files[files.length - 1]}` : '')

  if (!cli) {
    warn('Migration state not checked', 'Supabase CLI unavailable')
    return { pending: 0, applied: false, unknown: true, failed: false }
  }

  const state = readMigrationState()

  if (!state) {
    warn('Could not read migration state',
         'The project may be unlinked. Try `npx supabase link`.')
    return { pending: 0, applied: false, unknown: true, failed: false }
  }

  pass(`${state.applied.length} migration(s) already applied`)

  if (state.orphaned.length > 0) {
    warn(`${state.orphaned.length} applied remotely with no local file`,
         state.orphaned.map(m => m.remote).join(', '))
  }

  if (state.pending.length === 0) {
    pass('Database is up to date', 'nothing pending')
    return { pending: 0, applied: false, unknown: false, failed: false }
  }

  warn(`${state.pending.length} migration(s) pending:`)
  for (const m of state.pending) console.log(`        ${C.yellow}${m.local}${C.reset}`)

  /*
    READ-ONLY STOPS HERE.

    This is the branch the pre-dev hook takes, and it is why starting a dev
    server cannot change the schema: `--check` returns before the dry run,
    before the confirmation, and before any call that can write. Nothing below
    this line runs for `npm run dev`.
  */
  if (mode.checkOnly) {
    info('Database changes were NOT applied.')
    info('Run `npm run db:migrate` to apply them.')
    return { pending: state.pending.length, applied: false, unknown: false, failed: false }
  }

  const dry = dryRunPush()
  if (dry && dry.pending.length > 0) {
    info('Dry run — these would be applied:')
    for (const f of dry.pending) console.log(`        ${f}`)
  }

  /*
    --yes means nobody will be asked, so SAY that a write is about to happen.
    No npm script passes it; someone typing it has chosen to skip the prompt,
    and a schema change landing on a hosted project should still never be
    something they find out about afterwards. confirm() prints nothing when the
    answer is assumed.
  */
  if (mode.assumeYes) {
    warn(`Applying ${state.pending.length} migration(s) to ${describeTarget(env)}`,
         'not asking — started with --yes')
  }

  const go = await confirm(
    `Apply ${state.pending.length} migration(s) to ${describeTarget(env)}?`,
    mode,
  )

  if (!go) {
    warn('Migrations not applied', 'declined by operator')
    return { pending: state.pending.length, applied: false, unknown: false, failed: false }
  }

  const result = applyPendingMigrations()

  if (result.ok) {
    pass('Migrations applied')
    return { pending: state.pending.length, applied: true, unknown: false, failed: false }
  }

  fail('Migration push failed', result.output.split('\n').slice(-3).join(' '))
  return { pending: state.pending.length, applied: false, unknown: false, failed: true }
}

async function main(): Promise<number> {
  const mode = parseArgs(process.argv.slice(2))

  console.log(
    `\n${C.bold}${C.cyan}Touchcore ValueSpot — ` +
    `${mode.migrateOnly ? 'database migration' : 'project setup'}${C.reset}`,
  )
  if (mode.checkOnly) {
    console.log(`${C.dim}read-only check; nothing will be written${C.reset}`)
  } else if (mode.migrateOnly) {
    console.log(`${C.dim}applies pending migrations, after you confirm; never seeds${C.reset}`)
  }

  // ── 1. Environment ────────────────────────────────────────
  section('1. Environment')

  const { env, problems } = validateEnv(ROOT)
  if (!env) {
    for (const p of problems) fail(`${p.key} — ${p.detail}`, p.fix)
    return 1
  }
  pass('Environment variables present', describeTarget(env))

  if (isHostedTarget(env)) {
    info(`Target is a hosted project${mode.checkOnly ? '' : ' — migrations will require confirmation'}`)
  }

  // ── 2. Tooling ────────────────────────────────────────────
  section('2. Tooling')

  const cli = supabaseCliVersion()
  if (cli) pass('Supabase CLI available', `v${cli}`)
  else {
    fail('Supabase CLI not available',
         'It ships as a dev dependency — try `npm install`. Migration steps are skipped without it.')
  }

  // ── 3. Migrations ─────────────────────────────────────────
  section('3. Migrations')

  const migration = await migrationStep(env, mode, cli)

  /*
    --migrate stops here. `npm run db:migrate` applies migrations and does
    nothing else: no seed step, and readiness reporting only for the database
    it just touched. The exit codes it returns are decided at the end of main().
  */
  if (mode.migrateOnly) {
    console.log()

    if (migration.pending === 0 && !migration.unknown) {
      console.log(`${C.green}${C.bold}DATABASE UP TO DATE${C.reset}${C.dim} — nothing to apply${C.reset}`)
      console.log()
      return 0
    }

    if (migration.failed) {
      console.log(`${C.red}${C.bold}MIGRATION FAILED${C.reset} — the database was not changed as intended.`)
      console.log()
      return 1
    }

    if (!migration.applied) {
      /*
        Declined, or state unreadable. Nothing was written either way — but
        only one of them is a normal outcome. Declining is a choice and exits
        0; being unable to read the state means the question was never
        actually answered, so that exits 1 rather than reporting success.
      */
      console.log(`${C.yellow}${C.bold}NO CHANGES MADE${C.reset}${C.dim} — the database was not modified${C.reset}`)
      console.log()
      return migration.unknown ? 1 : 0
    }

    // ── Verification, on what was just applied ──────────────
    section('Verification')

    for (const check of await runVerification(env)) {
      if (check.status === 'pass') pass(check.label, check.detail)
      else if (check.status === 'warn') warn(check.label, check.detail)
      else fail(check.label, check.fix ?? check.detail)
    }

    console.log()

    if (failed) {
      console.log(`${C.red}${C.bold}MIGRATIONS APPLIED, VERIFICATION FAILED${C.reset} — see the FAIL lines above.`)
      console.log()
      return 1
    }

    console.log(`${C.green}${C.bold}MIGRATIONS APPLIED${C.reset}`)
    console.log()
    return 0
  }

  // ── 4. Seed data ──────────────────────────────────────────
  section('4. Seed data')

  const seeds = seedFiles(ROOT)
  info(`${seeds.length} reference seed file(s) in supabase/seed/ (applied by the CLI)`)

  /*
    runSeed() already returns early unless --seed was passed, so this is a
    second lock on the same door rather than the only one. It is here because
    the cost of the two ever disagreeing is demo employees appearing in a real
    database — and `npm run db:migrate` returns above this line in any case.
  */
  const seedResult = mode.migrateOnly
    ? { ran: false, detail: 'skipped (db:migrate never seeds)' }
    : await runSeed(ROOT, env, mode)
  if (seedResult.ran) pass('Demo data seeded', seedResult.detail)
  else info(`Demo seeding ${seedResult.detail}`)

  // ── 5. Verification ───────────────────────────────────────
  section('5. Verification')

  for (const check of await runVerification(env)) {
    if (check.status === 'pass') pass(check.label, check.detail)
    else if (check.status === 'warn') warn(check.label, check.detail)
    else fail(check.label, check.fix ?? check.detail)
  }

  // ── Result ────────────────────────────────────────────────
  console.log()
  if (failed) {
    console.log(`${C.red}${C.bold}SETUP INCOMPLETE${C.reset} — fix the FAIL lines above and re-run.`)
    if (mode.soft) {
      // Pre-dev hook: say so, then get out of the way.
      console.log(`${C.dim}Starting the dev server anyway (readiness check is advisory).${C.reset}\n`)
      return 0
    }
    console.log()
    return 1
  }

  console.log(`${C.green}${C.bold}SETUP OK${C.reset}${mode.checkOnly ? `  ${C.dim}(read-only check)${C.reset}` : ''}`)
  console.log(`${C.dim}Next: npm run dev${C.reset}\n`)
  return 0
}

main()
  .then(code => process.exit(code))
  .catch((err: Error) => {
    console.error(`\n${C.red}Setup failed:${C.reset} ${err.message}\n`)
    process.exit(1)
  })
