-- ============================================================
--  DEVELOPMENT ONLY — sign in test accounts without email delivery
--
--  Resend's shared test sender (onboarding@resend.dev) delivers only to the
--  address that owns the Resend account. Every other test account can sign in
--  with its password but never receives a code. This replaces the EMAIL
--  DELIVERY step, and nothing else.
--
--
--  WHAT IS AND IS NOT REPLACED
--  ---------------------------
--  verify_login_code() compares sha256(code || ':' || session_id) against
--  login_verifications.code_hash. As the SQL Editor operator you can write
--  that hash yourself and choose the code. The sign-in then completes through
--  the real function:
--
--      real hash comparison   real expiry check   real attempt counter
--      real session binding   real RLS            real role routing
--
--  So you are testing the actual authentication path, not a substitute for it.
--
--
--  WHY THIS IS NOT A PRODUCTION BACKDOOR
--  -------------------------------------
--  It has NO presence in the database or the application:
--
--      no function      no RPC        no grant
--      no feature flag  no code path  no reference from src/
--
--  It is a file that a project owner pastes into the SQL Editor. An ordinary
--  user cannot invoke a file. There is nothing to switch off before shipping,
--  because nothing was ever added — and anyone able to run this already has
--  full database access and would have no need of a login bypass.
--
--  Every statement is additionally limited to rows where verified_at IS NULL,
--  so it cannot un-verify a live session, re-verify a spent one, or touch a
--  role.
--
--  Do not run it against production.
-- ============================================================


-- ── A. Who is waiting on a code right now? ──────────────────
--
-- Run this first. Each row is a browser sitting on the verification screen.
-- Open all your test accounts, then look here to confirm they are all pending.

SELECT u.email,
       COALESCE(e.role, '(no employee record yet)') AS role,
       v.created_at,
       v.expires_at > now() AS still_valid,
       v.attempts
  FROM login_verifications v
  JOIN auth.users u ON u.id = v.user_id
  LEFT JOIN employees e ON e.auth_user_id = v.user_id
 WHERE v.verified_at IS NULL
 ORDER BY v.created_at DESC;


-- ── B. Plant the code 123456 for EVERY pending session ──────
--
-- The time-saver. Open all six or nine test accounts in separate browser
-- profiles or private windows, leave each on the code screen, run this ONCE,
-- then type 123456 in all of them.
--
-- Nothing needs editing. Only pending rows are affected.

UPDATE login_verifications v
   SET code_hash  = public.hash_login_code('123456', v.session_id),
       expires_at = now() + interval '60 minutes',
       attempts   = 0
  FROM auth.users u
 WHERE u.id = v.user_id
   AND v.verified_at IS NULL
RETURNING u.email, v.expires_at;

-- Each row returned is an account that can now be finished with 123456.
-- The hash is still salted per session_id, so these are six different stored
-- hashes that happen to accept the same typed code. Session binding is intact:
-- one account's row still cannot verify another's session.


-- ── C. Or just one account ──────────────────────────────────
--
-- When you want the others left alone. Edit the address on the marked line.

-- UPDATE login_verifications v
--    SET code_hash  = public.hash_login_code('123456', v.session_id),
--        expires_at = now() + interval '60 minutes',
--        attempts   = 0
--   FROM auth.users u
--  WHERE u.id = v.user_id
--    AND lower(u.email) = lower('employee-test-1@gmail.com')   -- <-- edit
--    AND v.verified_at IS NULL
-- RETURNING u.email, v.expires_at;


-- ── D. Confirm the sign-ins really completed ────────────────

SELECT u.email,
       COALESCE(e.role, '(none)')  AS role,
       v.verified_at IS NOT NULL   AS verified,
       v.code_hash IS NULL         AS hash_destroyed
  FROM login_verifications v
  JOIN auth.users u ON u.id = v.user_id
  LEFT JOIN employees e ON e.auth_user_id = v.user_id
 ORDER BY v.created_at DESC
 LIMIT 20;

-- EXPECT verified = true AND hash_destroyed = true.
-- hash_destroyed proves single use still holds: verify_login_code() nulls the
-- hash on success, so the code cannot be replayed.


-- ── E. Give the test accounts their roles ───────────────────
--
-- Each account signs up as 'employee' — self-registration can never mint a
-- higher role, which is correct and must not be changed.
--
-- Prefer promoting from the app: sign in as Super Admin and use
-- Administration, because that exercises the real permission path including
-- the hr_admin/super_admin boundary and the last-admin protection.
--
-- Use these only to set fixtures up quickly. Uncomment what you need.

-- UPDATE employees SET role = 'manager'
--  WHERE lower(email) IN ('manager-test-1@gmail.com', 'manager-test-2@gmail.com');

-- UPDATE employees SET role = 'hr_admin'
--  WHERE lower(email) IN ('hr-test-1@gmail.com', 'hr-test-2@gmail.com');

-- Employees need no statement; 'employee' is already the signup default.
--
-- NOTE: a role change only reaches RLS when the JWT is reissued, because
-- user_role is stamped into the token by custom_access_token_hook. Sign the
-- account out and in again after promoting it.


-- ── F. Reset a test account to try the flow again ───────────
--
-- Clears the pending verification so the next sign-in starts clean. Does not
-- delete the account and does not touch any employee data.

-- DELETE FROM login_verifications
--  WHERE verified_at IS NULL
--    AND user_id = (SELECT id FROM auth.users
--                    WHERE lower(email) = lower('employee-test-1@gmail.com'));


-- ── G. Remove the test accounts when finished ───────────────
--
-- Employees with any history (nominations, badges, approvals) are protected by
-- foreign keys and will refuse to delete. That is intended — do not force it.
-- Prefer deactivating from the Employees page instead of deleting.

-- UPDATE employees SET is_active = false
--  WHERE lower(email) LIKE '%-test-%@gmail.com';
