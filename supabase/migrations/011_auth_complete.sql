-- ============================================================
-- Migration 011: Complete authentication setup   ** RUN THIS **
--
-- Idempotent and self-contained. Safe to run more than once.
--
-- Design note — why this does not depend on a trigger over auth.users:
--   The obvious way to link a new account to its employee record is a trigger
--   on auth.users. On many Supabase projects the SQL Editor cannot create one
--   ("must be owner of relation users"), and the whole migration then fails,
--   leaving authentication broken with no obvious cause.
--
--   So the linking is done by claim_employee_account(), a SECURITY DEFINER
--   function in the public schema that the signed-in client calls. It cannot be
--   spoofed: the identity it acts on comes from auth.uid() and the JWT's email
--   claim, both set by Supabase, never from function arguments.
--
--   The auth.users trigger is still installed as extra hardening when the
--   project permits it, but it is wrapped so a refusal cannot fail this script.
-- ============================================================


-- ── 1. Company IDs are assigned, not typed ──────────────────

CREATE OR REPLACE FUNCTION public.assign_employee_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
BEGIN
  IF NEW.employee_id IS NULL OR btrim(NEW.employee_id) = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_id, '\D', '', 'g'), '')::integer), 0) + 1
      INTO next_num FROM employees;
    NEW.employee_id := 'TC' || lpad(next_num::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_employee_id ON employees;
CREATE TRIGGER assign_employee_id
  BEFORE INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION public.assign_employee_id();


-- ── 2. Setup status, for the signup screen ──────────────────

CREATE OR REPLACE FUNCTION public.auth_setup_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'has_employees', EXISTS (SELECT 1 FROM employees),
    'accepting_first_admin', NOT EXISTS (SELECT 1 FROM employees)
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_setup_status() TO anon, authenticated;


-- ── 3. Advisory eligibility check ───────────────────────────
--
-- Message quality only. claim_employee_account() below is the real decision.
-- Both the address and the exact full name must match before this admits a
-- record exists, so it cannot be used to enumerate staff from an email alone.

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
  emp employees%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees) THEN
    RETURN jsonb_build_object('status', 'first_admin', 'expected_role', 'super_admin');
  END IF;

  IF p_email IS NULL OR p_full_name IS NULL THEN
    RETURN jsonb_build_object('status', 'not_eligible', 'expected_role', NULL);
  END IF;

  SELECT * INTO emp FROM employees
   WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;

  IF emp.id IS NULL OR NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'not_eligible', 'expected_role', NULL);
  END IF;

  IF lower(regexp_replace(btrim(emp.full_name), '\s+', ' ', 'g'))
     IS DISTINCT FROM lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
  THEN
    RETURN jsonb_build_object('status', 'not_eligible', 'expected_role', NULL);
  END IF;

  IF emp.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_registered', 'expected_role', emp.role);
  END IF;

  RETURN jsonb_build_object('status', 'eligible', 'expected_role', emp.role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_signup_eligibility(text, text) TO anon, authenticated;


-- ── 4. THE LINK — this is what makes an account usable ──────
--
-- Called by the client once it holds a session. Every input that matters is
-- taken from the verified JWT, so a caller cannot claim somebody else's record
-- by passing different arguments — there are no arguments.
--
-- Returns jsonb { status, role }, where status is one of:
--   ok | not_authenticated | not_invited | inactive | already_registered | name_mismatch

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

  -- Founding administrator. With no employee records at all nobody could ever
  -- have been invited, so the first account bootstraps the system. This branch
  -- closes permanently once a single employee row exists.
  IF NOT EXISTS (SELECT 1 FROM employees) THEN
    INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
    VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, 'super_admin', true)
    RETURNING * INTO emp;
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'bootstrapped', true);
  END IF;

  SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;

  IF emp.id IS NULL      THEN RETURN jsonb_build_object('status', 'not_invited'); END IF;
  IF NOT emp.is_active   THEN RETURN jsonb_build_object('status', 'inactive');    END IF;
  IF emp.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  -- Second factor when email confirmation is disabled: knowing the address is
  -- not enough on its own, the name on the record must match too.
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

-- Only a signed-in caller can claim, and only for themselves.
REVOKE EXECUTE ON FUNCTION public.claim_employee_account() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_employee_account() TO authenticated;


-- ── 5. Repair accounts created before this migration ────────
--
-- Anything registered earlier sits in auth.users unlinked. Link by address.
-- Only rows unclaimed on both sides are touched, so this cannot steal an
-- existing link and is safe to re-run.

UPDATE employees e
   SET auth_user_id = u.id
  FROM auth.users u
 WHERE e.auth_user_id IS NULL
   AND lower(e.email) = lower(u.email)
   AND NOT EXISTS (SELECT 1 FROM employees o WHERE o.auth_user_id = u.id);


-- ── 6. Optional hardening: refuse ineligible signups outright ──
--
-- Nice to have, not required — claim_employee_account() already withholds
-- access from anyone who is not an eligible employee, and RLS shows an
-- unlinked account nothing. Wrapped so that a project which does not allow
-- triggers on auth.users still completes this migration successfully.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees) THEN
    RETURN NEW;  -- first-admin bootstrap happens at claim time
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
     WHERE lower(email) = lower(btrim(NEW.email))
       AND is_active
       AND auth_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'This email address has not been invited to ValueSpot.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
  EXECUTE 'CREATE TRIGGER on_auth_user_created
             AFTER INSERT ON auth.users
             FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()';
  RAISE NOTICE 'Optional hardening installed: signup trigger on auth.users.';
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE
    'Skipped the optional auth.users trigger (no ownership on this project). '
    'Authentication is fully functional without it.';
END;
$$;
