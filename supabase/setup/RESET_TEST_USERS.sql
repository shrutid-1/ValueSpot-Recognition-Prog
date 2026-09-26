-- ============================================================
--  TEST DATA RESET — remove every user except the Super Admin
--
--  ⚠️  DESTRUCTIVE. Development/testing only. Never run against data you
--      would miss. There is no undo once STEP 3 commits.
--
--  This is a DATA reset, not a schema change. It creates, alters and drops
--  nothing: no table, column, constraint, index, policy, trigger or function.
--  Every foreign key, RLS policy and guard stays exactly as it is, and the
--  script works within them rather than around them.
--
--  WHAT SURVIVES
--    the Super Admin's employees row and auth.users row, untouched
--    core_values, behaviours, scenarios, badge_definitions, rewards
--    departments, projects, app_config (signup domains and everything else)
--    every audit_logs row -- see the note on actor_id in STEP 2
--    all functions, triggers, policies and migrations
--
--  WHAT GOES
--    every other employees row, whatever its role
--    every other auth.users row, INCLUDING abandoned signups that never
--      finished verification and so never got an employee record
--    their nominations, appreciations, badges, notifications, rewards,
--      project memberships, reciprocal flags
--    every login_verifications / login_code_sends row belonging to them
--
--  Afterwards their email addresses are free for fresh testing, because both
--  uniqueness constraints that hold an address are released: employees.email
--  and auth.users.email.
--
--  HOW THE SUPER ADMIN IS PROTECTED
--    Identified by QUERY, never by a hardcoded address:
--      role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL
--    STEP 3 aborts unless EXACTLY ONE such account exists, and every delete
--    below is written as "except that one". The whole of STEP 3 is one
--    transaction with a verification block at the end that raises -- rolling
--    everything back -- if the Super Admin is not intact when it finishes.
--
--  RUN STEP 0, THEN 1, AND READ THEM. Only run STEP 3 once you agree with
--  what STEP 1 listed.
-- ============================================================


-- ============================================================
--  STEP 0 — Who is the Super Admin?  (READ-ONLY)
-- ============================================================

SELECT e.id            AS employee_id,
       e.employee_id   AS company_id,
       e.full_name,
       e.email,
       e.role,
       e.is_active,
       e.auth_user_id,
       u.email         AS auth_email,
       u.last_sign_in_at
  FROM employees e
  LEFT JOIN auth.users u ON u.id = e.auth_user_id
 WHERE e.role = 'super_admin'
 ORDER BY e.created_at;

-- EXPECT EXACTLY ONE ROW, is_active = true, auth_user_id NOT NULL.
--
--   More than one usable row -> STOP. STEP 3 will refuse. Decide which one
--     survives and demote the other from Administration first.
--   Zero rows -> STOP. There is no Super Admin to preserve and this script
--     would empty the system. Nothing below is safe to run.
--
-- Read the email on this row and satisfy yourself it is the account you
-- intend to keep before going any further.


-- ============================================================
--  STEP 1 — Exactly what would be removed  (READ-ONLY)
-- ============================================================

WITH sa AS (
  SELECT id AS emp_id, auth_user_id
    FROM employees
   WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL
   LIMIT 1
)
SELECT 'employees (other users)'        AS what,
       count(*)                         AS rows_removed
  FROM employees e, sa WHERE e.id <> sa.emp_id
UNION ALL SELECT 'auth.users (other logins)', count(*)
  FROM auth.users u, sa WHERE u.id <> sa.auth_user_id
UNION ALL SELECT '  ...of which never finished signup', count(*)
  FROM auth.users u, sa
 WHERE u.id <> sa.auth_user_id
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.auth_user_id = u.id)
UNION ALL SELECT 'nominations (given or received)', count(*)
  FROM nominations n, sa
 WHERE n.nominator_id <> sa.emp_id OR n.nominee_id <> sa.emp_id
UNION ALL SELECT 'notifications', count(*)
  FROM notifications x, sa WHERE x.recipient_id <> sa.emp_id
UNION ALL SELECT 'employee_value_badges', count(*)
  FROM employee_value_badges x, sa WHERE x.employee_id <> sa.emp_id
UNION ALL SELECT 'badge_history', count(*)
  FROM badge_history x, sa WHERE x.employee_id <> sa.emp_id
UNION ALL SELECT 'project_members', count(*)
  FROM project_members x, sa WHERE x.employee_id <> sa.emp_id
UNION ALL SELECT 'reward_assignments', count(*)
  FROM reward_assignments x, sa
 WHERE x.employee_id <> sa.emp_id OR x.assigned_by <> sa.emp_id
UNION ALL SELECT 'reciprocal_recognition_flags', count(*)
  FROM reciprocal_recognition_flags x, sa
 WHERE x.employee_a_id <> sa.emp_id OR x.employee_b_id <> sa.emp_id
UNION ALL SELECT 'login_verifications (2FA state)', count(*)
  FROM login_verifications x, sa WHERE x.user_id <> sa.auth_user_id
UNION ALL SELECT 'login_code_sends (rate limiting)', count(*)
  FROM login_code_sends x, sa WHERE x.user_id <> sa.auth_user_id
UNION ALL SELECT 'audit_logs KEPT, actor_id nulled', count(*)
  FROM audit_logs a, sa WHERE a.actor_id IS NOT NULL AND a.actor_id <> sa.emp_id;

-- The last line is the one exception to "user data goes". See STEP 2.


-- Which people, by name and address:
WITH sa AS (
  SELECT id AS emp_id FROM employees
   WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL LIMIT 1
)
SELECT e.full_name, e.email, e.role, e.is_active,
       e.auth_user_id IS NOT NULL AS has_login
  FROM employees e, sa
 WHERE e.id <> sa.emp_id
 ORDER BY e.role, e.email;


-- Auth logins with no employee record — abandoned signups. These are invisible
-- in the app but still hold their email address hostage, which is exactly the
-- problem this reset is meant to solve.
SELECT u.email, u.created_at, u.last_sign_in_at
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.auth_user_id = u.id)
 ORDER BY u.created_at;


-- ============================================================
--  STEP 2 — What cannot simply be deleted, and why
--
--  audit_logs
--    actor_id REFERENCES employees(id) with NO ACTION, so deleting a person
--    who appears in the audit trail would be refused outright. Two ways out:
--    delete the history, or keep it and release the reference.
--
--    This script KEEPS IT and sets actor_id = NULL. The row already carries
--    actor_email, so "who granted administrator access in September" is still
--    answerable after the reset. An audit trail that deletes itself whenever
--    someone leaves is not an audit trail, and Security activity in
--    Administration reads this table.
--
--  nominations
--    nominator_id / nominee_id are NOT NULL with ON DELETE RESTRICT -- chosen
--    deliberately in migration 003 so recognitions cannot be silently
--    orphaned. They cannot be nulled and they cannot cascade, so the
--    nominations themselves must go. That is correct for a test reset: a
--    recognition whose giver or receiver no longer exists is not meaningful
--    data. nomination_appreciations follow by ON DELETE CASCADE.
--
--  projects / app_config / employees.manager_id
--    Optional references from records that must SURVIVE. Nulled rather than
--    deleted, so a project outlives the manager who ran it and app_config
--    keeps its value after the admin who set it is gone.
--
--  NOTHING BELOW WEAKENS A CONSTRAINT. No FK is dropped, deferred or altered;
--  the deletions are simply ordered so that every constraint is satisfied as
--  it is written.
-- ============================================================


-- ============================================================
--  STEP 3 — THE RESET.  ⚠️ DESTRUCTIVE. Run only after STEP 1.
--
--  One transaction. If the closing verification is unhappy it raises, and
--  everything here rolls back untouched.
-- ============================================================

BEGIN;

DO $$
DECLARE
  sa_emp  uuid;
  sa_auth uuid;
  sa_mail text;
  n_sa    integer;
  removed integer;
BEGIN
  -- ── The guard. Identify by query; refuse on anything ambiguous. ──
  SELECT count(*) INTO n_sa
    FROM employees
   WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL;

  IF n_sa <> 1 THEN
    RAISE EXCEPTION
      'Refusing to run: found % usable super_admin accounts, expected exactly 1. '
      'Resolve this from Administration first.', n_sa;
  END IF;

  SELECT id, auth_user_id, email INTO sa_emp, sa_auth, sa_mail
    FROM employees
   WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL;

  RAISE NOTICE 'Preserving Super Admin: % (employee %, auth %)', sa_mail, sa_emp, sa_auth;

  -- ── 1. Release optional references held by records that SURVIVE ──

  -- Audit history is kept. actor_email still records who acted.
  UPDATE audit_logs SET actor_id = NULL
   WHERE actor_id IS NOT NULL AND actor_id <> sa_emp;

  UPDATE app_config SET updated_by = NULL
   WHERE updated_by IS NOT NULL AND updated_by <> sa_emp;

  UPDATE projects SET manager_id = NULL
   WHERE manager_id IS NOT NULL AND manager_id <> sa_emp;

  -- The Super Admin may report to someone who is about to be removed.
  UPDATE employees SET manager_id = NULL
   WHERE manager_id IS NOT NULL AND manager_id <> sa_emp;

  -- Optional approver references on nominations that will survive.
  UPDATE nominations SET assigned_approver_id = NULL
   WHERE assigned_approver_id IS NOT NULL AND assigned_approver_id <> sa_emp;
  UPDATE nominations SET approved_by_id = NULL
   WHERE approved_by_id IS NOT NULL AND approved_by_id <> sa_emp;
  UPDATE nominations SET rejected_by_id = NULL
   WHERE rejected_by_id IS NOT NULL AND rejected_by_id <> sa_emp;

  UPDATE reciprocal_recognition_flags SET reviewed_by_id = NULL
   WHERE reviewed_by_id IS NOT NULL AND reviewed_by_id <> sa_emp;

  -- ── 2. Remove dependent rows, innermost first ──

  DELETE FROM nomination_appreciations
   WHERE employee_id <> sa_emp;

  -- A surviving reward assignment must not point at a nomination we remove.
  UPDATE reward_assignments ra SET nomination_id = NULL
   WHERE ra.nomination_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM nominations n
                  WHERE n.id = ra.nomination_id
                    AND (n.nominator_id <> sa_emp OR n.nominee_id <> sa_emp));

  DELETE FROM reward_assignments
   WHERE employee_id <> sa_emp OR assigned_by <> sa_emp;

  DELETE FROM reciprocal_recognition_flags
   WHERE employee_a_id <> sa_emp OR employee_b_id <> sa_emp;

  DELETE FROM notifications         WHERE recipient_id <> sa_emp;
  DELETE FROM employee_value_badges WHERE employee_id  <> sa_emp;
  DELETE FROM badge_history         WHERE employee_id  <> sa_emp;
  DELETE FROM project_members       WHERE employee_id  <> sa_emp;

  -- ON DELETE RESTRICT on both ends, so these must go before the people do.
  -- Appreciations on these nominations follow by ON DELETE CASCADE.
  DELETE FROM nominations
   WHERE nominator_id <> sa_emp OR nominee_id <> sa_emp;

  -- ── 3. The people ──
  DELETE FROM employees WHERE id <> sa_emp;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'Removed % employee record(s).', removed;

  -- ── 4. Their authentication state ──
  -- No FK on these two tables; they key on the auth user id.
  DELETE FROM login_verifications WHERE user_id <> sa_auth;
  DELETE FROM login_code_sends    WHERE user_id <> sa_auth;

  -- Every other login, including signups that never finished verification.
  DELETE FROM auth.users WHERE id <> sa_auth;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'Removed % auth login(s).', removed;

  -- ── 5. Prove the Super Admin came through intact ──
  PERFORM 1 FROM employees
   WHERE id = sa_emp
     AND role = 'super_admin'
     AND is_active
     AND auth_user_id = sa_auth;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: the Super Admin employees row is not intact. Rolling back.';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = sa_auth;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: the Super Admin auth.users row is gone. Rolling back.';
  END IF;

  SELECT count(*) INTO n_sa FROM employees;
  IF n_sa <> 1 THEN
    RAISE EXCEPTION 'ABORT: % employee rows remain, expected exactly 1. Rolling back.', n_sa;
  END IF;

  SELECT count(*) INTO n_sa FROM auth.users;
  IF n_sa <> 1 THEN
    RAISE EXCEPTION 'ABORT: % auth users remain, expected exactly 1. Rolling back.', n_sa;
  END IF;

  RAISE NOTICE 'Reset complete. % remains as super_admin.', sa_mail;
END;
$$;

COMMIT;


-- ============================================================
--  STEP 4 — Verification  (READ-ONLY, run after STEP 3)
-- ============================================================

-- 1, 2, 3: the Super Admin survives, still super_admin, and is the only user.
SELECT e.full_name, e.email, e.role, e.is_active,
       e.auth_user_id IS NOT NULL AS can_sign_in
  FROM employees e;
-- EXPECT one row: role super_admin, is_active true, can_sign_in true.

-- 4: no other auth logins.
SELECT count(*) AS auth_users_total FROM auth.users;
-- EXPECT 1.

-- 5: no orphans on either side.
SELECT (SELECT count(*) FROM employees e
         WHERE e.auth_user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.auth_user_id))
         AS employees_pointing_at_missing_logins,
       (SELECT count(*) FROM auth.users u
         WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.auth_user_id = u.id))
         AS logins_with_no_employee_record;
-- EXPECT 0 and 0.

-- 6: the addresses you want to reuse are genuinely free.
--    Edit the list, then expect ZERO rows back.
-- SELECT 'employees' AS held_in, email FROM employees
--  WHERE lower(email) IN ('you@example.com', 'other@example.com')
-- UNION ALL
-- SELECT 'auth.users', email FROM auth.users
--  WHERE lower(email) IN ('you@example.com', 'other@example.com');

-- 7: system and reference data untouched.
SELECT (SELECT count(*) FROM core_values)      AS core_values,
       (SELECT count(*) FROM behaviours)       AS behaviours,
       (SELECT count(*) FROM scenarios)        AS scenarios,
       (SELECT count(*) FROM departments)      AS departments,
       (SELECT count(*) FROM projects)         AS projects,
       (SELECT count(*) FROM badge_definitions) AS badge_definitions,
       (SELECT count(*) FROM rewards)          AS rewards,
       (SELECT count(*) FROM app_config)       AS app_config,
       (SELECT count(*) FROM audit_logs)       AS audit_logs_kept;
-- EXPECT the same numbers as before the reset. audit_logs in particular must
-- NOT have dropped -- only its actor_id references were released.

-- Security objects are untouched by construction, but confirm:
SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies,
       (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'public.employees'::regclass AND NOT tgisinternal) AS employee_triggers;
-- EXPECT the same counts as before; this script creates and drops nothing.


-- ============================================================
--  AFTERWARDS
--
--  The Super Admin's own session is unaffected -- their login_verifications
--  row was kept, so they are not signed out and will not be asked for a new
--  code. If you would rather force a clean sign-in, sign out in the app
--  normally; migration 023 revokes the verification on the way out.
--
--  With the system down to one user, has_usable_admin() is still true, so the
--  founding-administrator bootstrap stays closed. New signups behave exactly
--  as they do in production: the public form creates an Employee, and Manager
--  and HR still require an invitation from Employees -> Add employee.
-- ============================================================
