-- ============================================================
-- Migration 022: Require the second factor on every protected table
--
-- Apply AFTER 018 and 021. This is the switch that turns enforcement on.
--
-- ⚠️  This can lock everyone out. Read the rollback at the bottom first and
--     keep the SQL Editor open while you test in one browser.
--
-- Every policy below becomes:
--
--     session_second_factor_ok() AND (exactly what it required before)
--
-- The role model is untouched. Nobody gains an ability; passing the emailed
-- code becomes an additional requirement on top of existing authorization.
--
-- ALTER POLICY is used rather than DROP + CREATE so each expression is
-- replaced atomically — a table is never momentarily left without its policy.
-- It also fails loudly if a policy is missing, which is the right behaviour
-- for a security change.
--
-- Superseding 019 and 020
-- -----------------------
-- Both were written against the JWT `amr` claim and were never applied.
-- Measurement showed AMR cannot bind a password session to an email code:
-- POST /auth/v1/verify carries no Authorization header, so Supabase always
-- mints a fresh session. 021 replaces that mechanism. The policy work below is
-- 020's, unchanged apart from the helper it calls.
--
-- Not affected
-- ------------
-- Edge Functions use the service role and bypass RLS. They enforce the second
-- factor themselves through session_second_factor_ok_for().
-- ============================================================


-- ── 0. The two gates 019 would have installed ───────────────
--
-- current_employee_role() is the single check behind every privileged
-- function — set_employee_role, the administrator listings, signup domains,
-- security activity. Returning NULL for an unverified session makes all of
-- them refuse at once, with no change to their own code.

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT role FROM employees
   WHERE auth_user_id = auth.uid()
     AND is_active
     AND public.session_second_factor_ok()
   LIMIT 1;
$fn$;

REVOKE EXECUTE ON FUNCTION public.current_employee_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_employee_role() TO authenticated;


-- Creating or linking an employee record is exactly the moment the second
-- factor must already have passed.

CREATE OR REPLACE FUNCTION public.claim_employee_account(p_access_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid          uuid := auth.uid();
  uemail       text := lower(btrim(auth.jwt()->>'email'));
  claimed_name text := NULLIF(btrim(auth.jwt()->'user_metadata'->>'full_name'), '');
  emp          employees%ROWTYPE;
  linked       integer;
BEGIN
  IF uid IS NULL OR uemail IS NULL OR uemail = '' THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;
  IF emp.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
  END IF;

  IF NOT public.has_usable_admin() THEN
    SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;

    IF emp.id IS NOT NULL THEN
      UPDATE employees
         SET auth_user_id = uid,
             role         = 'super_admin',
             is_active    = true,
             full_name    = COALESCE(claimed_name, full_name)
       WHERE id = emp.id AND auth_user_id IS NULL
      RETURNING * INTO emp;

      IF emp.id IS NULL THEN
        RETURN jsonb_build_object('status', 'already_registered');
      END IF;
    ELSE
      INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
      VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, 'super_admin', true)
      RETURNING * INTO emp;
    END IF;

    RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'bootstrapped', true);
  END IF;

  SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;

  IF emp.id IS NULL THEN
    IF NOT public.signup_domain_allowed(uemail) THEN
      RETURN jsonb_build_object('status', 'domain_blocked');
    END IF;

    BEGIN
      INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
      VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, 'employee', true)
      RETURNING * INTO emp;

      RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'created', true);
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;
      IF emp.id IS NULL THEN
        RETURN jsonb_build_object('status', 'already_registered');
      END IF;
    END;
  END IF;

  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  IF emp.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status',
      CASE WHEN emp.auth_user_id = uid THEN 'ok' ELSE 'already_registered' END,
      'role', emp.role);
  END IF;

  IF claimed_name IS NOT NULL
     AND lower(regexp_replace(claimed_name, '\s+', ' ', 'g'))
         IS DISTINCT FROM lower(regexp_replace(btrim(emp.full_name), '\s+', ' ', 'g'))
  THEN
    RETURN jsonb_build_object('status', 'name_mismatch');
  END IF;

  UPDATE employees SET auth_user_id = uid
   WHERE id = emp.id AND auth_user_id IS NULL;

  GET DIAGNOSTICS linked = ROW_COUNT;
  IF linked = 0 THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_employee_account(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_employee_account(text) TO authenticated;


-- The gate that makes the code screen unavoidable: with no profile the
-- application cannot open any portal.

DROP POLICY IF EXISTS "employees_read_active" ON employees;
CREATE POLICY "employees_read_active" ON employees
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND public.session_second_factor_ok()
    AND (
      is_active = true OR id = (auth.jwt()->>'employee_id')::uuid
    )
  );


-- ── 1. Core directory ───────────────────────────────────────

-- employees_read_active is handled in 019.

ALTER POLICY "employees_update_own" ON employees
  USING (
    public.session_second_factor_ok()
    AND id = (auth.jwt()->>'employee_id')::uuid
  )
  WITH CHECK (
    public.session_second_factor_ok()
    AND id = (auth.jwt()->>'employee_id')::uuid
    AND role = (SELECT role FROM employees WHERE id = (auth.jwt()->>'employee_id')::uuid)
  );

ALTER POLICY "employees_hr_full" ON employees
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "departments_read_authenticated" ON departments
  USING (public.session_second_factor_ok() AND auth.role() = 'authenticated');

ALTER POLICY "departments_hr_write" ON departments
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "projects_read_authenticated" ON projects
  USING (public.session_second_factor_ok() AND auth.role() = 'authenticated');

ALTER POLICY "projects_hr_write" ON projects
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "project_members_read_authenticated" ON project_members
  USING (public.session_second_factor_ok() AND auth.role() = 'authenticated');

ALTER POLICY "project_members_hr_write" ON project_members
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );


-- ── 2. Core Values, behaviours, scenarios ───────────────────

ALTER POLICY "core_values_read_active" ON core_values
  USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND (is_active = true OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'))
  );

ALTER POLICY "core_values_hr_write" ON core_values
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "behaviours_read_active" ON behaviours
  USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND (is_active = true OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'))
  );

ALTER POLICY "behaviours_hr_write" ON behaviours
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "scenarios_read_active" ON scenarios
  USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND (is_active = true OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'))
  );

ALTER POLICY "scenarios_hr_write" ON scenarios
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );


-- ── 3. Nominations — the recognition records themselves ─────

ALTER POLICY "nominations_read_nominator" ON nominations
  USING (
    public.session_second_factor_ok()
    AND nominator_id = (auth.jwt()->>'employee_id')::uuid
  );

ALTER POLICY "nominations_read_nominee_approved" ON nominations
  USING (
    public.session_second_factor_ok()
    AND nominee_id = (auth.jwt()->>'employee_id')::uuid
    AND status IN ('approved', 'clarification_requested')
  );

ALTER POLICY "nominations_read_approver" ON nominations
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin')
    AND assigned_approver_id = (auth.jwt()->>'employee_id')::uuid
  );

ALTER POLICY "nominations_hr_read_all" ON nominations
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "nominations_insert" ON nominations
  WITH CHECK (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND nominator_id = (auth.jwt()->>'employee_id')::uuid
    AND nominator_id != nominee_id
  );

-- Redefined by 009 with a separate WITH CHECK; both halves are preserved.
ALTER POLICY "nominations_update_nominator" ON nominations
  USING (
    public.session_second_factor_ok()
    AND nominator_id = (auth.jwt()->>'employee_id')::uuid
    AND status IN ('draft', 'clarification_requested')
  )
  WITH CHECK (
    public.session_second_factor_ok()
    AND nominator_id = (auth.jwt()->>'employee_id')::uuid
    AND status IN ('draft', 'pending', 'clarification_requested')
  );

ALTER POLICY "nominations_update_approver" ON nominations
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin')
    AND assigned_approver_id = (auth.jwt()->>'employee_id')::uuid
    AND status = 'pending'
  );

ALTER POLICY "nominations_hr_update" ON nominations
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "appreciations_read_all_authenticated" ON nomination_appreciations
  USING (public.session_second_factor_ok() AND auth.role() = 'authenticated');

ALTER POLICY "appreciations_insert_own" ON nomination_appreciations
  WITH CHECK (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );


-- ── 4. Badges ───────────────────────────────────────────────

ALTER POLICY "badge_defs_read_authenticated" ON badge_definitions
  USING (public.session_second_factor_ok() AND auth.role() = 'authenticated');

ALTER POLICY "badge_defs_hr_write" ON badge_definitions
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "evb_read_own" ON employee_value_badges
  USING (
    public.session_second_factor_ok()
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );

ALTER POLICY "evb_read_team" ON employee_value_badges
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin')
    AND employee_id IN (
      SELECT id FROM employees WHERE manager_id = (auth.jwt()->>'employee_id')::uuid
    )
  );

ALTER POLICY "evb_hr_read_all" ON employee_value_badges
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "badge_history_read_own" ON badge_history
  USING (
    public.session_second_factor_ok()
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );

ALTER POLICY "badge_history_read_team" ON badge_history
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin')
    AND employee_id IN (
      SELECT id FROM employees WHERE manager_id = (auth.jwt()->>'employee_id')::uuid
    )
  );

ALTER POLICY "badge_history_hr" ON badge_history
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );


-- ── 5. Notifications, audit, config, rewards ────────────────

ALTER POLICY "notifications_own" ON notifications
  USING (
    public.session_second_factor_ok()
    AND recipient_id = (auth.jwt()->>'employee_id')::uuid
  );

ALTER POLICY "notifications_hr_read" ON notifications
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "audit_logs_hr_read" ON audit_logs
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "app_config_hr_read" ON app_config
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "app_config_hr_write" ON app_config
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "app_config_read_operational" ON app_config
  USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND key IN (
      'hr_fallback_employee_id',
      'recognition_feed_page_size',
      'timezone',
      'badge_period_type',
      'badge_period_start_month',
      'financial_year_q1_start'
    )
  );

ALTER POLICY "rewards_hr_full" ON rewards
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "reward_assignments_read_own" ON reward_assignments
  USING (
    public.session_second_factor_ok()
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );

ALTER POLICY "reward_assignments_hr_full" ON reward_assignments
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

ALTER POLICY "flags_hr_only" ON reciprocal_recognition_flags
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );


-- ── 6. The recognition feed view ────────────────────────────
--
-- A pre-existing hole, independent of two-factor: this view has no
-- security_invoker, so it runs as its owner and bypasses RLS on nominations
-- and employees entirely. Anything holding the `authenticated` role can read
-- every approved recognition through it, including names.
--
-- That is deliberate — the feed is meant to be visible company-wide, and the
-- underlying nominations policies would not allow it. Turning on
-- security_invoker would therefore break the feed rather than secure it.
--
-- So the check is applied inside the view instead. Definition below is
-- unchanged apart from the added condition in the WHERE clause.

CREATE OR REPLACE VIEW v_recognition_feed AS
SELECT
  n.id,
  n.approved_at,
  n.published_at,
  n.what_happened,
  n.what_impact,
  n.recognition_source,

  nominator.id             AS nominator_id,
  nominator.full_name      AS nominator_name,
  nominator.avatar_url     AS nominator_avatar,

  nominee.id               AS nominee_id,
  nominee.full_name        AS nominee_name,
  nominee.avatar_url       AS nominee_avatar,

  cv.id                    AS core_value_id,
  cv.name                  AS core_value_name,
  cv.accent_color          AS core_value_color,
  cv.icon                  AS core_value_icon,

  COALESCE(n.snapshot_behaviour_name, b.name) AS behaviour_name,
  COALESCE(n.snapshot_scenario_name, s.name)  AS scenario_name,
  COALESCE(n.snapshot_project_name, p.name)   AS project_name,
  n.project_id,

  (SELECT COUNT(*) FROM nomination_appreciations na WHERE na.nomination_id = n.id)::integer AS appreciation_count

FROM nominations n
JOIN employees nominator ON n.nominator_id = nominator.id
JOIN employees nominee   ON n.nominee_id = nominee.id
JOIN core_values cv       ON n.core_value_id = cv.id
LEFT JOIN behaviours b    ON n.behaviour_id = b.id
LEFT JOIN scenarios s     ON n.scenario_id = s.id
LEFT JOIN projects p      ON n.project_id = p.id

WHERE n.status = 'approved'
  AND public.session_second_factor_ok();

GRANT SELECT ON v_recognition_feed TO authenticated;




-- ============================================================
-- ROLLBACK
--
-- If sign-in breaks, make the check a no-op. Every policy calls the same
-- function, so this restores access everywhere in one statement:
--
--   CREATE OR REPLACE FUNCTION public.session_second_factor_ok()
--   RETURNS boolean LANGUAGE sql STABLE AS $fn$ SELECT true $fn$;
--
-- The code screen still works in the browser; only database enforcement is
-- suspended. Re-enable by running the real definition from 021 again.
-- ============================================================
