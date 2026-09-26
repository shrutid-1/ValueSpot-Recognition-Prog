/**
 * Guards the properties of the Value Store.
 *
 * Run: npm run verify:store
 *
 * The feature rests on claims that are easy to undo by accident and that no
 * type-check would notice:
 *
 *   1. ONLY EARNED VALUE BUYS. redeem_reward() moves `earned_balance` and
 *      never names `budget_balance`, so a giving budget cannot reach a
 *      reward however the browser asks.
 *   2. THE BROWSER NAMES A REWARD, NOTHING ELSE. The price, the active flag,
 *      whether approval is needed and who is spending are all read inside the
 *      function.
 *   3. THE WALLET IS LOCKED BEFORE THE BALANCE IS READ. That, not a disabled
 *      button, is what stops two tabs spending the same coins.
 *   4. THE PRICE IS HISTORY. It is copied onto the redemption, and the refund
 *      returns the copy — never a fresh lookup of what the reward costs now.
 *   5. EXACTLY ONE DECISION LANDS. The request row is locked before its
 *      status is read, and a second decision is refused.
 *   6. A REJECTION REFUNDS, VISIBLY. Its own ledger kind, its own row.
 *   7. ROLE COMES FROM THE TABLE. Both HR functions re-read it from
 *      `employees` rather than trusting the JWT claim.
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * Like approval-authorities.ts and the other verifiers here, this checks the
 * SHAPE OF THE CODE, not a running database. It cannot tell you that two
 * simultaneous redemptions really produced one winner — that needs two
 * verified sessions racing each other against the real database, and is
 * manual UAT. It asserts that the mechanism which would produce that outcome
 * is present and wired up.
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

/** Source with comments stripped, so "X is absent" cannot be fooled by prose
 *  about X — and this codebase documents what it deliberately does not do. */
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')

/*
  EVERY migration that touches the store, in order.

  This used to read 051 alone. 052 then redefined redeem_reward() and
  decide_reward_redemption() with CREATE OR REPLACE, and every assertion
  below carried on passing against the text of functions the database no
  longer runs — a green verifier guarding dead code, which is worse than no
  verifier at all.

  Concatenated in order, with fnBody() taking the LAST definition of each
  name, so what is checked is always what a fresh database would end up
  with. A future 053 need only be added to this list.
*/
const STORE_MIGRATIONS = [
  'supabase/migrations/051_value_store.sql',
  'supabase/migrations/052_reward_validity.sql',
]

const MIGRATION = STORE_MIGRATIONS.map(f => stripComments(read(f))).join('\n')
const M052 = stripComments(read('supabase/migrations/052_reward_validity.sql'))

/**
 * The body of one SQL function, so an assertion is scoped to it.
 *
 * lastIndexOf, not indexOf: a later migration replacing a function is the
 * normal way this schema evolves, and the last definition is the live one.
 */
function fnBody(sql: string, name: string): string {
  /* CREATE OR REPLACE, not bare FUNCTION: the REVOKE and GRANT lines that
     follow every definition spell the same name, and matching the last of
     those returned the text after the function instead of the function. */
  const start = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  if (start === -1) return ''
  const open = sql.indexOf('$fn$', start)
  const close = sql.indexOf('$fn$;', open + 4)
  return open === -1 || close === -1 ? '' : sql.slice(open, close)
}

const redeem = fnBody(MIGRATION, 'redeem_reward')
const decide = fnBody(MIGRATION, 'decide_reward_redemption')
const listQueue = fnBody(MIGRATION, 'list_reward_redemptions')
const listMine = fnBody(MIGRATION, 'list_my_redemptions')
const effective = fnBody(MIGRATION, 'redemption_effective_status')
const guardBody = fnBody(MIGRATION, 'guard_reward_configuration')

console.log(`\n${C.bold}Value Store${C.reset} ${C.dim}(migrations 051-052)${C.reset}\n`)

// ── 1. Only earned value buys ───────────────────────────────
console.log(`${C.bold}Balances stay separate${C.reset}`)

check(
  'redeem_reward() never touches budget_balance',
  redeem.length > 0 && !redeem.includes('budget_balance'),
  'A redemption must not be able to reach the giving budget.',
)

check(
  'redeem_reward() debits earned_balance',
  /earned_balance\s*=\s*earned_balance\s*-/.test(redeem),
)

check(
  'the refund credits earned_balance, not the budget',
  /earned_balance\s*=\s*earned_balance\s*\+/.test(decide) && !decide.includes('budget_balance'),
)

// ── 2. Nothing is trusted from the caller ───────────────────
console.log(`\n${C.bold}The browser is not trusted${C.reset}`)

check(
  'redeem_reward() takes ONLY a reward id',
  /FUNCTION public\.redeem_reward\(p_reward_id UUID\)/.test(MIGRATION),
  'A price, balance or employee parameter would be a forgeable input.',
)

check(
  'the price is read from `rewards` inside the function',
  /coin_price[\s\S]{0,200}FROM\s+rewards/.test(redeem) || /FROM\s+rewards/.test(redeem),
)

check(
  'the spender is the session, not an argument',
  redeem.includes("auth.jwt()->>'employee_id'"),
)

check(
  'an inactive reward is refused',
  /NOT r\.is_active/.test(redeem),
)

check(
  'an unpriced reward is refused',
  /r\.coin_price\s*<=\s*0/.test(redeem),
)

// ── 3. Double spending ──────────────────────────────────────
console.log(`\n${C.bold}Double-spend protection${C.reset}`)

const lockAt = redeem.indexOf('FOR UPDATE')
const readAt = redeem.indexOf('INTO my_earned')
check(
  'the wallet is locked in the same statement that reads the balance',
  lockAt > -1 && readAt > -1 && lockAt > readAt,
  'The balance must be read under FOR UPDATE, or two tabs read the same number.',
)

const debitAt = redeem.search(/UPDATE value_coin_wallets/)
check(
  'the shortfall check happens before the debit',
  redeem.indexOf('< r.coin_price') > -1 && redeem.indexOf('< r.coin_price') < debitAt,
)

// ── 4. The price is history ─────────────────────────────────
console.log(`\n${C.bold}Historical price${C.reset}`)

check(
  'the cost and the name are copied onto the redemption',
  /coin_cost[\s\S]{0,120}reward_name_snapshot/.test(MIGRATION),
)

check(
  'the refund uses the recorded cost, not the reward table',
  decide.includes('req.coin_cost') && !/FROM\s+rewards/.test(decide),
  'Refunding a fresh lookup would return a different number than was taken.',
)

check(
  'a redemption must carry its cost and name (CHECK constraint)',
  /reward_assignments_redemption_shape[\s\S]{0,300}coin_cost IS NOT NULL/.test(MIGRATION),
)

// ── 5. One decision lands ───────────────────────────────────
console.log(`\n${C.bold}Approval concurrency${C.reset}`)

const decideLock = decide.indexOf('FOR UPDATE')
const statusCheck = decide.indexOf("status <> 'pending'")
check(
  'the request is locked before its status is read',
  decideLock > -1 && statusCheck > -1 && decideLock < statusCheck,
)

check(
  'a request that is not pending is refused',
  statusCheck > -1 && /RAISE EXCEPTION[\s\S]{0,120}already/.test(decide),
)

// ── 6. A rejection refunds, visibly ─────────────────────────
console.log(`\n${C.bold}Refunds${C.reset}`)

check(
  'the refund is its own ledger kind',
  decide.includes("'reward_refund'"),
)

check(
  'a redemption is its own ledger kind',
  redeem.includes("'reward_redemption'"),
)

check(
  'neither reuses recognition_tip',
  !redeem.includes("'recognition_tip'") && !decide.includes("'recognition_tip'"),
  'Reward movements must not be filed under recognition.',
)

check(
  'rejecting requires a reason',
  /p_action = 'reject' AND reason IS NULL[\s\S]{0,160}RAISE EXCEPTION/.test(decide),
)

// ── 7. Authority ────────────────────────────────────────────
console.log(`\n${C.bold}Authority${C.reset}`)

for (const [name, body] of [['decide_reward_redemption', decide], ['list_reward_redemptions', listQueue]] as const) {
  check(
    `${name}() re-reads the role from employees`,
    /SELECT role[\s\S]{0,80}FROM employees/.test(body),
    'A JWT claim is what a session says; the table is what is true.',
  )
  check(
    `${name}() refuses anyone but HR and Super Admin`,
    /NOT IN \('hr_admin', 'super_admin'\)/.test(body),
  )
}

check(
  'both wallet-moving functions demand the second factor',
  redeem.includes('session_second_factor_ok') && decide.includes('session_second_factor_ok'),
)

// ── 8. Seeding and re-runs ──────────────────────────────────
console.log(`\n${C.bold}Migration hygiene${C.reset}`)

check(
  'the sample catalogue is idempotent',
  /WHERE NOT EXISTS \(SELECT 1 FROM rewards r WHERE r\.name = v\.name\)/.test(MIGRATION),
  'Re-running setup must not duplicate the starting rewards.',
)

check(
  'the seed is not an upsert',
  !/ON CONFLICT[\s\S]{0,60}DO UPDATE/.test(MIGRATION),
  'A later run must leave prices HR has changed alone.',
)

check(
  'every ADD CONSTRAINT is preceded by a DROP',
  (MIGRATION.match(/ADD CONSTRAINT/g) ?? []).length ===
    (MIGRATION.match(/DROP CONSTRAINT IF EXISTS/g) ?? []).length,
)

check(
  'no view is replaced (column-position hazard)',
  !/CREATE OR REPLACE VIEW/.test(MIGRATION),
)



// ── 9. Validity and expiry (052) ────────────────────────────
console.log(`\n${C.bold}Validity and expiry${C.reset}`)

check(
  'the validity range is a CHECK, not a convention',
  /redemption_validity_days BETWEEN 1 AND 365/.test(M052),
  'The browser clamps to give a readable message; this is what enforces it.',
)

check(
  'the term is SNAPSHOT onto the redemption',
  redeem.includes('validity_days_snapshot') && redeem.includes('r.redemption_validity_days'),
  'Without the copy, an old redemption would follow HR changing the reward.',
)

check(
  'approval computes the expiry from the SNAPSHOT, not the catalogue',
  decide.includes('req.validity_days_snapshot') && !/FROM rewards/.test(decide),
  'Reading rewards here would let a validity change rewrite existing expiries.',
)

check(
  'the expiry is computed server-side, never accepted',
  redeem.includes('make_interval') && decide.includes('make_interval') &&
    !/FUNCTION public\.redeem_reward\([^)]*expires/.test(MIGRATION) &&
    !/FUNCTION public\.decide_reward_redemption\([\s\S]{0,160}expires/.test(MIGRATION),
  'An expires_at parameter on either writer would be a forgeable input.',
)

check(
  'a pending request cannot expire',
  /CHECK \(expires_at IS NULL OR fulfilled_at IS NOT NULL\)/.test(M052),
  'The clock starts at fulfilment, so a slow queue cannot burn the window.',
)

check(
  "'expired' is never written to the status column",
  !/SET[\s\S]{0,120}status\s*=\s*'expired'/.test(MIGRATION) &&
    !MIGRATION.includes("'rejected', 'expired'") &&
    !/status_check[\s\S]{0,160}'expired'/.test(MIGRATION),
  'It is derived at read time; a stored copy is one that can go stale.',
)

check(
  'only an approved redemption can be derived as expired',
  effective.includes("p_status = 'approved'") && effective.includes('p_expires_at <= now()'),
)

check(
  'the derived status is STABLE, so it re-reads the clock',
  /redemption_effective_status[\s\S]{0,240}\bSTABLE\b/.test(M052),
  'IMMUTABLE would let the planner cache an answer that expires.',
)

check(
  'no scheduler is introduced',
  !/pg_cron|cron\.schedule/.test(M052),
  '050 settled this: a sweep that fails silently leaves rows lying.',
)

check(
  'expiry moves no coins',
  /* No LEDGER KIND names an expiry — checked against the kind CHECK rather
     than the whole file, where reward_expiry_warning_days (a config key, not
     a coin movement) would otherwise match. Narrowed to reward_expir so that
     allowance_expired — 050's budget forfeiture, a real kind — does not trip it. And the function that derives
     the status writes nothing at all: it is a SELECT. */
  !/kind_check[\s\S]{0,500}reward_expir/.test(MIGRATION) &&
    !/INSERT|UPDATE/.test(effective) &&
    !effective.includes('value_coin_transactions'),
  'An approval is a completed spend, so an expiry reverses nothing.',
)

check(
  'the employee list takes no employee argument',
  /FUNCTION public\.list_my_redemptions\(p_limit INTEGER DEFAULT 50\)/.test(M052) &&
    listMine.includes("auth.jwt()->>'employee_id'"),
  'An employee parameter would be somebody else to pass.',
)

check(
  'both redemption lists derive the status server-side',
  listMine.includes('redemption_effective_status') &&
    listQueue.includes('redemption_effective_status'),
  "Computed in the browser, the viewer's clock would decide what has lapsed.",
)

check(
  'the expiry warning threshold is configuration, not a literal',
  M052.includes('reward_expiry_warning_days') && listQueue.includes('value_coin_setting'),
)

check(
  'only HR and a Super Admin may write the catalogue, from the TABLE',
  guardBody.includes('SELECT role INTO actor_role FROM employees') &&
    /NOT IN \('hr_admin', 'super_admin'\)/.test(guardBody) &&
    /TRIGGER guard_reward_configuration_trg[\s\S]{0,120}ON rewards/.test(M052),
  'The RLS policy reads a JWT claim; this re-reads the role from employees.',
)

// ── 10. The front end keeps its layering ────────────────────
console.log(`\n${C.bold}Front-end layering${C.reset}`)

const STORE_FILES = [
  'src/pages/employee/ValueStorePage.tsx',
  'src/components/experience/RewardCard.tsx',
  'src/components/hr/RedemptionQueue.tsx',
  'src/components/experience/MyRedemptions.tsx',
  'src/components/experience/RedemptionDetail.tsx',
]

for (const f of STORE_FILES) {
  const src = read(f)
  check(
    `${path.basename(f)} makes no direct Supabase call`,
    !src.includes('supabase.') && !src.includes("from '@/lib/supabase'"),
  )
}

check(
  'the store API sends only a reward id to redeem',
  /rpc\('redeem_reward', \{ p_reward_id: rewardId \}\)/.test(read('src/lib/api/store.ts')),
)

check(
  'the Value Store never reads the giving budget',
  !read('src/pages/employee/ValueStorePage.tsx').includes('.budget'),
  'Showing it here would invite the confusion the two balances exist to avoid.',
)

// ── 11. The shelves are HR's, not the code's (062) ──────────
console.log(`\n${C.bold}Store categories${C.reset}`)

const M062 = stripComments(read('supabase/migrations/062_reward_categories.sql'))

check(
  'rewards.category is a foreign key to reward_categories, not a fixed CHECK',
  /DROP CONSTRAINT IF EXISTS rewards_category_check/.test(M062) &&
    /FOREIGN KEY \(category\) REFERENCES reward_categories\(slug\)/.test(M062),
)

{
  const del = fnBody(M062, 'delete_reward_category')
  check(
    'removing a category moves its rewards and deletes it in one function',
    /UPDATE rewards SET category/.test(del) && /DELETE FROM reward_categories/.test(del),
    'Split across two calls, a failure between them strands rewards or refuses the delete.',
  )
  check(
    'removal refuses the last category',
    /count\(\*\) FROM reward_categories\) <= 1/.test(del),
  )
  for (const name of ['create_reward_category', 'delete_reward_category']) {
    const body = fnBody(M062, name)
    check(
      `${name}() re-reads the role from employees and checks the second factor`,
      /FROM employees WHERE id = actor/.test(body) && /session_second_factor_ok\(\)/.test(body),
    )
  }
  check(
    'there is no INSERT or DELETE policy on reward_categories',
    !/ON reward_categories\s+FOR (INSERT|DELETE|ALL)/.test(M062),
    'Creation and removal go through their functions or nowhere.',
  )
}

{
  /* The five original slugs written out as a list anywhere in the browser is
     the hard-coded catalogue coming back. The seeded-glyph fallback in
     rewardMarks.ts is the one sanctioned mention, and it is a map, not a
     list of choices. */
  const offenders = [
    'src/pages/hr/RewardsPage.tsx',
    'src/pages/employee/ValueStorePage.tsx',
    'src/components/experience/RewardCard.tsx',
    'src/components/experience/MyRedemptions.tsx',
    'src/components/experience/RedemptionDetail.tsx',
    'src/lib/api/store.ts',
    'src/lib/api/reference.ts',
  ].filter(f => /['"](everyday|experiences|wellness|recognition)['"]/.test(read(f)))
  check(
    'no screen or API hard-codes the original category list',
    offenders.length === 0,
    `Found in: ${offenders.join(', ')}`,
  )
}

console.log(
  failed === 0
    ? `\n${C.green}${C.bold}VALUE STORE OK${C.reset} ${C.dim}(static checks)${C.reset}\n`
    : `\n${C.red}${C.bold}${failed} CHECK(S) FAILED${C.reset}\n`,
)

process.exit(failed === 0 ? 0 : 1)
