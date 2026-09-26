/**
 * calculate-badges Edge Function
 *
 * Recalculates employee value badges in bulk. `process-approval` maintains
 * badges incrementally after each approval; this function is the backfill path,
 * used after seeding or after badge thresholds change.
 *
 * Usage:
 * ```
 * curl -X POST https://your-project.supabase.co/functions/v1/calculate-badges \
 *   -H "Authorization: Bearer YOUR_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{}'
 * ```
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * The session id from an already-validated access token.
 *
 * Read from the token itself rather than the request body, so a caller cannot
 * claim a session that is not theirs. Signature verification is done by
 * getUser() before this value is used.
 */
function readSessionId(token: string): string | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown }
    return typeof claims.session_id === 'string' ? claims.session_id : null
  } catch {
    return null
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BadgeDefinition {
  level: number
  minimum_count: number
  maximum_count: number | null
}

interface RecognitionCount {
  employee_id: string
  core_value_id: string
  recognition_count: number
  unique_recognizers: Set<string>
}

interface AnnualPeriod {
  period_start: string
  period_end: string
}

/**
 * Highest badge level whose range contains `count`.
 *
 * Scans from the highest minimum downward so the most senior qualifying badge
 * wins when ranges overlap.
 */
function calculateBadgeLevel(count: number, definitions: BadgeDefinition[]): number | null {
  const sorted = [...definitions].sort((a, b) => b.minimum_count - a.minimum_count)
  for (const badge of sorted) {
    if (count >= badge.minimum_count) {
      if (badge.maximum_count === null || count <= badge.maximum_count) {
        return badge.level
      }
    }
  }
  return null
}

/** Zero-pad to two digits for YYYY-MM-DD assembly. */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Last day of a given 1-indexed month, accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Annual badge period containing today, as plain date strings.
 *
 * Built by arithmetic rather than `new Date(...).toISOString()`, which would
 * shift the boundary by the runtime's UTC offset — in IST that turned
 * 2026-01-01 into 2025-12-31 and wrote to a different period row than
 * process-approval, splitting each employee's badge across two records.
 */
function getAnnualPeriod(startMonth: number): AnnualPeriod {
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1

  // A period beginning in month M covers M..M+11. If we are before M this
  // year, we are still inside the period that began last year.
  const startYear = currentMonth >= startMonth ? currentYear : currentYear - 1

  const endMonth = startMonth === 1 ? 12 : startMonth - 1
  const endYear = startMonth === 1 ? startYear : startYear + 1

  return {
    period_start: `${startYear}-${pad(startMonth)}-01`,
    period_end: `${endYear}-${pad(endMonth)}-${pad(daysInMonth(endYear, endMonth))}`,
  }
}

/** Read a scalar app_config value, tolerating both JSON numbers and strings. */
function configNumber(value: unknown, fallback: number): number {
  const parsed = Number(typeof value === 'string' ? value.replace(/"/g, '') : value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Aggregate approved recognitions per employee x core value for the period.
 *
 * Pages through the table so the result is not silently truncated at
 * PostgREST's default row cap.
 */
async function fetchRecognitionCounts(
  supabase: SupabaseClient,
  period: AnnualPeriod,
): Promise<RecognitionCount[]> {
  const pageSize = 1000
  const counts = new Map<string, RecognitionCount>()

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('nominations')
      .select('nominee_id, core_value_id, nominator_id')
      .eq('status', 'approved')
      .gte('approved_at', `${period.period_start}T00:00:00Z`)
      .lte('approved_at', `${period.period_end}T23:59:59Z`)
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const nom of data) {
      const key = `${nom.nominee_id}:${nom.core_value_id}`
      let entry = counts.get(key)
      if (!entry) {
        entry = {
          employee_id: nom.nominee_id,
          core_value_id: nom.core_value_id,
          recognition_count: 0,
          unique_recognizers: new Set<string>(),
        }
        counts.set(key, entry)
      }
      entry.recognition_count += 1
      entry.unique_recognizers.add(nom.nominator_id)
    }

    if (data.length < pageSize) break
  }

  return Array.from(counts.values())
}

interface ExistingBadge {
  employee_id: string
  core_value_id: string
  badge_level: number | null
  recognition_count: number
}

/**
 * Every badge row already stored for the period.
 *
 * Read in one paged pass instead of a SELECT per combination, and — more
 * importantly — read INDEPENDENTLY of the recognition counts. The reconcile
 * step below needs to see rows that the counts no longer mention, which is
 * precisely the set a per-combination lookup can never reach.
 */
async function fetchExistingBadges(
  supabase: SupabaseClient,
  period: AnnualPeriod,
): Promise<Map<string, ExistingBadge>> {
  const pageSize = 1000
  const rows = new Map<string, ExistingBadge>()

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('employee_value_badges')
      .select('employee_id, core_value_id, badge_level, recognition_count')
      .eq('period_type', 'annual')
      .eq('period_start', period.period_start)
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data as ExistingBadge[]) {
      rows.set(`${row.employee_id}:${row.core_value_id}`, row)
    }

    if (data.length < pageSize) break
  }

  return rows
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // This function rewrites every employee's badges, so it is an
    // administrative operation and had no caller check at all — the service
    // role bypasses RLS, so anyone who could reach the endpoint could trigger
    // a full recalculation. Require an authenticated, second-factor verified
    // HR administrator.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const sessionId = readSessionId(token)
    const { data: secondFactorOk } = sessionId
      ? await supabase.rpc('session_second_factor_ok_for', {
          p_session_id: sessionId,
          p_user_id: user.id,
        })
      : { data: false }

    if (secondFactorOk !== true) {
      return new Response(JSON.stringify({ error: 'Verification required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerEmp } = await supabase
      .from('employees')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()

    if (!callerEmp || !['hr_admin', 'super_admin'].includes(callerEmp.role as string)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('[calculate-badges] Starting badge calculation')

    const { data: appConfig, error: configError } = await supabase
      .from('app_config')
      .select('key, value')
    if (configError) throw configError

    const configMap = new Map((appConfig ?? []).map(c => [c.key, c.value]))
    const badgePeriodStartMonth = configNumber(configMap.get('badge_period_start_month'), 1)

    const { data: badges, error: badgesError } = await supabase
      .from('badge_definitions')
      .select('level, minimum_count, maximum_count')
      .eq('is_active', true)
      .order('level', { ascending: true })
    if (badgesError) throw badgesError

    const definitions: BadgeDefinition[] = badges ?? []
    const period = getAnnualPeriod(badgePeriodStartMonth)

    const counts = await fetchRecognitionCounts(supabase, period)
    console.log(
      `[calculate-badges] ${counts.length} employee-value combinations in ` +
      `${period.period_start}..${period.period_end}`,
    )

    const existingBadges = await fetchExistingBadges(supabase, period)

    let badgesCreated = 0
    let badgesUpdated = 0
    let badgesCleared = 0
    let historyCreated = 0

    for (const count of counts) {
      const key = `${count.employee_id}:${count.core_value_id}`
      const existing = existingBadges.get(key)
      const currentLevel: number | null = existing?.badge_level ?? null

      /*
        Claimed before the write, not after.

        This combination has approved recognitions behind it, so it is not an
        orphan no matter how the upsert below turns out. Removing it here
        means a failed write leaves the stored row untouched, where the next
        run will retry it — whereas claiming it after the write would let an
        error fall through to the reconcile pass and zero a badge that is
        perfectly valid.
      */
      existingBadges.delete(key)

      /*
        The recount is AUTHORITATIVE — it may lower a badge.

        REQ-005-06 ("badges never downgrade within a period") is honoured by
        the incremental path in process-approval, where it belongs: an
        employee should not lose a badge to ordinary churn. It must not apply
        here. This function recomputes from the approved rows that actually
        exist, and it is what runs after a moderator removes or re-files a
        recognition. Carrying the old level forward at that point would leave
        a badge standing on evidence an administrator had just deleted, which
        makes moderation cosmetic.
      */
      const newLevel = calculateBadgeLevel(count.recognition_count, definitions)

      const { error: upsertError } = await supabase
        .from('employee_value_badges')
        .upsert({
          employee_id: count.employee_id,
          core_value_id: count.core_value_id,
          period_type: 'annual',
          period_start: period.period_start,
          period_end: period.period_end,
          recognition_count: count.recognition_count,
          unique_recognizer_count: count.unique_recognizers.size,
          badge_level: newLevel,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'employee_id,core_value_id,period_type,period_start' })

      if (upsertError) {
        console.error('[calculate-badges] Error writing badge:', upsertError)
        continue
      }

      if (existing) badgesUpdated++
      else badgesCreated++

      /*
        History records a level being REACHED, so it is written only when the
        level actually rose. Previously the test was `!== currentLevel`, which
        now that a recount can lower a badge would log a DEMOTION as though it
        were an achievement. A revocation is already recorded in audit_logs by
        the moderation function that caused it.
      */
      const levelRose = newLevel !== null && (currentLevel === null || newLevel > currentLevel)

      if (levelRose) {
        const { error: historyError } = await supabase.from('badge_history').insert({
          employee_id: count.employee_id,
          core_value_id: count.core_value_id,
          previous_level: currentLevel,
          new_level: newLevel,
          recognition_count: count.recognition_count,
          period_type: 'annual',
          period_start: period.period_start,
          period_end: period.period_end,
        })
        if (!historyError) historyCreated++
      }
    }

    /*
      Reconcile what the counts no longer mention.

      Anything still in `existingBadges` is a stored badge with NO approved
      recognition behind it any more — the last one was removed by a
      moderator, or re-filed against a different Core Value. Those rows were
      previously unreachable: the loop above iterates the counts, and a
      combination that has dropped to zero produces no count to iterate, so
      its row was never revisited and kept asserting the old figure. That is
      the defect where a deleted recognition went on showing as a badge on the
      employee's dashboard and journey.

      The rows are zeroed rather than deleted: the employee still belongs to
      the period, the screens render a zero correctly, and nothing has to be
      recreated if they are recognised for that value again.
    */
    for (const stale of existingBadges.values()) {
      // Already at zero — nothing to correct, and no pointless write.
      if (stale.recognition_count === 0 && stale.badge_level === null) continue

      const { error: clearError } = await supabase
        .from('employee_value_badges')
        .update({
          recognition_count: 0,
          unique_recognizer_count: 0,
          badge_level: null,
          last_updated: new Date().toISOString(),
        })
        .eq('employee_id', stale.employee_id)
        .eq('core_value_id', stale.core_value_id)
        .eq('period_type', 'annual')
        .eq('period_start', period.period_start)

      if (clearError) {
        console.error('[calculate-badges] Error clearing badge:', clearError)
        continue
      }
      badgesCleared++
    }

    const result = {
      success: true,
      period,
      processed: counts.length,
      badges_created: badgesCreated,
      badges_updated: badgesUpdated,
      badges_cleared: badgesCleared,
      history_created: historyCreated,
    }

    console.log('[calculate-badges] Complete:', result)

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[calculate-badges] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
