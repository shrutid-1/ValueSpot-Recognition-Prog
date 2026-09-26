/** Core Value slugs — used for routing and icon mapping */
export const CORE_VALUE_SLUGS = [
  'adaptable',
  'transparent',
  'collaborative',
  'innovative',
  'accountable',
] as const

export type CoreValueSlug = typeof CORE_VALUE_SLUGS[number]

/**
 * Core Value tone colors — monochromatic steel-blue family.
 * Touchcore palette: the signal red, a steel, a graphite, a rose and an amber.
 */
export const CORE_VALUE_COLORS: Record<CoreValueSlug, string> = {
  adaptable:     '#2a6ea8',  // steel
  transparent:   '#5b6b78',  // graphite
  collaborative: '#be3a66',  // rose
  innovative:    '#a25a0b',  // amber
  accountable:   '#c42a20',  // the signal red
}

/**
 * Tailwind soft-tint backgrounds for legacy page usage.
 * Maps to the closest accent ramp class available.
 */
export const CORE_VALUE_BG: Record<CoreValueSlug, string> = {
  adaptable:     'bg-accent-100',
  transparent:   'bg-accent-100',
  collaborative: 'bg-accent-100',
  innovative:    'bg-accent-100',
  accountable:   'bg-accent-100',
}

export const CORE_VALUE_TEXT: Record<CoreValueSlug, string> = {
  adaptable:     'text-accent-700',
  transparent:   'text-accent-700',
  collaborative: 'text-accent-900',
  innovative:    'text-accent-600',
  accountable:   'text-accent-700',
}

export const CORE_VALUE_BORDER: Record<CoreValueSlug, string> = {
  adaptable:     'border-accent-300',
  transparent:   'border-accent-300',
  collaborative: 'border-accent-700',
  innovative:    'border-accent-300',
  accountable:   'border-accent-500',
}

export const CORE_VALUE_RING: Record<CoreValueSlug, string> = {
  adaptable:     'ring-accent-400',
  transparent:   'ring-accent-400',
  collaborative: 'ring-accent-700',
  innovative:    'ring-accent-300',
  accountable:   'ring-accent-500',
}

/** Badge level display names — mirrors DB, used for fallback display only */
export const BADGE_LEVEL_NAMES: Record<number, string> = {
  1: 'Cheers',
  2: 'Applause',
  3: 'Kudos',
  4: 'Spotlight',
  5: 'Value Ambassador',
}

/** Pagination defaults */
export const PAGE_SIZE = 20
export const SEARCH_DEBOUNCE_MS = 300

/** App timezone */
export const APP_TIMEZONE = 'Asia/Kolkata'

/** Routes */
export const ROUTES = {
  // Auth — Employee, and the general entry point
  LOGIN: '/login',
  SIGNUP: '/signup',
  RESET_PASSWORD: '/reset-password',

  // Auth — Manager and HR.
  //
  // Separate ENTRY EXPERIENCES, not separate privileges. The role always comes
  // from the employee record; these URLs decide what the page says, never what
  // the account may do. Opening /hr/setup uninvited produces an ordinary
  // Employee account, because that is what the database writes.
  //
  // They sit under /manager and /hr alongside the protected app routes. React
  // Router resolves them because they are registered as top-level entries, and
  // no child of '/' claims these exact paths.
  MANAGER_LOGIN: '/manager/login',
  MANAGER_SETUP: '/manager/setup',
  HR_LOGIN: '/hr/login',
  HR_SETUP: '/hr/setup',

  // Employee
  DASHBOARD: '/dashboard',
  GIVE_RECOGNITION: '/give-recognition',
  RECOGNITION_FEED: '/feed',
  MY_RECOGNITIONS: '/my-recognitions',
  CORE_VALUE_JOURNEY: '/my-journey',
  /* Where an employee reports a mistake in a recognition. */
  SUPPORT: '/support',
  PROFILE: '/profile',
  /* The Value Wallet: balance, activity and the recognitions behind it. */
  WALLET: '/wallet',
  /* The Value Store: what earned coins can be spent on. */
  VALUE_STORE: '/store',

  // Manager
  MANAGER_DASHBOARD: '/manager/dashboard',
  PENDING_APPROVALS: '/manager/approvals',
  TEAM_RECOGNITION: '/manager/team',
  TEAM_BADGES: '/manager/badges',
  MANAGED_PROJECTS: '/manager/projects',
  /*
    Reports for a Manager.

    A second path to the SAME page as REPORTS below, not a second page. The
    page reads the caller's role and the database scopes the data; what differs
    is only the URL, and a Manager landing on `/hr/reports` would be told they
    are somewhere they are not. REPORTS keeps its path so existing HR links and
    bookmarks are untouched.
  */
  MANAGER_REPORTS: '/manager/reports',

  // HR Admin
  HR_DASHBOARD: '/hr/dashboard',
  ANALYTICS: '/hr/analytics',
  BADGE_ANALYTICS: '/hr/badge-analytics',
  REPORTS: '/hr/reports',
  EMPLOYEES: '/hr/employees',
  DEPARTMENTS: '/hr/departments',
  PROJECTS: '/hr/projects',
  CORE_VALUES: '/hr/core-values',
  BEHAVIOURS: '/hr/behaviours',
  SCENARIOS: '/hr/scenarios',
  REWARDS: '/hr/rewards',
  AUDIT_LOGS: '/hr/audit-logs',
  SETTINGS: '/hr/settings',
  /* Value Coin policy, and every employee's wallet. HR and Super Admin. */
  VALUE_COINS: '/hr/value-coins',
  // Super Admin only. Inside the HR portal by design — a higher-privilege
  // area, not a separate portal or dashboard.
  ADMINISTRATION: '/hr/administration',
  /* Migration 034 — the shared correction queue, read by HR and Super Admin. */
  SUPPORT_REQUESTS: '/hr/support-requests',
} as const
