/**
 * Seed orchestration.
 *
 * The project already has two seeding mechanisms and this adds neither a third
 * nor a replacement:
 *
 *   supabase/seed/*.sql     reference data (core values, behaviours, badge
 *                           definitions, app_config) -- applied by the CLI
 *   scripts/seeders/*.ts    demo/development data, run via `npm run seed`
 *
 * Seeding is OFF unless --seed is passed. It writes rows, and a setup command
 * that quietly inserts data into whatever project happens to be configured is
 * a bad command.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Env } from './env.js'
import { isHostedTarget } from './guard.js'
import type { RunMode } from './guard.js'
import { confirm } from './guard.js'

export interface SeedResult {
  ran: boolean
  detail: string
}

export function seedFiles(root: string): string[] {
  const dir = path.join(root, 'supabase', 'seed')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
}

/**
 * Run the TypeScript demo seeders.
 *
 * Refuses against a hosted project without an explicit confirmation: demo
 * employees and nominations in a real workspace are tedious to unpick, and
 * migration 003 puts ON DELETE RESTRICT on nominations precisely so they
 * cannot be casually removed.
 */
export async function runSeed(
  root: string,
  env: Env,
  mode: RunMode,
): Promise<SeedResult> {
  if (!mode.seed) {
    return { ran: false, detail: 'skipped (pass --seed to run)' }
  }

  if (mode.checkOnly) {
    return { ran: false, detail: 'skipped (--check is read-only)' }
  }

  if (isHostedTarget(env)) {
    const okToSeed = await confirm(
      'Seeding writes demo employees and recognitions into a HOSTED project. Continue?',
      mode,
    )
    if (!okToSeed) return { ran: false, detail: 'declined by operator' }
  }

  const seeder = path.join(root, 'scripts', 'seeders', 'seed.ts')
  if (!fs.existsSync(seeder)) {
    return { ran: false, detail: 'scripts/seeders/seed.ts not found' }
  }

  try {
    execFileSync('npx', ['tsx', seeder], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      timeout: 600_000,
    })
    return { ran: true, detail: 'demo data seeded' }
  } catch (err) {
    return { ran: false, detail: `seeder failed: ${(err as Error).message}` }
  }
}
