-- ============================================================
-- Migration 028: monthly recognition trend in one query
--
-- Additive. One function. Safe to run more than once.
--
--
-- WHY
-- ---
-- HRDashboardPage built its 12-month trend chart with a loop:
--
--     for (let i = 11; i >= 0; i--) {
--       const { count } = await supabase.from('nominations')
--         .select('id', { count: 'exact', head: true })
--         .eq('status','approved').gte(...).lte(...)
--     }
--
-- Twelve round trips, awaited one after another, each waiting for the previous
-- to land before it starts. At a 100 ms round trip that is over a second of
-- dead time on every visit to the HR dashboard -- and it happens AFTER the
-- Promise.all batch above it has already finished.
--
-- It is one GROUP BY. The database was always able to answer this in a single
-- pass; nothing about the old shape was necessary.
--
--
-- SECURITY INVOKER, DELIBERATELY
-- ------------------------------
-- Note what this function is NOT: it is not SECURITY DEFINER. It runs with the
-- caller's own privileges, so every RLS policy on nominations applies exactly
-- as it does to the twelve queries it replaces -- including the
-- session_second_factor_ok() gate that migration 022 put on all of them.
--
-- A caller who could not see a row before cannot see it counted now. This is a
-- round-trip optimisation and nothing else: no new data is exposed, no policy
-- is altered, and there is no privilege to escalate because the function
-- borrows none.
--
-- That is also why it is safe to GRANT to authenticated generally rather than
-- gating it by role. An employee calling it gets a count of the rows an
-- employee may see. RLS is the authority, as everywhere else in this schema.
--
--
-- WHAT THIS MIGRATION DOES NOT TOUCH
-- ----------------------------------
--   every RLS policy            nominations and its indexes
--   claim_employee_account()    send_employee_invitation()
--   set_employee_role()         the 026/027 guards
--   2FA, Vault, pg_net, Brevo   migrations 001-027
-- ============================================================


CREATE OR REPLACE FUNCTION public.recognition_monthly_trend(
  p_months    integer DEFAULT 12,
  p_timezone  text    DEFAULT 'Asia/Kolkata'
)
RETURNS jsonb
LANGUAGE sql
STABLE
-- SECURITY INVOKER is the default and is stated here only to make the choice
-- visible: changing it to DEFINER would silently bypass RLS.
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH bounds AS (
    -- Months are bucketed in the application's display timezone, matching the
    -- IST the dashboard formats every other date in. Doing it in UTC would put
    -- recognitions from the first few hours of a month into the previous one.
    SELECT date_trunc('month', (now() AT TIME ZONE p_timezone))::date AS this_month
  ),
  series AS (
    SELECT generate_series(
             (SELECT this_month FROM bounds) - ((GREATEST(p_months, 1) - 1) || ' months')::interval,
             (SELECT this_month FROM bounds),
             '1 month'::interval
           )::date AS month_start
  ),
  counted AS (
    SELECT date_trunc('month', (n.approved_at AT TIME ZONE p_timezone))::date AS month_start,
           count(*) AS n
      FROM nominations n
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       -- Bounded so the index on approved_at is usable and old rows are not
       -- scanned. Matches the window the series covers.
       AND (n.approved_at AT TIME ZONE p_timezone)
             >= (SELECT this_month FROM bounds) - ((GREATEST(p_months, 1) - 1) || ' months')::interval
     GROUP BY 1
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'month', to_char(s.month_start, 'Mon YY'),
               'count', COALESCE(c.n, 0)
             )
             ORDER BY s.month_start
           ),
           '[]'::jsonb)
    FROM series s
    LEFT JOIN counted c ON c.month_start = s.month_start;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recognition_monthly_trend(integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recognition_monthly_trend(integer, text) TO authenticated;


-- ── Verification ────────────────────────────────────────────

SELECT '028 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'recognition_monthly_trend')          AS trend_rpc_installed,
       (SELECT NOT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'recognition_monthly_trend')                 AS runs_as_caller_not_definer,
       has_function_privilege('anon',
         'public.recognition_monthly_trend(integer, text)', 'EXECUTE') AS anon_may_execute,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')  AS policies_untouched;
-- EXPECT trend_rpc_installed true, runs_as_caller_not_definer TRUE (this is
-- the important one -- it means RLS still applies), anon_may_execute false,
-- and policies_untouched unchanged at 43.


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.recognition_monthly_trend(integer, text);
--
-- The dashboard would need its loop back; nothing else is affected. No table,
-- policy, grant, trigger or existing function was changed here.
-- ============================================================
