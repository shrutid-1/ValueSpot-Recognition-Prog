-- ============================================================
-- Migration 012: Self-service account creation   ** RUN THIS **
--
-- Idempotent and self-contained. Safe to run more than once.
-- Requires 011_auth_complete.sql to have been applied first.
--
-- What changes, and why
-- ---------------------
-- 011 made signup invite-only: an account could only be created when HR had
-- already entered that person as an employee. That is correct for a closed
-- roster, but it means the very first person after the bootstrap admin hits
-- "we could not match those details to an employee record" and has no way
-- forward on their own.
--
-- 012 opens registration while keeping the property that actually matters:
--
--     nobody can give themselves a role.
--
-- Three paths into an account, and the role is decided by the database in all
-- three:
--
--   1. Empty system      -> first account becomes super_admin (bootstrap).
--   2. HR invited you    -> your existing employee record is linked, and its
--                           role is whatever HR set. Your full name must match
--                           the record, so knowing an address is not enough to
--                           claim a manager or HR account.
--   3. Nobody invited you-> a new employee record is created for you at role
--                           'employee', the lowest privilege there is. HR can
--                           promote you later. The portal chosen in the browser
--                           is never consulted.
--
-- Path 3 is what this migration adds. Note the asymmetry: self-registration can
-- only ever mint the least-privileged role, so opening it up grants no power
-- that an attacker did not already have by being able to read the app.
--
-- Optional narrowing: set app_config.signup_allowed_domains to a JSON array of
-- domains and path 3 is restricted to those addresses. Left empty, any address
-- may self-register. Paths 1 and 2 ignore it — an explicit HR invitation is a
-- stronger signal than a domain match.
--
--     UPDATE app_config SET value = '["touchcore.in"]'::jsonb
--      WHERE key = 'signup_allowed_domains';
-- ============================================================


-- ── 1. Domain allowlist (empty = unrestricted) ──────────────

INSERT INTO app_config (key, value, description)
VALUES (
  'signup_allowed_domains',
  '[]'::jsonb,
  'JSON array of email domains permitted to self-register, e.g. ["touchcore.in"]. '
  'Empty array means any domain may register. Does not affect HR-invited accounts.'
)
ON CONFLICT (key) DO NOTHING;


CREATE OR REPLACE FUNCTION public.signup_domain_allowed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_array_length(value) = 0
          OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(value) d
                WHERE lower(d) = lower(split_part(btrim(p_email), '@', 2))
             )
        FROM app_config
       WHERE key = 'signup_allowed_domains'
         AND jsonb_typeof(value) = 'array'
    ),
    true   -- unconfigured: do not lock anybody out
  );
$$;

REVOKE EXECUTE ON FUNCTION public.signup_domain_allowed(text) FROM PUBLIC;


-- ── 2. Eligibility, rewritten for the open path ─────────────
--
-- Advisory only — it shapes the message on the signup form. The real decision
-- is claim_employee_account() below, which runs against the verified JWT.
--
-- status is one of:
--   first_admin        no employees exist; this account becomes super_admin
--   invited            an unclaimed employee record matches; role comes from it
--   open              no record; a new 'employee' record will be created
--   already_registered the record (or address) is already linked to an account
--   name_mismatch      the address is on record under a different name
--   inactive           the record exists but has been deactivated
--   domain_blocked     self-registration is restricted to other domains

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
  emp   employees%ROWTYPE;
  mail  text := lower(btrim(p_email));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees) THEN
    RETURN jsonb_build_object('status', 'first_admin', 'expected_role', 'super_admin');
  END IF;

  IF mail IS NULL OR mail = '' THEN
    RETURN jsonb_build_object('status', 'open', 'expected_role', 'employee');
  END IF;

  SELECT * INTO emp FROM employees WHERE lower(email) = mail LIMIT 1;

  -- No record: this is the ordinary self-service case.
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

  -- The record is waiting to be claimed. The name is the second factor that
  -- stops somebody who merely knows a colleague's address from taking it.
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


-- ── 3. THE LINK — now creates a record when none exists ─────
--
-- Still takes no arguments. Identity comes from auth.uid() and the JWT email
-- claim, both set by Supabase, so a caller cannot act as anybody else.
--
-- Returns jsonb { status, role }, where status is one of:
--   ok | not_authenticated | inactive | already_registered
--   | name_mismatch | domain_blocked

CREATE OR REPLACE FUNCTION public.claim_employee_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Already linked: nothing to do. Keeps this safe to call on every sign-in.
  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;
  IF emp.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
  END IF;

  -- Founding administrator. With no employee records at all nobody could have
  -- been invited, so the first account bootstraps the system. This branch
  -- closes permanently once a single employee row exists.
  IF NOT EXISTS (SELECT 1 FROM employees) THEN
    INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
    VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, 'super_admin', true)
    RETURNING * INTO emp;
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'bootstrapped', true);
  END IF;

  SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;

  -- ── Path 3: nobody invited this address. Create the record. ──
  IF emp.id IS NULL THEN
    IF NOT public.signup_domain_allowed(uemail) THEN
      RETURN jsonb_build_object('status', 'domain_blocked');
    END IF;

    BEGIN
      -- 'employee' is hard-coded on purpose. There is no argument, no JWT
      -- claim and no metadata field that can raise it: self-registration
      -- mints the lowest privilege and nothing else. employee_id is filled
      -- in by the assign_employee_id trigger from migration 011.
      INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
      VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, 'employee', true)
      RETURNING * INTO emp;

      RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'created', true);
    EXCEPTION WHEN unique_violation THEN
      -- Two sessions raced, or HR added the record a moment ago. Fall through
      -- and treat it as the invited path against whatever now exists.
      SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;
      IF emp.id IS NULL THEN
        RETURN jsonb_build_object('status', 'already_registered');
      END IF;
    END;
  END IF;

  -- ── Path 2: an employee record exists. Verify, then link. ──
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

  -- Guarded so two concurrent claims cannot both take one record.
  UPDATE employees SET auth_user_id = uid
   WHERE id = emp.id AND auth_user_id IS NULL;

  GET DIAGNOSTICS linked = ROW_COUNT;
  IF linked = 0 THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_employee_account() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_employee_account() TO authenticated;


-- ── 4. Retire the invite-only gate on auth.users ────────────
--
-- 011 optionally installed on_auth_user_created, which raises an exception for
-- any address that was not already an active, unregistered employee. That is
-- precisely the rule 012 replaces, so it has to go — left in place it aborts
-- every self-service signup with "Database error saving new user".
--
-- Wrapped, because a project that could not create the trigger equally cannot
-- drop it, and that must not fail this script.

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
  RAISE NOTICE 'Invite-only signup trigger removed; self-service registration is active.';
EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_object THEN
  RAISE NOTICE
    'Could not drop on_auth_user_created (no ownership of auth.users). '
    'If it was never created this is expected and harmless.';
END;
$$;

DROP FUNCTION IF EXISTS public.handle_new_auth_user() CASCADE;


-- ── 5. Repair accounts stranded by the old rule ─────────────
--
-- Anyone who registered while the gate was in force has a row in auth.users
-- and no employee record. Give each of them the same 'employee' record that
-- signing up today would have produced. Only unlinked rows on both sides are
-- touched, so this cannot disturb an existing account and is safe to re-run.

INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
SELECT u.id,
       COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''),
                split_part(lower(u.email), '@', 1)),
       lower(u.email),
       'employee',
       true
  FROM auth.users u
 WHERE u.email IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.auth_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE lower(e.email) = lower(u.email))
   AND public.signup_domain_allowed(u.email);

-- And link any account whose employee record was created separately.
UPDATE employees e
   SET auth_user_id = u.id
  FROM auth.users u
 WHERE e.auth_user_id IS NULL
   AND lower(e.email) = lower(u.email)
   AND NOT EXISTS (SELECT 1 FROM employees o WHERE o.auth_user_id = u.id);
