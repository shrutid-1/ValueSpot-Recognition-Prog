-- ============================================================
--  VERIFY 026 — who may create an employee record, and at what role
--
--  Run in the Supabase SQL Editor AFTER pushing 026.
--
--  Every section runs inside a transaction that ENDS IN ROLLBACK. No employee
--  record, auth user, verification row or audit entry survives it. Nothing is
--  created, promoted or deleted for real.
--
--  It does not approximate anything: it impersonates a genuine signed-in
--  browser by setting request.jwt.claims and SET LOCAL ROLE authenticated, so
--  RLS, the second-factor gate and both triggers run exactly as they do for a
--  real request. A statement that succeeds here would succeed over the REST
--  API, and one that fails here would fail there.
--
--  Prerequisite: one active hr_admin and one active super_admin that have
--  signed up (auth_user_id NOT NULL). Section 0 says whether you have them.
-- ============================================================


-- ── 0. What the tests need ──────────────────────────────────

SELECT role, count(*) AS usable_accounts
  FROM employees
 WHERE is_active AND auth_user_id IS NOT NULL
   AND role IN ('hr_admin', 'super_admin')
 GROUP BY role;

-- EXPECT one row for hr_admin and one for super_admin, each >= 1.
-- No hr_admin yet? That is the bootstrap working as designed: sign in as the
-- Super Admin, Employees -> Add employee -> HR, and invite the first one.


-- ============================================================
--  A. HR creates Employee / Manager / HR — and never Super Admin.
--     Tests: "HR can create/invite Employee|Manager|HR",
--            "HR cannot create Super Admin",
--            "Direct REST attempt by HR to create Super Admin is rejected".
--
--  This IS the REST path — the same policy, the same trigger, the same role —
--  so there is no separate API test to run afterwards.
-- ============================================================

BEGIN;

DO $$
DECLARE
  hr_uid  uuid;
  sid     uuid := gen_random_uuid();
  outcome text;
  r       text;
BEGIN
  SELECT auth_user_id INTO hr_uid
    FROM employees
   WHERE role = 'hr_admin' AND is_active AND auth_user_id IS NOT NULL
   LIMIT 1;

  IF hr_uid IS NULL THEN
    RAISE EXCEPTION 'No usable hr_admin account. See section 0.';
  END IF;

  -- Become that HR user, with a verified second factor.
  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  SELECT sid, hr_uid, 'verify-026@localhost', NULL, now() + interval '1 hour', now();

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', hr_uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'hr_admin', 'email', 'verify-026@localhost')::text,
    true);

  SET LOCAL ROLE authenticated;

  FOREACH r IN ARRAY ARRAY['employee', 'manager', 'hr_admin', 'super_admin'] LOOP
    BEGIN
      INSERT INTO employees (full_name, email, role, is_active)
      VALUES ('Verify 026 ' || r, 'verify-026-' || r || '@localhost', r, true);
      outcome := 'CREATED';
    EXCEPTION
      WHEN insufficient_privilege THEN outcome := 'REFUSED  (' || SQLERRM || ')';
      WHEN OTHERS                THEN outcome := 'ERROR ' || SQLSTATE || '  (' || SQLERRM || ')';
    END;
    RAISE NOTICE 'HR creating %-12s -> %', r, outcome;
  END LOOP;

  RESET ROLE;
END;
$$;

ROLLBACK;

-- EXPECT:
--   HR creating employee     -> CREATED
--   HR creating manager      -> CREATED
--   HR creating hr_admin     -> CREATED
--   HR creating super_admin  -> REFUSED  (Only a Super Admin can create a
--                                         Super Admin account.)


-- ============================================================
--  B. A Super Admin may create any role.
-- ============================================================

BEGIN;

DO $$
DECLARE
  sa_uid  uuid;
  sid     uuid := gen_random_uuid();
  outcome text;
  r       text;
BEGIN
  SELECT auth_user_id INTO sa_uid
    FROM employees
   WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL
   LIMIT 1;

  IF sa_uid IS NULL THEN
    RAISE EXCEPTION 'No usable super_admin account. See section 0.';
  END IF;

  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  SELECT sid, sa_uid, 'verify-026@localhost', NULL, now() + interval '1 hour', now();

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', sa_uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'super_admin', 'email', 'verify-026@localhost')::text,
    true);

  SET LOCAL ROLE authenticated;

  FOREACH r IN ARRAY ARRAY['employee', 'manager', 'hr_admin', 'super_admin'] LOOP
    BEGIN
      INSERT INTO employees (full_name, email, role, is_active)
      VALUES ('Verify 026 ' || r, 'verify-026-sa-' || r || '@localhost', r, true);
      outcome := 'CREATED';
    EXCEPTION
      WHEN insufficient_privilege THEN outcome := 'REFUSED  (' || SQLERRM || ')';
      WHEN OTHERS                THEN outcome := 'ERROR ' || SQLSTATE || '  (' || SQLERRM || ')';
    END;
    RAISE NOTICE 'Super Admin creating %-12s -> %', r, outcome;
  END LOOP;

  RESET ROLE;
END;
$$;

ROLLBACK;

-- EXPECT all four CREATED.


-- ============================================================
--  B2. INVITATION AUTHORITY — only HR and Super Admin may invite.
--
--  Sections A and B proved HR and Super Admin CAN. This proves the other two
--  CANNOT, which is the half that actually matters: an invitation is created
--  by inserting an unclaimed employees row, so "can this person invite?" is
--  exactly "can this person insert?".
--
--  Both fixtures are fully legitimate, VERIFIED sessions. The only thing that
--  differs from section A is the role on their employee record — and note that
--  the trigger reads that role from the TABLE via current_employee_role(),
--  never from the user_role claim. The claims below are set honestly; setting
--  them dishonestly would change nothing, which is the point.
-- ============================================================

BEGIN;

DO $$
DECLARE
  uid     uuid;
  sid     uuid;
  who     text;
  target  text;
  outcome text;
  n       integer;
BEGIN
  FOREACH who IN ARRAY ARRAY['employee', 'manager'] LOOP
    uid := gen_random_uuid();
    sid := gen_random_uuid();

    -- Seed with no identity, or the previous iteration's claims make this
    -- INSERT look like one employee creating another.
    PERFORM set_config('request.jwt.claims', '', true);

    INSERT INTO auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            created_at, updated_at)
    VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'verify-026-inv-' || who || '@localhost', '', now(), now(), now());

    INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
    VALUES ('Inv ' || who, 'verify-026-inv-' || who || '@localhost', who, true, uid);

    INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
    VALUES (sid, uid, 'verify-026-inv-' || who || '@localhost', NULL,
            now() + interval '1 hour', now());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                        'user_role', who,
                        'email', 'verify-026-inv-' || who || '@localhost')::text,
      true);

    SET LOCAL ROLE authenticated;

    FOREACH target IN ARRAY ARRAY['employee', 'manager', 'hr_admin', 'super_admin'] LOOP
      BEGIN
        INSERT INTO employees (full_name, email, role, is_active)
        VALUES ('Invited by ' || who, 'verify-026-invby-' || who || '-' || target || '@localhost',
                target, true);
        outcome := 'CREATED  <-- WRONG, ' || who || ' must not be able to invite';
      EXCEPTION
        WHEN insufficient_privilege THEN outcome := 'REFUSED  (' || SQLERRM || ')';
        WHEN OTHERS                THEN outcome := 'REFUSED ' || SQLSTATE || '  (' || SQLERRM || ')';
      END;
      RAISE NOTICE '%-8s inviting %-12s -> %', who, target, outcome;
    END LOOP;

    RESET ROLE;

    -- Nothing may have been created by either of them, at any role.
    SELECT count(*) INTO n FROM employees
     WHERE email LIKE 'verify-026-invby-' || who || '-%';
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL: % created % invitation record(s).', who, n;
    END IF;
  END LOOP;

  RAISE NOTICE 'B2 PASS: neither Employee nor Manager can invite anybody.';
END;
$$;

ROLLBACK;

-- EXPECT eight REFUSED lines (two roles x four targets), then B2 PASS.
--
-- Two independent gates produce those refusals, and either alone is enough:
--   * RLS   employees_hr_full is the only INSERT policy and demands an
--           hr_admin/super_admin claim, so PostgREST refuses first.
--   * 026   guard_employee_role_insert reads current_employee_role() from the
--           table and raises for any caller who is not hr_admin/super_admin.
--
-- The SQLSTATE tells you which answered: 42501 from the trigger carries its
-- message, while a bare RLS refusal reports "new row violates row-level
-- security policy". Either is a pass.


-- ============================================================
--  C. AN INVITED MANAGER CANNOT BECOME HR.
--
--  A record is planted as Manager. The claiming session carries metadata
--  asking for hr_admin — exactly what a tampered browser would send. The
--  stored role must win.
-- ============================================================

BEGIN;

DO $$
DECLARE
  uid        uuid := gen_random_uuid();
  sid        uuid := gen_random_uuid();
  claimed    jsonb;
  final_role text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_user_meta_data)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'verify-026-invited@localhost', '', now(), now(), now(),
          jsonb_build_object('full_name', 'Invited Person',
                             'signup_role', 'hr_admin'));   -- <-- the attempt

  -- HR invited them as a Manager.
  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Invited Person', 'verify-026-invited@localhost', 'manager', true, NULL);

  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  VALUES (sid, uid, 'verify-026-invited@localhost', NULL, now() + interval '1 hour', now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'employee', 'email', 'verify-026-invited@localhost',
                      'user_metadata', jsonb_build_object('full_name', 'Invited Person',
                                                          'signup_role', 'hr_admin'))::text,
    true);

  claimed := public.claim_employee_account();

  SELECT role INTO final_role FROM employees
   WHERE lower(email) = 'verify-026-invited@localhost';

  RAISE NOTICE 'Invited as manager, metadata asks for hr_admin -> claim %, record says %',
               claimed, final_role;

  IF final_role <> 'manager' THEN
    RAISE EXCEPTION 'FAIL: an invited user overrode the role HR assigned.';
  END IF;
  RAISE NOTICE 'PASS: the stored invitation role won.';
END;
$$;

ROLLBACK;

-- EXPECT "PASS: the stored invitation role won." and record says manager.
-- The mechanism is not a check that could be bypassed: claim_employee_account()
-- never reads any requested role on the invited branch.


-- ============================================================
--  D. THE PUBLIC DOOR AND THE INVITATION-ONLY DOORS.
--
--  D1  Public Employee registration creates an Employee, and browser metadata
--      asking for manager/hr_admin/super_admin changes nothing.
--  D2  The Manager and HR setup pages REFUSE an address nobody invited,
--      rather than quietly producing an Employee account.
--  D3  p_require_invited_role cannot GRANT anything: asking for a role you
--      were not invited to is refused, in every direction.
-- ============================================================

BEGIN;

DO $$
DECLARE
  uid     uuid;
  sid     uuid;
  claimed jsonb;
  r       text;
BEGIN
  -- ── D1: the public Employee form. No required role is passed. ──
  FOREACH r IN ARRAY ARRAY['employee', 'manager', 'hr_admin', 'super_admin'] LOOP
    uid := gen_random_uuid();
    sid := gen_random_uuid();

    INSERT INTO auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_user_meta_data)
    VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'verify-026-self-' || r || '@localhost', '', now(), now(), now(),
            jsonb_build_object('full_name', 'Self ' || r, 'signup_role', r));

    INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
    VALUES (sid, uid, 'verify-026-self-' || r || '@localhost', NULL,
            now() + interval '1 hour', now());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                        'user_role', 'employee',
                        'email', 'verify-026-self-' || r || '@localhost',
                        'user_metadata', jsonb_build_object('full_name', 'Self ' || r,
                                                            'signup_role', r))::text,
      true);

    claimed := public.claim_employee_account();
    RAISE NOTICE 'D1 public signup, metadata asks for %-12s -> %', r, claimed;

    IF claimed->>'role' <> 'employee' THEN
      RAISE EXCEPTION 'FAIL: signup_role metadata produced %', claimed->>'role';
    END IF;
  END LOOP;

  RAISE NOTICE 'D1 PASS: the public form only ever creates an Employee.';
END;
$$;

ROLLBACK;


BEGIN;

DO $$
DECLARE
  uid     uuid;
  sid     uuid;
  claimed jsonb;
  r       text;
  n       integer;
BEGIN
  -- ── D2: the setup pages, with NO invitation on file. ──
  FOREACH r IN ARRAY ARRAY['manager', 'hr_admin'] LOOP
    uid := gen_random_uuid();
    sid := gen_random_uuid();

    INSERT INTO auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_user_meta_data)
    VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'verify-026-gate-' || r || '@localhost', '', now(), now(), now(),
            jsonb_build_object('full_name', 'Gate ' || r, 'signup_role', r));

    INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
    VALUES (sid, uid, 'verify-026-gate-' || r || '@localhost', NULL,
            now() + interval '1 hour', now());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                        'user_role', 'employee',
                        'email', 'verify-026-gate-' || r || '@localhost',
                        'user_metadata', jsonb_build_object('full_name', 'Gate ' || r,
                                                            'signup_role', r))::text,
      true);

    claimed := public.claim_employee_account(NULL, r);
    RAISE NOTICE 'D2 uninvited at the %-9s setup page -> %', r, claimed;

    IF claimed->>'status' <> 'invitation_required' THEN
      RAISE EXCEPTION 'FAIL: uninvited % setup returned %', r, claimed->>'status';
    END IF;

    -- The refusal must leave NOTHING behind. No consolation Employee account.
    SELECT count(*) INTO n FROM employees
     WHERE lower(email) = 'verify-026-gate-' || r || '@localhost';
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL: a refused % setup still created % record(s).', r, n;
    END IF;
  END LOOP;

  RAISE NOTICE 'D2 PASS: setup pages refuse the uninvited and create nothing.';
END;
$$;

ROLLBACK;


BEGIN;

DO $$
DECLARE
  uid     uuid;
  sid     uuid;
  claimed jsonb;
  final   text;
BEGIN
  -- ── D3: invited as manager, but standing at the HR setup page. ──
  uid := gen_random_uuid();
  sid := gen_random_uuid();

  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_user_meta_data)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'verify-026-wrongdoor@localhost', '', now(), now(), now(),
          jsonb_build_object('full_name', 'Wrong Door', 'signup_role', 'hr_admin'));

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Wrong Door', 'verify-026-wrongdoor@localhost', 'manager', true, NULL);

  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  VALUES (sid, uid, 'verify-026-wrongdoor@localhost', NULL, now() + interval '1 hour', now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'employee', 'email', 'verify-026-wrongdoor@localhost',
                      'user_metadata', jsonb_build_object('full_name', 'Wrong Door',
                                                          'signup_role', 'hr_admin'))::text,
    true);

  -- Asking for hr_admin while invited as manager.
  claimed := public.claim_employee_account(NULL, 'hr_admin');
  RAISE NOTICE 'D3 invited manager asking for hr_admin -> %', claimed;

  IF claimed->>'status' <> 'invitation_role_mismatch' THEN
    RAISE EXCEPTION 'FAIL: wrong-door claim returned %', claimed->>'status';
  END IF;

  SELECT role INTO final FROM employees WHERE lower(email) = 'verify-026-wrongdoor@localhost';
  IF final <> 'manager' THEN
    RAISE EXCEPTION 'FAIL: the record became % instead of manager.', final;
  END IF;

  -- And the right door still works, taking the role from the RECORD.
  claimed := public.claim_employee_account(NULL, 'manager');
  RAISE NOTICE 'D3 same person at the manager setup page -> %', claimed;

  IF claimed->>'status' <> 'ok' OR claimed->>'role' <> 'manager' THEN
    RAISE EXCEPTION 'FAIL: a valid manager invitation was not honoured: %', claimed;
  END IF;

  RAISE NOTICE 'D3 PASS: the required role can only refuse, never promote.';
END;
$$;

ROLLBACK;

-- EXPECT, in order:
--   D1  four lines all reporting role "employee", then D1 PASS
--   D2  two lines reporting status "invitation_required", then D2 PASS
--   D3  invitation_role_mismatch, then ok/manager, then D3 PASS
--
-- D2 is the behaviour that replaced "uninvited signup becomes Employee": the
-- setup pages now refuse and create nothing, and the test asserts BOTH.


-- ============================================================
--  E. An unverified session cannot reach anything.
--     Tests: "unverified session cannot access protected data",
--            "password + email verification code remains required".
-- ============================================================

BEGIN;

DO $$
DECLARE
  uid      uuid;
  sid      uuid := gen_random_uuid();
  outcome  text;
  seen     integer;
BEGIN
  SELECT auth_user_id INTO uid
    FROM employees
   WHERE role = 'hr_admin' AND is_active AND auth_user_id IS NOT NULL
   LIMIT 1;

  -- Same account, same JWT claims as section A. The ONLY difference is that no
  -- login_verifications row exists — the emailed code was never entered.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'hr_admin', 'email', 'verify-026@localhost')::text,
    true);

  RAISE NOTICE 'Unverified claim_employee_account() -> %', public.claim_employee_account();

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO seen FROM employees;
  RAISE NOTICE 'Unverified HR reading employees     -> % rows', seen;

  BEGIN
    INSERT INTO employees (full_name, email, role, is_active)
    VALUES ('Verify 026 unverified', 'verify-026-unver@localhost', 'employee', true);
    outcome := 'CREATED  <-- WRONG, the second factor is not being enforced';
  EXCEPTION WHEN OTHERS THEN outcome := 'REFUSED ' || SQLSTATE || '  (' || SQLERRM || ')';
  END;
  RAISE NOTICE 'Unverified HR creating employee    -> %', outcome;

  RESET ROLE;
END;
$$;

ROLLBACK;

-- EXPECT {"status": "needs_verification"}, 0 rows, and REFUSED.
-- Zero rows is 022's gate: every policy carries session_second_factor_ok(),
-- so an unverified session reads nothing even holding an hr_admin claim.


-- ============================================================
--  F. Role separation: an Employee JWT reaches no HR data.
--     Tests: "Employee cannot access HR protected data",
--            "Manager cannot access HR protected data".
--
--  Verified sessions this time — the ONLY difference from an HR session is the
--  user_role claim, which is stamped by custom_access_token_hook from the
--  employee record and cannot be set by the browser.
-- ============================================================

BEGIN;

DO $$
DECLARE
  uid  uuid;
  sid  uuid;
  who  text;
  n    integer;
BEGIN
  FOREACH who IN ARRAY ARRAY['employee', 'manager'] LOOP
    uid := gen_random_uuid();
    sid := gen_random_uuid();

    -- Fixtures must be seeded with no identity, or the previous iteration's
    -- claims make this INSERT look like one employee creating another.
    PERFORM set_config('request.jwt.claims', '', true);

    INSERT INTO auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            created_at, updated_at)
    VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'verify-026-sep-' || who || '@localhost', '', now(), now(), now());

    INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
    VALUES ('Sep ' || who, 'verify-026-sep-' || who || '@localhost', who, true, uid);

    INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
    VALUES (sid, uid, 'verify-026-sep-' || who || '@localhost', NULL,
            now() + interval '1 hour', now());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                        'user_role', who,
                        'email', 'verify-026-sep-' || who || '@localhost')::text,
      true);

    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO n FROM audit_logs;
    RAISE NOTICE '%-8s reading audit_logs (HR only) -> % rows', who, n;
    IF n > 0 THEN
      RAISE EXCEPTION 'FAIL: % can read HR audit data.', who;
    END IF;

    -- Scoped to an HR-ONLY key on purpose. app_config_read_operational (007,
    -- re-gated in 022) deliberately lets any verified user read six
    -- operational keys — timezone, feed page size and the like — so counting
    -- the whole table would report a breach where the design is working.
    SELECT count(*) INTO n FROM app_config WHERE key = 'signup_allowed_domains';
    RAISE NOTICE '%-8s reading signup_allowed_domains (HR only) -> % rows', who, n;
    IF n > 0 THEN
      RAISE EXCEPTION 'FAIL: % can read HR-only configuration.', who;
    END IF;

    RESET ROLE;
  END LOOP;

  RAISE NOTICE 'PASS: neither Employee nor Manager reached HR data.';
END;
$$;

ROLLBACK;

-- EXPECT 0 rows on every line, then PASS. Typing an HR URL changes none of
-- this: the browser never chooses user_role, and RLS is what answers.


-- ============================================================
--  G. The guards that must not have moved.
-- ============================================================

SELECT tgname,
       CASE tgtype & 4  WHEN 4  THEN 'INSERT ' ELSE '' END ||
       CASE tgtype & 16 WHEN 16 THEN 'UPDATE'  ELSE '' END AS fires_on
  FROM pg_trigger
 WHERE tgrelid = 'public.employees'::regclass
   AND NOT tgisinternal
 ORDER BY tgname;

-- EXPECT guard_employee_role_change UPDATE, guard_employee_role_insert INSERT,
-- guard_last_admin_active UPDATE, plus set_employees_updated_at.

SELECT proname,
       pg_get_functiondef(oid) LIKE '%needs_super_admin%'   AS super_admin_boundary_intact,
       pg_get_functiondef(oid) LIKE '%only administrator%'  AS last_admin_protection_intact
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace AND proname = 'set_employee_role';

-- EXPECT both true — 026 does not redefine set_employee_role().

SELECT proname,
       pg_get_functiondef(oid) LIKE '%session_second_factor_ok%' AS still_needs_2fa,
       pg_get_functiondef(oid) NOT LIKE '%signup_role%'          AS takes_no_browser_role
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_employee_account';

-- EXPECT both true — 022's definition is live, with no browser-supplied role
-- anywhere in it.

SELECT count(*) AS leftover_rows FROM employees WHERE email LIKE 'verify-026%';

-- EXPECT 0. Every section rolled back.
