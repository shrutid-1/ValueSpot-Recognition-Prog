-- ============================================================
-- Migration 026: who may CREATE an employee record, and at what role
--
-- Additive. One new function, one new trigger. Safe to run more than once.
-- Requires 011-025.
--
--
-- THE HOLE THIS CLOSES
-- --------------------
-- Migration 016 made roles unwritable from the browser -- but only on UPDATE:
--
--     CREATE TRIGGER guard_employee_role_change
--       BEFORE UPDATE ON employees          <-- UPDATE, and nothing else
--
-- INSERT was left to RLS alone, and employees_hr_full is
--
--     FOR ALL USING ( session_second_factor_ok()
--                     AND user_role IN ('hr_admin','super_admin') )
--
-- with no WITH CHECK. Postgres then reuses USING as the WITH CHECK, and that
-- expression tests only WHO IS CALLING -- it never looks at the role column
-- being written.
--
-- So an hr_admin could
--
--     POST /rest/v1/employees  { "email": "...", "role": "super_admin", ... }
--
-- for an address they control, register it, and hold full control of the
-- system. set_employee_role() refuses that exact promotion; the INSERT path
-- simply was not covered. 016's own header makes the point: "The role dropdown
-- not offering the option is not a control; anyone can call the REST API."
--
--
-- THE RULE
-- --------
--     super_admin  ->  employee, manager, hr_admin, super_admin
--     hr_admin     ->  employee, manager, hr_admin        (NOT super_admin)
--     manager      ->  nothing
--     employee     ->  nothing
--     anon         ->  nothing (RLS already refuses; this is the second gate)
--
-- hr_admin may create an hr_admin because that is the HR workflow: HR adds the
-- person at the role they will hold, sends the invitation link, and
-- claim_employee_account() links the account to that record with its role
-- intact. No Super Admin promotion step is involved, and there is no approval
-- chain anywhere in this file.
--
-- Creating a super_admin remains a super_admin's act alone, matching
-- set_employee_role(), which this migration does not touch.
--
--
-- WHAT SELF-SIGNUP CAN DO
-- -----------------------
-- The two rules from migration 022 are unchanged:
--
--     a record already exists for this email  ->  ITS ROLE WINS
--     no record exists                        ->  'employee', a literal
--
-- There is no argument, JWT claim or metadata field that can raise that
-- literal, so Manager and HR accounts can only come from a record HR created.
--
-- Part C adds ONE thing on top: an optional p_require_invited_role, which lets
-- the Manager and HR setup pages say "refuse unless this person really was
-- invited at that role" instead of quietly producing an Employee account from
-- the wrong door. It can only ever NARROW the outcome -- see Part C.
--
--
-- WHAT IS DELIBERATELY STILL ALLOWED
-- ----------------------------------
-- 1. auth.uid() IS NULL -- the SQL Editor, migrations, seeders and the service
--    role. Exactly the escape hatch guard_employee_role_change() already keeps,
--    for the same reason: reaching them means owning the project, and they are
--    the way back in if the app ever locks itself out.
--
-- 2. The two inserts claim_employee_account() makes on the caller's own behalf.
--    That function is SECURITY DEFINER but auth.uid() still resolves to the end
--    user inside it, so its inserts pass through this trigger and must be
--    recognised or every signup breaks:
--
--      a. ordinary self-registration  -> role 'employee', own auth_user_id
--      b. founding administrator      -> role 'super_admin', own auth_user_id,
--                                        only while has_usable_admin() is false
--
--    Both are matched structurally: the row must carry the CALLER'S OWN
--    auth_user_id. A privilege escalation would need to mint a row for someone
--    else, which these branches cannot do. Branch (b) is the existing Super
--    Admin bootstrap -- it closes permanently the moment one usable
--    administrator exists, and auth_user_id is UNIQUE, so neither branch can be
--    replayed by an account that already has a record.
--
--    Note that both are unreachable from the REST API regardless:
--    employees_hr_full is the only INSERT policy on the table and it demands an
--    hr_admin/super_admin JWT claim, which a brand-new account does not have.
--
--
-- WHAT THIS MIGRATION DOES NOT TOUCH
-- ----------------------------------
--   set_employee_role()           guard_employee_role_change
--   check_signup_eligibility()    guard_last_admin_active
--   session_second_factor_ok()    request_login_code() / verify_login_code()
--   migrations 021-025            every RLS policy, including 022's
--   the Super Admin system        the last-Super-Admin protection
--   audit logging                 the Super Admin bootstrap (Part C keeps it
--                                 byte-for-byte, only making it unreachable
--                                 from a setup page)
--
-- claim_employee_account() IS redefined, by Part C, and only there. Both of
-- 022's role rules survive unchanged; the function gains one optional
-- restricting argument and nothing else.
--
-- No policy is created, altered or dropped, so 022's second-factor gate is
-- exactly as it was. The check rides on current_employee_role(), which already
-- returns NULL for a session that has not passed the emailed code -- so an
-- unverified session cannot create a record either, with no policy change.
-- ============================================================


CREATE OR REPLACE FUNCTION public.guard_employee_role_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_role text;
BEGIN
  -- Trusted, identity-less callers: SQL Editor, migrations, seeders, service
  -- role. Same escape hatch as guard_employee_role_change().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- The row belongs to the caller: this is claim_employee_account() creating
  -- somebody's own account, never one person minting a record for another.
  IF NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id = auth.uid() THEN

    -- (a) ordinary self-registration. The only role self-signup can produce,
    --     matching the literal in claim_employee_account().
    IF NEW.role = 'employee' THEN
      RETURN NEW;
    END IF;

    -- (b) the existing Super Admin bootstrap, while nobody can administer the
    --     system. Untouched by this migration and left deliberately separate
    --     from the Employee/Manager/HR flow.
    IF NEW.role = 'super_admin' AND NOT public.has_usable_admin() THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Signing up can only create an Employee account. Manager and HR accounts are created by HR.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Everything else is one person creating a record for another. Read the
  -- caller's role from the database, never from the browser. This returns NULL
  -- for an unverified session (022), so the second factor gates creation too.
  caller_role := public.current_employee_role();

  IF caller_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  -- HR runs the roster: Employee, Manager and HR alike, with no Super Admin
  -- involved. Super Admin is the one thing HR cannot mint, here or over REST.
  IF caller_role = 'hr_admin' THEN
    IF NEW.role IN ('employee', 'manager', 'hr_admin') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Only a Super Admin can create a Super Admin account.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE EXCEPTION
    'You do not have permission to create employee records.'
    USING ERRCODE = 'insufficient_privilege';
END;
$fn$;


DROP TRIGGER IF EXISTS guard_employee_role_insert ON employees;
CREATE TRIGGER guard_employee_role_insert
  BEFORE INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_role_insert();


-- ============================================================
-- PART C -- refuse, rather than downgrade, at the setup pages
--
-- /manager/setup and /hr/setup are reached from an invitation. Someone who
-- opens one uninvited must be REFUSED, not handed an ordinary Employee
-- account they never asked for through a door that was not meant for them.
--
-- p_require_invited_role is how a caller says which door it is standing at.
--
--
-- WHY THIS IS SAFE TO ACCEPT FROM A BROWSER
-- -----------------------------------------
-- It is a RESTRICTION, never a grant. Read the three checks below: every one
-- can only make the call FAIL. There is no branch in which a larger value of
-- p_require_invited_role produces a larger role -- the role written is still
-- emp.role, read from the employee record HR created.
--
--   passing 'hr_admin' while invited as hr_admin  ->  hr_admin   (unchanged)
--   passing 'hr_admin' while invited as manager   ->  REFUSED
--   passing 'hr_admin' while not invited at all   ->  REFUSED
--   passing 'hr_admin' as an ordinary registrant  ->  REFUSED
--   passing nothing at all                        ->  'employee' literal
--
-- So the worst a tampered browser can do with it is lock itself out. That is
-- what makes it acceptable input; nothing about authorisation moved to the
-- client.
--
-- It is also checked BEFORE the Super Admin bootstrap branch, so a setup page
-- can never be the thing that founds an administrator.
-- ============================================================

-- The old one-argument signature is dropped so PostgREST has a single
-- candidate and rpc('claim_employee_account', {}) stays unambiguous.
DROP FUNCTION IF EXISTS public.claim_employee_account(text);

CREATE OR REPLACE FUNCTION public.claim_employee_account(
  p_access_code           text DEFAULT NULL,
  p_require_invited_role  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid          uuid := auth.uid();
  uemail       text := lower(btrim(auth.jwt()->>'email'));
  claimed_name text := NULLIF(btrim(auth.jwt()->'user_metadata'->>'full_name'), '');
  required     text := NULLIF(lower(btrim(p_require_invited_role)), '');
  emp          employees%ROWTYPE;
  linked       integer;
BEGIN
  -- p_access_code is accepted and ignored, kept so a browser still running an
  -- older bundle does not fail with "function does not exist" mid-deploy.
  IF uid IS NULL OR uemail IS NULL OR uemail = '' THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- Unchanged from 022: creating or linking a record is exactly the moment the
  -- emailed code must already have been accepted.
  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;
  IF emp.id IS NOT NULL THEN
    -- Already linked. Still honour the restriction, so an Employee cannot use
    -- the HR setup page to reach an HR destination.
    IF required IS NOT NULL AND emp.role <> required THEN
      RETURN jsonb_build_object('status', 'invitation_role_mismatch', 'role', emp.role);
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'role', emp.role);
  END IF;

  -- ── The setup-page gate. Deliberately ahead of the bootstrap branch. ──
  IF required IS NOT NULL THEN
    -- Only the two invitation-only roles have a setup page. Employee has a
    -- public form and needs no invitation; super_admin has neither and is
    -- refused here in the same breath as any other nonsense value.
    IF required NOT IN ('manager', 'hr_admin') THEN
      RETURN jsonb_build_object('status', 'invalid_role');
    END IF;

    SELECT * INTO emp FROM employees WHERE lower(email) = uemail LIMIT 1;

    IF emp.id IS NULL THEN
      RETURN jsonb_build_object('status', 'invitation_required', 'role', required);
    END IF;

    IF emp.role <> required THEN
      -- Invited, but through a different door. Says nothing about which.
      RETURN jsonb_build_object('status', 'invitation_role_mismatch');
    END IF;

    -- Falls through to the ordinary invited-linking path below, which reads
    -- the role from the record and never from `required`.
  END IF;

  -- Founding administrator, while no usable administrator exists. Unchanged
  -- from 022, and unreachable when a setup page set `required` above.
  IF required IS NULL AND NOT public.has_usable_admin() THEN
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

  -- ── Nobody invited this address: an ordinary Employee account. ──
  -- Unreachable when `required` is set, because that branch already returned
  -- 'invitation_required' for exactly this case.
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

  -- ── A record exists. Verify, then link. ITS ROLE WINS. ──
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

  RETURN jsonb_build_object('status', 'ok', 'role', emp.role, 'invited', true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_employee_account(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_employee_account(text, text) TO authenticated;


-- ── Verification ────────────────────────────────────────────

SELECT '026 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname = 'guard_employee_role_insert'
                  AND tgrelid = 'public.employees'::regclass
                  AND NOT tgisinternal)                                AS insert_guard_installed,
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname = 'guard_employee_role_change'
                  AND tgrelid = 'public.employees'::regclass
                  AND NOT tgisinternal)                                AS update_guard_intact,
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname = 'guard_last_admin_active'
                  AND tgrelid = 'public.employees'::regclass
                  AND NOT tgisinternal)                                AS last_admin_guard_intact,
       (SELECT pg_get_functiondef(oid) LIKE '%session_second_factor_ok%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'claim_employee_account')                     AS claim_still_needs_2fa,
       (SELECT pg_get_functiondef(oid) NOT LIKE '%signup_role%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'claim_employee_account')                     AS claim_takes_no_browser_role,
       (SELECT count(*) FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'claim_employee_account')                     AS claim_overloads,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')   AS policies_untouched;
-- EXPECT the three guards true, claim_still_needs_2fa true, and
-- claim_takes_no_browser_role true -- the last confirms no browser-supplied
-- ROLE reaches the function (p_require_invited_role can only restrict).
-- claim_overloads must be 1: the old single-argument signature is dropped so
-- PostgREST has no ambiguity to resolve.
-- policies_untouched should equal whatever it read after 025: this migration
-- creates, alters and drops no policy.


-- ============================================================
-- ROLLBACK
--
--   DROP TRIGGER  IF EXISTS guard_employee_role_insert ON employees;
--   DROP FUNCTION IF EXISTS public.guard_employee_role_insert();
--
-- That restores the pre-026 behaviour exactly, including the escalation hole
-- described at the top. Nothing else has to be reverted: no table, column,
-- policy, grant or existing function was changed here.
-- ============================================================
