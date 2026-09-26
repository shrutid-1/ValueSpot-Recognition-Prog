/**
 * Value Coins, from HR's side.
 *
 * Two powers, and they are different in kind. The SETTINGS decide the rules
 * everybody plays under from now on; an ADJUSTMENT reaches into one person's
 * wallet and changes what is already there. The second is the one that needs
 * a reason, and the database requires one.
 *
 * Neither function trusts the JWT's role claim. Both re-read the caller's
 * role from `employees` — a claim is what a token says, the table is what is
 * true, and these can move any balance in the organisation.
 */
import type { UserRole, ValueCoinAccount } from '@/types'
import { supabase, toApiError } from './client'

/** One employee's wallet, as the HR table lists it. */
export interface AdminWalletRow {
  employee_id: string
  full_name: string
  employee_code: string
  email: string
  role: UserRole
  is_active: boolean
  budget_balance: number
  earned_balance: number
  budget_period_start: string | null
}

/**
 * The policy, as HR edits it.
 *
 * Every field is a whole number of coins or days. A limit of 0 means NO
 * LIMIT, consistently — the alternative is a nullable limit, and a nullable
 * limit invites every reader to decide for itself what a missing value means.
 */
export interface CoinPolicy {
  /** Earned coins a new joiner starts with, once. */
  signupGrant: number
  /** Budget granted to everyone each period. */
  monthlyAllowance: number
  /** Ceiling on one send. 0 = no limit. */
  maxPerRecognition: number
  /** Ceiling on what one person sends one colleague in a day. 0 = no limit. */
  maxPerPersonPerDay: number
  /** Day of the month the budget turns over, 1–28. */
  resetDay: number
  /** Whether an unused budget survives the reset. */
  carryOver: boolean
}

/*
  The app_config keys behind each field, in one place.

  Named here rather than spelled at each call site: a typo in a key does not
  fail, it silently writes a setting nothing reads and leaves the real one at
  its old value.
*/
const KEYS = {
  signupGrant:        'value_coin_signup_grant',
  monthlyAllowance:   'value_coin_monthly_allowance',
  maxPerRecognition:  'value_coin_max_per_recognition',
  maxPerPersonPerDay: 'value_coin_max_per_person_per_day',
  resetDay:           'value_coin_allowance_reset_day',
  carryOver:          'value_coin_allowance_carry_over',
} as const

export const coinAdminApi = {
  /**
   * The current policy.
   *
   * Read straight from app_config, which HR may read (`app_config_hr_read`)
   * and an employee may not — which is exactly right here, and is why the
   * employee-facing limits travel on the wallet RPC instead.
   */
  async getPolicy(): Promise<CoinPolicy> {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', Object.values(KEYS))

    if (error) throw toApiError(error, 'Could not load the Value Coin settings.')

    const raw: Record<string, number> = {}
    for (const row of data ?? []) {
      raw[row.key] = Number(String(row.value).replace(/"/g, ''))
    }

    /* Defaults match the ones the database functions fall back to. They are
       repeated rather than fetched because a settings screen that cannot
       reach a row must still render something editable. */
    return {
      signupGrant:        raw[KEYS.signupGrant] ?? 500,
      monthlyAllowance:   raw[KEYS.monthlyAllowance] ?? 500,
      maxPerRecognition:  raw[KEYS.maxPerRecognition] ?? 0,
      maxPerPersonPerDay: raw[KEYS.maxPerPersonPerDay] ?? 0,
      resetDay:           raw[KEYS.resetDay] ?? 1,
      carryOver:          (raw[KEYS.carryOver] ?? 0) !== 0,
    }
  },

  /**
   * Save the policy.
   *
   * Written as JSON numbers, never strings: the column is jsonb and every
   * reader casts with `(value #>> '{}')::integer`, so storing "500" instead
   * of 500 would change the stored type for every consumer of that key.
   *
   * `carryOver` is stored as 0/1 rather than a JSON boolean for the same
   * reason — value_coin_setting() reads one integer shape, and one shape it
   * can always read beats two it has to tell apart.
   */
  async setPolicy(policy: CoinPolicy): Promise<void> {
    const rows: [string, number][] = [
      [KEYS.signupGrant,        Math.max(0, Math.floor(policy.signupGrant))],
      [KEYS.monthlyAllowance,   Math.max(0, Math.floor(policy.monthlyAllowance))],
      [KEYS.maxPerRecognition,  Math.max(0, Math.floor(policy.maxPerRecognition))],
      [KEYS.maxPerPersonPerDay, Math.max(0, Math.floor(policy.maxPerPersonPerDay))],
      // Clamped to a day every month actually has, which is what the database
      // clamps to as well.
      [KEYS.resetDay,           Math.min(28, Math.max(1, Math.floor(policy.resetDay)))],
      [KEYS.carryOver,          policy.carryOver ? 1 : 0],
    ]

    for (const [key, value] of rows) {
      const { error } = await supabase
        .from('app_config')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)

      if (error) throw toApiError(error, 'Could not save the Value Coin settings.')
    }
  },

  /** Every employee's balances. Refused by the database for anyone else. */
  async listWallets(search?: string, limit = 100): Promise<AdminWalletRow[]> {
    const { data, error } = await supabase.rpc('admin_list_value_coin_wallets', {
      p_search: search?.trim() || null,
      p_limit: limit,
    })

    if (error) throw toApiError(error, 'Could not load employee wallets.')

    return (data ?? []) as unknown as AdminWalletRow[]
  },

  /**
   * Add to or remove from one employee's balance.
   *
   * A DELTA, not a new total. An administrator looking at a number and typing
   * a different one is deciding from what they last loaded, and two of them
   * doing it at once means the second silently discards the first. "Add 200"
   * composes; "set to 700" does not.
   */
  async adjust(input: {
    employeeId: string
    account: ValueCoinAccount
    delta: number
    reason: string
  }): Promise<{ budget: number; earned: number }> {
    const { data, error } = await supabase.rpc('admin_adjust_value_coin_wallet', {
      p_employee_id: input.employeeId,
      p_account: input.account,
      p_delta: Math.trunc(input.delta),
      p_reason: input.reason.trim(),
    })

    if (error) throw toApiError(error, 'Could not adjust that wallet.')

    const result = data as unknown as { budget_balance: number; earned_balance: number }

    return { budget: result.budget_balance, earned: result.earned_balance }
  },
}
