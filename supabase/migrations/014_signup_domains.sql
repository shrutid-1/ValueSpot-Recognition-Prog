-- ============================================================
-- Migration 014: Manage the signup domain allowlist from the app
--
-- Idempotent and self-contained. Safe to run more than once.
-- Requires 012 (the app_config row) and 013 (current_employee_role).
--
-- 012 added app_config.signup_allowed_domains but left it as raw SQL, which
-- means the one control that decides whether the public internet can register
-- lives outside the product. 014 puts it behind two functions so HR Settings
-- can own it.
--
-- Why functions rather than a table policy: app_config's RLS reads
-- auth.jwt()->>'user_role', a claim that only exists once the custom access
-- token hook is registered. If the hook is missing the policy denies everyone
-- and the screen looks broken. current_employee_role() reads the employees
-- table instead, so authorization holds either way.
-- ============================================================


-- ── 1. Read ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_signup_domains()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
BEGIN
  IF caller_role IS NULL OR caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'domains', COALESCE(
      (SELECT value FROM app_config
        WHERE key = 'signup_allowed_domains' AND jsonb_typeof(value) = 'array'),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_signup_domains() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_signup_domains() TO authenticated;


-- ── 2. Write ────────────────────────────────────────────────
--
-- Normalises as it goes, so "@Touchcore.IN ", "www.touchcore.in" and
-- "touchcore.in" cannot end up as three separate entries that behave
-- differently. An empty array is accepted and means unrestricted — that is a
-- real choice, and the UI states its consequence rather than hiding it.

CREATE OR REPLACE FUNCTION public.set_signup_domains(p_domains text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
  caller_id   uuid;
  raw         text;
  cleaned     text;
  out_domains text[] := ARRAY[]::text[];
BEGIN
  IF caller_role IS NULL OR caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  IF p_domains IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  IF array_length(p_domains, 1) > 20 THEN
    RETURN jsonb_build_object('status', 'too_many', 'limit', 20);
  END IF;

  FOREACH raw IN ARRAY p_domains LOOP
    cleaned := lower(btrim(COALESCE(raw, '')));
    cleaned := regexp_replace(cleaned, '^@', '');          -- "@touchcore.in"
    cleaned := regexp_replace(cleaned, '^https?://', '');  -- pasted from a browser
    cleaned := regexp_replace(cleaned, '^www\.', '');
    cleaned := regexp_replace(cleaned, '/.*$', '');        -- trailing path

    CONTINUE WHEN cleaned = '';

    -- Deliberately strict: a typo here either locks staff out or lets everyone
    -- in, and both are worse than a rejected save.
    IF cleaned !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
      RETURN jsonb_build_object('status', 'invalid_domain', 'domain', cleaned);
    END IF;

    IF NOT (cleaned = ANY(out_domains)) THEN
      out_domains := out_domains || cleaned;
    END IF;
  END LOOP;

  SELECT id INTO caller_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  INSERT INTO app_config (key, value, description, updated_by, updated_at)
  VALUES (
    'signup_allowed_domains',
    to_jsonb(out_domains),
    'JSON array of email domains permitted to self-register. Empty array means '
    'any domain may register. Does not affect HR-invited accounts.',
    caller_id,
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('status', 'ok', 'domains', to_jsonb(out_domains));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_signup_domains(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_signup_domains(text[]) TO authenticated;
