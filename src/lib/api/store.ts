/**
 * The Value Store — browsing rewards, redeeming them, and deciding requests.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a second reward system. The catalogue is `rewards` (005), the same
 * table the HR screen has always edited, and a redemption is a row in
 * `reward_assignments` (005) with the columns migration 051 added. Nothing
 * here duplicates either.
 *
 * WHAT THE BROWSER IS NOT TRUSTED WITH
 * ------------------------------------
 * `redeem` sends one thing: which reward. Not the price, not the balance, not
 * the employee. All three are read inside redeem_reward(), which also holds
 * the wallet row locked while it checks and debits — so two tabs pressing
 * Redeem at once cannot spend the same coins, and a crafted request cannot
 * name its own price.
 *
 * The active catalogue is a plain select through RLS, readable by anybody
 * signed in (051). Both redemption lists go through RPCs: the queue because
 * it re-derives the caller's role from `employees`, and the employee's own
 * list because 052 made 'expired' a DERIVED status — a question about the
 * clock, which only the database's may answer.
 */
import type {
  Reward, RewardCategory, RedemptionStatus, RedemptionLifecycleStatus,
} from '@/types'
import { supabase, toApiError } from './client'

/** One of the employee's own redemptions. */
export interface MyRedemption {
  id: string
  /** What the COLUMN holds. Never 'expired' — nothing ever writes that. */
  status: RedemptionStatus
  /**
   * What it actually is right now, derived by the database against its own
   * clock. This is the one the UI renders; `status` stays beside it so an
   * expired row can still say it was approved first.
   */
  effective_status: RedemptionLifecycleStatus
  /** What was PAID, recorded at redemption. Never the reward's price today. */
  coin_cost: number
  /** What the reward was called then, so a renamed one still reads right. */
  reward_name_snapshot: string
  assigned_at: string
  decided_at: string | null
  decision_reason: string | null
  /** When it became the employee's to use. The expiry counts from here. */
  fulfilled_at: string | null
  /** The term in force at redemption. Null on rows predating migration 052. */
  validity_days_snapshot: number | null
  /** Null while pending: the clock has not started. Null on legacy rows too. */
  expires_at: string | null
  /** The shelf, for the card's mark. Null if HR deleted the reward since. */
  reward_category: RewardCategory | null
}

/** A redemption as the HR queue lists it. */
export interface RedemptionRequest {
  id: string
  status: RedemptionStatus
  /** Derived server-side, so the queue and the employee agree on 'expired'. */
  effective_status: RedemptionLifecycleStatus
  coin_cost: number
  reward_name_snapshot: string
  assigned_at: string
  decided_at: string | null
  decision_reason: string | null
  fulfilled_at: string | null
  validity_days_snapshot: number | null
  expires_at: string | null
  /**
   * Inside the configured warning window and not gone yet. Computed in the
   * database against `reward_expiry_warning_days`, so the threshold is one
   * value in app_config rather than a number picked in the browser.
   */
  expires_soon: boolean
  employee_id: string
  employee_name: string
  employee_code: string
  employee_avatar: string | null
  decided_by_name: string | null
}

/** What `redeem` reports back. */
export interface RedeemResult {
  redemptionId: string
  status: RedemptionStatus
  coinCost: number
  rewardName: string
  /** The term recorded on the redemption, read from the reward server-side. */
  validityDays: number
  /**
   * When it stops being usable — null when the request is pending, because
   * the clock does not start until somebody approves it.
   */
  expiresAt: string | null
  /** The employee's earned balance AFTER the debit, read inside the lock. */
  earned: number
}

export const storeApi = {
  /**
   * The rewards an employee can see.
   *
   * No `is_active` filter in the query: `rewards_read_active` (051) is what
   * decides that, and restating it here would put the rule in a second place
   * where it could later disagree with the first. Priced rewards only —
   * an unpriced one cannot be bought and redeem_reward() refuses it, so
   * offering it would be offering a control that can only fail.
   */
  async listRewards(): Promise<Reward[]> {
    const { data, error } = await supabase
      .from('rewards')
      .select('*')
      .gt('coin_price', 0)
      .order('coin_price', { ascending: true })

    if (error) throw toApiError(error, 'We could not load the Value Store.')

    return (data ?? []) as Reward[]
  },

  /**
   * Spend earned coins on a reward.
   *
   * One argument. Everything else the decision needs is read server-side —
   * see the module note. The error messages come back from the function
   * itself ("You have 400 earned Value Coins. Movie Voucher costs 1000."),
   * so a shortfall explains itself rather than failing generically.
   */
  async redeem(rewardId: string): Promise<RedeemResult> {
    const { data, error } = await supabase.rpc('redeem_reward', { p_reward_id: rewardId })

    if (error) throw toApiError(error, 'We could not redeem that reward.')

    const r = data as unknown as {
      redemption_id: string
      status: RedemptionStatus
      coin_cost: number
      reward_name: string
      validity_days: number
      expires_at: string | null
      earned: number
    }

    return {
      redemptionId: r.redemption_id,
      status: r.status,
      coinCost: r.coin_cost,
      rewardName: r.reward_name,
      validityDays: r.validity_days,
      expiresAt: r.expires_at,
      earned: r.earned,
    }
  },

  /**
   * This person's own redemptions, newest first.
   *
   * An RPC since 052, where this used to be a plain select. The reason is
   * the derived status: whether a reward has lapsed is settled by comparing
   * its expiry against a clock, and the only clock allowed to settle it is
   * the database's. Worked out here, a laptop with the wrong date would
   * show a dead voucher as usable, or hide a live one.
   *
   * Still no employee parameter — `me` comes from the session inside the
   * function, exactly as redeem_reward() does, so there is nothing to pass
   * somebody else's id into.
   *
   * The reward's NAME still comes off the snapshot on the row rather than
   * the join, so a redemption survives HR renaming or deleting the reward.
   */
  async listMyRedemptions(limit = 50): Promise<MyRedemption[]> {
    const { data, error } = await supabase.rpc('list_my_redemptions', { p_limit: limit })

    if (error) throw toApiError(error, 'We could not load your reward history.')

    return (data ?? []) as unknown as MyRedemption[]
  },

  /**
   * The organisation's redemptions. Refused by the database for anyone else.
   *
   * 'expired' is a legal filter even though no row is stored that way: the
   * function matches on the derived status for that one value.
   */
  async listRedemptions(
    status: RedemptionLifecycleStatus | 'all' = 'pending',
  ): Promise<RedemptionRequest[]> {
    const { data, error } = await supabase.rpc('list_reward_redemptions', {
      p_status: status,
      p_limit: 200,
    })

    if (error) throw toApiError(error, 'Could not load reward requests.')

    return (data ?? []) as unknown as RedemptionRequest[]
  },

  /**
   * Approve or reject a pending request.
   *
   * A rejection requires a reason and refunds the cost recorded on the
   * request — not the reward's price today, which HR may have changed since.
   * Deciding one that somebody else already decided is refused with what
   * actually happened to it, rather than overwriting their decision.
   */
  async decide(input: {
    redemptionId: string
    action: 'approve' | 'reject'
    reason?: string | null
  }): Promise<{ status: RedemptionStatus; refunded: number; expiresAt: string | null }> {
    const { data, error } = await supabase.rpc('decide_reward_redemption', {
      p_redemption_id: input.redemptionId,
      p_action: input.action,
      p_reason: input.reason?.trim() || null,
    })

    if (error) throw toApiError(error, 'Could not record that decision.')

    const r = data as unknown as {
      status: RedemptionStatus
      refunded: number
      expires_at: string | null
    }

    return { status: r.status, refunded: r.refunded, expiresAt: r.expires_at }
  },
}

/** The shelves, in the order the store lists them. */
export const REWARD_CATEGORIES: { value: RewardCategory | 'all'; label: string }[] = [
  { value: 'all',         label: 'Everything' },
  { value: 'everyday',    label: 'Everyday' },
  { value: 'experiences', label: 'Experiences' },
  { value: 'learning',    label: 'Learning' },
  { value: 'wellness',    label: 'Wellness' },
  { value: 'recognition', label: 'Recognition' },
]
