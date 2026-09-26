-- ============================================================
-- Migration 018: Remove access codes; roles are assigned by administrators
--
-- Incremental. Applies once cleanly and is safe to re-apply.
--
-- What changes
-- ------------
-- Access codes are withdrawn. Registering yourself now always produces an
-- 'employee' account, and every elevated role is granted by a person:
--
--   Manager      <- HR Admin, on the Employees page
--   HR Admin     <- Super Admin, in Administration -> Access & roles
--   Super Admin  <- Super Admin, in Administration -> Administrators
--
-- Why this is not a loss of security
-- ----------------------------------
-- A code was a bearer secret: whoever held the string got the role, and it
-- could be forwarded to someone it was never meant for. Granting a role to a
-- named employee record is strictly narrower — it names the person, requires an
-- administrator to be signed in, and is written to audit_logs either way.
--
-- The privilege floor is unchanged and still hard-coded: nothing a browser
-- sends can make claim_employee_account() write anything but 'employee'.
--
-- DESTRUCTIVE: this drops role_access_codes and role_access_code_attempts.
-- Any codes still outstanding stop working. Audit entries about codes are kept
-- — they live in audit_logs, which is untouched.
-- ============================================================


-- ── 1. Self-registration always yields 'employee' ───────────
--
-- Identical to the version in 015/013 except that the access-code branch is
-- gone. The bootstrap, invited-record, domain, name-match and concurrency
-- behaviour are all preserved exactly.

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
  emp          employees%ROWTYPE;
  linked       integer;
BEGIN
  -- p_access_code is accepted and ignored. Kept in the signature so that a
  -- browser still running the previous bundle does not fail with "function
  -- does not exist" mid-deploy.
  IF uid IS NULL OR uemail IS NULL OR uemail = '' THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- Serialise concurrent claims for the same account: the signup form and the
  -- auth-state listener both fire moments apart.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;
  IF emp.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
  END IF;

  -- Founding administrator, while no usable administrator exists.
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

  -- ── Nobody invited this address: create an ordinary account. ──
  IF emp.id IS NULL THEN
    IF NOT public.signup_domain_allowed(uemail) THEN
      RETURN jsonb_build_object('status', 'domain_blocked');
    END IF;

    BEGIN
      -- 'employee' is a literal. There is no argument, JWT claim or metadata
      -- field that can raise it.
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


-- ── 2. Withdraw the access-code machinery ───────────────────

DROP FUNCTION IF EXISTS public.create_role_access_code(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.revoke_role_access_code(uuid);
DROP FUNCTION IF EXISTS public.list_role_access_codes();
DROP FUNCTION IF EXISTS public.hash_access_code(text);
DROP FUNCTION IF EXISTS public.normalise_access_code(text);

DROP TABLE IF EXISTS role_access_code_attempts;
DROP TABLE IF EXISTS role_access_codes;


-- ── 3. Keep historical code events readable ─────────────────
--
-- The tables are gone but the audit entries are not, and a record of who
-- issued administrative access last month is exactly what an audit trail is
-- for. The action filter keeps the access_code.* values so that history stays
-- visible in Security activity.

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
