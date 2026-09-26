-- ============================================================
-- Migration 015: Fix the first-administrator deadlock  ** RUN THIS **
--
-- Idempotent and self-contained. Safe to run more than once.
-- Requires 011-014.
--
-- The bug this fixes
-- ------------------
-- 011 and 012 granted 'super_admin' to the first account only when the
-- employees table was completely EMPTY. That is the wrong test. A table gains
-- rows long before anyone becomes an administrator — demo seed data, an
-- HR-created record, somebody's ordinary signup — and the moment it does, the
-- bootstrap closes forever.
--
-- The result was a deadlock with no way out inside the product:
--
--     manager / HR accounts need an access code
--     access codes are issued only by a super admin
--     the only route to super admin had already closed
--
-- The escape was to edit the database by hand, which is not a reasonable thing
-- to ask of the person setting the product up.
--
-- The fix
-- -------
-- Test for what actually matters: "does a usable administrator exist yet?"
-- rather than "is the table empty?". Until one does, the next person to sign in
-- becomes it. The moment one does, the branch closes permanently — exactly as
-- before, and for the same reason.
--
--     no admin yet  ->  first person to sign in becomes super_admin
--     admin exists  ->  self-registration gives 'employee'; manager and HR
--                       need a code issued from HR Settings
--
-- "Usable" means active AND linked to a login. A row that says 'super_admin'
-- but has no auth account behind it cannot administer anything, so it must not
-- count — otherwise seed data claiming to be an admin re-creates the deadlock.
--
-- Why this is not a hardcoded code
-- --------------------------------
-- A fixed code compiled into the app would sit in the git history and in every
-- browser's copy of the JavaScript bundle, grant HR access to anyone who read
-- it, and could never be rotated. This window is narrow, self-closing, and
-- leaves an audit trail in employees.created_at. It is the same trade every
-- self-hosted product makes on first run.
-- ============================================================


-- ── 1. Is there an administrator yet? ───────────────────────
--
-- One definition, used by all three functions below, so the signup form can
-- never disagree with what the claim will actually do.

CREATE OR REPLACE FUNCTION public.has_usable_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
     WHERE role = 'super_admin'
       AND is_active
       AND auth_user_id IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_usable_admin() TO anon, authenticated;


-- ── 2. Setup status, for the signup screen ──────────────────

CREATE OR REPLACE FUNCTION public.auth_setup_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'has_employees',         EXISTS (SELECT 1 FROM employees),
    'has_admin',             public.has_usable_admin(),
    'accepting_first_admin', NOT public.has_usable_admin()
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_setup_status() TO anon, authenticated;


-- ── 3. Eligibility, aligned with the new test ───────────────

CREATE OR REPLACE FUNCTION public.check_signup_eligibility(
  p_email     text,
  p_full_name text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp  employees%ROWTYPE;
  mail text := lower(btrim(p_email));
BEGIN
  -- No administrator yet: whoever signs up next becomes one, whatever else is
  -- already in the table.
  IF NOT public.has_usable_admin() THEN
    RETURN jsonb_build_object('status', 'first_admin', 'expected_role', 'super_admin');
  END IF;

  IF mail IS NULL OR mail = '' THEN
    RETURN jsonb_build_object('status', 'open', 'expected_role', 'employee');
  END IF;

  SELECT * INTO emp FROM employees WHERE lower(email) = mail LIMIT 1;

  IF emp.id IS NULL THEN
    IF NOT public.signup_domain_allowed(mail) THEN
      RETURN jsonb_build_object('status', 'domain_blocked', 'expected_role', NULL);
    END IF;
    RETURN jsonb_build_object('status', 'open', 'expected_role', 'employee');
  END IF;

  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive', 'expected_role', NULL);
  END IF;

  IF emp.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_registered', 'expected_role', emp.role);
  END IF;

  IF p_full_name IS NULL
     OR lower(regexp_replace(btrim(emp.full_name), '\s+', ' ', 'g'))
        IS DISTINCT FROM lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
  THEN
    RETURN jsonb_build_object('status', 'name_mismatch', 'expected_role', NULL);
  END IF;

  RETURN jsonb_build_object('status', 'invited', 'expected_role', emp.role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_signup_eligibility(text, text) TO anon, authenticated;


-- ── 4. The claim, with the corrected bootstrap ──────────────
--
-- Identical to 013 except for the founding-administrator branch, which now
-- fires whenever no usable admin exists rather than only on an empty table,
-- and which adopts an existing record for the same address instead of
-- colliding with it.

CREATE OR REPLACE FUNCTION public.claim_employee_account(p_access_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          uuid := auth.uid();
  uemail       text := lower(btrim(auth.jwt()->>'email'));
  claimed_name text := NULLIF(btrim(auth.jwt()->'user_metadata'->>'full_name'), '');
  raw_code     text;
  code_row     role_access_codes%ROWTYPE;
  granted_role text := 'employee';
  recent_fails integer;
  emp          employees%ROWTYPE;
  linked       integer;
BEGIN
  IF uid IS NULL OR uemail IS NULL OR uemail = '' THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- Serialise concurrent claims for the same account, so a single-use code
  -- cannot be redeemed twice and two callers cannot both bootstrap.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;
  IF emp.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
  END IF;

  -- ── Founding administrator ──
  -- No usable admin exists, so this account becomes one. Checked inside the
  -- advisory lock and re-checked by the same predicate the UI used, so two
  -- people signing up together cannot both be promoted.
  IF NOT public.has_usable_admin() THEN
    SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;

    IF emp.id IS NOT NULL THEN
      -- A record for this address already exists (seed data, or HR added it).
      -- Adopt it rather than failing on the unique email constraint.
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

  -- ── No record: self-registration. A code decides the role. ──
  IF emp.id IS NULL THEN
    IF NOT public.signup_domain_allowed(uemail) THEN
      RETURN jsonb_build_object('status', 'domain_blocked');
    END IF;

    raw_code := COALESCE(
      NULLIF(btrim(p_access_code), ''),
      NULLIF(btrim(auth.jwt()->'user_metadata'->>'access_code'), '')
    );

    IF raw_code IS NOT NULL THEN
      SELECT count(*) INTO recent_fails
        FROM role_access_code_attempts
       WHERE auth_user_id = uid
         AND NOT succeeded
         AND attempted_at > now() - interval '1 hour';

      IF recent_fails >= 5 THEN
        RETURN jsonb_build_object('status', 'too_many_attempts');
      END IF;

      SELECT * INTO code_row FROM role_access_codes
       WHERE code_hash = public.hash_access_code(raw_code)
       LIMIT 1;

      IF code_row.id IS NULL
         OR code_row.revoked_at IS NOT NULL
         OR code_row.expires_at <= now()
         OR code_row.used_count >= code_row.max_uses
      THEN
        INSERT INTO role_access_code_attempts (auth_user_id, succeeded) VALUES (uid, false);
        RETURN jsonb_build_object('status', 'invalid_code');
      END IF;

      UPDATE role_access_codes
         SET used_count = used_count + 1
       WHERE id = code_row.id
         AND revoked_at IS NULL
         AND expires_at > now()
         AND used_count < max_uses;

      GET DIAGNOSTICS linked = ROW_COUNT;
      IF linked = 0 THEN
        INSERT INTO role_access_code_attempts (auth_user_id, succeeded) VALUES (uid, false);
        RETURN jsonb_build_object('status', 'invalid_code');
      END IF;

      INSERT INTO role_access_code_attempts (auth_user_id, succeeded) VALUES (uid, true);
      granted_role := code_row.role;
    END IF;

    BEGIN
      INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
      VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, granted_role, true)
      RETURNING * INTO emp;

      RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'created', true);
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;
      IF emp.id IS NULL THEN
        RETURN jsonb_build_object('status', 'already_registered');
      END IF;
    END;
  END IF;

  -- ── A record exists. Verify, then link. Its role wins. ──
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
$$;

REVOKE EXECUTE ON FUNCTION public.claim_employee_account(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_employee_account(text) TO authenticated;


-- ── 5. Adopt an account that is already signed up ───────────
--
-- If somebody already registered while the old rule was in force, they are an
-- 'employee' and the bootstrap would otherwise never fire for them — there is
-- no admin, but they are already linked, so the branch above returns early.
-- Promote the earliest such account, once, only while no admin exists.

DO $$
DECLARE
  first_account employees%ROWTYPE;
BEGIN
  IF public.has_usable_admin() THEN
    RAISE NOTICE 'An administrator already exists; nothing to promote.';
    RETURN;
  END IF;

  SELECT * INTO first_account
    FROM employees
   WHERE auth_user_id IS NOT NULL AND is_active
   ORDER BY created_at
   LIMIT 1;

  IF first_account.id IS NULL THEN
    RAISE NOTICE
      'No signed-up accounts yet. The next person to sign up becomes the administrator.';
    RETURN;
  END IF;

  UPDATE employees SET role = 'super_admin' WHERE id = first_account.id;

  RAISE NOTICE
    'Promoted % (%) to super_admin. Sign out and back in, then choose the HR Admin portal.',
    first_account.full_name, first_account.email;
END;
$$;
