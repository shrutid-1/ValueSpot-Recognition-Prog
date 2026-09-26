-- ============================================================
-- Migration 007: Server-side rate limiting + config read access
--
-- Fixes two defects in the original schema:
--   1. Recognition rate limits (REQ-010-02 / REQ-010-03) were only checked by
--      the frontend before INSERT, so any caller holding the anon key could
--      skip the check entirely. They are now enforced by a trigger.
--   2. `app_config` was readable by hr_admin/super_admin only, so the approver
--      routing in the recognition wizard could never read
--      `hr_fallback_employee_id` and silently fell back to "first HR admin".
-- ============================================================

-- ── 1. Rate limiting ────────────────────────────────────────

/**
 * Read a scalar app_config value as text.
 *
 * `#>> '{}'` unwraps a jsonb scalar whether it was stored as a JSON number (5)
 * or as a JSON string ("5"), which the Settings page currently writes.
 */
CREATE OR REPLACE FUNCTION public.app_config_text(config_key text, fallback text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value #>> '{}', 'null') FROM app_config WHERE key = config_key),
    fallback
  );
$$;

-- SECURITY DEFINER bypasses RLS on app_config, so only the trigger below (which
-- runs as definer itself) may call it — never a client.
REVOKE EXECUTE ON FUNCTION public.app_config_text(text, text) FROM PUBLIC;

/**
 * Enforce per-employee daily and monthly recognition limits.
 *
 * Day and month boundaries are evaluated in the configured display timezone
 * (NFR-006) rather than UTC, so "today" means the same thing here as it does
 * in the UI. Drafts do not count — only submitted nominations.
 */
CREATE OR REPLACE FUNCTION public.enforce_nomination_rate_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz            text;
  daily_limit   integer;
  monthly_limit integer;
  daily_count   integer;
  monthly_count integer;
BEGIN
  -- Rate limits are a product rule for people using the app. The service role
  -- (seeders, Edge Functions) and direct SQL are administrative paths and are
  -- exempt — without this, `npm run seed` would trip the daily limit.
  IF COALESCE(auth.role(), 'service_role') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- Drafts are not submissions and do not consume quota.
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  tz            := public.app_config_text('timezone', 'Asia/Kolkata');
  daily_limit   := public.app_config_text('rate_limit_daily', '5')::integer;
  monthly_limit := public.app_config_text('rate_limit_monthly', '20')::integer;

  SELECT count(*) INTO daily_count
  FROM nominations
  WHERE nominator_id = NEW.nominator_id
    AND status <> 'draft'
    AND (created_at AT TIME ZONE tz)::date = (now() AT TIME ZONE tz)::date;

  IF daily_count >= daily_limit THEN
    RAISE EXCEPTION
      'Daily recognition limit of % reached. Please come back tomorrow.', daily_limit
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO monthly_count
  FROM nominations
  WHERE nominator_id = NEW.nominator_id
    AND status <> 'draft'
    AND date_trunc('month', created_at AT TIME ZONE tz)
        = date_trunc('month', now() AT TIME ZONE tz);

  IF monthly_count >= monthly_limit THEN
    RAISE EXCEPTION
      'Monthly recognition limit of % reached. Your limit resets next month.', monthly_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_nomination_rate_limits() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_nomination_rate_limits ON nominations;
CREATE TRIGGER enforce_nomination_rate_limits
  BEFORE INSERT ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_nomination_rate_limits();

-- ── 2. Config read access ───────────────────────────────────

-- Operational, non-sensitive keys every signed-in user's UI needs. RLS policies
-- are OR'd, so the existing HR-only policies still grant full access; this only
-- widens SELECT for this specific allowlist.
DROP POLICY IF EXISTS "app_config_read_operational" ON app_config;
CREATE POLICY "app_config_read_operational" ON app_config
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND key IN (
      'hr_fallback_employee_id',
      'recognition_feed_page_size',
      'timezone',
      'badge_period_type',
      'badge_period_start_month',
      'financial_year_q1_start'
    )
  );
