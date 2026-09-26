/**
 * Operational settings — the tunable numbers behind the recognition rules.
 *
 * Rate limits, the anti-gaming window, the financial-year start, and the badge
 * thresholds. Small, rarely changed, and read by the rules rather than by the
 * screens: `app_config` is what check-rate-limits and check-duplicate consult.
 *
 * Authorization is unchanged and none is performed here. `app_config_hr_write`
 * governs the writes and `app_config_hr_read` / `app_config_read_operational`
 * the reads, both gated on session_second_factor_ok() since migration 022. A
 * non-HR caller is refused by the database exactly as before.
 */
import type { BadgeDefinition } from '@/types'
import { supabase, toApiError } from './client'

/** A configuration row as the settings screen edits it. */
export interface ConfigValue {
  key: string
  value: number
}

export const settingsApi = {
  /**
   * The named configuration values.
   *
   * Takes the keys it should read rather than selecting the whole table. The
   * screen shows four settings but used to download every row `app_config`
   * would return, including operational keys it never displays.
   */
  async getConfig(keys: readonly string[]): Promise<Record<string, string>> {
    if (keys.length === 0) return {}

    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', [...keys])

    if (error) throw toApiError(error, 'Could not load settings.')

    const values: Record<string, string> = {}
    for (const row of data ?? []) {
      // `value` is jsonb; a seeded number arrives as a number, but a seeded
      // string arrives with its quotes, which must not reach the input.
      values[row.key] = String(row.value).replace(/"/g, '')
    }
    return values
  },

  /**
   * Set one numeric configuration value.
   *
   * The value is written as a JSON number, not a string: the column is jsonb
   * and is seeded with numbers, so writing "5" instead of 5 would silently
   * change the stored type for every consumer of that key.
   */
  async setNumericConfig(key: string, value: number): Promise<void> {
    if (!Number.isFinite(value)) {
      throw new Error(`Refusing to store a non-numeric value for ${key}.`)
    }

    const { error } = await supabase
      .from('app_config')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)

    if (error) throw toApiError(error, 'Could not save that setting.')
  },

  /** Move one badge level's count thresholds. */
  async setBadgeThresholds(
    badgeId: string,
    thresholds: { minimumCount: number; maximumCount: number | null },
  ): Promise<void> {
    const { error } = await supabase
      .from('badge_definitions')
      .update({
        minimum_count: thresholds.minimumCount,
        maximum_count: thresholds.maximumCount,
      })
      .eq('id', badgeId)

    if (error) throw toApiError(error, 'Could not save that badge threshold.')
  },
}

export type { BadgeDefinition }
