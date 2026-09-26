/**
 * Value Coins — the balance, the ledger, and sending.
 *
 * Every write is an RPC, and none of the three tables involved has a write
 * policy at all (migration 048). That is not the usual arrangement in this
 * codebase — comments and appreciations are plain table writes fenced by
 * RLS — and the difference is what is at stake. A balance written by the
 * wrong person is a currency nobody can trust again, so the only way one
 * moves is send_value_coins(), which reads the sender from the session,
 * locks both wallets, and refuses anything it cannot justify.
 *
 * Reads are plain selects, fenced normally: your own wallet and the
 * transactions you were a party to. A colleague's balance is not readable,
 * which is deliberate — it says how much they have given away.
 */
import type { ValueCoinTransactionKind, ValueCoinAccount } from '@/types'
import { supabase, toApiError } from './client'

/** Which side of a movement the reader is on. */
export type CoinDirection = 'in' | 'out'

/** Which movements the wallet is listing. */
export type ActivityFilter = 'all' | 'received' | 'given' | 'rewards' | 'adjusted'

/**
 * One movement of coins, with the recognition that produced it.
 *
 * Shape of v_value_coin_activity (049). `direction` and `counterparty_*` are
 * resolved against the SESSION inside the view — the same transfer is a
 * credit to one person and a debit to the other, and only the database knows
 * which of them is asking.
 */
export interface ValueCoinActivity {
  id: string
  created_at: string
  amount: number
  kind: ValueCoinTransactionKind
  note: string | null
  nomination_id: string | null
  direction: CoinDirection
  /** Which balance this row moved: the budget, or earned coins. */
  account: ValueCoinAccount
  /** Null for the welcome grant, and for a colleague no longer readable. */
  counterparty_id: string | null
  counterparty_name: string | null
  counterparty_avatar: string | null
  /** The recognition the coins were sent on. Null for the grant. */
  core_value_name: string | null
  project_name: string | null
  nominee_name: string | null
  nominator_name: string | null
}

/** One month of the activity series. */
export interface WalletMonth {
  /** First day of the month, as a date string. */
  month: string
  received: number
  given: number
}

/**
 * Everything the wallet screen states at once.
 *
 * One call rather than six, because a screen about money must not show six
 * numbers fetched at six different moments that disagree with each other.
 */
/**
 * The limits an employee is sending under.
 *
 * Carried on the wallet rather than read from app_config, whose read policy
 * is HR-only: an employee never reads that table, they read this, and the
 * function behind it runs as its owner. Opening a table of operational
 * settings to everyone so a popover can say "max 100" would be the wrong
 * trade.
 */
export interface CoinLimits {
  /** Budget granted each period. */
  monthlyAllowance: number
  /** Ceiling on one send. 0 means no limit — consistently, everywhere. */
  maxPerRecognition: number
  /** Ceiling on what one person may send one colleague in a day. 0 = none. */
  maxPerPersonPerDay: number
  /** Whether an unused budget survives the reset. */
  carryOver: boolean
  /** The period the current budget belongs to. */
  periodStart: string
  /** When it next turns over. */
  periodEnd: string
}

/** The two balances, and the rules they sit under. */
export interface CoinBalances extends CoinLimits {
  /** What you may GIVE. Resets each period. */
  budget: number
  /** What colleagues SENT you. Never resets, never spendable. */
  earned: number
}

export interface WalletSummary extends CoinBalances {
  receivedThisMonth: number
  givenThisMonth: number
  receivedTotal: number
  givenTotal: number
  grantedTotal: number
  /**
   * DISTINCT recognitions that earned coins — not transactions. Three
   * colleagues sending on one recognition is one recognition.
   */
  recognitionsEarningTotal: number
  recognitionsEarningThisMonth: number
  /** Six months, oldest first, with zeroes for the quiet ones. */
  months: WalletMonth[]
}

/** What `send` gives back: the movement, and what is left. */
export interface SendResult {
  transactionId: string
  amount: number
  /** The sender's remaining BUDGET, read inside the same lock as the debit. */
  budget: number
}


/** The wire shape both wallet RPCs return for the balances and limits. */
interface RawBalances {
  budget: number
  earned: number
  monthly_allowance: number
  max_per_recognition: number
  max_per_person_per_day: number
  carry_over: boolean
  period_start: string
  period_end: string
}

/* One reader for both, so `ensure` and `summary` cannot come to disagree
   about what the same eight fields are called. */
const readBalances = (raw: unknown): CoinBalances => {
  const r = raw as RawBalances
  return {
    budget: r.budget,
    earned: r.earned,
    monthlyAllowance: r.monthly_allowance,
    maxPerRecognition: r.max_per_recognition,
    maxPerPersonPerDay: r.max_per_person_per_day,
    carryOver: r.carry_over,
    periodStart: r.period_start,
    periodEnd: r.period_end,
  }
}

export const walletApi = {
  /**
   * This person's balance, opening their wallet if this is the first time.
   *
   * One call rather than "read, and open if empty", because the opening is
   * the part that must happen exactly once and a two-step version invites
   * two callers to each decide they are first. The function takes no
   * employee id — it reads the session — so it cannot be aimed at somebody
   * else's wallet.
   *
   * The starting grant is configuration (`value_coin_signup_grant`), not a
   * constant in this file. Nothing here knows or needs to know what it is.
   */
  async ensure(): Promise<CoinBalances> {
    const { data, error } = await supabase.rpc('ensure_my_value_coin_wallet')

    if (error) throw toApiError(error, 'We could not open your Value Coin wallet.')

    return readBalances(data)
  },

  /** Balance, this month, lifetime, and the six-month series — in one call. */
  async summary(): Promise<WalletSummary> {
    const { data, error } = await supabase.rpc('value_coin_summary')

    if (error) throw toApiError(error, 'We could not load your Value Wallet.')

    const raw = data as unknown as RawBalances & {
      received_this_month: number
      given_this_month: number
      received_total: number
      given_total: number
      granted_total: number
      recognitions_earning_total: number
      recognitions_earning_this_month: number
      months: WalletMonth[] | null
    }

    return {
      ...readBalances(raw),
      receivedThisMonth: raw.received_this_month,
      givenThisMonth: raw.given_this_month,
      receivedTotal: raw.received_total,
      givenTotal: raw.given_total,
      grantedTotal: raw.granted_total,
      recognitionsEarningTotal: raw.recognitions_earning_total,
      recognitionsEarningThisMonth: raw.recognitions_earning_this_month,
      months: raw.months ?? [],
    }
  },

  /**
   * This person's movements, newest first, with the recognition behind each.
   *
   * No employee filter in the query. The view already scopes itself to the
   * caller, and restating the rule here would put it in a second place where
   * it could later disagree with the first.
   *
   * The filter is applied in the DATABASE rather than to a fetched array,
   * because the list is paged: filtering twenty fetched rows down to the
   * four received ones would call that "Coins received" while hiding every
   * older one.
   */
  async activity(filter: ActivityFilter = 'all', limit = 40): Promise<ValueCoinActivity[]> {
    let query = supabase
      .from('v_value_coin_activity')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    /*
      Each tab is a different QUERY, not a different view of one fetched
      array. The list is capped, so filtering twenty fetched rows down to the
      four rewards among them would call that "Rewards" while hiding every
      older redemption.

      Earned and Given are about recognition only — a redemption is also an
      outgoing movement, and lumping it under "Given" would have somebody's
      coffee voucher appear as a gift to a colleague.
    */
    if (filter === 'received') query = query.eq('kind', 'recognition_tip').eq('direction', 'in')
    if (filter === 'given') query = query.eq('kind', 'recognition_tip').eq('direction', 'out')
    if (filter === 'rewards') query = query.in('kind', ['reward_redemption', 'reward_refund'])
    if (filter === 'adjusted') query = query.eq('kind', 'admin_adjustment')

    const { data, error } = await query

    if (error) throw toApiError(error, 'We could not load your Value Coin activity.')

    return (data ?? []) as unknown as ValueCoinActivity[]
  },

  /**
   * Send coins to the person a recognition is about.
   *
   * There is no sender parameter, and that is the point: the database reads
   * it from the session, so spending somebody else's balance is not a thing
   * this call can express. The recipient IS passed, and is checked against
   * the nomination's nominee inside the function — passing anybody else is
   * refused rather than quietly recorded.
   *
   * The error messages come back from the function itself — "You have 40
   * Value Coins, which is not enough to send 100" — so an overdraft says
   * what is actually wrong instead of a generic failure.
   */
  async send(input: {
    recipientId: string
    amount: number
    nominationId: string
    note?: string | null
  }): Promise<SendResult> {
    const { data, error } = await supabase.rpc('send_value_coins', {
      p_recipient_id: input.recipientId,
      p_amount: input.amount,
      p_nomination_id: input.nominationId,
      p_note: input.note?.trim() || null,
    })

    if (error) throw toApiError(error, 'We could not send those Value Coins.')

    const result = data as unknown as {
      transaction_id: string; amount: number; budget: number
    }

    return {
      transactionId: result.transaction_id,
      amount: result.amount,
      budget: result.budget,
    }
  },
}
