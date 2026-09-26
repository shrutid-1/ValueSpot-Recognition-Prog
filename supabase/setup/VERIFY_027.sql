-- ============================================================
--  VERIFY 027 — automated invitation email
--
--  Run in the Supabase SQL Editor AFTER applying 026 and 027.
--
--  Every section that creates fixtures runs inside a transaction ending in
--  ROLLBACK. Nothing survives, including the invitation_sends rows and the
--  audit_logs entries the sender writes.
--
--  ⚠️  ONE IMPORTANT DIFFERENCE from VERIFY_026.sql
--
--  send_employee_invitation() calls net.http_post(). pg_net QUEUES that
--  request outside the transaction, so a rolled-back section can still cause
--  a real email to be sent. Every fixture here therefore uses an @localhost
--  address, which no provider will deliver -- Brevo will simply reject it,
--  which is itself a valid outcome for these tests. They check WHO MAY SEND
--  and WHAT THE FUNCTION DECIDES, not whether mail arrives.
--
--  Real delivery is verified separately, at the end, with a live address.
-- ============================================================


-- ── 0. Configuration the sender depends on ──────────────────

SELECT COALESCE(NULLIF(btrim((SELECT value #>> '{}' FROM app_config
                               WHERE key = 'app_base_url')), ''),
                '(NOT SET)')                                    AS app_base_url,
       (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name = 'brevo_api_key'
           AND btrim(decrypted_secret) <> '')                   AS brevo_api_key_set,
       (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name = 'brevo_sender'
           AND btrim(decrypted_secret) <> '')                   AS brevo_sender_set,
       (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'brevo_sender')                           AS sender_in_use;

-- EXPECT app_base_url set, and both secrets = 1.
-- The API key is checked for PRESENCE only and never selected.
--
-- Not set yet?
--   UPDATE app_config SET value = '"http://localhost:5173"'::jsonb
--    WHERE key = 'app_base_url';


-- ============================================================
--  A. WHO MAY SEND.   Tests 1-6, 8, 9.
--
--  Four callers, one pending target each. Only hr_admin and super_admin may
--  send; employee and manager must be refused. Note the sender reads the
--  caller's role from the TABLE via current_employee_role(), so the honest
--  user_role claims below are irrelevant to the outcome -- which is the point.
-- ============================================================

BEGIN;

DO $$
DECLARE
  caller   text;
  uid      uuid;
  sid      uuid;
  target   uuid;
  res      jsonb;
  expected text;
BEGIN
  FOREACH caller IN ARRAY ARRAY['employee', 'manager', 'hr_admin', 'super_admin'] LOOP
    uid := gen_random_uuid();
    sid := gen_random_uuid();

    -- Seed fixtures with no identity, or the previous iteration's claims make
    -- these INSERTs look like one employee creating another.
    PERFORM set_config('request.jwt.claims', '', true);

    INSERT INTO auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            created_at, updated_at)
    VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'verify-027-' || caller || '@localhost', '', now(), now(), now());

    INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
    VALUES ('Caller ' || caller, 'verify-027-' || caller || '@localhost',
            caller, true, uid);

    -- A pending invitation for them to try to send.
    INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
    VALUES ('Target of ' || caller, 'verify-027-target-' || caller || '@localhost',
            'employee', true, NULL)
    RETURNING id INTO target;

    INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
    VALUES (sid, uid, 'verify-027-' || caller || '@localhost', NULL,
            now() + interval '1 hour', now());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid,
                        'user_role', caller,
                        'email', 'verify-027-' || caller || '@localhost')::text,
      true);

    res := public.send_employee_invitation(target);
    RAISE NOTICE '%-12s sending an invitation -> %', caller, res;

    expected := CASE WHEN caller IN ('hr_admin', 'super_admin')
                     THEN 'queued' ELSE 'forbidden' END;

    IF res->>'status' <> expected THEN
      RAISE EXCEPTION 'FAIL: % got status %, expected %',
                      caller, res->>'status', expected;
    END IF;
  END LOOP;

  RAISE NOTICE 'A PASS: only HR and Super Admin may send invitations.';
END;
$$;

ROLLBACK;

-- EXPECT:
--   employee     -> forbidden
--   manager      -> forbidden
--   hr_admin     -> queued
--   super_admin  -> queued
-- then A PASS.
--
-- If hr_admin/super_admin return 'app_url_not_configured' or
-- 'email_not_configured' instead, that is section 0 failing, not a security
-- result -- fix the configuration and re-run.


-- ============================================================
--  B. WHICH TARGETS ARE VALID.   Tests 7, 10, 11.
--
--  super_admin is never an invitation target; an already-registered person
--  cannot be re-invited; an inactive record cannot be invited.
-- ============================================================

BEGIN;

DO $$
DECLARE
  hr_uid   uuid := gen_random_uuid();
  sid      uuid := gen_random_uuid();
  linked   uuid := gen_random_uuid();
  t_super  uuid;
  t_linked uuid;
  t_inact  uuid;
  res      jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (hr_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'verify-027-hr@localhost', '', now(), now(), now()),
         (linked, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'verify-027-linked@localhost', '', now(), now(), now());

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('HR Caller', 'verify-027-hr@localhost', 'hr_admin', true, hr_uid);

  -- A super_admin with no login: a "pending" record at a forbidden role.
  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Pending Super', 'verify-027-super@localhost', 'super_admin', true, NULL)
  RETURNING id INTO t_super;

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Already Registered', 'verify-027-linked@localhost', 'employee', true, linked)
  RETURNING id INTO t_linked;

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Inactive Person', 'verify-027-inactive@localhost', 'manager', false, NULL)
  RETURNING id INTO t_inact;

  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  VALUES (sid, hr_uid, 'verify-027-hr@localhost', NULL, now() + interval '1 hour', now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', hr_uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'hr_admin', 'email', 'verify-027-hr@localhost')::text,
    true);

  res := public.send_employee_invitation(t_super);
  RAISE NOTICE 'target super_admin        -> %', res;
  IF res->>'status' <> 'invalid_target_role' THEN
    RAISE EXCEPTION 'FAIL: super_admin target returned %', res->>'status';
  END IF;

  res := public.send_employee_invitation(t_linked);
  RAISE NOTICE 'target already registered -> %', res;
  IF res->>'status' <> 'already_registered' THEN
    RAISE EXCEPTION 'FAIL: registered target returned %', res->>'status';
  END IF;

  res := public.send_employee_invitation(t_inact);
  RAISE NOTICE 'target inactive           -> %', res;
  IF res->>'status' <> 'inactive' THEN
    RAISE EXCEPTION 'FAIL: inactive target returned %', res->>'status';
  END IF;

  res := public.send_employee_invitation(gen_random_uuid());
  RAISE NOTICE 'target does not exist     -> %', res;
  IF res->>'status' <> 'not_found' THEN
    RAISE EXCEPTION 'FAIL: missing target returned %', res->>'status';
  END IF;

  RAISE NOTICE 'B PASS: invalid targets are all refused.';
END;
$$;

ROLLBACK;


-- ============================================================
--  C. RATE LIMITING.   Test 16.
--
--  One send per minute per employee. Must not touch the 2FA limits.
-- ============================================================

BEGIN;

DO $$
DECLARE
  hr_uid    uuid := gen_random_uuid();
  sid       uuid := gen_random_uuid();
  target    uuid;
  res       jsonb;
  code_rows integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (hr_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'verify-027-rl@localhost', '', now(), now(), now());

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('RL Caller', 'verify-027-rl@localhost', 'hr_admin', true, hr_uid);

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('RL Target', 'verify-027-rl-target@localhost', 'employee', true, NULL)
  RETURNING id INTO target;

  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  VALUES (sid, hr_uid, 'verify-027-rl@localhost', NULL, now() + interval '1 hour', now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', hr_uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'hr_admin', 'email', 'verify-027-rl@localhost')::text,
    true);

  SELECT count(*) INTO code_rows FROM login_code_sends;

  res := public.send_employee_invitation(target);
  RAISE NOTICE 'first send  -> %', res;
  IF res->>'status' <> 'queued' THEN
    RAISE EXCEPTION 'FAIL: first send returned %', res->>'status';
  END IF;

  res := public.send_employee_invitation(target);
  RAISE NOTICE 'second send -> %', res;
  IF res->>'status' <> 'cooldown' THEN
    RAISE EXCEPTION 'FAIL: immediate resend returned %, expected cooldown', res->>'status';
  END IF;

  -- Test 17: the 2FA ledger must be untouched by any of this.
  IF (SELECT count(*) FROM login_code_sends) <> code_rows THEN
    RAISE EXCEPTION 'FAIL: sending an invitation consumed 2FA rate-limit budget.';
  END IF;

  RAISE NOTICE 'C PASS: cooldown holds and 2FA rate limiting is untouched.';
END;
$$;

ROLLBACK;


-- ============================================================
--  D. THE LINK COMES FROM THE STORED ROLE.   Tests 12, 13.
--
--  send_employee_invitation() takes ONE argument: an employee id. There is no
--  role parameter and no URL parameter, so a browser cannot ask for a
--  different destination -- the test is that the signature makes it
--  inexpressible, which is stronger than a runtime check.
-- ============================================================

SELECT p.proname,
       pg_get_function_arguments(p.oid)                         AS arguments,
       pg_get_functiondef(p.oid) LIKE '%current_employee_role%' AS authorises_from_table,
       pg_get_functiondef(p.oid) LIKE '%app_base_url%'          AS url_from_app_config,
       pg_get_functiondef(p.oid) NOT LIKE '%p_role%'            AS no_role_argument,
       p.prosecdef                                              AS security_definer
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('send_employee_invitation', 'invitation_delivery_status')
 ORDER BY p.proname;

-- EXPECT send_employee_invitation(p_employee_id uuid) — one argument only —
-- with authorises_from_table, url_from_app_config, no_role_argument and
-- security_definer all true.


-- Only 'employee', 'manager' and 'hr_admin' map to a path, and the CASE reads
-- emp.role. Confirm the three destinations are present and super_admin is not:
SELECT pg_get_functiondef(oid) LIKE '%/manager/setup%' AS has_manager_path,
       pg_get_functiondef(oid) LIKE '%/hr/setup%'      AS has_hr_path,
       pg_get_functiondef(oid) LIKE '%/signup%'        AS has_employee_path
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace AND proname = 'send_employee_invitation';
-- EXPECT all three true.


-- ============================================================
--  E. FAILING SAFELY.   Tests 14, 15.
--
--  Missing app_base_url and missing Brevo credentials must each produce a
--  clear refusal, not a broken link in somebody's inbox.
-- ============================================================

BEGIN;

DO $$
DECLARE
  hr_uid uuid := gen_random_uuid();
  sid    uuid := gen_random_uuid();
  target uuid;
  res    jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (hr_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'verify-027-cfg@localhost', '', now(), now(), now());

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Cfg Caller', 'verify-027-cfg@localhost', 'hr_admin', true, hr_uid);

  INSERT INTO employees (full_name, email, role, is_active, auth_user_id)
  VALUES ('Cfg Target', 'verify-027-cfg-target@localhost', 'manager', true, NULL)
  RETURNING id INTO target;

  INSERT INTO login_verifications (session_id, user_id, email, code_hash, expires_at, verified_at)
  VALUES (sid, hr_uid, 'verify-027-cfg@localhost', NULL, now() + interval '1 hour', now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', hr_uid, 'role', 'authenticated', 'session_id', sid,
                      'user_role', 'hr_admin', 'email', 'verify-027-cfg@localhost')::text,
    true);

  -- Blank the URL for the duration of this transaction only.
  UPDATE app_config SET value = '""'::jsonb WHERE key = 'app_base_url';

  res := public.send_employee_invitation(target);
  RAISE NOTICE 'app_base_url blank -> %', res;
  IF res->>'status' <> 'app_url_not_configured' THEN
    RAISE EXCEPTION 'FAIL: blank app_base_url returned %', res->>'status';
  END IF;

  -- No send may have been recorded, and no email queued.
  IF EXISTS (SELECT 1 FROM invitation_sends WHERE employee_id = target) THEN
    RAISE EXCEPTION 'FAIL: a refused send was still recorded.';
  END IF;

  RAISE NOTICE 'E PASS: a missing application URL refuses and records nothing.';
END;
$$;

ROLLBACK;

-- The Brevo half of test 14 cannot be exercised without removing a Vault
-- secret, which is not something to do casually on a working project. The
-- code path is the same one migration 025 already uses and returns
-- 'email_not_configured' from the identical check; section 0 confirms both
-- secrets are present, which is the practical assurance.
--
-- Note the ORDER in the function: app_base_url is checked BEFORE the Vault
-- read, so a misconfigured URL never reaches the provider.


-- ============================================================
--  F. Permissions and isolation.
-- ============================================================

SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_may_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_may_execute
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('send_employee_invitation', 'invitation_delivery_status')
 ORDER BY p.proname;
-- EXPECT anon false, authenticated true, for both. The functions authorise
-- the caller themselves; the GRANT only lets them be called.

SELECT relrowsecurity                                            AS rls_enabled,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'invitation_sends') AS policies,
       has_table_privilege('authenticated', 'invitation_sends', 'SELECT') AS authenticated_may_read
  FROM pg_class WHERE oid = 'public.invitation_sends'::regclass;
-- EXPECT rls_enabled true, policies 0, authenticated_may_read false.
-- Same posture as login_verifications: the client cannot read the ledger.


-- ============================================================
--  G. Nothing else moved.   Tests 17, 18, 19.
-- ============================================================

SELECT proname,
       pg_get_functiondef(oid) LIKE '%api.brevo.com%'   AS still_uses_brevo,
       pg_get_functiondef(oid) LIKE '%login_code_sends%' AS still_rate_limits
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace AND proname = 'request_login_code';
-- EXPECT both true — 027 does not touch the 2FA email flow.

SELECT proname,
       pg_get_functiondef(oid) LIKE '%session_second_factor_ok%' AS still_needs_2fa,
       pg_get_functiondef(oid) NOT LIKE '%signup_role%'          AS takes_no_browser_role
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_employee_account';
-- EXPECT both true — the setup/signup flow is unchanged by 027.

SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.employees'::regclass AND NOT tgisinternal
 ORDER BY tgname;
-- EXPECT assign_employee_id, guard_employee_role_change,
-- guard_employee_role_insert, guard_last_admin_active, set_employees_updated_at.

SELECT count(*) AS leftover_rows FROM employees WHERE email LIKE 'verify-027%';
-- EXPECT 0. Every section rolled back.


-- ============================================================
--  H. REAL DELIVERY — run by hand, with a real address.
--
--  The sections above deliberately use @localhost so that nothing is actually
--  mailed. This is the one test that must reach an inbox, and it is the only
--  way to confirm the whole path end to end.
--
--  1. In the app, as HR or Super Admin: Employees -> Add employee.
--     Name, a REAL address you can read, Role = Manager. Create & invite.
--  2. In the dialog, press "Send invitation email".
--       EXPECT "Invitation email queued", becoming "Invitation email sent"
--       about 2.5 seconds later.
--  3. Check the inbox. The email should name the person, say Manager, and
--     carry a "Complete your account" button.
--  4. The link must be  <app_base_url>/manager/setup?email=...
--     Open it: the page must read "Set Up Manager Account" and, once the name
--     and address match, show "You've been invited ... as a Manager".
--  5. Repeat with Role = HR and confirm the link is /hr/setup.
--
--  Then confirm the provider's own view:

SELECT s.sent_at,
       e.email    AS invited,
       e.role     AS invited_as,
       b.email    AS sent_by,
       public.invitation_delivery_status(s.employee_id) ->> 'status' AS delivery
  FROM invitation_sends s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN employees b ON b.id = s.sent_by
 ORDER BY s.sent_at DESC
 LIMIT 10;

-- EXPECT delivery = 'sent' for the ones that arrived. 'failed' with a reason
-- of provider_auth or invalid_sender points at the Brevo configuration;
-- recipient_not_allowed means the sender is not verified for that recipient.
-- ============================================================
