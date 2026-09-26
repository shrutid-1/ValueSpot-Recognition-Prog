-- ============================================================
-- Migration 017: Separate HR administration from system administration
--
-- Incremental. 013-016 are already applied to this project; every statement
-- below redefines an existing function or adjusts a grant. No tables are
-- created, no rows are changed, nothing is dropped. Safe to apply once, and
-- safe to re-apply.
--
-- The boundary being drawn
-- -----------------------
-- HR Admin runs HR. That includes appointing managers, which is ordinary
-- onboarding work and should not need a Super Admin.
--
-- Super Admin runs the system. That means the controls which decide who can
-- administer the company's data at all.
--
--                                        hr_admin   super_admin
--   Manager access codes                    yes         yes
--   HR Admin access codes                   no          yes
--   Grant / revoke HR Admin                 no          yes
--   Grant / revoke Super Admin              no          yes
--   Signup domain policy                    no          yes
--   See who the administrators are          no          yes
--   Security activity                       no          yes
--
-- Three of those were previously open to hr_admin. In particular
-- set_signup_domains let an HR Admin open self-registration to every domain
-- on the internet — a system-wide access control sitting behind an HR screen.
--
-- What is deliberately unchanged
-- ------------------------------
-- set_employee_role(), the role-change guard trigger and the last-administrator
-- protections from 016 are already correct and are not touched here. HR Admin
-- was never able to grant hr_admin or super_admin through them.
-- ============================================================


-- ── 1. Signup domain policy: super admin only ───────────────
--
-- This decides who may create an account at all, so it belongs with system
-- administration rather than with HR's day-to-day settings.

CREATE OR REPLACE FUNCTION public.get_signup_domains()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_employee_role() IS DISTINCT FROM 'super_admin' THEN
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


CREATE OR REPLACE FUNCTION public.set_signup_domains(p_domains text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id   uuid;
  raw         text;
  cleaned     text;
  out_domains text[] := ARRAY[]::text[];
  previous    jsonb;
BEGIN
  IF public.current_employee_role() IS DISTINCT FROM 'super_admin' THEN
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
    cleaned := regexp_replace(cleaned, '^@', '');
    cleaned := regexp_replace(cleaned, '^https?://', '');
    cleaned := regexp_replace(cleaned, '^www\.', '');
    cleaned := regexp_replace(cleaned, '/.*$', '');

    CONTINUE WHEN cleaned = '';

    IF cleaned !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
      RETURN jsonb_build_object('status', 'invalid_domain', 'domain', cleaned);
    END IF;

    IF NOT (cleaned = ANY(out_domains)) THEN
      out_domains := out_domains || cleaned;
    END IF;
  END LOOP;

  SELECT id INTO caller_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT value INTO previous FROM app_config WHERE key = 'signup_allowed_domains';

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

  -- Widening this policy is one of the few actions that can expose the whole
  -- system, so it is recorded with its before and after.
  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    caller_id,
    lower(btrim(auth.jwt()->>'email')),
    'signup_domains.changed',
    'app_config',
    NULL,
    jsonb_build_object('domains', COALESCE(previous, '[]'::jsonb)),
    jsonb_build_object('domains', to_jsonb(out_domains))
  );

  RETURN jsonb_build_object('status', 'ok', 'domains', to_jsonb(out_domains));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_signup_domains(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_signup_domains(text[]) TO authenticated;


-- ── 2. Who the administrators are: super admin only ─────────

CREATE OR REPLACE FUNCTION public.list_administrators()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_employee_role() IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden', 'admins', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'admins', COALESCE((
      SELECT jsonb_agg(a ORDER BY a.full_name)
        FROM (
          SELECT id, full_name, email, is_active,
                 (auth_user_id IS NOT NULL) AS can_sign_in
            FROM employees
           WHERE role = 'super_admin'
        ) a
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_administrators() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_administrators() TO authenticated;


-- ── 3. HR Administrators, for the Access & Roles screen ─────
--
-- The counterpart to list_administrators(): who currently holds hr_admin, so
-- a super admin can review and revoke without hunting through the employee
-- directory.

CREATE OR REPLACE FUNCTION public.list_hr_administrators()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_employee_role() IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden', 'admins', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'admins', COALESCE((
      SELECT jsonb_agg(a ORDER BY a.full_name)
        FROM (
          SELECT id, full_name, email, is_active,
                 (auth_user_id IS NOT NULL) AS can_sign_in
            FROM employees
           WHERE role = 'hr_admin'
        ) a
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_hr_administrators() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_hr_administrators() TO authenticated;


-- ── 4. Access codes: HR keeps managers, and everything is logged ──
--
-- The permission rule is unchanged from 013 and already matches what we want:
-- hr_admin may issue 'manager' only, super_admin may issue either. What is
-- added here is the audit trail, and hiding HR Admin codes from HR's listing
-- so the screen shows only what that person can actually act on.

CREATE OR REPLACE FUNCTION public.create_role_access_code(
  p_role            text,
  p_label           text    DEFAULT NULL,
  p_expires_in_days integer DEFAULT 14,
  p_max_uses        integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
  caller_id   uuid;
  body        text;
  code        text;
  prefix      text;
  row_out     role_access_codes%ROWTYPE;
BEGIN
  IF caller_role IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF p_role NOT IN ('manager', 'hr_admin') THEN
    RETURN jsonb_build_object('status', 'invalid_role');
  END IF;

  -- HR appoints managers. Only a super admin creates another administrator.
  IF p_role = 'hr_admin' AND caller_role <> 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden', 'reason', 'needs_super_admin');
  END IF;
  IF caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  IF p_expires_in_days IS NULL OR p_expires_in_days < 1 OR p_expires_in_days > 90 THEN
    RETURN jsonb_build_object('status', 'invalid_expiry');
  END IF;
  IF p_max_uses IS NULL OR p_max_uses < 1 OR p_max_uses > 50 THEN
    RETURN jsonb_build_object('status', 'invalid_max_uses');
  END IF;

  SELECT id INTO caller_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  prefix := CASE p_role WHEN 'hr_admin' THEN 'HRA' ELSE 'MGR' END;

  body := upper(replace(gen_random_uuid()::text, '-', ''));
  code := prefix
       || '-' || substr(body, 1, 4)
       || '-' || substr(body, 5, 4)
       || '-' || substr(body, 9, 4)
       || '-' || substr(body, 13, 4)
       || '-' || substr(body, 17, 4);

  INSERT INTO role_access_codes (code_hash, role, label, created_by, expires_at, max_uses)
  VALUES (
    public.hash_access_code(code),
    p_role,
    NULLIF(btrim(p_label), ''),
    caller_id,
    now() + make_interval(days => p_expires_in_days),
    p_max_uses
  )
  RETURNING * INTO row_out;

  -- The code itself is never written to the audit trail; only the fact that
  -- one was issued, for which role, and by whom.
  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    caller_id,
    lower(btrim(auth.jwt()->>'email')),
    'access_code.issued',
    'role_access_code',
    row_out.id,
    NULL,
    jsonb_build_object('role', row_out.role, 'label', row_out.label,
                       'expires_at', row_out.expires_at, 'max_uses', row_out.max_uses)
  );

  RETURN jsonb_build_object(
    'status',     'ok',
    'id',         row_out.id,
    'code',       code,
    'role',       row_out.role,
    'expires_at', row_out.expires_at,
    'max_uses',   row_out.max_uses
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_role_access_code(text, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_role_access_code(text, text, integer, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.revoke_role_access_code(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
  caller_id   uuid;
  target      role_access_codes%ROWTYPE;
BEGIN
  IF caller_role IS NULL OR caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT * INTO target FROM role_access_codes WHERE id = p_id;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF target.role = 'hr_admin' AND caller_role <> 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden', 'reason', 'needs_super_admin');
  END IF;

  SELECT id INTO caller_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  UPDATE role_access_codes SET revoked_at = now()
   WHERE id = p_id AND revoked_at IS NULL;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    caller_id,
    lower(btrim(auth.jwt()->>'email')),
    'access_code.revoked',
    'role_access_code',
    target.id,
    jsonb_build_object('role', target.role, 'label', target.label, 'revoked', false),
    jsonb_build_object('role', target.role, 'label', target.label, 'revoked', true)
  );

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_role_access_code(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_role_access_code(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.list_role_access_codes()
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
    RETURN jsonb_build_object('status', 'forbidden', 'codes', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'can_issue_hr_admin', (caller_role = 'super_admin'),
    'codes', COALESCE((
      SELECT jsonb_agg(c ORDER BY c.created_at DESC)
        FROM (
          SELECT r.id, r.role, r.label, r.expires_at, r.max_uses, r.used_count,
                 r.revoked_at, r.created_at,
                 e.full_name AS created_by_name,
                 (r.revoked_at IS NULL
                  AND r.expires_at > now()
                  AND r.used_count < r.max_uses) AS is_usable
            FROM role_access_codes r
            LEFT JOIN employees e ON e.id = r.created_by
           -- HR sees the manager codes it can act on; administrator codes are
           -- not its business and cannot be revoked by it anyway.
           WHERE caller_role = 'super_admin' OR r.role = 'manager'
        ) c
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_role_access_codes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_role_access_codes() TO authenticated;


-- ── 5. Security activity ────────────────────────────────────
--
-- A narrowed view of audit_logs: only the events that change who can
-- administer the system. The general Audit Logs page is unchanged and remains
-- available to HR.

CREATE OR REPLACE FUNCTION public.list_security_activity(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_employee_role() IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden', 'events', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'events', COALESCE((
      SELECT jsonb_agg(e ORDER BY e.created_at DESC)
        FROM (
          SELECT l.id, l.action, l.actor_email, l.entity_type, l.entity_id,
                 l.previous_value, l.new_value, l.created_at,
                 a.full_name AS actor_name
            FROM audit_logs l
            LEFT JOIN employees a ON a.id = l.actor_id
           WHERE l.action IN (
                   'super_admin.granted', 'super_admin.revoked',
                   'employee.role_changed',
                   'access_code.issued',   'access_code.revoked',
                   'signup_domains.changed'
                 )
           ORDER BY l.created_at DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
        ) e
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_security_activity(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_security_activity(integer) TO authenticated;


-- ── 6. Trim two helpers back off the anonymous role ─────────
--
-- Both are internal: auth_setup_status() and check_signup_eligibility() call
-- them, and those are SECURITY DEFINER, so they keep working. Only the direct
-- anonymous route is closed. Nothing in the app calls either one directly.

REVOKE EXECUTE ON FUNCTION public.signup_domain_allowed(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_usable_admin()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_usable_admin()          TO authenticated;
