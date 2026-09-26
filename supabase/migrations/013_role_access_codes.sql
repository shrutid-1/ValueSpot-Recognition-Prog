-- ============================================================
-- Migration 013: Manager and HR self-registration   ** RUN THIS **
--
-- Idempotent and self-contained. Safe to run more than once.
-- Requires 011 and 012.
--
-- The problem 012 left open
-- -------------------------
-- 012 opened registration but pinned every self-created account to 'employee',
-- because an open form that lets you tick "HR Admin" hands administrator rights
-- to anyone who can load the page. So managers and HR could not create their
-- own accounts — somebody had to enter them first.
--
-- What 013 adds
-- -------------
-- A role-scoped access code. An administrator issues a code for a specific
-- role; whoever holds it may self-register into that role, choosing their own
-- password, with nobody creating the account for them.
--
--   super_admin  -> may issue 'manager' and 'hr_admin' codes
--   hr_admin     -> may issue 'manager' codes only
--   manager      -> may issue nothing
--
-- That is the separation of credentials by role, in the only place where
-- separating it means anything: authority to hold the role. Passwords stay in
-- auth.users, hashed by Supabase, exactly once. A second password table would
-- mean hand-rolling password storage and letting one person exist twice with
-- two different passwords — strictly worse for both security and privacy.
--
-- Properties this preserves
-- -------------------------
--   * The code is stored only as a SHA-256 hash. Leaking the table leaks
--     nothing usable, and not even an administrator can read a code back after
--     it is issued.
--   * Codes expire, have a use limit, and can be revoked.
--   * The role still comes from the database. The portal picked in the browser
--     is never consulted; the role is read off the code that was redeemed.
--   * Guessing is rate limited per account, so the code cannot be brute forced
--     through the API.
-- ============================================================


-- ── 1. Who is the caller, according to the database ─────────
--
-- Deliberately reads employees rather than auth.jwt()->>'user_role': the JWT
-- claim only exists once the custom access token hook is registered, and
-- authorization must not silently fail open when it is not.

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM employees
   WHERE auth_user_id = auth.uid() AND is_active
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_employee_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_employee_role() TO authenticated;


-- ── 2. The codes themselves ─────────────────────────────────

CREATE TABLE IF NOT EXISTS role_access_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the normalised code. The code itself is shown once, at
  -- creation, and is not recoverable from here.
  code_hash   TEXT NOT NULL UNIQUE,
  -- Only these two. 'employee' needs no code, and 'super_admin' is never
  -- reachable through a form.
  role        TEXT NOT NULL CHECK (role IN ('manager', 'hr_admin')),
  label       TEXT,
  created_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_access_codes_role ON role_access_codes(role);

ALTER TABLE role_access_codes ENABLE ROW LEVEL SECURITY;

-- No policies at all: every route in and out is a SECURITY DEFINER function
-- below. Nothing reaches this table directly from a browser, so a mistake in a
-- policy cannot expose it.


-- Failed redemptions, so a code cannot be guessed through repeated calls.
CREATE TABLE IF NOT EXISTS role_access_code_attempts (
  id           BIGSERIAL PRIMARY KEY,
  auth_user_id UUID NOT NULL,
  succeeded    BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_access_code_attempts_user
  ON role_access_code_attempts(auth_user_id, attempted_at DESC);

ALTER TABLE role_access_code_attempts ENABLE ROW LEVEL SECURITY;


-- ── 3. Normalisation and hashing ────────────────────────────
--
-- Punctuation and case are cosmetic, so "hra-1a2b-3c4d" and "HRA1A2B3C4D"
-- redeem the same code. sha256() is built into Postgres; no extension needed.

CREATE OR REPLACE FUNCTION public.normalise_access_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.hash_access_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(sha256(convert_to(public.normalise_access_code(p_code), 'UTF8')), 'hex');
$$;


-- ── 4. Issue a code ─────────────────────────────────────────
--
-- Returns the plaintext code exactly once. There is no way to read it back:
-- if it is lost, revoke it and issue another.

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

  -- Least privilege: HR may recruit managers, but only a super admin may
  -- create another administrator.
  IF p_role = 'hr_admin' AND caller_role <> 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden');
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

  -- 80 bits from gen_random_uuid(), which Postgres draws from a
  -- cryptographically strong source. Grouped only for legibility.
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

  RETURN jsonb_build_object(
    'status',     'ok',
    'id',         row_out.id,
    'code',       code,            -- shown once, never stored in this form
    'role',       row_out.role,
    'expires_at', row_out.expires_at,
    'max_uses',   row_out.max_uses
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_role_access_code(text, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_role_access_code(text, text, integer, integer) TO authenticated;


-- ── 5. List and revoke ──────────────────────────────────────

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
  IF caller_role NOT IN ('hr_admin', 'super_admin') OR caller_role IS NULL THEN
    RETURN jsonb_build_object('status', 'forbidden', 'codes', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
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
        ) c
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_role_access_codes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_role_access_codes() TO authenticated;


CREATE OR REPLACE FUNCTION public.revoke_role_access_code(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
  target      role_access_codes%ROWTYPE;
BEGIN
  IF caller_role IS NULL OR caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT * INTO target FROM role_access_codes WHERE id = p_id;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- The same rule as issuing: only a super admin governs hr_admin codes.
  IF target.role = 'hr_admin' AND caller_role <> 'super_admin' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  UPDATE role_access_codes SET revoked_at = now()
   WHERE id = p_id AND revoked_at IS NULL;

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_role_access_code(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_role_access_code(uuid) TO authenticated;


-- ── 6. Redeeming, folded into the claim ─────────────────────
--
-- The code travels in the signup request's user metadata, so the existing
-- zero-argument call still works and there is no window in which the account
-- gets created as an 'employee' first. An explicit argument overrides it, which
-- is what the retry screen uses when somebody mistypes the code.
--
-- Returns jsonb { status, role }, where status is one of:
--   ok | not_authenticated | inactive | already_registered | name_mismatch
--   | domain_blocked | invalid_code | too_many_attempts

DROP FUNCTION IF EXISTS public.claim_employee_account();

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

  -- Serialise concurrent claims for the same account. The signup form and the
  -- auth-state listener both fire a claim moments apart, and without this both
  -- can pass the checks below and redeem a single-use code twice. The lock is
  -- transaction scoped, so it is released when this function returns; the
  -- second caller then sees the linked record and exits at the check below.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Already linked: nothing to do. Keeps this safe to call on every sign-in.
  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;
  IF emp.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
  END IF;

  -- Founding administrator. With no employee records nobody could have been
  -- invited, so the first account bootstraps the system.
  IF NOT EXISTS (SELECT 1 FROM employees) THEN
    INSERT INTO employees (auth_user_id, full_name, email, role, is_active)
    VALUES (uid, COALESCE(claimed_name, split_part(uemail, '@', 1)), uemail, 'super_admin', true)
    RETURNING * INTO emp;
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
      -- Throttle before looking anything up, so the API cannot be used to
      -- grind through the keyspace.
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

      -- One branch for every failure, so a wrong code and an expired code are
      -- indistinguishable to the caller.
      IF code_row.id IS NULL
         OR code_row.revoked_at IS NOT NULL
         OR code_row.expires_at <= now()
         OR code_row.used_count >= code_row.max_uses
      THEN
        INSERT INTO role_access_code_attempts (auth_user_id, succeeded)
        VALUES (uid, false);
        RETURN jsonb_build_object('status', 'invalid_code');
      END IF;

      -- Guarded increment: two people redeeming the last use of a code at the
      -- same moment cannot both succeed.
      UPDATE role_access_codes
         SET used_count = used_count + 1
       WHERE id = code_row.id
         AND revoked_at IS NULL
         AND expires_at > now()
         AND used_count < max_uses;

      GET DIAGNOSTICS linked = ROW_COUNT;
      IF linked = 0 THEN
        INSERT INTO role_access_code_attempts (auth_user_id, succeeded)
        VALUES (uid, false);
        RETURN jsonb_build_object('status', 'invalid_code');
      END IF;

      INSERT INTO role_access_code_attempts (auth_user_id, succeeded) VALUES (uid, true);
      granted_role := code_row.role;
    END IF;

    BEGIN
      -- granted_role is 'employee' unless a valid code was redeemed above.
      -- Nothing the browser sends can reach this variable directly.
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
