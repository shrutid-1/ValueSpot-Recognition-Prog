/**
 * Verifies that employee search treats its input as text, never as PostgREST
 * filter syntax.
 *
 * Run: npm run verify:search
 *
 * The property being checked is structural: whatever the user types, the
 * generated filter must contain exactly one condition per searched column and
 * no others. A term that adds a predicate of its own is the defect this
 * guards against.
 */
import { ilikeAnyFilter } from '../../src/lib/api/filters'

const COLUMNS = ['full_name', 'email', 'employee_id'] as const

let failures = 0

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

const BACKSLASH = String.fromCharCode(92)
const QUOTE = '"'

/**
 * Split into the conditions PostgREST would parse, breaking on commas that sit
 * outside double quotes — the same rule its grammar uses.
 */
function parseConditions(filter: string): string[] {
  const conditions: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < filter.length; i++) {
    const char = filter[i]
    if (char === BACKSLASH) { current += char + (filter[i + 1] ?? ''); i++; continue }
    if (char === QUOTE) { inQuotes = !inQuotes; current += char; continue }
    if (char === ',' && !inQuotes) { conditions.push(current); current = ''; continue }
    current += char
  }
  conditions.push(current)
  return conditions
}

function conditionCount(filter: string): number {
  return parseConditions(filter).length
}

/** The column and operator each parsed condition actually applies. */
function targets(filter: string): string[] {
  return parseConditions(filter).map(c => c.split('.').slice(0, 2).join('.'))
}

console.log('\nEmployee search filter — injection resistance\n')

/* The attack from the Phase 6 security review. */
const INJECTION = 'a,role.eq.super_admin'
const injected = ilikeAnyFilter(COLUMNS, INJECTION)

check(
  'injected predicate does not become a condition',
  conditionCount(injected) === COLUMNS.length,
  `expected ${COLUMNS.length} conditions, parsed ${conditionCount(injected)} in: ${injected}`,
)
check(
  'injected predicate survives only inside the quoted term',
  injected.includes(`${QUOTE}%a,role.eq.super_admin%${QUOTE}`),
  `term was not quoted verbatim: ${injected}`,
)
check(
  'every parsed condition is one of our own ILIKE predicates',
  targets(injected).every(t => COLUMNS.some(c => t === `${c}.ilike`)),
  `unexpected predicate(s): ${targets(injected).join(' | ')}`,
)

/* Other inputs that carry filter meaning. */
const HOSTILE: Array<[string, string]> = [
  ['comma', 'smith,jones'],
  ['parentheses', 'a)(or(is_active.eq.false'],
  ['nested or', 'x,or(role.eq.hr_admin,role.eq.super_admin)'],
  ['dot operator', 'name.eq.admin'],
  ['double quote', `he said ${QUOTE}hi${QUOTE}`],
  ['backslash', `back${BACKSLASH}slash`],
  ['quote then predicate', `${QUOTE}%,role.eq.super_admin,full_name.ilike.${QUOTE}%`],
  ['not.is null', 'a,email.not.is.null'],
  ['trailing backslash', `admin${BACKSLASH}`],
]

for (const [label, term] of HOSTILE) {
  const filter = ilikeAnyFilter(COLUMNS, term)
  const applied = targets(filter)

  check(
    `${label}: stays ${COLUMNS.length} ILIKE conditions on the searched columns`,
    conditionCount(filter) === COLUMNS.length &&
      applied.every(t => COLUMNS.some(c => t === `${c}.ilike`)),
    `parsed ${conditionCount(filter)} condition(s) [${applied.join(' | ')}] in: ${filter}`,
  )
}

/* Ordinary searches must be unchanged in meaning. */
console.log('\nOrdinary search behaviour\n')

const ordinary = ilikeAnyFilter(COLUMNS, 'anita')
check(
  'plain term matches every searched column',
  COLUMNS.every(c => ordinary.includes(`${c}.ilike.${QUOTE}%anita%${QUOTE}`)),
  ordinary,
)
check(
  'wildcards are preserved as wildcards',
  ilikeAnyFilter(COLUMNS, '50%').includes(`${QUOTE}%50%%${QUOTE}`),
  ilikeAnyFilter(COLUMNS, '50%'),
)
check(
  'a backslash is escaped, not dropped',
  ilikeAnyFilter(COLUMNS, `a${BACKSLASH}b`).includes(`a${BACKSLASH}${BACKSLASH}b`),
  ilikeAnyFilter(COLUMNS, `a${BACKSLASH}b`),
)
check(
  'a double quote is escaped, not dropped',
  ilikeAnyFilter(COLUMNS, `a${QUOTE}b`).includes(`a${BACKSLASH}${QUOTE}b`),
  ilikeAnyFilter(COLUMNS, `a${QUOTE}b`),
)

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
